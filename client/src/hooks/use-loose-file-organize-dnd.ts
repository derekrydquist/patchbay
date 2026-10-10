import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  useSensor,
  useSensors,
  useDndMonitor,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  type CollisionDetection,
  type Collision,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  type DroppableContainer,
  type ClientRect,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { type Clip } from '@/lib/daw-data';
import { useOrganizeLooseFile, useAssignLooseFileTrack, useUnassignLooseFileTrack } from '@/hooks/use-bucket-mutations';
import { useToast } from '@/hooks/use-toast';
import { createHoldTimer, onNativeFileDrag, type NativeFileHold } from '@/hooks/use-native-file-drop';

// Shared drag/organize interaction for loose files — a song-scoped upload with no
// Track/Section yet, draggable onto a Section row or Versions column to organize it
// into a real clip. Three surfaces need this identically: MediaBucket/Workspace
// (mounted inside Timeline.tsx's own DndContext), the Dashboard Ideas shelf, and the
// Dashboard Songs quick-browser — this hook is the single source of truth so a fix in
// one no longer has to be re-discovered and re-applied in the other two by hand.
//
// Placing a loose file directly onto the Timeline (as opposed to organizing it into a
// bucket section) is NOT part of this hook — that interaction needs Timeline's own
// pixel/section geometry to resolve a drop point and stays in Timeline.tsx.

export const BUCKET_SECTION_DROP_PREFIX = 'bucket-section||';
export const BUCKET_VERSIONS_DROP_PREFIX = 'bucket-versions||';
// A Track row in MediaBucket's Tracks column (Column 1) — not a Section row. Drop
// here moves the loose file into the Track-scoped resting tier instead of
// organizing it into a real clip. Same collision/geometry handling as the other
// two prefixes; only the drag-end action differs (assign-track vs. organize).
export const BUCKET_TRACK_DROP_PREFIX = 'bucket-track||';
// The Sections column's own open background (not a specific Section row) — a second
// entry point onto the SAME Track-scoped resting tier as a Track-row drop (identical
// destination, identical mutation), scoped to whichever Track is currently selected.
// Geometrically NESTS inside every Section row rendered in that column (the
// background covers the whole column; a Section row is a smaller region within it),
// so it needs lower priority than any other organize target — see the background-
// match handling in matchOrganizeDropTarget below.
export const BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX = 'bucket-sections-bg||';
// The Tracks column's own open background — the reverse of a Track-row drop. Drop
// a Track-scoped loose file here to clear its trackId and return it to the plain
// song-scoped shelf in the Tracks column. Only enabled while the active drag is a
// Track-scoped loose file (see MediaBucket). Nests every Track row the same way the
// Sections background nests every Section row, so it gets the same fallback-only
// priority in matchOrganizeDropTarget.
export const BUCKET_TRACKS_BACKGROUND_DROP_PREFIX = 'bucket-tracks-bg||';
// The Ideas shelf Column 1 list's open space — drop an organized Ideas-shelf clip
// here to turn it back into a band-wide loose file (make-loose). Enabled only while
// an idea-clip drag is active (never for loose-file drags), so the loose-file
// handleDragEnd below never sees it. Nests every Idea row, so it gets the same
// fallback-only priority in matchOrganizeDropTarget: an Idea row always wins.
export const IDEAS_SHELF_BACKGROUND_DROP_PREFIX = 'ideas-shelf-bg||';

export function bucketSectionDropId(ideaId: string): string {
  return `${BUCKET_SECTION_DROP_PREFIX}${ideaId}`;
}

export function bucketVersionsDropId(suffix: string): string {
  return `${BUCKET_VERSIONS_DROP_PREFIX}${suffix}`;
}

export function bucketTrackDropId(trackId: string): string {
  return `${BUCKET_TRACK_DROP_PREFIX}${trackId}`;
}

export function bucketSectionsBackgroundDropId(suffix: string): string {
  return `${BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX}${suffix}`;
}

