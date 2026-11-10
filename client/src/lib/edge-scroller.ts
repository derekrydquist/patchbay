// Edge scroll for a drag: scrolls an element while the pointer rests near one of its
// edges. Shared by the timeline (section header drags, timeline clip drags, Media
// Bucket file drags) and the file browser columns (useColumnEdgeScroll).

// Edge-scroll constants — the playhead drag's (handlePlayheadPointerDown in Timeline.tsx),
// shared by createEdgeScroller below. EDGE_ZONE_PX / EDGE_ZONE_RELEASE_PX are
// hysteresis thresholds ONLY — they decide when the auto-scroll zone turns on/off in the
// playhead's handlePointerMove. They are
// deliberately NOT used by clampToVisibleWindow's bound formula. Those two jobs (zone
// activation vs. position-clamp bound) have different correctness requirements: the clamp
// bound must reach exactly 0 / endOfTimeline at the true scroll limits with a constant
// (undistorted) rate throughout, which a shared hysteresis-distance constant cannot express
// without either leaving a residual floor/ceiling (a fixed margin) or a variable-rate taper
// (margin that shrinks with scrollLeft — tried and reverted; a linear taper doubles the
// effective rate throughout the tapered region, and a smoothstep taper only matches the rate
// AT the two endpoints while leaving a ~2.5x mid-taper speed bump). See clampToVisibleWindow
// in Timeline.tsx for the constant-rate, no-margin formula that replaced both.
export const SCROLL_SPEED_PX = 300;       // pixels/second of viewport scroll when the zone is active
export const EDGE_ZONE_PX = 150;          // pointer within this px of the edge → zone ON
export const EDGE_ZONE_RELEASE_PX = 210;  // pointer must clear this px from the edge → zone OFF
// Minimum total pointer displacement from the pointerdown origin before a zone can engage AT
// ALL. Filters the case where the flag happens to already render within EDGE_ZONE_PX at the
// moment of pointerdown (e.g. after a prior manual scroll) — without this, any sub-pixel
// jitter from a real hand trying to hold still would immediately trigger full-speed
// auto-scroll on a click the user never intended as a drag toward the edge. History: 6 -> 24
// -> 48 -> 96 -> 72. At 96 against a 100px EDGE_ZONE_PX (96% of the zone width), a natural
// drag toward the edge from a starting position already inside the zone required the cursor
// to cross onto the instrument panel (leftDist going negative) before the displacement gate
// was satisfied — confirmed via live testing, not just reasoned about. EDGE_ZONE_PX was raised
// to 150 and this lowered to 72 together to restore a real gap (78px) between the two, so a
// drag toward the edge from anywhere inside the zone can satisfy both conditions without
// needing to overshoot past the panel. Each step up from 6 still read as too sensitive for
// real trackpad input, whose OS-level pointer-acceleration curve can turn a small physical
// touch into a much larger on-screen CSS-pixel delta than the same gesture produces via direct
// pixel-targeted input. Gating logic itself confirmed correct and unbypassable; this value is
// a pure feel/tuning knob, not a correctness fix — but it and EDGE_ZONE_PX are not
// independently tunable without checking this relationship.
export const MIN_DRAG_DISTANCE_PX = 72;

