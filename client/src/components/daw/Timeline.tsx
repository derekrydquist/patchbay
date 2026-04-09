import React, { useState, useEffect } from 'react';
import { 
  DndContext, 
  DragOverlay, 
  DragStartEvent, 
  DragEndEvent, 
  useSensor, 
  useSensors, 
  PointerSensor, 
  TouchSensor, 
  MouseSensor,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { INITIAL_TRACKS, Track, Clip, MOCK_SONG } from '@/lib/daw-data';
import { TimelineTrack } from './Track';
import { TimelineClip } from './Clip';
import { nanoid } from 'nanoid';
import { Ruler } from './Ruler';
import { Music2 } from 'lucide-react';
import { MediaBucket } from './MediaBucket';

export function Timeline() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [activeDragClip, setActiveDragClip] = useState<Clip | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  useEffect(() => {
    const handleAddClip = (e: any) => {
      const clip = e.detail as Clip;
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
    <DndContext 
      sensors={sensors} 
      onDragStart={handleDragStart} 
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <MediaBucket
          key={refreshKey}
          onAddToTimeline={(clip) => {
            const track = tracks.find(t => clip.name.toLowerCase().includes(t.name.toLowerCase()));
            if (track) {
              addClipToTrack(track.id, clip);
            } else {
              addClipToTrack(tracks[0].id, clip);
            }
          }}
          onInstrumentAdded={() => setRefreshKey((v) => v + 1)}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative overflow-hidden select-none">
          <Ruler />
          <div className="flex-1 overflow-y-auto overflow-x-auto relative scrollbar-hide">
            <div className="min-w-[2000px] pb-32">
              {tracks.map(track => (
                <TimelineTrack key={track.id} track={track} />
              ))}
              
              <div className="h-16 flex items-center justify-center border-b border-white/5 border-dashed text-muted-foreground hover:bg-white/5 cursor-pointer transition-colors group">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] group-hover:text-primary transition-colors opacity-40 group-hover:opacity-100">+ Add New Track</span>
              </div>
            </div>

            <div className="absolute top-0 bottom-0 left-[240px] w-[1px] bg-primary/40 z-40 pointer-events-none shadow-[0_0_15px_rgba(212,175,55,0.2)]">
              <div className="absolute -top-3 -left-[5px] w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-primary" />
            </div>
          </div>
        </div>
      </div>

      <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
        {activeDragClip ? (
          <div className="opacity-90 scale-105 rotate-1 cursor-grabbing pointer-events-none z-[9999]">
            <div 
              className="h-10 rounded-md border-2 border-primary shadow-[0_0_30px_rgba(212,175,55,0.4)] flex items-center px-4 gap-3 bg-[#0c0c0e]"
              style={{ width: Math.max(160, activeDragClip.duration * 20) }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeDragClip.color }} />
              <span className="text-xs font-black text-white truncate uppercase tracking-widest font-heading">
                {activeDragClip.name}
              </span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