export function bucketTracksBackgroundDropId(suffix: string): string {
  return `${BUCKET_TRACKS_BACKGROUND_DROP_PREFIX}${suffix}`;
}

export function ideasShelfBackgroundDropId(suffix: string): string {
  return `${IDEAS_SHELF_BACKGROUND_DROP_PREFIX}${suffix}`;
}

// Column-background targets that geometrically contain other organize targets —
// matched only as a fallback (see matchOrganizeDropTarget).
function isBackgroundDropId(id: UniqueIdentifier): boolean {
  const s = String(id);
  return (
    s.startsWith(BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX) ||
    s.startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX) ||
    s.startsWith(IDEAS_SHELF_BACKGROUND_DROP_PREFIX)
  );
}

export function isBucketOrganizeDropId(id: string | number): boolean {
  const s = String(id);
  return (
    s.startsWith(BUCKET_SECTION_DROP_PREFIX) ||
    s.startsWith(BUCKET_VERSIONS_DROP_PREFIX) ||
    s.startsWith(BUCKET_TRACK_DROP_PREFIX) ||
    s.startsWith(BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX) ||
    s.startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX) ||
    s.startsWith(IDEAS_SHELF_BACKGROUND_DROP_PREFIX)
  );
}

// Low-level collision pass shared by every surface's collision detection: organize
// drop targets (Section rows, Versions columns) are narrow, non-full-width zones, so
// a vertical-band-only heuristic or the wrong rect cache entry can false-match a
// sibling column at the same row height. Reads a live getBoundingClientRect() first so
// a droppable with a stable-but-freshly-mounted id is never skipped for lack of a
// cached rect (see bucketVersionsDropId's stable-id fix — the bug this specifically
// guards against).
//
// The two column backgrounds (Sections: BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX,
// Tracks: BUCKET_TRACKS_BACKGROUND_DROP_PREFIX) are the prefixes that geometrically
// CONTAIN another organize target (a Section row / Track row sits inside them) —
// every other prefix pair occupies disjoint screen regions, so simple
// first-match-wins was safe for them. A background hit is remembered but not
// returned immediately; the loop keeps looking for a more specific match (Section
// row, Versions column, or Track row) and only falls back to the background if
// nothing more specific matched anywhere in the full pass. This makes the priority
// explicit rather than relying on dnd-kit's incidental container registration order.
// The backgrounds (these two, plus the Ideas shelf's Column 1 list,
// IDEAS_SHELF_BACKGROUND_DROP_PREFIX, on a different surface) never overlap each
// other, so remembering whichever one matched is unambiguous.
//
// dnd-kit only passes ENABLED droppables to collision detection — which is why a
// Track row stays enabled even for a drag of a file already scoped to it: a
// disabled row would be invisible here and the drop would fall through to the
// Tracks background (un-assign). handleDragEnd turns that own-row hit into a cancel.
export function matchOrganizeDropTarget(
  droppableContainers: DroppableContainer[],
  droppableRects: Map<UniqueIdentifier, ClientRect>,
  x: number,
  y: number
): { id: UniqueIdentifier } | null {
  let backgroundMatch: { id: UniqueIdentifier } | null = null;
  for (const container of droppableContainers) {
    if (!isBucketOrganizeDropId(container.id)) continue;
    const rect = container.node.current?.getBoundingClientRect() ?? droppableRects.get(container.id);
    if (!rect) continue;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      if (isBackgroundDropId(container.id)) {
        backgroundMatch = { id: container.id };
        continue;
      }
      return { id: container.id };
    }
  }
  return backgroundMatch;
}

// Standalone collision detection for a DndContext whose only droppables are organize
// targets (Dashboard's Ideas shelf and Songs quick-browser). Timeline.tsx's own
// trackFirstCollision has other passes (gap zones, track rows) and calls
// matchOrganizeDropTarget directly as one pass among several instead of using this.
export const organizeDropCollision: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  const match = matchOrganizeDropTarget(droppableContainers, droppableRects, pointerCoordinates.x, pointerCoordinates.y);
  return match ? [match as Collision] : [];
};

