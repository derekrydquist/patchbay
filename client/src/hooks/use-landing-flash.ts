import { useEffect, useSyncExternalStore, type RefObject } from 'react';

// ── Landing flash: show where a file went ─────────────────────────────────────
// After any action that lands a file in a file browser (a move, organize, assign,
// upload, ...), the row or card it landed as scrolls into view inside its own column
// and flashes gold. One shared mechanism for every surface:
//
//   - The code that performs the action (a mutation's onSuccess, UploadModal) calls
//     requestLandingFlash([{ id, zone }]) once it knows where the file now lives.
//   - Every file row/card calls useLandingFlash(id, zone, ref) with its OWN id and a
//     zone computed from its OWN data. When a request matches, that element is the
//     landed file: it takes the request, scrolls within its own scroller, flashes.
//
// The zone is what keeps a stale row from flashing. Right after a move the file can
// still be mounted at its old location (the destination list refetches first, or
// the source list hasn't refetched yet) — same id, but its old data puts it in a
// different zone, so it never matches. Zones:
//   clip:<ideaId>     an organized clip card (BucketClip, SongsClipContextMenuCard,
//                     IdeaClipCard) — from the clip's own ideaId
//   track:<trackId>   a Track-scoped loose file (a track's shelf in the Sections column)
//   song:<songId>     a song-level loose file (Tracks column, or a legacy file in an
//                     Idea's Column 2)
//   band              a band-wide loose file (Ideas shelf Column 1)
//
// Works in either order: a row that mounts after the request matches on mount, and
// a row already mounted when the request arrives matches through the store
// subscription. Requests that never match (the destination isn't on screen, a search
// hides the file) expire after LANDING_REQUEST_TTL_MS and are dropped silently.

export function clipLandingZone(ideaId: string): string {
  return `clip:${ideaId}`;
}

export function looseLandingZone(looseFile: { trackId: string | null; songId: string | null }): string {
  if (looseFile.trackId) return `track:${looseFile.trackId}`;
  if (looseFile.songId) return `song:${looseFile.songId}`;
  return 'band';
}

export interface LandingFlashItem {
  id: string;
  zone: string;
}

const LANDING_REQUEST_TTL_MS = 6000;

// One request batch: every file one action landed. The batch scrolls once (to the
// topmost of its matched elements) and flashes them all.
interface LandingBatch {
  // Elements matched since the last frame, waiting to scroll + flash together.
  matched: HTMLElement[];
  frame: number | null;
  scrolled: boolean;
}

const pending = new Map<string, LandingBatch>(); // `${zone}|${id}` → batch
const listeners = new Set<() => void>();

function keyOf(id: string, zone: string): string {
  return `${zone}|${id}`;
}

function notify(): void {
  listeners.forEach(l => l());
}

