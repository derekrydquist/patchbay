import React, { useState } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { INITIAL_TRACKS, Track, Clip } from '@/lib/daw-data';
import { TimelineTrack } from './Track';
import { MediaBucket } from './MediaBucket';
import { Transport } from './Transport';
import { TimelineClip } from './Clip';
import { nanoid } from 'nanoid';
import { Ruler } from './Ruler';

export function Timeline() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [activeDragClip, setActiveDragClip] = useState<Clip | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const clip = active.data.current?.clip as Clip;

    if (clip) {
      setActiveDragClip(clip);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragClip(null);

    if (!over) return;

    const activeType = active.data.current?.type;
    const clip = active.data.current?.clip as Clip;
    const trackId = over.id as string;

    if (!trackId || !clip) return;

    if (activeType === 'bucket-clip') {
      setTracks(prev => prev.map(t => {
        if (t.id === trackId) {
          const lastClip = t.clips[t.clips.length - 1];
          const start = lastClip ? lastClip.start + lastClip.duration : 0;
          
          return {
            ...t,
            clips: [...t.clips, { ...clip, id: nanoid(), start }]
          };
        }
        return t;
      }));
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
       <Ruler />

       <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart} 
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-y-auto overflow-x-auto relative">
          <div className="min-w-[2000px] pb-32">
            {tracks.map(track => (
              <TimelineTrack key={track.id} track={track} />
            ))}
            
            <div className="h-16 flex items-center justify-center border-b border-border/20 border-dashed text-muted-foreground hover:bg-card/10 cursor-pointer transition-colors group">
              <span className="text-[11px] font-bold uppercase tracking-wider group-hover:text-primary transition-colors">+ Add New Track</span>
            </div>
          </div>

          <div className="absolute top-0 bottom-0 left-[240px] w-[1px] bg-primary z-40 pointer-events-none shadow-[0_0_10px_rgba(212,175,55,0.5)]">
            <div className="absolute -top-3 -left-[5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-primary" />
          </div>
        </div>

        <DragOverlay modifiers={[restrictToWindowEdges]}>
          {activeDragClip ? (
            <TimelineClip clip={activeDragClip} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