// Sensor config matching Timeline.tsx's currently-working setup — the reference
// implementation for this interaction. A 5px distance constraint (Pointer/Mouse) keeps
// a plain click on a Folder/Section row from being swallowed as a micro-drag; Touch
// uses a short hold delay instead since touch has no meaningful click-vs-drag distance.
export function useLooseFileOrganizeSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );
}

// Resolved destination of a completed drag-driven organize/assign action, surfaced
// via onOrganized so each surface can select/navigate to it the same way every
// creation action (Add Instrument, Add Section, ...) already auto-selects its
// result. A discriminated union because the two actions resolve to different
// destinations — organize into a real section (trackId + sectionName), assign-track
// into the Track-scoped resting tier (trackId alone, no section yet).
export type OrganizeDestination =
  | { action: 'organize'; trackId: string; sectionName: string }
  | { action: 'assign-track'; trackId: string }
  | { action: 'unassign-track'; originTrackId: string };

// Narrow view of the active drag for droppables that only need to know "is a loose
// file being dragged, and which Track (if any) is it scoped to?". Returns null when
// no loose-file drag is active, otherwise { trackId } (null trackId = a plain
// Tracks-column file). Uses useDndMonitor (drag start/end/cancel events only)
// instead of useDndContext, whose value changes on every pointer move during a drag
// and re-renders every consumer each frame. Must be called inside a DndContext.
export function useActiveLooseFileDrag(): { trackId: string | null } | null {
  const [drag, setDrag] = useState<{ trackId: string | null } | null>(null);
  // Memoized so useDndMonitor's effect (keyed on the listener object) doesn't
  // unsubscribe/resubscribe on every render.
  const listener = useMemo(() => ({
    onDragStart: ({ active }: DragStartEvent) => {
      const data = active.data.current as { type?: string; trackId?: string | null } | undefined;
      setDrag(data?.type === 'loose-file' ? { trackId: data.trackId ?? null } : null);
    },
    onDragEnd: () => setDrag(null),
    onDragCancel: () => setDrag(null),
  }), []);
  useDndMonitor(listener);
  return drag;
}

// How long a loose-file drag must rest on a Track row before that Track opens.
export const SPRING_LOAD_DELAY_MS = 800;

// ── Drop report: did a loose-file drop start a move? ──────────────────────────
// The spring hook below restores the pre-drag selection when a drag ends WITHOUT
// moving the file, but the drop itself is decided elsewhere — in the surface's
// DndContext onDragEnd (useLooseFileOrganizeDnd's handleDragEnd, and Timeline's for
// place-on-timeline). dnd-kit calls that onDragEnd prop first and then notifies
// useDndMonitor listeners, synchronously in the same call, so a report written by
// the drop handler is always there when the monitor's onDragEnd reads it. Keyed by
// the draggable id and cleared at every drag start, so a report can never leak into
// a later drag. No report = the file did not move (a cancel, a non-target, or a
// drop handler that bailed).
//   'moved'    — a mutation fired (organize, assign-track, un-assign).
//   'deferred' — Workspace's Place on Timeline dialog opened; the move waits on it.
export type LooseFileDropReport = 'moved' | 'deferred';
let lastDropReport: { activeId: UniqueIdentifier; report: LooseFileDropReport } | null = null;

export function reportLooseFileDrop(activeId: UniqueIdentifier, report: LooseFileDropReport): void {
  lastDropReport = { activeId, report };
}

function clearLooseFileDropReport(): void {
  lastDropReport = null;
}

function takeLooseFileDropReport(activeId: UniqueIdentifier): LooseFileDropReport | null {
  const r = lastDropReport && lastDropReport.activeId === activeId ? lastDropReport.report : null;
  lastDropReport = null;
  return r;
}

// Fired by Timeline when the Place on Timeline dialog that a drop opened ('deferred')
// is closed: placed = true for Place Clip, false for Cancel / Escape / outside click.
// A window event, same idiom as find-in-bucket, since MediaBucket (which owns the
// selection) and Timeline (which owns the dialog) don't share props. A dialog opened
// from a context menu has no deferred drop behind it, so its event is a no-op.
const LOOSE_PLACEMENT_RESOLVED_EVENT = 'loose-placement-resolved';

