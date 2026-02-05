import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Track, Clip } from '@/lib/daw-data';
import { TimelineClip } from './Clip';
import { Volume2, Mic, Headphones, Activity } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface TrackProps {
  track: Track;
  isActive?: boolean;
}

export function TimelineTrack({ track, isActive }: TrackProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: track.id,
    data: { track, type: 'track' },
  });

  return (
    <div className="flex w-full h-24 border-b border-border bg-card/20 hover:bg-card/40 transition-colors group">
      {/* Track Header (Controls) */}
      <div className="w-64 shrink-0 bg-card border-r border-border p-3 flex flex-col justify-between relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-1 h-full absolute left-0 top-0 bottom-0" style={{ backgroundColor: track.color }} />
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            {track.type === 'vocal' ? <Mic size={14} className="text-muted-foreground" /> : 
             track.type === 'instrument' ? <Activity size={14} className="text-muted-foreground" /> :
             <Headphones size={14} className="text-muted-foreground" />}
          </div>
          <span className="font-heading font-bold uppercase tracking-wider text-sm truncate text-foreground">{track.name}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
             <button className={cn("text-[10px] w-5 h-5 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors", track.muted && "bg-destructive text-destructive-foreground border-destructive")}>M</button>
             <button className={cn("text-[10px] w-5 h-5 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors", track.solo && "bg-primary text-primary-foreground border-primary")}>S</button>
          </div>
          <Slider defaultValue={[track.volume]} max={100} step={1} className="w-20" />
        </div>
      </div>

      {/* Track Lane (Timeline) */}
      <div 
        ref={setNodeRef}
        className={cn(
          "flex-1 relative overflow-hidden bg-[linear-gradient(90deg,transparent_19px,rgba(255,255,255,0.02)_20px)] bg-[size:20px_100%]",
          isOver && "bg-primary/5 ring-inset ring-2 ring-primary/20"
        )}
      >
        {track.clips.map(clip => (
          <TimelineClip key={clip.id} clip={clip} />
        ))}
      </div>
    </div>
  );
}
