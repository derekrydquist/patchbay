import { type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FileAudio, Trash2 } from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useDeleteLooseFile } from '@/hooks/use-bucket-mutations';
import { type ApiLooseFile } from '@/lib/bucket-api';
import { type Clip } from '@/lib/daw-data';
import { cn } from '@/lib/utils';

// Converts a loose file into the same Clip shape BucketClip drag payloads use,
// so the DragOverlay ghost and generic clip-shaped drag logic in Timeline.tsx
// work unmodified. sectionName is deliberately omitted — a loose file has none
// until it's organized.
export function looseFileToClip(lf: ApiLooseFile): Clip {
  return {
    id: lf.id,
    name: lf.name,
    type: lf.type as Clip['type'],
    color: lf.color,
    start: 0,
    duration: lf.duration,
    src: lf.src ?? undefined,
    isFinal: false,
    metadata: lf.metadata as unknown as Clip['metadata'],
  };
}

interface LooseFileRowProps {
  looseFile: ApiLooseFile;
  // null for a band-wide, unassigned file (Ideas shelf Column 1) — carried in drag
  // data for informational purposes only; the organize/place-on-timeline handlers
  // resolve destination entirely from the drop target's own data, never from this.
  songId: string | null;
  // Optional — when provided, the row is also clickable (not just draggable). The
  // Ideas shelf uses this to load the file's preview into the Files column, since a
  // loose file has no bucket-clip card of its own until it's organized. Omitted at
  // every other call site (MediaBucket, Songs quick-browser), which have no
  // equivalent preview surface and keep the original drag-only behavior.
  onClick?: () => void;
  // Whether this file is the one currently previewed — same gold-highlight
  // treatment as every other "this row is the active selection" row in the app
  // (IdeaListRow, SongsSectionRow, etc.). Selection is mutually exclusive with
  // any Idea highlight; the Ideas shelf clears the Idea's isSelected whenever a
  // loose file is being previewed. Meaningless (and omitted) without `onClick`.
  isSelected?: boolean;
  // Fired after a successful delete, in addition to the hook's own list-query
  // invalidation. Surfaces with local state referencing this specific file (the
  // Ideas shelf's one-off preview) use this to clear that state; every other
  // call site omits it since the row simply disappearing is enough.
  onDeleted?: () => void;
}

interface LooseFileDeleteMenuProps {
  looseFile: Pick<ApiLooseFile, 'id' | 'trackId'>;
  songId: string | null;
  onDeleted?: () => void;
  children: ReactNode;
}

// The right-click "Delete" menu shared by every surface that can render a loose
// file — LooseFileRow (Column 1 / Tracks-column lists) and the Ideas shelf's
// one-off preview card (a bare WaveformPlayerCard, not a LooseFileRow, so it
// needs this wrapped around it directly). Kept as one component specifically so
// the two surfaces can't drift apart the way TimelineClip/WaveformPlayerCard's
// final/comment badges once did — see CornerBadge in the daw CLAUDE.md.
export function LooseFileDeleteMenu({ looseFile, songId, onDeleted, children }: LooseFileDeleteMenuProps) {
  const deleteMutation = useDeleteLooseFile({
    onSuccess: () => onDeleted?.(),
    onError: (msg) => console.error('[deleteLooseFile] error:', msg),
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="bg-[#0c0c0e] border-white/10 min-w-[140px]">
        <ContextMenuItem
          className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer text-xs flex items-center gap-2"
          onClick={() => deleteMutation.mutate({ looseFileId: looseFile.id, songId, trackId: looseFile.trackId })}
        >
          <Trash2 size={13} /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// A song-scoped or band-wide upload with no Track/Section yet. Draggable onto a
// Section (organize) or onto the Timeline (place-on-timeline) — see Timeline.tsx /
// MediaBucket.tsx for the drop handling. Clickable only where `onClick` is passed;
// otherwise it carries no folder-browser navigation state. Right-click offers a
// single, unconfirmed Delete via LooseFileDeleteMenu — a loose file has no
// dependent rows yet, so there's nothing for a delete to cascade into.
export function LooseFileRow({ looseFile, songId, onClick, isSelected, onDeleted }: LooseFileRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `loose-${looseFile.id}`,
    // trackId is carried alongside `clip` (not inside it — looseFileToClip's Clip
    // shape has no such field) so drop targets can tell an already Track-scoped
    // file apart from a plain Tracks-column one. See TrackFolderRow in
    // MediaBucket.tsx, which disables itself when this equals its own track.
    data: { clip: looseFileToClip(looseFile), type: 'loose-file', songId, trackId: looseFile.trackId },
  });
  const style = { transform: CSS.Translate.toString(transform) };

  return (
    <LooseFileDeleteMenu looseFile={looseFile} songId={songId} onDeleted={onDeleted}>
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-2 p-2 rounded text-xs select-none touch-none cursor-grab active:cursor-grabbing transition-opacity',
          isSelected
            ? 'bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]'
            : 'text-muted-foreground/80',
          onClick && !isSelected && 'hover:bg-white/5 hover:text-white',
          isDragging && 'opacity-40'
        )}
        title={looseFile.name}
      >
        <FileAudio size={14} className={cn('shrink-0', isSelected ? 'text-primary' : 'text-primary/50')} />
        <span className="font-bold tracking-tight truncate">{looseFile.name}</span>
      </div>
    </LooseFileDeleteMenu>
  );
}