// Edge scroll with the playhead drag's rules and constants: the zone turns on within
// the engage distance of the start edge (left / top, moved in by startInset — the
// timeline's sticky track panel or ruler) or of the end edge (right / bottom of the
// visible area, clientWidth / clientHeight), once the pointer has moved
// MIN_DRAG_DISTANCE_PX from the drag origin; it turns off past the release distance;
// any movement away from the edge pauses scrolling until the pointer moves toward it
// again; forward scrolling stops at endScrollCap. A pointer past the start edge (over
// the inset) is a negative distance and stays engaged. It only moves scrollLeft
// (axis 'x') or scrollTop (axis 'y'). The playhead drag keeps its own copy of this
// logic, inside handlePlayheadPointerDown, because it also derives playhead time each
// frame.
export interface EdgeScroller {
  start: (originX: number, originY: number) => void;
  onPointerMove: (e: PointerEvent) => void;
  stop: () => void;
}
export function createEdgeScroller(opts: {
  getEl: () => HTMLElement | null;
  axis?: 'x' | 'y';
  // Px from the element's left / top edge where the start edge's zone is measured from.
  startInset?: number;
  // Engage / release distances; defaults to EDGE_ZONE_PX / EDGE_ZONE_RELEASE_PX.
  zone?: (el: HTMLElement) => { engage: number; release: number };
  // Pointer travel from the origin before a zone can engage; defaults to MIN_DRAG_DISTANCE_PX.
  minDragDistance?: number;
  // Forward (right / down) scrolling stops here; defaults to the element's max scroll.
  endScrollCap?: (el: HTMLElement) => number;
  onScrolled?: (scroll: number) => void;
}): EdgeScroller {
  const vertical = opts.axis === 'y';
  const startInset = opts.startInset ?? 0;
  const minDragDistance = opts.minDragDistance ?? MIN_DRAG_DISTANCE_PX;
  const getScroll = (el: HTMLElement) => vertical ? el.scrollTop : el.scrollLeft;
  const setScroll = (el: HTMLElement, v: number) => { if (vertical) el.scrollTop = v; else el.scrollLeft = v; };
  const getMaxScroll = (el: HTMLElement) => Math.max(0, vertical
    ? el.scrollHeight - el.clientHeight
    : el.scrollWidth - el.clientWidth);
  let zone: 'off' | 'on-left' | 'on-right' = 'off'; // left/right = top/bottom on axis 'y'
  let raf: number | null = null;
  let lastTs: number | null = null;
  let lastDist: number | null = null;
  let paused = false;
  let origin = { x: 0, y: 0 };

  const stopLoop = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    lastTs = null;
  };
  const turnOff = () => {
    zone = 'off';
    lastDist = null;
    paused = false;
  };
  const frame = (timestamp: number) => {
    const el = opts.getEl();
    if (!el || zone === 'off') { stopLoop(); return; }
    if (lastTs === null) { lastTs = timestamp; raf = requestAnimationFrame(frame); return; }
    const dt = (timestamp - lastTs) / 1000;
    lastTs = timestamp;
    const dir = zone === 'on-left' ? -1 : 1;
    const maxScroll = getMaxScroll(el);
    const ceiling = dir === 1 ? (opts.endScrollCap?.(el) ?? maxScroll) : maxScroll;
    const speed = paused ? 0 : SCROLL_SPEED_PX;
    const next = Math.max(0, Math.min(getScroll(el) + dir * speed * dt, ceiling));
    setScroll(el, next);
    opts.onScrolled?.(next);
    if (next <= 0 || next >= ceiling) { stopLoop(); turnOff(); return; }
    raf = requestAnimationFrame(frame);
  };

  return {
    start(originX, originY) {
      origin = { x: originX, y: originY };
      stopLoop();
      turnOff();
    },
    onPointerMove(e) {
      const el = opts.getEl();
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const { engage, release } = opts.zone?.(el) ?? { engage: EDGE_ZONE_PX, release: EDGE_ZONE_RELEASE_PX };
      const viewportPos = vertical ? e.clientY - rect.top : e.clientX - rect.left;
      const leftDist = viewportPos - startInset;
      const rightDist = (vertical ? el.clientHeight : el.clientWidth) - viewportPos;
      const movedEnough = Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= minDragDistance;
      const prev = zone;
      if (prev === 'off') {
        if (movedEnough && leftDist < engage) { zone = 'on-left'; lastDist = leftDist; paused = false; }
        else if (movedEnough && rightDist < engage) { zone = 'on-right'; lastDist = rightDist; paused = false; }
      } else {
        const dist = prev === 'on-left' ? leftDist : rightDist;
        if (dist >= release) {
          turnOff();
        } else {
          if (lastDist !== null) {
            if (dist > lastDist) paused = true;
            else if (dist < lastDist) paused = false;
          }
          lastDist = dist;
        }
      }
      if (prev === 'off' && zone !== 'off' && raf === null) { lastTs = null; raf = requestAnimationFrame(frame); }
      if (zone === 'off' && raf !== null) stopLoop();
    },
    stop() {
      stopLoop();
      turnOff();
    },
  };
}