export function resolveDeferredLooseFileDrop(placed: boolean): void {
  window.dispatchEvent(new CustomEvent(LOOSE_PLACEMENT_RESOLVED_EVENT, { detail: { placed } }));
}

export interface SpringLoadedTracksOptions<S> {
  selectedTrackId: string | null;
  /** Select the Track exactly like a click (also clears the Section). */
  onOpenTrack: (trackId: string) => void;
  /** The surface's current selection, snapshotted at drag start. */
  captureSelection: () => S;
  /** Put a snapshot back with the same setters a click uses. No flash. */
  restoreSelection: (selection: S) => void;
}

// Spring-loaded Track rows: holding a loose-file drag over a Track row for
// SPRING_LOAD_DELAY_MS selects that Track (onOpenTrack), so its Sections column
// fills in and the file can be dropped onto a Section row in the same drag. Drops
// are untouched — this only changes selection mid-drag. Mount once per DndContext,
// inside it (MediaBucket, the Songs quick-browser); not on the Ideas shelf.
//
// Driven by useDndMonitor's onDragOver, which dnd-kit fires only when the collision
// result's id changes — so while the pointer rests on one Track row no further
// events arrive and the timer runs; entering another row (or leaving to nothing)
// fires once and restarts or clears it.
//
// Every loose-file drag is eligible. A Track-scoped (shelf) file lives in the
// selected Track's Sections column, which unmounts when another Track opens; dnd-kit
// then drops the row's data, so handleDragEnd falls back to the snapshot taken at
// drag start (see useLooseFileOrganizeDnd). A shelf file never springs its own
// origin Track open.
//
// Restore: if a spring changed the selection and the drag ends without moving the
// file (Escape or any other cancel, a release over no target, a drop the handler
// cancels), the selection captured at drag start comes back — for a shelf file that
// is its origin Track, so its shelf is visible again. A drag that moved the file
// leaves the selection to the existing "view follows the file" handling. A drag
// that never sprung never touches the selection.
export function useSpringLoadedTracks<S>(options: SpringLoadedTracksOptions<S>): void {
  // Read at event time, so the listener below never needs re-subscribing.
  const latest = useRef(options);
  latest.current = options;
  const timerRef = useRef(createHoldTimer());
  const eligibleRef = useRef(false);
  const originTrackIdRef = useRef<string | null>(null);
  // Selection at drag start, and whether a spring changed it during this drag.
  const startSelectionRef = useRef<{ selection: S } | null>(null);
  const sprungRef = useRef(false);
  // A Place on Timeline dialog is open over a sprung selection: restore on cancel.
  const pendingRestoreRef = useRef<{ selection: S } | null>(null);

  const listener = useMemo(() => {
    const clear = () => timerRef.current.cancel();
    const finish = () => {
      clear();
      eligibleRef.current = false;
      originTrackIdRef.current = null;
      startSelectionRef.current = null;
      sprungRef.current = false;
    };
    return {
      onDragStart: ({ active }: DragStartEvent) => {
        clear();
        clearLooseFileDropReport();
        pendingRestoreRef.current = null;
        const data = active.data.current as { type?: string; trackId?: string | null } | undefined;
        eligibleRef.current = data?.type === 'loose-file';
        originTrackIdRef.current = data?.trackId ?? null;
        startSelectionRef.current = eligibleRef.current
          ? { selection: latest.current.captureSelection() }
          : null;
        sprungRef.current = false;
      },
      onDragOver: ({ over }: DragOverEvent) => {
        clear();
        if (!eligibleRef.current || !over) return;
        if (!String(over.id).startsWith(BUCKET_TRACK_DROP_PREFIX)) return;
        const trackId = (over.data.current as { trackId?: string } | undefined)?.trackId;
        if (!trackId || trackId === latest.current.selectedTrackId || trackId === originTrackIdRef.current) return;
        timerRef.current.arm(() => {
          if (trackId === latest.current.selectedTrackId) return;
          sprungRef.current = true;
          latest.current.onOpenTrack(trackId);
        }, SPRING_LOAD_DELAY_MS);
      },
      onDragEnd: ({ active }: DragEndEvent) => {
        const report = takeLooseFileDropReport(active.id);
        const start = startSelectionRef.current;
        if (sprungRef.current && start) {
          if (report === 'deferred') pendingRestoreRef.current = start;
          else if (report !== 'moved') latest.current.restoreSelection(start.selection);
        }
        finish();
      },
      onDragCancel: () => {
        clearLooseFileDropReport();
        const start = startSelectionRef.current;
        if (sprungRef.current && start) latest.current.restoreSelection(start.selection);
        finish();
      },
      clear,
    };
  }, []);
  useDndMonitor(listener);
  useEffect(() => listener.clear, [listener]);

  useEffect(() => {
    const handler = (e: Event) => {
      const pending = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      if (pending && !(e as CustomEvent<{ placed: boolean }>).detail.placed) {
        latest.current.restoreSelection(pending.selection);
      }
    };
    window.addEventListener(LOOSE_PLACEMENT_RESOLVED_EVENT, handler);
    return () => window.removeEventListener(LOOSE_PLACEMENT_RESOLVED_EVENT, handler);
  }, []);
}

