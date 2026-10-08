import { DragOverlay, type Modifier } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { FileAudio } from 'lucide-react';
import { type Clip } from '@/lib/daw-data';

// Floating drag ghost for a loose file being dragged onto a Section row or Versions
// column, for any DndContext built around useLooseFileOrganizeDnd. Styled to match
// Timeline.tsx's own clip-drag DragOverlay (the reference implementation) so the drag
// feel is identical everywhere. Timeline itself doesn't need this component — its
// existing DragOverlay already renders a ghost for every drag type it handles,
// loose files included.
//
// Also renders the Ideas shelf's organized-clip drags (move to another Idea) — only
// the name is shown, so any object with one works.
//
// A portal-based DragOverlay is required here (not just LooseFileRow's own inline
// transform) because a plain in-place transform can visually clip/detach inside a
// scrolling, overflow-hidden column — this was the root cause of the Songs
// quick-browser's detached/misplaced drag-preview bug.
//
// The ghost is row-sized and anchored just below and to the right of the cursor
// (anchorBelowRightOfCursor), not at the grab offset: a ghost at the grab offset
// sat on top of the row being targeted, so the row under the cursor looked like
// the drop target while a different row was actually highlighted. Pointer events
// are off on DragOverlay's own wrapper, not just the ghost inside it.
const CURSOR_GAP_PX = 12;

// Moves the overlay's top-left corner to the cursor plus CURSOR_GAP_PX on both
// axes. Same shape as @dnd-kit/modifiers' snapCenterToCursor, which would center
// the ghost on the cursor and still cover the target row.
const anchorBelowRightOfCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const activator = getEventCoordinates(activatorEvent);
  if (!activator) return transform;
  return {
    ...transform,
    x: transform.x + activator.x - draggingNodeRect.left + CURSOR_GAP_PX,
    y: transform.y + activator.y - draggingNodeRect.top + CURSOR_GAP_PX,
  };
};

export function LooseFileDragOverlay({ clip }: { clip: Pick<Clip, 'name'> | null }) {
  return (
    <DragOverlay
      modifiers={[anchorBelowRightOfCursor, restrictToWindowEdges]}
      dropAnimation={null}
      style={{ pointerEvents: 'none' }}
    >
      {clip ? (
        <div className="opacity-90 cursor-grabbing pointer-events-none z-[9999]">
          <div className="h-8 max-w-xs rounded-md border-2 border-primary shadow-[0_0_30px_rgba(212,175,55,0.4)] flex items-center px-4 gap-3 bg-[#0c0c0e] pointer-events-none">
            <FileAudio size={14} className="shrink-0 text-primary" />
            <span className="text-xs font-bold text-white truncate tracking-tight">{clip.name}</span>
          </div>
        </div>
      ) : null}
    </DragOverlay>
  );
}
