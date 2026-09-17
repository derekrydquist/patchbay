import { useState } from 'react';
import {
  useSensor,
  useSensors,
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
import { useOrganizeLooseFile } from '@/hooks/use-bucket-mutations';

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

export function bucketSectionDropId(ideaId: string): string {
  return `${BUCKET_SECTION_DROP_PREFIX}${ideaId}`;
}

export function bucketVersionsDropId(suffix: string): string {
  return `${BUCKET_VERSIONS_DROP_PREFIX}${suffix}`;
}

export function isBucketOrganizeDropId(id: string | number): boolean {
  const s = String(id);
  return s.startsWith(BUCKET_SECTION_DROP_PREFIX) || s.startsWith(BUCKET_VERSIONS_DROP_PREFIX);
}

// Low-level collision pass shared by every surface's collision detection: organize
// drop targets (Section rows, Versions columns) are narrow, non-full-width zones, so
// a vertical-band-only heuristic or the wrong rect cache entry can false-match a
// sibling column at the same row height. Reads a live getBoundingClientRect() first so
// a droppable with a stable-but-freshly-mounted id is never skipped for lack of a
// cached rect (see bucketVersionsDropId's stable-id fix — the bug this specifically
// guards against).
export function matchOrganizeDropTarget(
  droppableContainers: DroppableContainer[],
  droppableRects: Map<UniqueIdentifier, ClientRect>,
  x: number,
  y: number
): { id: UniqueIdentifier } | null {
  for (const container of droppableContainers) {
    if (!isBucketOrganizeDropId(container.id)) continue;
    const rect = container.node.current?.getBoundingClientRect() ?? droppableRects.get(container.id);
    if (!rect) continue;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return { id: container.id };
    }
  }
  return null;
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

interface UseLooseFileOrganizeDndOptions {
  onError?: (message: string) => void;
}

export function useLooseFileOrganizeDnd(songId: string | undefined, options?: UseLooseFileOrganizeDndOptions) {
  const [activeDrag, setActiveDrag] = useState<Clip | null>(null);
  const sensors = useLooseFileOrganizeSensors();
  const organizeLooseFileMutation = useOrganizeLooseFile(songId, {
    onError: options?.onError ?? ((msg) => console.error('[organizeLooseFile] error:', msg)),
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

    const dropData = over.data.current as { trackId?: string; sectionName?: string } | undefined;
    const looseFileId = active.data.current?.clip?.id;
    if (!dropData?.trackId || !dropData?.sectionName || !looseFileId) {
      console.warn('[LooseFileDrop] missing trackId/sectionName on organize drop target', dropData);
      return true;
    }
    organizeLooseFileMutation.mutate({
      looseFileId,
      trackId: dropData.trackId,
      sectionName: dropData.sectionName,
    });
    return true;
  };

  return {
    sensors,
    collisionDetection: organizeDropCollision,
    handleDragStart,
    handleDragEnd,
    activeDrag,
    isPending: organizeLooseFileMutation.isPending,
  };
}
