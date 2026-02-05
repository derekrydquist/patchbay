import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Clip } from '@/lib/daw-data';
import { GripVertical } from 'lucide-react';

interface ClipProps {
  clip: Clip;
  isOverlay?: boolean;
}

export function TimelineClip({ clip, isOverlay }: ClipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: clip.id,
    data: { clip, type: 'clip' },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  // 1 unit = 20px (arbitrary scale)
  const width = clip.duration * 20;
  
  // If in timeline (not overlay), position it absolutely based on start time
  const positionStyle: React.CSSProperties = isOverlay ? { width } : {
    width,
    left: clip.start * 20,
    position: 'absolute',
    ...style,
  };

  return (
    <div
      ref={setNodeRef}
      style={positionStyle}
      {...listeners}
      {...attributes}
      className={cn(
        "h-full rounded-md border border-white/10 flex items-center overflow-hidden group cursor-grab active:cursor-grabbing shadow-sm z-10",
        isDragging && "opacity-50 ring-2 ring-primary ring-offset-2 ring-offset-background z-50",
        isOverlay && "shadow-2xl scale-105 opacity-90 z-50"
      )}
    >
      <div 
        className="absolute inset-0 opacity-80" 
        style={{ backgroundColor: clip.color }}
      />
      
      {/* Waveform Visualization (Fake) */}
      <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
         <svg width="100%" height="100%" preserveAspectRatio="none">
            <path d={`M0,${50 + Math.random() * 10} Q${width/4},${20} ${width/2},${50} T${width},${50}`} fill="none" stroke="black" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
         </svg>
      </div>

      <div className="relative z-10 px-2 flex items-center gap-1 w-full">
        <GripVertical size={12} className="text-black/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="text-xs font-medium text-black truncate w-full select-none mix-blend-multiply">
          {clip.name}
        </span>
      </div>
    </div>
  );
}

export function BucketClip({ clip }: { clip: Clip }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bucket-${clip.id}`,
    data: { clip, type: 'bucket-clip' },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "p-2 rounded-md border border-border bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing flex items-center gap-3 transition-colors group",
        isDragging && "opacity-0"
      )}
    >
      <div 
        className="w-3 h-8 rounded-sm shrink-0" 
        style={{ backgroundColor: clip.color }}
      />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors">{clip.name}</span>
        <span className="text-xs text-muted-foreground uppercase">{clip.type} • {clip.duration}s</span>
      </div>
    </div>
  );
}
