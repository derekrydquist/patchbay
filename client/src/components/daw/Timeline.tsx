import React, { useState, useEffect } from 'react';
import { DndContext, DragOverlay, DragStartEvent, DragEndEvent, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { INITIAL_TRACKS, Track, Clip, MOCK_SONG } from '@/lib/daw-data';
import { TimelineTrack } from './Track';
import { MediaBucket } from './MediaBucket';
import { Transport } from './Transport';
import { TimelineClip } from './Clip';
import { nanoid } from 'nanoid';
import { Ruler } from './Ruler';
import { Music2 } from 'lucide-react';

export function Timeline() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [activeDragClip, setActiveDragClip] = useState<Clip | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 2,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 5,
      },
    })
  );

  useEffect(() => {
    const handleAddClip = (e: any) => {
      const clip = e.detail as Clip;
      // Find the track for the instrument
      const track = tracks.find(t => clip.name.toLowerCase().includes(t.name.toLowerCase()));
      if (track) {
        addClipToTrack(track.id, clip);
      } else {
        addClipToTrack(tracks[0].id, clip);
      }
    };

    window.addEventListener('add-clip-to-timeline', handleAddClip);
    return () => window.removeEventListener('add-clip-to-timeline', handleAddClip);
  }, [tracks]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const clip = active.data.current?.clip as Clip;

    if (clip) {
      setActiveDragClip(clip);
    }
  };

  const addClipToTrack = (trackId: string, clip: Clip) => {
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
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragClip(null);

    if (!over) return;

    const activeType = active.data.current?.type;
    const clip = active.data.current?.clip as Clip;
    const trackId = over.id as string;

    if (!trackId || !clip) return;

    if (activeType === 'bucket-clip' || activeType === 'clip') {
      addClipToTrack(trackId, clip);
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

        <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
          {activeDragClip ? (
            <div className="opacity-90 scale-105 rotate-1 cursor-grabbing pointer-events-none z-[9999]">
              <div 
                className="h-10 rounded border-2 border-primary shadow-[0_0_20px_rgba(212,175,55,0.4)] flex items-center px-3 gap-2"
                style={{ backgroundColor: activeDragClip.color, width: Math.max(120, activeDragClip.duration * 20) }}
              >
                <Music2 size={14} className="text-black/70" />
                <span className="text-xs font-black text-black truncate uppercase tracking-tighter">
                  {activeDragClip.name}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