// Spring-loaded Track rows for a native (Finder) file drag — the same behavior as
// useSpringLoadedTracks above, for drags dnd-kit never sees. Same options, same
// call-site callbacks, same delay. Doesn't need a DndContext (call it anywhere on
// the surface). Returns holdFor(trackId), passed to each Track row's
// useNativeFileDrop as its `hold`: the row times the rest (armed on dragenter,
// cancelled on dragleave / drop / drag end) and holdFor decides what firing does.
//
// - A Track that's already selected gets no hold (nothing to open); the fire also
//   re-checks, as the dnd spring does.
// - The selection is captured at the FIRST spring of a drag rather than at drag
//   start: nothing else can change it during a native drag (no clicks), so it's
//   the same value, and it needs no reliable "drag started" signal.
// - Restore: when the drag ends (onNativeFileDrag onEnd) with no accepted drop —
//   Escape, release over a non-target or a disabled target, leaving the window —
//   the captured selection comes back, with no flash. Chromium fires nothing on
//   Escape, so there it lands on the next real mouse movement (see the tracker's
//   end detection in use-native-file-drop.tsx). An accepted drop leaves the
//   drop handler's own selection in place. A drag that never sprung does nothing.
// - The start selection is kept for the WHOLE drag, not per end: a false end
//   restores, but if the tracker then resumes (onBegin fresh=false — dragover kept
//   arriving), the drag is still the same one, so a later spring keeps the
//   original start and a later real end restores to it. It's cleared only by an
//   accepted drop or a fresh drag entering the page.
export function useNativeSpringLoadedTracks<S>(options: SpringLoadedTracksOptions<S>): (trackId: string) => NativeFileHold | undefined {
  const latest = useRef(options);
  latest.current = options;
  const startSelectionRef = useRef<{ selection: S } | null>(null);

  useEffect(() => onNativeFileDrag({
    onBegin: ({ fresh }) => {
      if (fresh) startSelectionRef.current = null;
    },
    onEnd: ({ dropped }) => {
      const start = startSelectionRef.current;
      if (dropped) startSelectionRef.current = null;
      else if (start) latest.current.restoreSelection(start.selection);
    },
  }), []);

  const { selectedTrackId } = options;
  return useCallback((trackId: string) => {
    if (trackId === selectedTrackId) return undefined;
    return {
      ms: SPRING_LOAD_DELAY_MS,
      onHold: () => {
        const o = latest.current;
        if (trackId === o.selectedTrackId) return;
        if (!startSelectionRef.current) startSelectionRef.current = { selection: o.captureSelection() };
        o.onOpenTrack(trackId);
      },
    };
  }, [selectedTrackId]);
}

