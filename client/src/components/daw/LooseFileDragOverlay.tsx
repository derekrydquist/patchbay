import { DragOverlay } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { FileAudio } from 'lucide-react';
import { type Clip } from '@/lib/daw-data';

// Floating drag ghost for a loose file being dragged onto a Section row or Versions
// column, for any DndContext built around useLooseFileOrganizeDnd. Styled to match
// Timeline.tsx's own clip-drag DragOverlay (the reference implementation) so the drag
// feel is identical everywhere. Timeline itself doesn't need this component — its
// existing DragOverlay already renders a ghost for every drag type it handles,
// loose files included.
//
// A portal-based DragOverlay is required here (not just LooseFileRow's own inline
// transform) because a plain in-place transform can visually clip/detach inside a
// scrolling, overflow-hidden column — this was the root cause of the Songs
// quick-browser's detached/misplaced drag-preview bug.
export function LooseFileDragOverlay({ clip }: { clip: Clip | null }) {
  return (
    <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
      {clip ? (
        <div className="opacity-90 scale-105 rotate-1 cursor-grabbing pointer-events-none z-[9999]">
          <div className="h-10 max-w-xs rounded-md border-2 border-primary shadow-[0_0_30px_rgba(212,175,55,0.4)] flex items-center px-4 gap-3 bg-[#0c0c0e] pointer-events-none">
            <FileAudio size={14} className="shrink-0 text-primary" />
            <span className="text-xs font-bold text-white truncate tracking-tight">{clip.name}</span>
          </div>
        </div>
      ) : null}
    </DragOverlay>
  );
}
