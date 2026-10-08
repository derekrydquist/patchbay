import { useState, useMemo } from 'react';
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
  type DragEndEvent,
  type DroppableContainer,
  type ClientRect,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { type Clip } from '@/lib/daw-data';
import { useOrganizeLooseFile, useAssignLooseFileTrack, useUnassignLooseFileTrack } from '@/hooks/use-bucket-mutations';
import { useToast } from '@/hooks/use-toast';

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

// Column-background targets that geometrically contain other organize targets —
// matched only as a fallback (see matchOrganizeDropTarget).
function isBackgroundDropId(id: UniqueIdentifier): boolean {
  const s = String(id);
  return s.startsWith(BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX) || s.startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX);
}

export function isBucketOrganizeDropId(id: string | number): boolean {
  const s = String(id);
  return (
    s.startsWith(BUCKET_SECTION_DROP_PREFIX) ||
    s.startsWith(BUCKET_VERSIONS_DROP_PREFIX) ||
    s.startsWith(BUCKET_TRACK_DROP_PREFIX) ||
    s.startsWith(BUCKET_SECTIONS_BACKGROUND_DROP_PREFIX) ||
    s.startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX)
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
// The two backgrounds are different columns and never overlap each other, so
// remembering whichever one matched is unambiguous.
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

interface UseLooseFileOrganizeDndOptions {
  onError?: (message: string) => void;
  onOrganized?: (dest: OrganizeDestination) => void;
}

export function useLooseFileOrganizeDnd(songId: string | undefined, options?: UseLooseFileOrganizeDndOptions) {
  const [activeDrag, setActiveDrag] = useState<Clip | null>(null);
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
    const clip = event.active.data.current?.clip as Clip | undefined;
    const type = event.active.data.current?.type as string | undefined;
    setActiveDrag(type === 'loose-file' && clip ? clip : null);
  };

  // Returns true when the event was a loose-file organize drop (handled here, whether
  // it succeeded or warned) — callers embedding this inside a larger handleDragEnd
  // (Timeline.tsx) can early-return on true and fall through to their own logic on
  // false rather than duplicating the isBucketOrganizeDropId/type check themselves.
  const handleDragEnd = (event: DragEndEvent): boolean => {
    const { active, over } = event;
    setActiveDrag(null);
    if (!over) return false;
    if (active.data.current?.type !== 'loose-file') return false;
    if (!isBucketOrganizeDropId(over.id)) return false;

    const looseFileId = active.data.current?.clip?.id;
    if (!looseFileId) {
      console.warn('[LooseFileDrop] missing loose file id on drag data');
      return true;
    }

    // Tracks-column-background drop — un-assign a Track-scoped loose file back to
    // the plain song-scoped shelf. MediaBucket only enables this droppable while a
    // Track-scoped loose file is being dragged, but the origin is re-checked here
    // since un-assigning a file with no track has nothing to do.
    if (String(over.id).startsWith(BUCKET_TRACKS_BACKGROUND_DROP_PREFIX)) {
      const originTrackId = (active.data.current as { trackId?: string | null } | undefined)?.trackId ?? null;
      if (!originTrackId) {
        console.warn('[LooseFileDrop] Tracks-background drop on a file with no trackId — nothing to un-assign');
        return true;
      }
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
      const originTrackId = (active.data.current as { trackId?: string | null } | undefined)?.trackId ?? null;
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
      assignLooseFileTrackMutation.mutate(
        { looseFileId, trackId: destTrackId, originTrackId },
        { onSuccess: () => options?.onOrganized?.({ action: 'assign-track', trackId: destTrackId }) }
      );
      return true;
    }

    const dropData = over.data.current as { trackId?: string; sectionName?: string } | undefined;
    if (!dropData?.trackId || !dropData?.sectionName) {
      console.warn('[LooseFileDrop] missing trackId/sectionName on organize drop target', dropData);
      return true;
    }
    const destTrackId = dropData.trackId;
    const destSectionName = dropData.sectionName;
    organizeLooseFileMutation.mutate(
      { looseFileId, trackId: destTrackId, sectionName: destSectionName },
      { onSuccess: () => options?.onOrganized?.({ action: 'organize', trackId: destTrackId, sectionName: destSectionName }) }
    );
    return true;
  };

  return {
    sensors,
    collisionDetection: organizeDropCollision,
    handleDragStart,
    handleDragEnd,
    activeDrag,
    isPending:
      organizeLooseFileMutation.isPending ||
      assignLooseFileTrackMutation.isPending ||
      unassignLooseFileTrackMutation.isPending,
  };
}
