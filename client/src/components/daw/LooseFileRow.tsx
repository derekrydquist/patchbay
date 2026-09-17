import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FileAudio } from 'lucide-react';
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
}

// A song-scoped or band-wide upload with no Track/Section yet. Draggable onto a
// Section (organize) or onto the Timeline (place-on-timeline) — see Timeline.tsx /
// MediaBucket.tsx for the drop handling. Clickable only where `onClick` is passed;
// otherwise it carries no folder-browser navigation state.
export function LooseFileRow({ looseFile, songId, onClick, isSelected }: LooseFileRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `loose-${looseFile.id}`,
    data: { clip: looseFileToClip(looseFile), type: 'loose-file', songId },
  });
  const style = { transform: CSS.Translate.toString(transform) };

  return (
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
  );
}
