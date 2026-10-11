import { createContext, useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
import { useOrganizeLooseFile, useAssignLooseFileTrack, useUnassignLooseFileTrack, useMoveVersion } from '@/hooks/use-bucket-mutations';
import { useToast } from '@/hooks/use-toast';
import { createHoldTimer, onNativeFileDrag, type NativeFileHold } from '@/hooks/use-native-file-drop';
import { flashGold } from '@/hooks/use-landing-flash';

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

// ── Organize drag types ──────────────────────────────────────────────────────
// Two kinds of drag can reach the bucket drop targets (Section rows, Track rows,
// Files column, Sections/Tracks backgrounds):
//   'loose-file'  — LooseFileRow / the Ideas shelf preview card.
//   'bucket-clip' — a version already in a section of a real song: BucketClip in
//                   MediaBucket, SongsClipContextMenuCard in the Songs quick-browser.
// Every other drag (timeline clips, Ideas shelf idea-clips) is neither.
export const BUCKET_CLIP_DRAG_TYPE = 'bucket-clip';

// The drag data LooseFileRow (and the Ideas shelf preview card) put on a loose-file
// draggable — everything handleDragEnd reads from active.data.current.
export interface LooseFileDragData {
  clip: Clip;
  type: 'loose-file';
  songId: string | null;
  trackId: string | null;
}

// The drag data every version card puts on its draggable. Timeline.tsx reads
// clip/type/trackId for the bucket → timeline drop; the rest identifies where the
// version lives now. isFullTake comes from the idea (ideas.isFullTake), never from
// the section name — Full Take sections are named both "Full Take" and "Full Takes",
// and some Full Take clips have a null sectionName.
export interface BucketClipDragData {
  clip: Clip;
  type: typeof BUCKET_CLIP_DRAG_TYPE;
  trackId: string;
  // The version's track name, for the move dialog's wording.
  trackName: string;
  ideaId: string;
  songId: string;
  isFullTake: boolean;
}

export type OrganizeDragData = LooseFileDragData | BucketClipDragData;

function isOrganizeDragData(data: unknown): data is OrganizeDragData {
  const d = data as Partial<OrganizeDragData> | undefined;
  return !!d?.clip && (d.type === 'loose-file' || d.type === BUCKET_CLIP_DRAG_TYPE);
}

// What a drop target needs to know about the active drag. ideaId is null for a
// loose file (it has no section yet); trackId is null for a loose file with no Track.
export interface ActiveOrganizeDrag {
  type: OrganizeDragData['type'];
  trackId: string | null;
  ideaId: string | null;
  songId: string | null;
  isFullTake: boolean;
}

function toActiveOrganizeDrag(data: OrganizeDragData): ActiveOrganizeDrag {
  return data.type === 'loose-file'
    ? { type: data.type, trackId: data.trackId, ideaId: null, songId: data.songId, isFullTake: false }
    : { type: data.type, trackId: data.trackId, ideaId: data.ideaId, songId: data.songId, isFullTake: data.isFullTake };
}

// The active organize drag (loose file or version), or null when none — including
// while a timeline clip or an Ideas shelf idea-clip is dragged. Uses useDndMonitor
// (drag start/end/cancel events only) instead of useDndContext, whose value changes
// on every pointer move during a drag and re-renders every consumer each frame.
// Must be called inside a DndContext.
export function useActiveOrganizeDrag(): ActiveOrganizeDrag | null {
  const [drag, setDrag] = useState<ActiveOrganizeDrag | null>(null);
  // Memoized so useDndMonitor's effect (keyed on the listener object) doesn't
  // unsubscribe/resubscribe on every render.
  const listener = useMemo(() => ({
    onDragStart: ({ active }: DragStartEvent) => {
      const data = active.data.current;
      setDrag(isOrganizeDragData(data) ? toActiveOrganizeDrag(data) : null);
    },
    onDragEnd: () => setDrag(null),
    onDragCancel: () => setDrag(null),
  }), []);
  useDndMonitor(listener);
  return drag;
}

// The drop data every section target carries — a Section row, and the Files column
// for the section it shows (MediaBucket and the Songs quick-browser). trackId and
// sectionName are what the loose-file organize reads; the rest is for version moves
// (ideaId/songId/isFullTake decide acceptance, trackName is for the dialog wording).
export interface SectionDropTarget {
  trackId: string;
  sectionName: string;
  ideaId: string;
  songId: string;
  isFullTake: boolean;
  trackName: string;
}

// The drop data a track target carries — a Track row, and the Sections column's
// background for the track it shows. trackId is what the loose-file assign reads;
// songId decides whether a version may move there (Moves C/D), trackName is for the
// view following the file. The Tracks column's background carries TracksDropTarget.
export interface TrackDropTarget {
  trackId: string;
  songId: string;
  trackName: string;
}

export interface TracksDropTarget {
  unassign: true;
  songId: string;
}

// ── Per-target drop rules ────────────────────────────────────────────────────
// Whether a bucket drop target accepts the active drag. A target highlights only
// when isOver AND its rule says yes — never on isOver alone (dnd-kit's isOver is
// pure geometry and ignores `disabled`), so only valid targets ever light up. One
// rule per target, shared by MediaBucket (Workspace, SongHome) and the Songs
// quick-browser; each has a branch per drag type, so a later change can switch a
// target on for one type without touching the other. A drag that is neither type
// (null) is never accepted.
//
// The rules decide highlighting. The drops themselves are decided in handleDragEnd
// below (loose files) and in each surface's onDragEnd (versions — none built yet).
// A version (bucket-clip) is accepted by a section — a Section row, or the Files
// column showing it — when the section is in the same song, isn't the version's own
// section, and neither side is a Full Take (always ideas.isFullTake, never the name).
function versionAcceptsSection(drag: ActiveOrganizeDrag, target: SectionDropTarget): boolean {
  return drag.songId === target.songId && drag.ideaId !== target.ideaId && !target.isFullTake && !drag.isFullTake;
}

export const organizeDropRules = {
  // A Section row (or an Ideas-shelf-style row with the same id prefix).
  sectionRow(drag: ActiveOrganizeDrag | null, target: SectionDropTarget): boolean {
    if (!drag) return false;
    if (drag.type === 'loose-file') return true;
    return versionAcceptsSection(drag, target); // bucket-clip: Move A
  },
  // A Track row. A loose file already scoped to this track: own-track drop, which
  // handleDragEnd cancels — no highlight. A version: any track of its own song,
  // its own track included (Move D: section → that track's shelf is a real move).
  trackRow(drag: ActiveOrganizeDrag | null, target: { trackId: string; songId: string }): boolean {
    if (!drag) return false;
    if (drag.type === 'loose-file') return drag.trackId !== target.trackId;
    return drag.songId === target.songId && !drag.isFullTake; // bucket-clip: Move D
  },
  // The Files column of the selected section (null = no section selected). Its own
  // section (where a version drag starts) is never accepted.
  filesColumn(drag: ActiveOrganizeDrag | null, target: SectionDropTarget | null): boolean {
    if (!drag || !target) return false;
    if (drag.type === 'loose-file') return true;
    return versionAcceptsSection(drag, target); // bucket-clip: Move A
  },
  // The Sections column's open background, scoped to the selected track. A loose
  // file already scoped to that track is a cancel — no highlight. A version: the
  // shown track's shelf, own track or not (Move C).
  sectionsBackground(drag: ActiveOrganizeDrag | null, target: TrackDropTarget | null): boolean {
    if (!drag || !target) return false;
    if (drag.type === 'loose-file') return !(drag.trackId && drag.trackId === target.trackId);
    return drag.songId === target.songId && !drag.isFullTake; // bucket-clip: Move C
  },
  // The Tracks column's open background. Also decides whether the droppable is
  // enabled at all (it nests every Track row, so an enabled-but-invalid background
  // could swallow drops): a Track-scoped loose file (un-assign), or a version of the
  // same song (Move B: song-level loose file). Track rows still win over it.
  tracksBackground(drag: ActiveOrganizeDrag | null, target: { songId: string }): boolean {
    if (!drag) return false;
    if (drag.type === 'loose-file') return !!drag.trackId;
    return drag.songId === target.songId && !drag.isFullTake; // bucket-clip: Move B
  },
};

// How long a loose-file, version or Finder drag must rest on a Track or Section row
// before it opens.
export const SPRING_LOAD_DELAY_MS = 800;

// ── Drop report: did a loose-file drop start a move? ──────────────────────────
// The spring hook below (useSpringLoadedRows) restores the pre-drag selection when a drag ends WITHOUT
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

export interface SpringLoadedRowsOptions<S> {
  selectedTrackId: string | null;
  /** The selected section's ideas-row id (null = none). */
  selectedSectionId: string | null;
  /** Select the Track exactly like a click (also clears the Section). */
  onOpenTrack: (trackId: string) => void;
  /** Select a section of the selected Track exactly like a click. */
  onOpenSection: (ideaId: string) => void;
  /** The surface's current selection, snapshotted at drag start. */
  captureSelection: () => S;
  /** Put a snapshot back with the same setters a click uses. No flash. */
  restoreSelection: (selection: S) => void;
  /** A drag that sprung a row is over for good — after its restore, its accepted
   *  drop, or the deferred move it started resolving. Fires after restoreSelection,
   *  in the same tick. MediaBucket uses it to mark a sprung section viewed only once
   *  the drag has settled. */
  onSpringSettled?: () => void;
}

// ── Scroll guard: is the pointer still on the row? ───────────────────────────
// dnd-kit recomputes collisions on pointer movement and rect re-measures, not
// continuously, so a list that scrolls under a resting pointer (wheel, auto-scroll)
// can leave `over` naming a row that has slid away. Before a spring opens anything,
// useSpringLoadedRows re-checks the pointer against the row's live rect. A dnd-kit
// `over` carries no DOM node, so every spring-loaded row tags itself with
// springRowAttrs(its drop id) and the check finds it by that attribute. A row
// without the attribute (or no longer rendered) never springs.
const SPRING_ROW_ATTR = 'data-spring-row';

export function springRowAttrs(dropId: string): { 'data-spring-row': string } {
  return { [SPRING_ROW_ATTR]: dropId } as { 'data-spring-row': string };
}

function isPointerOnSpringRow(dropId: string, pointer: { x: number; y: number } | null): boolean {
  // No pointer position known (no move since drag start) — nothing to contradict.
  if (!pointer) return true;
  const el = document.querySelector(`[${SPRING_ROW_ATTR}="${CSS.escape(dropId)}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
}

// Client coordinates of a pointer/mouse/touch event, or null.
function eventPoint(e: Event | null | undefined): { x: number; y: number } | null {
  if (!e) return null;
  if ('touches' in e) {
    const t = (e as TouchEvent).touches[0] ?? (e as TouchEvent).changedTouches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  if ('clientX' in e) return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  return null;
}

// Spring-loaded Track and Section rows: holding a loose-file or version drag over
// a Track row for SPRING_LOAD_DELAY_MS selects that Track (onOpenTrack), so its
// Sections column fills in; holding it over a Section row of the selected Track
// selects that section (onOpenSection), so the Files column shows it and takes the
// drop. One drag can spring a Track and then a Section. Drops are untouched — this
// only changes selection mid-drag. Mount once per DndContext, inside it
// (MediaBucket, the Songs quick-browser); not on the Ideas shelf.
//
// Driven by useDndMonitor's onDragOver, which dnd-kit fires only when the collision
// result's id changes — so while the pointer rests on one row no further events
// arrive and the timer runs; entering another row (or leaving to nothing) fires
// once and restarts or clears it. One timer for both kinds of row.
//
// Track rows: every loose-file and version (bucket-clip) drag is eligible. A drag
// never springs its own origin Track open (a shelf file's Track, a version's Track).
// Section rows: only a row of the selected Track, not the selected section, and
// only when organizeDropRules.sectionRow accepts the drag — the same rule as the
// row's highlight, so a row springs exactly when it lights up (a version's own
// section and Full Takes never do).
//
// A Track-scoped (shelf) file lives in the selected Track's Sections column, and a
// version in the selected section's Files column; both unmount when another row
// opens. dnd-kit then drops the row's data, so handleDragEnd falls back to the
// snapshot taken at drag start (see useLooseFileOrganizeDnd).
//
// Restore: if a spring changed the selection and the drag ends without moving the
// file (Escape or any other cancel, a release over no target, a drop the handler
// cancels), the Track + Section captured at drag start come back — for a shelf file
// that is its origin Track, so its shelf is visible again. A drag that moved the
// file leaves the selection to the existing "view follows the file" handling. A
// 'deferred' drop (version move, Place on Timeline dialog) waits for its outcome. A
// drag that never sprung never touches the selection.
//
// Scroll guard: when the timer fires, the pointer (tracked here from window
// pointermove/touchmove during the drag) must still be inside the row's live rect
// (isPointerOnSpringRow), or nothing opens.
export function useSpringLoadedRows<S>(options: SpringLoadedRowsOptions<S>): void {
  // Read at event time, so the listener below never needs re-subscribing.
  const latest = useRef(options);
  latest.current = options;
  const timerRef = useRef(createHoldTimer());
  // The active drag (null = not a loose-file/version drag, so nothing springs).
  const dragRef = useRef<ActiveOrganizeDrag | null>(null);
  // Selection at drag start, and whether a spring changed it during this drag.
  const startSelectionRef = useRef<{ selection: S } | null>(null);
  const sprungRef = useRef(false);
  // A deferred drop is pending over a sprung selection: restore if it doesn't happen.
  const pendingRestoreRef = useRef<{ selection: S } | null>(null);
  // Live pointer position during a drag, for the scroll guard.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const listener = useMemo(() => {
    const onMove = (e: Event) => {
      const p = eventPoint(e);
      if (p) pointerRef.current = p;
    };
    const trackPointer = (on: boolean) => {
      const method = on ? 'addEventListener' : 'removeEventListener';
      window[method]('pointermove', onMove, { capture: true });
      window[method]('touchmove', onMove, { capture: true });
    };
    const clear = () => timerRef.current.cancel();
    const finish = () => {
      clear();
      trackPointer(false);
      pointerRef.current = null;
      dragRef.current = null;
      startSelectionRef.current = null;
      sprungRef.current = false;
    };
    const settle = () => latest.current.onSpringSettled?.();
    const spring = (open: () => void) => {
      sprungRef.current = true;
      open();
    };
    return {
      onDragStart: ({ active, activatorEvent }: DragStartEvent) => {
        clear();
        clearLooseFileDropReport();
        // A deferred drop whose outcome never arrived: nothing will restore it now.
        if (pendingRestoreRef.current) { pendingRestoreRef.current = null; settle(); }
        const data = active.data.current;
        dragRef.current = isOrganizeDragData(data) ? toActiveOrganizeDrag(data) : null;
        startSelectionRef.current = dragRef.current
          ? { selection: latest.current.captureSelection() }
          : null;
        sprungRef.current = false;
        pointerRef.current = dragRef.current ? eventPoint(activatorEvent) : null;
        trackPointer(!!dragRef.current);
      },
      onDragOver: ({ over }: DragOverEvent) => {
        clear();
        const drag = dragRef.current;
        if (!drag || !over) return;
        const id = String(over.id);
        if (id.startsWith(BUCKET_TRACK_DROP_PREFIX)) {
          const trackId = (over.data.current as { trackId?: string } | undefined)?.trackId;
          if (!trackId || trackId === latest.current.selectedTrackId || trackId === drag.trackId) return;
          timerRef.current.arm(() => {
            if (trackId === latest.current.selectedTrackId) return;
            if (!isPointerOnSpringRow(id, pointerRef.current)) return;
            spring(() => latest.current.onOpenTrack(trackId));
          }, SPRING_LOAD_DELAY_MS);
          return;
        }
        if (id.startsWith(BUCKET_SECTION_DROP_PREFIX)) {
          const target = over.data.current as SectionDropTarget | undefined;
          if (!target?.ideaId) return;
          const isOpenable = () => {
            const o = latest.current;
            return target.trackId === o.selectedTrackId && target.ideaId !== o.selectedSectionId;
          };
          if (!isOpenable() || !organizeDropRules.sectionRow(drag, target)) return;
          timerRef.current.arm(() => {
            if (!isOpenable()) return;
            if (!isPointerOnSpringRow(id, pointerRef.current)) return;
            spring(() => latest.current.onOpenSection(target.ideaId));
          }, SPRING_LOAD_DELAY_MS);
        }
      },
      onDragEnd: ({ active }: DragEndEvent) => {
        const report = takeLooseFileDropReport(active.id);
        const start = startSelectionRef.current;
        if (sprungRef.current && start) {
          if (report === 'deferred') {
            pendingRestoreRef.current = start;
          } else {
            if (report !== 'moved') latest.current.restoreSelection(start.selection);
            settle();
          }
        }
        finish();
      },
      onDragCancel: () => {
        clearLooseFileDropReport();
        const start = startSelectionRef.current;
        if (sprungRef.current && start) {
          latest.current.restoreSelection(start.selection);
          settle();
        }
        finish();
      },
      clear,
      unmount: () => { clear(); trackPointer(false); },
    };
  }, []);
  useDndMonitor(listener);
  useEffect(() => listener.unmount, [listener]);

  useEffect(() => {
    const handler = (e: Event) => {
      const pending = pendingRestoreRef.current;
      pendingRestoreRef.current = null;
      if (!pending) return;
      if (!(e as CustomEvent<{ placed: boolean }>).detail.placed) {
        latest.current.restoreSelection(pending.selection);
      }
      latest.current.onSpringSettled?.();
    };
    window.addEventListener(LOOSE_PLACEMENT_RESOLVED_EVENT, handler);
    return () => window.removeEventListener(LOOSE_PLACEMENT_RESOLVED_EVENT, handler);
  }, []);
}

// Spring-loaded Track and Section rows for a native (Finder) file drag — the same
// behavior as useSpringLoadedRows above, for drags dnd-kit never sees. Same options,
// same call-site callbacks, same delay. Doesn't need a DndContext (call it anywhere
// on the surface). Returns trackHold(trackId) and sectionHold(ideaId), passed to
// each Track / Section row's useNativeFileDrop as its `hold`: the row times the rest
// (armed on dragenter, cancelled on dragleave / drop / drag end) and the hold
// decides what firing does. Both share ONE start selection, so a drag that springs
// a Track and then a Section restores to the original Track and Section.
//
// - A Track or Section that's already selected gets no hold (nothing to open); the
//   fire also re-checks, as the dnd spring does. Every Section row accepts a Finder
//   upload, so there is no other rule. Section rows are only ever rendered for the
//   selected Track.
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
export interface NativeSpringHolds {
  trackHold: (trackId: string) => NativeFileHold | undefined;
  sectionHold: (ideaId: string) => NativeFileHold | undefined;
}

export function useNativeSpringLoadedRows<S>(options: SpringLoadedRowsOptions<S>): NativeSpringHolds {
  const latest = useRef(options);
  latest.current = options;
  const startSelectionRef = useRef<{ selection: S } | null>(null);

  useEffect(() => onNativeFileDrag({
    onBegin: ({ fresh }) => {
      if (fresh) startSelectionRef.current = null;
    },
    onEnd: ({ dropped }) => {
      const start = startSelectionRef.current;
      if (!start) return;
      if (dropped) startSelectionRef.current = null;
      else latest.current.restoreSelection(start.selection);
      latest.current.onSpringSettled?.();
    },
  }), []);

  const { selectedTrackId, selectedSectionId } = options;
  const spring = (open: (o: SpringLoadedRowsOptions<S>) => void) => {
    const o = latest.current;
    if (!startSelectionRef.current) startSelectionRef.current = { selection: o.captureSelection() };
    open(o);
  };
  const trackHold = useCallback((trackId: string): NativeFileHold | undefined => {
    if (trackId === selectedTrackId) return undefined;
    return {
      ms: SPRING_LOAD_DELAY_MS,
      onHold: () => {
        if (trackId === latest.current.selectedTrackId) return;
        spring(o => o.onOpenTrack(trackId));
      },
    };
  }, [selectedTrackId]);
  const sectionHold = useCallback((ideaId: string): NativeFileHold | undefined => {
    if (ideaId === selectedSectionId) return undefined;
    return {
      ms: SPRING_LOAD_DELAY_MS,
      onHold: () => {
        if (ideaId === latest.current.selectedSectionId) return;
        spring(o => o.onOpenSection(ideaId));
      },
    };
  }, [selectedSectionId]);
  return useMemo(() => ({ trackHold, sectionHold }), [trackHold, sectionHold]);
}

// Spring-open flash timing and strength: a quick rise to a soft peak, a short hold,
// then a long ease-out fade so the tail stays visible (see flashGold).
export const SPRING_FLASH_RISE_MS = 150;
export const SPRING_FLASH_HOLD_MS = 150;
export const SPRING_FLASH_FADE_MS = 900;
/** Gold alpha at the peak, for both the background and the inset ring. */
export const SPRING_FLASH_PEAK_ALPHA = 0.18;

// Gold flash over the column a spring fills in — the Sections column when
// useSpringLoadedRows opens a Track, the Files column when it opens a Section —
// never on a click or a restore. The shared flashGold (use-landing-flash.ts) with
// the column's own softer peak; nothing at all under prefers-reduced-motion.
export function flashSpringOpenedColumn(el: HTMLElement | null): void {
  flashGold(el, {
    peakAlpha: SPRING_FLASH_PEAK_ALPHA,
    riseMs: SPRING_FLASH_RISE_MS,
    holdMs: SPRING_FLASH_HOLD_MS,
    fadeMs: SPRING_FLASH_FADE_MS,
    reducedMotion: 'skip',
  });
}

// Drag payload type for an organized clip dragged out of the Ideas shelf's Column 2
// (Finder-style move to another Idea). Not a loose file — handleDragEnd below ignores
// it, and Dashboard's own clip-move handler picks it up.
export const IDEA_CLIP_DRAG_TYPE = 'idea-clip';

// Kind + origin of whatever is being dragged, for drop targets that need to tell drag
// types apart (e.g. an Idea row suppressing its highlight for a clip dragged out of
// that same Idea). Same useDndMonitor approach as useActiveOrganizeDrag above, for
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

// ── No hover styling during a drag ───────────────────────────────────────────
// A file-browser surface (MediaBucket, the Songs quick-browser, the Ideas shelf's
// Column 1) wraps its rows in an element carrying DRAG_SURFACE_GROUP and the
// attributes from useDragSurfaceAttrs(): data-dnd-active is set during ANY dnd-kit
// drag. Rows style their hover with not-group-data-[dnd-active]/drag-surface:hover:*
// (DRAG_SURFACE_ROW_HOVER for the standard row), so plain hover is off mid-drag and
// only real drop highlights (organizeDropRules) light up. Outside a drag-surface
// group the variant still matches, so hover works normally there.
//
// One shared group name, not one per surface: Tailwind needs the group name written
// literally in each class, and shared rows (LooseFileRow, WaveformPlayerCard) appear
// on several surfaces.
export const DRAG_SURFACE_GROUP = 'group/drag-surface';
export const DRAG_SURFACE_ROW_HOVER =
  'not-group-data-[dnd-active]/drag-surface:hover:bg-white/5 not-group-data-[dnd-active]/drag-surface:hover:text-white';

// Must be called inside a DndContext.
export function useDragSurfaceAttrs(): { 'data-dnd-active': '' | undefined } {
  const drag = useActiveDragSource();
  return { 'data-dnd-active': drag ? '' : undefined };
}

interface UseLooseFileOrganizeDndOptions {
  onError?: (message: string) => void;
  onOrganized?: (dest: OrganizeDestination) => void;
}

export function useLooseFileOrganizeDnd(songId: string | undefined, options?: UseLooseFileOrganizeDndOptions) {
  // The dragged loose file or version, for the surface's LooseFileDragOverlay ghost.
  const [activeDrag, setActiveDrag] = useState<Clip | null>(null);
  // Copy of the loose-file or version drag data, taken at drag start. If the dragged
  // row unmounts mid-drag (a spring-loaded Track replaced the column holding it),
  // dnd-kit keeps active.id but swaps active.data.current for an empty object;
  // handleDragEnd then reads this instead. Keyed by the draggable id so a stale copy
  // never applies to a different drag.
  const dragSnapshotRef = useRef<{ activeId: UniqueIdentifier; data: OrganizeDragData } | null>(null);
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
    const data = event.active.data.current;
    const organizeData = isOrganizeDragData(data) ? data : null;
    setActiveDrag(organizeData ? organizeData.clip : null);
    clearLooseFileDropReport();
    dragSnapshotRef.current = organizeData
      ? { activeId: event.active.id, data: { ...organizeData } }
      : null;
  };

  // The drag's data: live when the dragged row is still mounted, otherwise the
  // drag-start copy. Doesn't clear anything — callers that route a version drop
  // (Timeline.tsx) read it before handleDragEnd, which clears the snapshot.
  const resolveDrag = (event: DragEndEvent): OrganizeDragData | undefined => {
    const live = event.active.data.current;
    if (isOrganizeDragData(live)) return live;
    const snapshot = dragSnapshotRef.current;
    return snapshot && snapshot.activeId === event.active.id ? snapshot.data : undefined;
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
  // useSpringLoadedRows, which restores the pre-drag selection on no move.
  const handleDragEnd = (event: DragEndEvent): boolean => {
    const { active, over } = event;
    // Live data when the dragged row is still mounted; otherwise the drag-start copy.
    const drag = resolveDrag(event);
    setActiveDrag(null);
    dragSnapshotRef.current = null;
    if (!over) return false;
    // Versions (bucket-clip) aren't handled here — the surface routes them itself.
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
    resolveDrag,
    activeDrag,
    isPending:
      organizeLooseFileMutation.isPending ||
      assignLooseFileTrackMutation.isPending ||
      unassignLooseFileTrackMutation.isPending,
  };
}

// ── Version moves (bucket-clip drops) ────────────────────────────────────────
// Drop handling for a real-song version dragged onto a bucket target, chained after
// useLooseFileOrganizeDnd's handleDragEnd on every surface (Timeline in Workspace,
// SongHome, the Songs quick-browser), which ignores version drags:
//   Section row / Files column showing another section → Move A (to that section)
//   Track row                                         → Move D (that track's shelf)
//   Sections column background                        → Move C (shown track's shelf)
//   Tracks column background                          → Move B (song-level)
// Acceptance uses the same organizeDropRules as the highlight, so a drop is acted on
// exactly where the target lit up; anything else does nothing.
//
// A drop that starts a move reports 'deferred' to the spring-loaded tracks (the
// request is async, and may open the in-use dialog), then resolves it: success → the
// file moved, the view follows it (onMoved); failure, Cancel or Escape → the
// drag-start selection comes back if a spring changed it.
//
// moveOutOfSection is the right-click "Remove from Section" (same as Move B), shared
// with the cards through VersionMoveOutContext. The surface renders
// VersionMoveInUseDialog with dialogProps/pendingVars — at the surface level, since
// the card unmounts once the version leaves its section.
export type VersionMoveDestination =
  | { kind: 'section'; trackId: string; sectionName: string }
  | { kind: 'loose'; trackId: string | null };

// "Remove from Section" on a version card. Provided by the surface (null = the item
// isn't offered there — not a real song, or no surface to host the dialog).
export interface VersionMoveOutRequest {
  clipId: string;
  clipName: string;
  songId: string;
  sourceTrackName: string;
  sourceSectionName: string;
}
export const VersionMoveOutContext = createContext<((req: VersionMoveOutRequest) => void) | null>(null);

export function useVersionMoveDnd(options?: { onMoved?: (dest: VersionMoveDestination) => void }) {
  const move = useMoveVersion({
    onSuccess: (vars) => {
      resolveDeferredLooseFileDrop(true);
      options?.onMoved?.(vars.kind === 'section'
        ? { kind: 'section', trackId: vars.destTrackId, sectionName: vars.destSectionName }
        : { kind: 'loose', trackId: vars.destTrackId });
    },
    onError: () => resolveDeferredLooseFileDrop(false),
    onCancel: () => resolveDeferredLooseFileDrop(false),
  });

  // drag: the caller's resolved drag data (live first, then the drag-start snapshot —
  // useLooseFileOrganizeDnd's resolveDrag, read before its handleDragEnd clears it).
  // Returns true when the event was a version drop on a bucket target (acted on or
  // not), false otherwise so the caller can carry on with its own branches.
  const handleDragEnd = (event: DragEndEvent, drag: OrganizeDragData | undefined): boolean => {
    if (drag?.type !== BUCKET_CLIP_DRAG_TYPE) return false;
    const { active, over } = event;
    if (!over || !isBucketOrganizeDropId(over.id)) return false;
    const id = String(over.id);
    const activeDrag = toActiveOrganizeDrag(drag);
    const base = {
      clipId: drag.clip.id,
      clipName: drag.clip.name,
      songId: drag.songId,
      sourceTrackName: drag.trackName,
      sourceSectionName: drag.clip.sectionName ?? '',
    };

    if (id.startsWith(BUCKET_SECTION_DROP_PREFIX) || id.startsWith(BUCKET_VERSIONS_DROP_PREFIX)) {
      const target = over.data.current as SectionDropTarget | undefined;
      if (!target?.ideaId || !organizeDropRules.sectionRow(activeDrag, target)) return true;
      reportLooseFileDrop(active.id, 'deferred');
      move.run({
        ...base,
        kind: 'section',
        destIdeaId: target.ideaId,
        destTrackId: target.trackId,
        destTrackName: target.trackName,
        destSectionName: target.sectionName,
      });
      return true;
    }

    if (id.startsWith(BUCKET_TRACK_DROP_PREFIX) || id.startsWith(BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX)) {
      const target = over.data.current as TrackDropTarget | undefined;
      if (!target?.trackId) return true;
      const accepts = id.startsWith(BUCKET_TRACK_DROP_PREFIX)
        ? organizeDropRules.trackRow(activeDrag, target)
        : organizeDropRules.sectionsBackground(activeDrag, target);
      if (!accepts) return true;
      reportLooseFileDrop(active.id, 'deferred');
      move.run({ ...base, kind: 'loose', destTrackId: target.trackId });
      return true;
    }

    if (id.startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX)) {
      const target = over.data.current as TracksDropTarget | undefined;
      if (!target?.songId || !organizeDropRules.tracksBackground(activeDrag, target)) return true;
      reportLooseFileDrop(active.id, 'deferred');
      move.run({ ...base, kind: 'loose', destTrackId: null });
      return true;
    }

    return true;
  };

  // Right-click "Remove from Section" — Move B without a drag (nothing to report).
  const moveOutOfSection = (req: VersionMoveOutRequest) => {
    move.run({ ...req, kind: 'loose', destTrackId: null });
  };

  return { handleDragEnd, moveOutOfSection, dialogProps: move.dialogProps, pendingVars: move.pendingVars };
}
