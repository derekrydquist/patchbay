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
  songId: string;
}

// A song-scoped upload with no Track/Section yet. Draggable onto a Section (organize)
// or onto the Timeline (place-on-timeline) — see Timeline.tsx / MediaBucket.tsx for the
// drop handling. Not clickable/selectable; it carries no folder-browser navigation state.
export function LooseFileRow({ looseFile, songId }: LooseFileRowProps) {
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
      className={cn(
        'w-full flex items-center gap-2 p-2 rounded text-xs text-muted-foreground/80 select-none touch-none cursor-grab active:cursor-grabbing transition-opacity',
        isDragging && 'opacity-40'
      )}
      title={looseFile.name}
    >
      <FileAudio size={14} className="shrink-0 text-primary/50" />
      <span className="font-bold tracking-tight truncate">{looseFile.name}</span>
    </div>
  );
}
