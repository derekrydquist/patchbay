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
  isInvalidTarget?: boolean;
}

export function TimelineTrack({ track, isActive, isInvalidTarget }: TrackProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: track.id,
    data: { track, type: 'track' },
    disabled: isInvalidTarget,
  });

  return (
    <div className={cn(
      "flex w-full h-16 border-b border-border bg-card/20 transition-all duration-300 group",
      isInvalidTarget ? "opacity-30 grayscale pointer-events-none" : "hover:bg-card/40"
    )}>
      {/* Track Header (Controls) */}
      <div className="w-64 shrink-0 bg-card border-r border-border px-3 flex items-center gap-3 sticky left-0 z-20">
        <div className="w-1 h-full absolute left-0 top-0 bottom-0" style={{ backgroundColor: track.color }} />
        
        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
          {track.type === 'vocal' ? <Mic size={14} className="text-muted-foreground" /> : 
           track.type === 'instrument' ? <Activity size={14} className="text-muted-foreground" /> :
           <Headphones size={14} className="text-muted-foreground" />}
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-heading font-bold uppercase tracking-wider text-[11px] truncate text-foreground block">{track.name}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex gap-0.5">
               <button 
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('toggle-track-mute', { detail: { trackId: track.id } }));
                }}
                className={cn("text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors", track.muted && "bg-destructive text-destructive-foreground border-destructive")}>M</button>
               <button 
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('toggle-track-solo', { detail: { trackId: track.id } }));
                }}
                className={cn("text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors", track.solo && "bg-primary text-primary-foreground border-primary")}>S</button>
            </div>
            <Slider 
              value={[track.volume ?? 80]} 
              onValueChange={([val]) => {
                window.dispatchEvent(new CustomEvent('update-track-volume', { detail: { trackId: track.id, volume: val } }));
              }}
              max={100} step={1} className="w-16 h-1" 
            />
          </div>
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