// Spring-open flash timing and strength: a quick rise to a soft peak, a short hold,
// then a long ease-out fade so the tail stays visible. Total duration is the sum;
// the keyframe offsets are derived from these in flashSpringOpenedColumn.
export const SPRING_FLASH_RISE_MS = 150;
export const SPRING_FLASH_HOLD_MS = 150;
export const SPRING_FLASH_FADE_MS = 900;
/** Gold alpha at the peak, for both the background and the inset ring. */
export const SPRING_FLASH_PEAK_ALPHA = 0.18;

// Gold flash over a Sections column when useSpringLoadedTracks opens a Track —
// never on a click or a restore. Web Animations API on the existing node: no
// remount (which would re-register the column's drop target), no inserted element,
// no size change. Only the peak keyframe is given; the start and end are implicit,
// so the flash rises from and fades back into the column's LIVE background/
// box-shadow — a drop highlight that turns on mid-flash shows through as it fades
// instead of being overwritten. A second spring cancels the running flash and
// restarts it.
const springFlashes = new WeakMap<Element, Animation>();

export function flashSpringOpenedColumn(el: HTMLElement | null): void {
  if (!el || typeof el.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  springFlashes.get(el)?.cancel();
  const gold = `rgba(212, 175, 55, ${SPRING_FLASH_PEAK_ALPHA})`;
  const peak = { backgroundColor: gold, boxShadow: `inset 0 0 0 2px ${gold}` };
  const duration = SPRING_FLASH_RISE_MS + SPRING_FLASH_HOLD_MS + SPRING_FLASH_FADE_MS;
  // Offsets 0 and 1 are implicit (the column's own live values). A keyframe's
  // easing applies to the segment that starts at it: the rise (implicit 0 → peak
  // start) is linear, the hold is flat, only the fade (peak end → implicit 1) eases out.
  const animation = el.animate(
    [
      { offset: SPRING_FLASH_RISE_MS / duration, ...peak },
      { offset: (SPRING_FLASH_RISE_MS + SPRING_FLASH_HOLD_MS) / duration, ...peak, easing: 'ease-out' },
    ],
    { duration, easing: 'linear' }
  );
  springFlashes.set(el, animation);
}

// Drag payload type for an organized clip dragged out of the Ideas shelf's Column 2
// (Finder-style move to another Idea). Not a loose file — handleDragEnd below ignores
// it, and Dashboard's own clip-move handler picks it up.
export const IDEA_CLIP_DRAG_TYPE = 'idea-clip';

// Kind + origin of whatever is being dragged, for drop targets that need to tell drag
// types apart (e.g. an Idea row suppressing its highlight for a clip dragged out of
// that same Idea). Same useDndMonitor approach as useActiveLooseFileDrag above, for
// the same per-frame re-render reason. Must be called inside a DndContext.
export function useActiveDragSource(): { type: string | null; sourceSongId: string | null } | null {
  const [drag, setDrag] = useState<{ type: string | null; sourceSongId: string | null } | null>(null);
  const listener = useMemo(() => ({
    onDragStart: ({ active }: DragStartEvent) => {
      const data = active.data.current as { type?: string; sourceSongId?: string } | undefined;
      setDrag({ type: data?.type ?? null, sourceSongId: data?.sourceSongId ?? null });
    },
    onDragEnd: () => setDrag(null),
    onDragCancel: () => setDrag(null),
  }), []);
  useDndMonitor(listener);
  return drag;
}

// The drag data LooseFileRow (and the Ideas shelf preview card) put on a loose-file
// draggable — everything handleDragEnd reads from active.data.current.
interface LooseFileDragData {
  clip: Clip;
  type: 'loose-file';
  songId: string | null;
  trackId: string | null;
}

interface UseLooseFileOrganizeDndOptions {
  onError?: (message: string) => void;
  onOrganized?: (dest: OrganizeDestination) => void;
}

export function useLooseFileOrganizeDnd(songId: string | undefined, options?: UseLooseFileOrganizeDndOptions) {
  const [activeDrag, setActiveDrag] = useState<Clip | null>(null);
  // Copy of the loose-file drag data, taken at drag start. If the dragged row
  // unmounts mid-drag (a spring-loaded Track replaced the Sections column holding
  // it), dnd-kit keeps active.id but swaps active.data.current for an empty object;
  // handleDragEnd then reads this instead. Keyed by the draggable id so a stale copy
  // never applies to a different drag.
  const dragSnapshotRef = useRef<{ activeId: UniqueIdentifier; data: LooseFileDragData } | null>(null);
  const sensors = useLooseFileOrganizeSensors();
  const { toast } = useToast();
  const organizeLooseFileMutation = useOrganizeLooseFile(songId, {
    onError: options?.onError ?? ((msg) => console.error('[organizeLooseFile] error:', msg)),
  });
  // Failure here gets a toast (not just console.error) — unlike organize, a failed
  // assign-track was previously indistinguishable from a same-track no-op, so
  // silence was actively misleading. Organize's own drag-drop silence-on-success
  // convention is untouched; this only adds failure feedback.
  const assignLooseFileTrackMutation = useAssignLooseFileTrack(songId, {
    onError: (msg) => {
      console.error('[assignLooseFileTrack] error:', msg);
      toast({ title: 'Failed to move file to track', description: msg, variant: 'destructive' });
      options?.onError?.(msg);
    },
  });
  const unassignLooseFileTrackMutation = useUnassignLooseFileTrack(songId, {
    onError: (msg) => {
      console.error('[unassignLooseFileTrack] error:', msg);
      toast({ title: 'Failed to move file to Tracks', description: msg, variant: 'destructive' });
      options?.onError?.(msg);
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as Partial<LooseFileDragData> | undefined;
    const isLooseFile = data?.type === 'loose-file' && !!data.clip;
    setActiveDrag(isLooseFile ? data.clip! : null);
    clearLooseFileDropReport();
    dragSnapshotRef.current = isLooseFile
      ? {
          activeId: event.active.id,
          data: { clip: data.clip!, type: 'loose-file', songId: data.songId ?? null, trackId: data.trackId ?? null },
        }
      : null;
  };

  // Escape / sensor cancel. Without this the ghost's clip outlived a cancelled
  // drag (harmless only because DragOverlay renders nothing with no active drag).
  // handleDragEnd clears it too, first thing, for every drop outcome.
  const handleDragCancel = () => {
    setActiveDrag(null);
    dragSnapshotRef.current = null;
  };

  // Returns true when the event was a loose-file organize drop (handled here, whether
  // it succeeded or warned) — callers embedding this inside a larger handleDragEnd
  // (Timeline.tsx) can early-return on true and fall through to their own logic on
  // false rather than duplicating the isBucketOrganizeDropId/type check themselves.
  // Whether the file actually moves is reported separately: each branch that fires a
  // mutation calls reportLooseFileDrop(..., 'moved') first; every other return
  // (warnings, own-track cancel, not-a-target) reports nothing — see
  // useSpringLoadedTracks, which restores the pre-drag selection on no move.
  const handleDragEnd = (event: DragEndEvent): boolean => {
    const { active, over } = event;
    setActiveDrag(null);
    const snapshot = dragSnapshotRef.current;
    dragSnapshotRef.current = null;
    // Live data when the dragged row is still mounted; otherwise the drag-start copy.
    const live = active.data.current as Partial<LooseFileDragData> | undefined;
    const drag: Partial<LooseFileDragData> | undefined = live?.type
      ? live
      : snapshot && snapshot.activeId === active.id ? snapshot.data : undefined;
    if (!over) return false;
    if (drag?.type !== 'loose-file') return false;
    if (!isBucketOrganizeDropId(over.id)) return false;
    // Idea-clip-only target (make-loose) — not a loose-file destination. It is
    // disabled for loose-file drags, so this is a guard, not a live path.
    if (String(over.id).startsWith(IDEAS_SHELF_BACKGROUND_DROP_PREFIX)) return false;

    const looseFileId = drag.clip?.id;
    if (!looseFileId) {
      console.warn('[LooseFileDrop] missing loose file id on drag data');
      return true;
    }

    // Tracks-column-background drop — un-assign a Track-scoped loose file back to
    // the plain song-scoped shelf. MediaBucket only enables this droppable while a
    // Track-scoped loose file is being dragged, but the origin is re-checked here
    // since un-assigning a file with no track has nothing to do.
    if (String(over.id).startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX)) {
      const originTrackId = drag.trackId ?? null;
      if (!originTrackId) {
        console.warn('[LooseFileDrop] Tracks-background drop on a file with no trackId — nothing to un-assign');
        return true;
      }
      reportLooseFileDrop(active.id, 'moved');
      unassignLooseFileTrackMutation.mutate(
        { looseFileId, originTrackId },
        { onSuccess: () => options?.onOrganized?.({ action: 'unassign-track', originTrackId }) }
      );
      return true;
    }

    // Track row and Sections-column-background drops both resolve to the identical
    // assign-track destination (trackId alone) — two entry points onto the same
    // mutation, not two mechanisms. Both carry the same { trackId } data shape.
    if (
      String(over.id).startsWith(BUCKET_TRACK_DROP_PREFIX) ||
      String(over.id).startsWith(BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX)
    ) {
      const trackDropData = over.data.current as { trackId?: string } | undefined;
      if (!trackDropData?.trackId) {
        console.warn('[LooseFileDrop] missing trackId on track drop target', trackDropData);
        return true;
      }
      // Origin trackId (null for a plain Tracks-column file) travels with the drag
      // payload itself — see LooseFileRow.tsx. Passed through so the mutation can
      // invalidate the ORIGIN track's Sections-column list too, not just the
      // destination's, so a genuine cross-track move never leaves the source view
      // stale.
      const originTrackId = drag.trackId ?? null;
      const destTrackId = trackDropData.trackId;
      // Dropping a Track-scoped file back onto its OWN track — its own Track row, or
      // the Sections-column background while that same track is selected — is a
      // cancel: no mutation, no toast, no onOrganized, no invalidation. A plain
      // Tracks-column file (originTrackId null) never equals a real destTrackId, so
      // it still assigns normally. The own Track row is deliberately left enabled
      // (unhighlighted) so it blocks the Tracks-background un-assign — see
      // TrackFolderRow in MediaBucket.tsx.
      if (originTrackId === destTrackId) {
        return true;
      }
      reportLooseFileDrop(active.id, 'moved');
      assignLooseFileTrackMutation.mutate(
        { looseFileId, trackId: destTrackId, originTrackId },
        { onSuccess: () => options?.onOrganized?.({ action: 'assign-track', trackId: destTrackId }) }
      );
      return true;
    }

    const dropData = over.data.current as { trackId?: string; sectionName?: string; ideaSongId?: string } | undefined;
    if (!dropData?.trackId || !dropData?.sectionName) {
      console.warn('[LooseFileDrop] missing trackId/sectionName on organize drop target', dropData);
      return true;
    }
    const destTrackId = dropData.trackId;
    const destSectionName = dropData.sectionName;
    // An Ideas shelf Idea row names its own song (ideaSongId), which can differ from
    // the selected song this hook was built with; every other organize target
    // belongs to the selected song.
    const destSongId = dropData.ideaSongId ?? songId;
    reportLooseFileDrop(active.id, 'moved');
    organizeLooseFileMutation.mutate(
      { looseFileId, trackId: destTrackId, sectionName: destSectionName, destSongId },
      { onSuccess: () => options?.onOrganized?.({ action: 'organize', trackId: destTrackId, sectionName: destSectionName }) }
    );
    return true;
  };

  return {
    sensors,
    collisionDetection: organizeDropCollision,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    activeDrag,
    isPending:
      organizeLooseFileMutation.isPending ||
      assignLooseFileTrackMutation.isPending ||
      unassignLooseFileTrackMutation.isPending,
  };
}
