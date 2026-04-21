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
import { Music2, Plus } from 'lucide-react';
import { MediaBucket } from './MediaBucket';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface TimelineSection {
  id: string;
  name: string;
  start: number;
  duration: number;
}

export function Timeline() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [activeDragClip, setActiveDragClip] = useState<Clip | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [playheadPosition, setPlayheadPosition] = useState(256); // Initial position matches left-[256px]
  const [isPlaying, setIsPlaying] = useState(false);

  const animationRef = React.useRef<number>();
  const lastTimeRef = React.useRef<number>();
  const timelineRef = React.useRef<HTMLDivElement>(null);

  const checkAudioMuteState = React.useCallback((pos: number) => {
    const playheadTime = (pos - 256) / 20;
    const trackMuteStates: Record<string, boolean> = {};
    
    for (const track of tracks) {
      if (track.muted) {
        trackMuteStates[track.id] = true;
        continue;
      }
      
      let isOverClip = false;
      for (const clip of track.clips) {
        if (playheadTime >= clip.start && playheadTime < clip.start + clip.duration) {
          isOverClip = true;
          break;
        }
      }
      trackMuteStates[track.id] = !isOverClip;
    }
    
    window.dispatchEvent(new CustomEvent('audio-mute-state', { detail: { trackMuteStates } }));
  }, [tracks]);

  const handlePlayheadPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        let newPos = moveEvent.clientX - rect.left + timelineRef.current.scrollLeft;
        newPos = Math.max(256, newPos);
        setPlayheadPosition(newPos);
        checkAudioMuteState(newPos);
        const time = Math.max(0, (newPos - 256) / 20);
        window.dispatchEvent(new CustomEvent('seek-audio', { detail: { time } }));
        window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
      }
    };
    
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  useEffect(() => {
    const handlePlayToggle = (e: any) => {
      setIsPlaying(e.detail.isPlaying);
      if (e.detail.isPlaying) {
        lastTimeRef.current = performance.now();
      }
    };

    window.addEventListener('toggle-play', handlePlayToggle);
    return () => window.removeEventListener('toggle-play', handlePlayToggle);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      const animate = (time: number) => {
        if (lastTimeRef.current) {
          const delta = time - lastTimeRef.current;
          // 20 pixels per second roughly matches the 20px per second width in Clip.tsx
          // width: Math.max(160, activeDragClip.duration * 20)
          setPlayheadPosition(prev => {
            const newPos = prev + (delta / 1000) * 20;
            
            // Check if playhead is over any clip
            const playheadTime = (newPos - 256) / 20;
            const trackMuteStates: Record<string, boolean> = {};
            
            for (const track of tracks) {
              if (track.muted) {
                trackMuteStates[track.id] = true;
                continue;
              }
              
              let isOverClip = false;
              for (const clip of track.clips) {
                if (playheadTime >= clip.start && playheadTime <= clip.start + clip.duration) {
                  isOverClip = true;
                  break;
                }
              }
              trackMuteStates[track.id] = !isOverClip;
            }
            
            // Dispatch event to mute/unmute audio based on whether we're over a clip
            window.dispatchEvent(new CustomEvent('audio-mute-state', { detail: { trackMuteStates } }));
            window.dispatchEvent(new CustomEvent('time-update', { detail: { time: playheadTime } }));
            
            return newPos;
          }); 
        }
        lastTimeRef.current = time;
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, tracks]);

  useEffect(() => {
    const handleToggleMute = (e: any) => {
      setTracks(prev => prev.map(t => 
        t.id === e.detail.trackId ? { ...t, muted: !t.muted } : t
      ));
    };

    const handleToggleSolo = (e: any) => {
      setTracks(prev => {
        const trackToToggle = prev.find(t => t.id === e.detail.trackId);
        if (!trackToToggle) return prev;
        
        const willBeSolo = !trackToToggle.solo;
        
        return prev.map(t => {
          if (t.id === e.detail.trackId) {
            return { ...t, solo: willBeSolo, muted: false };
          }
          // Only one track can be solo'd at a time
          if (willBeSolo) {
            return { ...t, solo: false, muted: true };
          } else {
            // Unsoloing the only soloed track unmutes all
            return { ...t, solo: false, muted: false }; 
          }
        });
      });
    };

    const handleUpdateVolume = (e: any) => {
      setTracks(prev => prev.map(t => 
        t.id === e.detail.trackId ? { ...t, volume: e.detail.volume } : t
      ));
    };

    const handleReplaceClip = (e: any) => {
      const { oldClipId, newClip } = e.detail;
      setTracks(prev => prev.map(t => {
        const hasClip = t.clips.some(c => c.id === oldClipId);
        if (!hasClip) return t;

        return {
          ...t,
          clips: t.clips.map(c => {
            if (c.id === oldClipId) {
              return {
                ...newClip,
                id: c.id,
                start: c.start,
                duration: c.duration,
                sectionName: c.sectionName,
              };
            }
            return c;
          })
        };
      }));
    };

    const handleRemoveClip = (e: any) => {
      const { clipId } = e.detail;
      setTracks(prev => prev.map(t => ({
        ...t,
        clips: t.clips.filter(c => c.id !== clipId)
      })));
    };

    window.addEventListener('toggle-track-mute', handleToggleMute);
    window.addEventListener('toggle-track-solo', handleToggleSolo);
    window.addEventListener('update-track-volume', handleUpdateVolume);
    window.addEventListener('replace-clip', handleReplaceClip);
    window.addEventListener('remove-clip', handleRemoveClip);

    return () => {
      window.removeEventListener('toggle-track-mute', handleToggleMute);
      window.removeEventListener('toggle-track-solo', handleToggleSolo);
      window.removeEventListener('update-track-volume', handleUpdateVolume);
      window.removeEventListener('replace-clip', handleReplaceClip);
      window.removeEventListener('remove-clip', handleRemoveClip);
    };
  }, []);

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

  const addClipToTrack = (trackId: string, clip: any) => {
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

    if (activeType === 'bucket-clip') {
      const clipIdeaName = clip.name.replace(tracks.find(t => t.id === trackId)?.name + ' ', '').split(' V')[0];
      addClipToTrack(trackId, { ...clip, sectionName: clipIdeaName });
    } else if (activeType === 'clip') {
      const clipIdeaName = clip.name.replace(tracks.find(t => t.id === trackId)?.name + ' ', '').split(' V')[0];
      
      // Calculate new start time based on drop position relative to track
      // Get the x-coordinate of the drop relative to the timeline container
      const trackElement = document.getElementById(`track-${trackId}`);
      let newStart = clip.start;
      
      if (trackElement && event.delta.x !== 0) {
        // We moved it horizontally, adjust the start time (20px = 1 second)
        newStart = Math.max(0, clip.start + (event.delta.x / 20));
      }
      
      setTracks(prev => {
        // First remove the clip from wherever it was
        const withoutClip = prev.map(t => ({
          ...t,
          clips: t.clips.filter(c => c.id !== clip.id)
        }));
        
        // Then add it to the new track at the new position
        return withoutClip.map(t => {
          if (t.id === trackId) {
            return {
              ...t,
              clips: [...t.clips, { ...clip, start: newStart, sectionName: clipIdeaName }]
            };
          }
          return t;
        });
      });
    }
  };

  const handleRulerSeek = (pos: number) => {
    const newPos = Math.max(256, pos + 256);
    setPlayheadPosition(newPos);
    const time = Math.max(0, pos / 20);
    window.dispatchEvent(new CustomEvent('seek-audio', { detail: { time } }));
    window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
  };

  const endOfTimeline = React.useMemo(() => {
    let max = 0;
    tracks.forEach(t => {
      t.clips.forEach(c => {
        max = Math.max(max, c.start + c.duration);
      });
    });
    return max;
  }, [tracks]);

  // Extract unique sections from clips in the timeline to render markers
  const timelineSections = React.useMemo(() => {
    const sections: { id: string, name: string, start: number, duration: number }[] = [];
    
    tracks.forEach(track => {
      track.clips.forEach(clip => {
        if (clip.sectionName) {
          // Check if we already have a section marker that overlaps
          const existingSection = sections.find(s => 
            s.name === clip.sectionName && 
            Math.abs(s.start - clip.start) < 2 // Group clips that start roughly at the same time
          );
          
          if (!existingSection) {
            sections.push({
              id: `section-${clip.id}`,
              name: clip.sectionName,
              start: clip.start,
              // We'll calculate duration based on the longest clip in this section
              duration: clip.duration 
            });
          } else {
            // Update duration if this clip extends further
            existingSection.duration = Math.max(existingSection.duration, (clip.start + clip.duration) - existingSection.start);
          }
        }
      });
    });
    
    return sections.sort((a, b) => a.start - b.start);
  }, [tracks]);

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
            const clipIdeaName = clip.name.replace(track?.name + ' ', '').split(' V')[0];
            
            if (track) {
              addClipToTrack(track.id, { ...clip, sectionName: clipIdeaName });
            } else {
              addClipToTrack(tracks[0].id, { ...clip, sectionName: clipIdeaName });
            }
          }}
          onInstrumentAdded={() => setRefreshKey((v) => v + 1)}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative overflow-hidden select-none">
          <div className="flex-1 overflow-y-auto overflow-x-auto relative scrollbar-hide" ref={timelineRef}>
            <div className="min-w-[2000px] pb-32">
              <Ruler onSeek={handleRulerSeek} />
              
              {/* Dynamic Section Headers based on clips */}
              {timelineSections.length > 0 && (
                <div className="flex w-full h-6 border-b border-border/50 bg-transparent relative pointer-events-none">
                  <div className="w-64 shrink-0 bg-transparent px-3 flex items-center sticky left-0 z-20">
                    {/* Empty header space for track column alignment */}
                  </div>
                  <div className="flex-1 relative">
                    {timelineSections.map(sec => (
                      <div 
                        key={sec.id}
                        className="absolute top-0 bottom-0 border-l border-primary/30 flex items-start pt-1 px-2 z-10"
                        style={{ left: sec.start * 20, width: sec.duration * 20 }}
                      >
                        <span className="text-[9px] font-bold text-primary/70 uppercase tracking-widest bg-[#09090b]/80 px-1 rounded backdrop-blur-sm">
                          {sec.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {tracks.map(track => (
                <TimelineTrack key={track.id} track={track} />
              ))}
              
              <div className="h-16 flex items-center justify-center border-b border-white/5 border-dashed text-muted-foreground hover:bg-white/5 cursor-pointer transition-colors group">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] group-hover:text-primary transition-colors opacity-40 group-hover:opacity-100">+ Add New Track</span>
              </div>
            </div>
          </div>

          {/* Global Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-[16px] z-50 flex justify-center cursor-ew-resize group"
            style={{ left: `${playheadPosition}px`, transform: 'translateX(-50%)' }}
            onPointerDown={handlePlayheadPointerDown}
          >
            <div className="w-[1px] h-full bg-primary shadow-[0_0_15px_rgba(212,175,55,0.6)] group-hover:w-[2px] transition-all" />
            <div className="absolute top-0 w-[13px] h-[14px] bg-primary rounded-sm shadow-sm flex items-center justify-center pointer-events-none">
              <div className="w-[1px] h-[8px] bg-black/50" />
            </div>
            <div className="absolute top-[14px] w-0 h-0 border-l-[6.5px] border-l-transparent border-r-[6.5px] border-r-transparent border-t-[6px] border-t-primary pointer-events-none" />
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