export function requestLandingFlash(items: LandingFlashItem[]): void {
  if (!items.length) return;
  const batch: LandingBatch = { matched: [], frame: null, scrolled: false };
  const keys = items.map(i => keyOf(i.id, i.zone));
  for (const key of keys) pending.set(key, batch);
  notify();
  setTimeout(() => {
    let changed = false;
    for (const key of keys) {
      if (pending.get(key) === batch) { pending.delete(key); changed = true; }
    }
    if (changed) notify();
  }, LANDING_REQUEST_TTL_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Called by the matching element: removes its request and queues it on its batch.
// Matches committed in the same render land in the same frame, so a multi-file
// upload's rows scroll + flash together (scrollBatchIntoView: the whole batch when
// it fits, else its topmost). A straggler that mounts in a later frame still
// flashes; it scrolls only if its batch hasn't scrolled yet.
function takeLanding(key: string, el: HTMLElement): void {
  const batch = pending.get(key);
  if (!batch) return;
  pending.delete(key);
  notify();
  batch.matched.push(el);
  if (batch.frame !== null) return;
  batch.frame = requestAnimationFrame(() => {
    batch.frame = null;
    const els = batch.matched.filter(e => e.isConnected);
    batch.matched = [];
    if (!els.length) return;
    if (!batch.scrolled) {
      batch.scrolled = true;
      scrollBatchIntoView(els);
    }
    for (const e of els) flashGold(e, { peakAlpha: LANDING_FLASH_PEAK_ALPHA, reducedMotion: 'ring' });
  });
}

/**
 * Scroll + flash this element when a requestLandingFlash item matches its id and
 * zone. `id`/`zone` must come from the element's own data, never from the request.
 */
export function useLandingFlash(id: string, zone: string, ref: RefObject<HTMLElement | null>): void {
  const key = keyOf(id, zone);
  const isPending = useSyncExternalStore(subscribe, () => pending.has(key));
  useEffect(() => {
    if (isPending && ref.current) takeLanding(key, ref.current);
  }, [isPending, key, ref]);
}

// ── Scrolling: only the element's own column ─────────────────────────────────
// Never scrollIntoView: it also scrolls the window (Dashboard and SongHome scroll
// with the page) and overflow-hidden ancestors the user can't scroll back. Instead,
// find the nearest scroll container — a Radix ScrollArea viewport or an
// overflow-y auto/scroll ancestor — and scroll only that, only if the element is
// outside its visible area. The document itself is never a candidate, and the
// timeline's scroller is never an ancestor of a file-browser row.

const SCROLL_MARGIN_PX = 8;

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function findOwnScroller(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.hasAttribute('data-radix-scroll-area-viewport')) return node;
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

// Scroll a batch's column the minimum amount that shows ALL of its matched
// elements, when they fit in the column's visible height; when they don't, bring
// the topmost into view. Nothing moves when they're already all visible. Only the
// elements in the topmost element's scroller count — one batch lands in one column.
function scrollBatchIntoView(els: HTMLElement[]): void {
  const rects = els.map(el => ({ el, r: el.getBoundingClientRect() }));
  const topmost = rects.reduce((a, b) => (b.r.top < a.r.top ? b : a));
  const scroller = findOwnScroller(topmost.el);
  if (!scroller) return;
  const inColumn = rects.filter(({ el }) => findOwnScroller(el) === scroller);
  const top = topmost.r.top;
  const bottom = Math.max(...inColumn.map(({ r }) => r.bottom));
  const view = scroller.getBoundingClientRect();
  const fits = bottom - top + 2 * SCROLL_MARGIN_PX <= view.height;
  let delta = 0;
  if (top < view.top) {
    delta = top - view.top - SCROLL_MARGIN_PX;
  } else if (bottom > view.bottom) {
    const showBottom = bottom - view.bottom + SCROLL_MARGIN_PX;
    const topToTop = top - view.top - SCROLL_MARGIN_PX;
    // Fits: just enough to show the bottom (the top stays in view by construction).
    // Doesn't fit: the topmost item to the top edge.
    delta = fits ? showBottom : Math.min(showBottom, topToTop);
  }
  if (delta === 0) return;
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// ── Gold flash ───────────────────────────────────────────────────────────────
// A quick rise to a soft peak, a short hold, then a long ease-out fade so the tail
// stays visible. Web Animations API on the existing node: no remount (which would
// re-register a drop target), no inserted element, no size change. Only the peak
// keyframe is given; the start and end are implicit, so the flash rises from and
// fades back into the element's LIVE background/box-shadow — a highlight that turns
// on mid-flash shows through as it fades instead of being overwritten. A second
// flash on the same element cancels the running one and restarts it.

export const FLASH_RISE_MS = 150;
export const FLASH_HOLD_MS = 150;
export const FLASH_FADE_MS = 900;
/** Gold alpha at the peak of a landed row/card's flash (background and inset ring).
 *  About double the spring column flash's, so it still shows on a selected
 *  (bg-primary/20) row. */
export const LANDING_FLASH_PEAK_ALPHA = 0.36;
/** Gold alpha of a timeline clip's landing glow — a ring plus a soft glow OUTSIDE the
 *  clip's edge (never a tint: Drums clips are gold), so it shows on every track color. */
export const TIMELINE_LANDING_GLOW_ALPHA = 0.95;
/** prefers-reduced-motion: how long the static ring replacing the animation stays. */
export const REDUCED_MOTION_RING_MS = 1500;
const REDUCED_MOTION_RING_COLOR = 'rgba(212, 175, 55, 0.9)';

export interface FlashGoldOptions {
  /** Gold alpha at the peak, for both the background and the inset ring. */
  peakAlpha: number;
  riseMs?: number;
  holdMs?: number;
  fadeMs?: number;
  /** Under prefers-reduced-motion: 'skip' does nothing, 'ring' shows a static gold
   *  ring for REDUCED_MOTION_RING_MS instead of the animation. */
  reducedMotion: 'skip' | 'ring';
  /** 'tint' (default): background tint + inset ring — file-browser rows, cards and
   *  columns. 'outerGlow': a ring and glow outside the element's edge, no tint —
   *  timeline clips. Its reduced-motion ring sits outside the edge too. */
  look?: 'tint' | 'outerGlow';
}

const runningFlashes = new WeakMap<Element, Animation>();
const runningRings = new WeakMap<HTMLElement, { timer: ReturnType<typeof setTimeout>; prevOutline: string; prevOffset: string }>();

export function flashGold(el: HTMLElement | null, options: FlashGoldOptions): void {
  if (!el) return;
  const look = options.look ?? 'tint';
  if (prefersReducedMotion()) {
    if (options.reducedMotion === 'ring') showStaticRing(el, look === 'outerGlow');
    return;
  }
  if (typeof el.animate !== 'function') return;
  runningFlashes.get(el)?.cancel();
  const rise = options.riseMs ?? FLASH_RISE_MS;
  const hold = options.holdMs ?? FLASH_HOLD_MS;
  const fade = options.fadeMs ?? FLASH_FADE_MS;
  const gold = `rgba(212, 175, 55, ${options.peakAlpha})`;
  const duration = rise + hold + fade;
  if (look === 'outerGlow') {
    // Explicit transparent endpoints with the same two-shadow structure as the peak,
    // so the shadows always interpolate (an implicit start from the element's own,
    // differently-shaped box-shadow list could snap instead of fading).
    const glow = (a: number) =>
      `0 0 0 2px rgba(212, 175, 55, ${a}), 0 0 14px 4px rgba(212, 175, 55, ${a * 0.6})`;
    const peak = { boxShadow: glow(options.peakAlpha) };
    const animation = el.animate(
      [
        { offset: 0, boxShadow: glow(0) },
        { offset: rise / duration, ...peak },
        { offset: (rise + hold) / duration, ...peak, easing: 'ease-out' },
        { offset: 1, boxShadow: glow(0) },
      ],
      { duration, easing: 'linear' }
    );
    runningFlashes.set(el, animation);
    return;
  }
  const peak = { backgroundColor: gold, boxShadow: `inset 0 0 0 2px ${gold}` };
  // Offsets 0 and 1 are implicit (the element's own live values). A keyframe's
  // easing applies to the segment that starts at it: the rise (implicit 0 → peak
  // start) is linear, the hold is flat, only the fade (peak end → implicit 1) eases out.
  const animation = el.animate(
    [
      { offset: rise / duration, ...peak },
      { offset: (rise + hold) / duration, ...peak, easing: 'ease-out' },
    ],
    { duration, easing: 'linear' }
  );
  runningFlashes.set(el, animation);
}

// Inline outline — inset so an overflow-hidden card doesn't clip it, or just outside
// the edge for a timeline clip; the element's previous inline outline is put back
// afterwards.
function showStaticRing(el: HTMLElement, outside: boolean): void {
  const running = runningRings.get(el);
  if (running) clearTimeout(running.timer);
  const prevOutline = running ? running.prevOutline : el.style.outline;
  const prevOffset = running ? running.prevOffset : el.style.outlineOffset;
  el.style.outline = `2px solid ${REDUCED_MOTION_RING_COLOR}`;
  el.style.outlineOffset = outside ? '1px' : '-2px';
  const timer = setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
    runningRings.delete(el);
  }, REDUCED_MOTION_RING_MS);
  runningRings.set(el, { timer, prevOutline, prevOffset });
}
