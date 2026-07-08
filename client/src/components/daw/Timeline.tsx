import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragMoveEvent,
  CollisionDetection,
  MeasuringStrategy,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  PointerSensor,
  TouchSensor,
  MouseSensor,
} from '@dnd-kit/core';
import { restrictToWindowEdges, restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { cn } from '@/lib/utils';
import { Track, Clip, MOCK_SONG } from '@/lib/daw-data';
import { bucketKeys } from '@/lib/bucket-api';
import { TimelineTrack, SectionInfo } from './Track';
import { TimelineClip } from './Clip';
import { nanoid } from 'nanoid';
import { Ruler } from './Ruler';
import { DawScrollbar } from './DawScrollbar';
import { MediaBucket } from './MediaBucket';

const MIN_SECTION_WIDTH = 4; // seconds — minimum width for a section column

type ApiTrack = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  sortOrder: number;
  songId: string;
  timelineClips: {
    id: string;
    name: string;
    type: string;
    color: string;
    start: number;
    duration: number;
    src: string | null;
    sectionName: string | null;
    isFinal: boolean;
    trimStart: number;
    trimEnd: number | null;
  }[];
};

type InsertionPoint = { trackId: string; sectionName: string; index: number; x: number };

// Returns the ordered list of sections that have at least one clip anywhere on the tracks.
// Uses sectionOrder as the authoritative order; sections not yet in sectionOrder are appended.
function getActiveSections(tracks: Track[], sectionOrder: string[]): string[] {
  const present = new Set(tracks.flatMap((t) => t.clips.map((c) => c.sectionName).filter(Boolean) as string[]));
  const ordered = sectionOrder.filter((s) => present.has(s));
  present.forEach((s) => { if (!ordered.includes(s)) ordered.push(s); });
  return ordered;
}

// Computes each section's absolute start time (seconds) and pixel-width (seconds).
// Section width = max total clip duration in that section across all tracks, floored at MIN_SECTION_WIDTH.
// This is the single source of truth for section geometry — used by both rendering and recalcAllStarts.
function computeSectionLayout(tracks: Track[], sectionOrder: string[]): SectionInfo[] {
  const sections: SectionInfo[] = [];
  let cursor = 0;
  for (const name of getActiveSections(tracks, sectionOrder)) {
    let maxWidth = MIN_SECTION_WIDTH;
    for (const t of tracks) {
      const total = t.clips
        .filter((c) => c.sectionName === name)
        .reduce((s, c) => s + (c.trimEnd ?? c.duration) - (c.trimStart ?? 0), 0);
      if (total > maxWidth) maxWidth = total;
    }
    sections.push({ name, start: cursor, duration: maxWidth });
    cursor += maxWidth;
  }
  return sections;
}

// Recalculates every clip's absolute start time. Derives section geometry from computeSectionLayout
// so rendering and positioning always stay in sync.
function recalcAllStarts(tracks: Track[], sectionOrder: string[]): Track[] {
  const layout = computeSectionLayout(tracks, sectionOrder);
  const sectionStarts: Record<string, number> = Object.fromEntries(layout.map((s) => [s.name, s.start]));
  const sections = layout.map((s) => s.name);

  return tracks.map((track) => {
    const sectioned = sections.flatMap((name) => {
      const sc = track.clips.filter((c) => c.sectionName === name);
      let pos = sectionStarts[name];
      return sc.map((clip) => {
        const updated = { ...clip, start: pos };
        pos += (clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0);
        return updated;
      });
    });
    const unsectioned = track.clips.filter((c) => !c.sectionName);
    return { ...track, clips: [...sectioned, ...unsectioned] };
  });
}

// Inserts or moves sectionName to gapIndex within activeNames (the section order shown during drag).
// gapIndex = 0 means before activeNames[0]; gapIndex = activeNames.length means after the last.
// Returns the new ordered list of all active section names.
function reorderSectionOrder(
  _sectionOrder: string[],
  sectionName: string,
  gapIndex: number,
  activeNames: string[]
): string[] {
  // Remove the section from its current position (if it's already in the layout).
  const withoutMoved = activeNames.filter((s) => s !== sectionName);
  const oldPos = activeNames.indexOf(sectionName);

  // gapIndex references a position in activeNames (which still includes the section if it existed).
  // Removing the section at oldPos shifts every subsequent index down by 1.
  let insertAt = gapIndex;
  if (oldPos !== -1 && oldPos < gapIndex) insertAt = gapIndex - 1;
  insertAt = Math.min(insertAt, withoutMoved.length);

  return [
    ...withoutMoved.slice(0, insertAt),
    sectionName,
    ...withoutMoved.slice(insertAt),
  ];
}

function apiTracksToTracks(apiTracks: ApiTrack[]): { tracks: Track[]; initialSectionOrder: string[] } {
  const rawTracks = apiTracks.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type as Track['type'],
    volume: 80,
    pan: 0,
    muted: false,
    solo: false,
    color: t.color ?? 'hsl(var(--chart-1))',
    clips: [...t.timelineClips].sort((a, b) => a.start - b.start).map((c) => {
      const ts = c.trimStart ?? 0;
      const te = c.trimEnd ?? null;
      return {
        id: c.id,
        name: c.name,
        type: c.type as Clip['type'],
        color: c.color,
        start: c.start,
        duration: c.duration,
        src: c.src ?? undefined,
        sectionName: c.sectionName ?? undefined,
        isFinal: c.isFinal ?? false,
        trimStart: ts,
        trimEnd: te,
      };
    }),
  }));
  const initialSectionOrder = getActiveSections(rawTracks, MOCK_SONG.sections);
  return { tracks: recalcAllStarts(rawTracks, initialSectionOrder), initialSectionOrder };
}

// Custom collision detection: gap zones require precise pointer intersection (they are narrow);
// track rows match by vertical overlap only — any X position on the row resolves to that track.
// Gap zones read live getBoundingClientRect() directly so freshly-mounted zones are never skipped
// due to a stale/missing entry in dnd-kit's droppableRects cache.
const trackFirstCollision: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  const { x, y } = pointerCoordinates;

  // First pass — gap zones only, live bounds check.
  for (const container of droppableContainers) {
    if (!String(container.id).startsWith('gap||')) continue;
    // Prefer a live rect from the DOM element; fall back to the cached rect.
    const rect = container.node.current?.getBoundingClientRect() ?? droppableRects.get(container.id);
    if (!rect) continue;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return [{ id: container.id }];
    }
  }

  // Second pass — track rows, vertical band only (X is irrelevant).
  for (const container of droppableContainers) {
    if (String(container.id).startsWith('gap||')) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    if (y >= rect.top && y <= rect.bottom) {
      return [{ id: container.id }];
    }
  }

  return [];
};

// Draggable section header label — used inside the section-reorder DndContext.
// id format: sec||${sectionName}
function DraggableSectionHeader({ name, width }: { name: string; width: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `sec||${name}` });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'border-r border-primary/20 flex items-start pt-1 px-2 shrink-0 cursor-grab active:cursor-grabbing select-none transition-opacity',
        isDragging && 'opacity-30'
      )}
      style={{ width, minWidth: width }}
    >
      <span className="text-[9px] font-bold text-primary/70 uppercase tracking-widest bg-[#09090b]/80 px-1 rounded backdrop-blur-sm pointer-events-none">
        {name}
      </span>
    </div>
  );
}

// Droppable zone at a clip boundary within the active drag's section.
// id format: gap||${clipIndex} where gap||0 = before clip 0, gap||N = after clip N-1.
// left: pixel offset from the left edge of the content div (includes the 256px track header).
// pointer-events is always 'auto' so the live getBoundingClientRect() check in collision
// detection can reliably find these elements.
function GapZone({ id, left, trackAreaHeight }: { id: string; left: number; trackAreaHeight: number }) {
  const nodeRef = React.useRef<HTMLDivElement | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id });

  const refCallback = React.useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    setNodeRef(node);
  }, [setNodeRef]);

  return (
    <div
      ref={refCallback}
      className="absolute z-30 -translate-x-1/2"
      style={{ left, top: 0, width: 20, height: trackAreaHeight, pointerEvents: 'auto' }}
    >
      {isOver && (
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-primary shadow-[0_0_12px_rgba(212,175,55,0.9)] pointer-events-none" />
      )}
    </div>
  );
}

export function Timeline({ songId }: { songId: string }) {
  const queryClient = useQueryClient();

  const { data: apiTracks } = useQuery<ApiTrack[]>({
    queryKey: [`/api/songs/${songId}/timeline`],
    queryFn: async () => {
      const res = await fetch(`/api/songs/${songId}/timeline`);
      if (!res.ok) throw new Error('Failed to fetch timeline');
      const body = await res.json();
      // Response shape is { songName, tracks } — extract the array.
      return Array.isArray(body) ? body : body.tracks;
    },
    refetchInterval: 3000,
  });

  const [tracks, setTracks] = useState<Track[]>([]);
  const tracksInitialized = useRef(false);
  const [insertionPoint, setInsertionPoint] = useState<InsertionPoint | null>(null);
  // Explicit ordered list of section names. This is the authoritative section order;
  // computeSectionLayout uses it instead of inferring order from MOCK_SONG.sections.
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  const sectionOrderRef = useRef<string[]>([]);
  // True when the drag pointer is over a between-column gap zone.
  const [isOverGap, setIsOverGap] = useState(false);

  // Section-reorder drag state — separate from clip drag state.
  const [activeSectionName, setActiveSectionName] = useState<string | null>(null);
  // Which gap index the cursor is nearest to during a section header drag (0 = before first column).
  const [sectionInsertGap, setSectionInsertGap] = useState<number | null>(null);

  useEffect(() => { sectionOrderRef.current = sectionOrder; }, [sectionOrder]);

  useEffect(() => {
    if (apiTracks && !tracksInitialized.current) {
      const { tracks: converted, initialSectionOrder } = apiTracksToTracks(apiTracks);
      setTracks(converted);
      setSectionOrder(initialSectionOrder);
      tracksInitialized.current = true;
    }
  }, [apiTracks]);

  // Merge track additions, removals, and clip changes after initial load.
  // Preserves local mute/solo/volume state for existing tracks.
  useEffect(() => {
    if (!apiTracks || !tracksInitialized.current) return;
    setTracks(prev => {
      const apiIds = new Set(apiTracks.map(t => t.id));
      const existingIds = new Set(prev.map(t => t.id));

      const withRemovals = prev.filter(t => apiIds.has(t.id));

      const withUpdatedClips = withRemovals.map(track => {
        const apiTrack = apiTracks.find(t => t.id === track.id);
        if (!apiTrack) return track;
        const freshClips = [...apiTrack.timelineClips].sort((a, b) => a.start - b.start).map(c => {
          const ts = c.trimStart ?? 0;
          const te = c.trimEnd ?? null;
          return {
            id: c.id,
            name: c.name,
            type: c.type as Clip['type'],
            color: c.color,
            start: c.start,
            duration: c.duration,
            src: c.src ?? undefined,
            sectionName: c.sectionName ?? undefined,
            isFinal: c.isFinal ?? false,
            trimStart: ts,
            trimEnd: te,
          };
        });
        return { ...track, clips: freshClips };
      });

      const newTracks = apiTracks
        .filter(t => !existingIds.has(t.id))
        .map(t => ({
          id: t.id,
          name: t.name,
          type: t.type as Track['type'],
          volume: 80,
          pan: 0,
          muted: false,
          solo: false,
          color: t.color ?? 'hsl(var(--chart-1))',
          clips: [],
        }));

      const merged = [...withUpdatedClips, ...newTracks];
      return recalcAllStarts(merged, sectionOrderRef.current);
    });
  }, [apiTracks]);

  // Keep sectionOrder pruned: remove any section that has no clips across all tracks.
  useEffect(() => {
    const activeSections = new Set(
      tracks.flatMap((t) => t.clips.map((c) => c.sectionName).filter(Boolean) as string[])
    );
    setSectionOrder((prev) => prev.filter((s) => activeSections.has(s)));
  }, [tracks]);

  const [activeDragData, setActiveDragData] = useState<{ clip: Clip; type: string; trackId?: string; sectionName?: string } | null>(null);
  const [playheadPositionState, setPlayheadPositionState] = useState(256);
  const playheadRef = React.useRef(256);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const setPlayheadPosition = React.useCallback((val: number | ((prev: number) => number)) => {
    if (typeof val === 'function') {
      playheadRef.current = val(playheadRef.current);
    } else {
      playheadRef.current = val;
    }
    setPlayheadPositionState(playheadRef.current);
  }, []);

  const [tracksVersion, setTracksVersion] = useState(0);
  const [bpm, setBpm] = useState(MOCK_SONG.bpm || 120);
  const [zoom, setZoom] = useState(80);
  const [isLooping, setIsLooping] = useState(false);

  const animationRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);
  const timelineRef = React.useRef<HTMLDivElement>(null!);
  const customAudioRefs = React.useRef<{ [clipId: string]: HTMLAudioElement }>({});
  const pendingPlayRef = React.useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterVolumeRef = React.useRef<number>(0.8); // 0–1, matches slider default of 80

  // Section layout: one entry per section that has at least one clip, in sectionOrder order.
  // Empty sections are absent — no column, no space. Derived entirely from clips on tracks.
  const sectionLayout = React.useMemo(
    () => computeSectionLayout(tracks, sectionOrder),
    [tracks, sectionOrder]
  );

  const endOfTimeline = React.useMemo(() => {
    if (sectionLayout.length === 0) return 0;
    const last = sectionLayout[sectionLayout.length - 1];
    return last.start + last.duration;
  }, [sectionLayout]);

  // Clip-boundary gap zone positions for the active drag's track+section.
  // gap||0 = before first clip, gap||N = after clip N-1.
  const gapZones = React.useMemo(() => {
    if (!activeDragData) return [];
    const { trackId } = activeDragData;
    const sectionName = activeDragData.clip?.sectionName;
    if (!trackId || !sectionName) return [];
    const track = tracks.find((t) => t.id === trackId);
    const sectionInfo = sectionLayout.find((s) => s.name === sectionName);
    if (!track || !sectionInfo) return [];
    const sectionClips = track.clips.filter((c) => c.sectionName === sectionName);
    const lefts: number[] = [];
    let cursor = sectionInfo.start;
    lefts.push(cursor);
    for (const c of sectionClips) {
      cursor += (c.trimEnd ?? c.duration) - (c.trimStart ?? 0);
      lefts.push(cursor);
    }
    return lefts.map((posSec, i) => ({ id: `gap||${i}`, left: 256 + posSec * zoom }));
  }, [activeDragData, tracks, sectionLayout, zoom]);

  useEffect(() => {
    tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        if (clip.src && !customAudioRefs.current[clip.id]) {
          const audio = new Audio(clip.src);
          audio.preload = 'auto';
          customAudioRefs.current[clip.id] = audio;
        }
      });
    });
  }, [tracks]);

  useEffect(() => {
    const handleClipReplaced = (e: any) => {
      const audio = customAudioRefs.current[e.detail.clipId];
      if (audio) {
        audio.pause();
        delete customAudioRefs.current[e.detail.clipId];
      }
    };
    window.addEventListener('clip-replaced', handleClipReplaced);
    return () => window.removeEventListener('clip-replaced', handleClipReplaced);
  }, []);

  useEffect(() => {
    const handleTrimPreview = (e: any) => {
      const { clipId, trimStart, trimEnd } = e.detail;
      setTracks((prev) => {
        const updated = prev.map((track) => ({
          ...track,
          clips: track.clips.map((c) =>
            c.id === clipId ? { ...c, trimStart, trimEnd } : c
          ),
        }));
        return recalcAllStarts(updated, sectionOrderRef.current);
      });
    };
    window.addEventListener('trim-preview', handleTrimPreview);
    return () => window.removeEventListener('trim-preview', handleTrimPreview);
  }, []);

  useEffect(() => {
    const handleTogglePlay = (e: any) => {
      if (e.detail.isPlaying) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        audioCtxRef.current.resume();
      }
    };
    window.addEventListener('toggle-play', handleTogglePlay);
    return () => window.removeEventListener('toggle-play', handleTogglePlay);
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      Object.values(customAudioRefs.current).forEach((audio) => audio.pause());
      pendingPlayRef.current.clear();
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    }
  }, [isPlaying]);

  useEffect(() => {
    const handleBpmUpdated = (e: any) => setBpm(e.detail.bpm);
    window.addEventListener('update-bpm', handleBpmUpdated);
    return () => window.removeEventListener('update-bpm', handleBpmUpdated);
  }, []);

  useEffect(() => {
    const handleMasterVolume = (e: any) => {
      masterVolumeRef.current = e.detail.volume / 100;
      Object.values(customAudioRefs.current).forEach((audio) => {
        if (!audio.paused) audio.volume = masterVolumeRef.current;
      });
    };
    window.addEventListener('update-master-volume', handleMasterVolume);
    return () => window.removeEventListener('update-master-volume', handleMasterVolume);
  }, []);

  useEffect(() => {
    const handleSongUpdated = () => setTracksVersion((v) => v + 1);
    window.addEventListener('song-updated', handleSongUpdated);
    return () => window.removeEventListener('song-updated', handleSongUpdated);
  }, []);

  const checkAudioMuteState = React.useCallback(
    (pos: number) => {
      const playheadTime = (pos - 256) / zoom;
      const trackMuteStates: Record<string, boolean> = {};
      for (const track of tracks) {
        if (track.muted) { trackMuteStates[track.id] = true; continue; }
        let isOverClip = false;
        for (const clip of track.clips) {
          if (playheadTime >= clip.start && playheadTime < clip.start + (clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)) {
            isOverClip = true;
            break;
          }
        }
        trackMuteStates[track.id] = !isOverClip;
      }
      window.dispatchEvent(new CustomEvent('audio-mute-state', { detail: { trackMuteStates } }));
    },
    [tracks, zoom]
  );

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
        const time = Math.max(0, (newPos - 256) / zoom);
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
    const handleLoopToggle = (e: any) => setIsLooping(e.detail.isLooping);
    window.addEventListener('toggle-loop', handleLoopToggle);
    return () => window.removeEventListener('toggle-loop', handleLoopToggle);
  }, []);

  useEffect(() => {
    const handlePlayToggle = (e: any) => {
      setIsPlaying(e.detail.isPlaying);
      if (e.detail.isPlaying) lastTimeRef.current = performance.now();
    };
    window.addEventListener('toggle-play', handlePlayToggle);
    return () => window.removeEventListener('toggle-play', handlePlayToggle);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      if (!lastTimeRef.current) lastTimeRef.current = performance.now();

      const animate = (time: number) => {
        if (lastTimeRef.current) {
          const delta = time - lastTimeRef.current;
          const pixelsPerSecond = zoom;

          setPlayheadPosition((prev) => {
            const newPos = prev + (delta / 1000) * pixelsPerSecond;
            const prevTime = (prev - 256) / zoom;
            const playheadTime = (newPos - 256) / zoom;

            if (isLooping) {
              const currentSection = sectionLayout.find(
                (sec) => prevTime >= sec.start && prevTime < sec.start + sec.duration
              );
              if (currentSection) {
                if (playheadTime >= currentSection.start + currentSection.duration) {
                  const loopStartPos = 256 + currentSection.start * zoom;
                  Object.values(customAudioRefs.current).forEach((audio) => {
                    if (audio && !audio.paused) audio.currentTime = currentSection.start;
                  });
                  window.dispatchEvent(new CustomEvent('seek-audio', { detail: { time: currentSection.start } }));
                  return loopStartPos;
                }
              }
            }

            for (const track of tracks) {
              for (const clip of track.clips) {
                const audio = customAudioRefs.current[clip.id];
                if (!audio || !clip.src) continue;

                const clipStart = clip.start;
                const trimStart = clip.trimStart ?? 0;
                const trimEnd = clip.trimEnd ?? clip.duration;
                const effectiveDuration = trimEnd - trimStart;
                const clipEnd = clipStart + effectiveDuration;
                const inRange = playheadTime >= clipStart && playheadTime < clipEnd;

                if (inRange && isPlaying) {
                  if (audio.paused && !pendingPlayRef.current.has(clip.id)) {
                    audio.currentTime = trimStart + Math.max(0, playheadTime - clipStart);
                    pendingPlayRef.current.add(clip.id);
                    audio.play()
                      .then(() => pendingPlayRef.current.delete(clip.id))
                      .catch((e) => {
                        pendingPlayRef.current.delete(clip.id);
                        console.warn('play failed:', e);
                      });
                  }
                  // Stop playback if audio has passed trimEnd
                  if (!audio.paused && audio.currentTime >= trimEnd) {
                    audio.pause();
                    pendingPlayRef.current.delete(clip.id);
                  }
                  // Update volume/mute/rate every frame
                  audio.volume = (track.volume / 100) * masterVolumeRef.current;
                  audio.muted = track.muted;
                  audio.playbackRate = bpm / 120;
                } else {
                  if (!audio.paused) {
                    audio.pause();
                    pendingPlayRef.current.delete(clip.id);
                  }
                }
              }
            }
            window.dispatchEvent(new CustomEvent('time-update', { detail: { time: playheadTime } }));
            return newPos;
          });
        }
        lastTimeRef.current = time;
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      Object.values(customAudioRefs.current).forEach((audio) => {
        if (audio && !audio.paused) audio.pause();
      });
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, tracks, bpm, isLooping, sectionLayout, zoom, setPlayheadPosition]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onScroll = () => setTimelineScrollLeft(el.scrollLeft);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handleToggleMute = (e: any) => {
      setTracks((prev) => prev.map((t) => (t.id === e.detail.trackId ? { ...t, muted: !t.muted } : t)));
    };
    const handleToggleSolo = (e: any) => {
      setTracks((prev) => {
        const target = prev.find((t) => t.id === e.detail.trackId);
        if (!target) return prev;
        const willBeSolo = !target.solo;
        return prev.map((t) => {
          if (t.id === e.detail.trackId) return { ...t, solo: willBeSolo, muted: false };
          return willBeSolo ? { ...t, solo: false, muted: true } : { ...t, solo: false, muted: false };
        });
      });
    };
    const handleUpdateVolume = (e: any) => {
      setTracks((prev) =>
        prev.map((t) => (t.id === e.detail.trackId ? { ...t, volume: e.detail.volume } : t))
      );
    };
    const handleReplaceClip = (e: any) => {
      const { oldClipId, newClip } = e.detail;
      setTracks((prev) =>
        prev.map((t) => {
          if (!t.clips.some((c) => c.id === oldClipId)) return t;
          return {
            ...t,
            clips: t.clips.map((c) =>
              c.id === oldClipId
                ? { ...newClip, id: c.id, start: c.start, duration: c.duration, sectionName: c.sectionName }
                : c
            ),
          };
        })
      );
      fetch(`/api/timeline-clips/${oldClipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newClip.name, type: newClip.type, color: newClip.color, src: newClip.src ?? null }),
      }).catch((err) => console.error('Failed to update replaced clip:', err));
    };

    const handleRemoveClip = (e: any) => {
      const { clipId } = e.detail;
      setTracks((prev) => {
        const track = prev.find((t) => t.clips.some((c) => c.id === clipId));
        if (!track) return prev;

        const draft = prev.map((t) =>
          t.id === track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
        );
        // Use the ref so this stale-closure handler sees the current sectionOrder.
        const recalced = recalcAllStarts(draft, sectionOrderRef.current);
        const finalTrack = recalced.find((t) => t.id === track.id)!;

        fetch(`/api/timeline-clips/${clipId}`, { method: 'DELETE' })
          .then(() => queryClient.invalidateQueries({ queryKey: ['activity'] }))
          .catch((err) => console.error('Failed to delete timeline clip:', err));
        track.clips.filter((c) => c.id !== clipId).forEach((old) => {
          const updated = finalTrack.clips.find((c) => c.id === old.id);
          if (updated && updated.start !== old.start) {
            fetch(`/api/timeline-clips/${old.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ start: updated.start }),
            }).catch((err) => console.error('Failed to update clip start after remove:', err));
          }
        });
        return recalced;
      });
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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  // ── Section-reorder handlers (separate DndContext) ─────────────────────────
  const handleSectionDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (id.startsWith('sec||')) setActiveSectionName(id.slice(5));
  };

  const handleSectionDragMove = (event: DragMoveEvent) => {
    if (!timelineRef.current) return;
    const { activatorEvent, delta } = event;
    const startClientX =
      'clientX' in activatorEvent
        ? (activatorEvent as MouseEvent).clientX
        : (activatorEvent as TouchEvent).touches?.[0]?.clientX ?? 0;
    const cursorClientX = startClientX + delta.x;
    const containerRect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft;
    // Cursor position in section-area coordinates (x=0 = left edge of first section).
    const cursorX = cursorClientX - containerRect.left + scrollLeft - 256;

    // Gap 0 is at x=0; gap i+1 is at the right edge of section[i].
    const gapXPositions = [0, ...sectionLayout.map((s) => (s.start + s.duration) * zoom)];
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < gapXPositions.length; i++) {
      const dist = Math.abs(cursorX - gapXPositions[i]);
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    setSectionInsertGap(nearest);
  };

  const handleSectionDragEnd = () => {
    if (activeSectionName !== null && sectionInsertGap !== null) {
      const activeNames = sectionLayout.map((s) => s.name);
      const newOrder = reorderSectionOrder(sectionOrder, activeSectionName, sectionInsertGap, activeNames);
      const recalced = recalcAllStarts(tracks, newOrder);
      setSectionOrder(newOrder);
      setTracks(recalced);
      // Patch all clips whose start time changed.
      tracks.forEach((track) => {
        const recalcedTrack = recalced.find((t) => t.id === track.id)!;
        track.clips.forEach((old) => {
          const updated = recalcedTrack.clips.find((c) => c.id === old.id);
          if (updated && updated.start !== old.start) {
            fetch(`/api/timeline-clips/${old.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ start: updated.start }),
            }).catch((err) => console.error('Failed to patch clip start after section reorder:', err));
          }
        });
      });
    }
    setActiveSectionName(null);
    setSectionInsertGap(null);
  };

  // Pixel offset (within the sections area) where the insertion line should appear during section drag.
  const sectionInsertX = React.useMemo(() => {
    if (activeSectionName === null || sectionInsertGap === null) return null;
    if (sectionInsertGap === 0) return 0;
    const prev = sectionLayout[sectionInsertGap - 1];
    return prev ? (prev.start + prev.duration) * zoom : null;
  }, [activeSectionName, sectionInsertGap, sectionLayout, zoom]);
  // ─────────────────────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const clip = event.active.data.current?.clip as Clip;
    const type = event.active.data.current?.type as string;
    const dragTrackId = event.active.data.current?.trackId as string | undefined;
    if (clip && type) {
      let enrichedClip = { ...clip };
      if (type === 'bucket-clip' && !clip.sectionName) {
        // Fallback for mock clips that don't carry sectionName: derive from MOCK_SONG idea name.
        // Real API clips always have sectionName set via toClip(), so this branch won't run for them.
        outer: for (const inst of MOCK_SONG.instruments) {
          for (const idea of inst.ideas) {
            if (idea.versions.some((v) => v.id === clip.id)) {
              enrichedClip.sectionName = idea.name.replace(inst.name + ' ', '');
              break outer;
            }
          }
        }
      }
      setActiveDragData({ clip: enrichedClip, type, trackId: dragTrackId });
    }
    setInsertionPoint(null);
  };

  // Inserts a clip into a specific section of a track. index is the position within that
  // section's clip array; omit to append at end. newOrder lets callers pre-compute the
  // section order when they've already updated it (e.g. gap drops).
  const insertClipInSection = (
    trackId: string,
    sectionName: string,
    clip: Clip,
    index?: number,
    newOrder?: string[]
  ) => {
    const newId = nanoid();
    // Compute the order to use: supplied, or current with the section added if missing.
    const effectiveOrder: string[] = newOrder ?? (
      sectionOrder.includes(sectionName)
        ? sectionOrder
        : [...sectionOrder, sectionName]
    );
    if (!newOrder) setSectionOrder(effectiveOrder);

    setTracks((prev) => {
      const targetTrack = prev.find((t) => t.id === trackId);
      if (!targetTrack) return prev;

      const sectionClips = targetTrack.clips.filter((c) => c.sectionName === sectionName);
      const otherClips = targetTrack.clips.filter((c) => c.sectionName !== sectionName);
      const insertAt = index ?? sectionClips.length;
      const newSectionClips = [
        ...sectionClips.slice(0, insertAt),
        { ...clip, id: newId, sectionName, trimStart: 0, trimEnd: null },
        ...sectionClips.slice(insertAt),
      ];

      const draft = prev.map((t) =>
        t.id === trackId ? { ...t, clips: [...otherClips, ...newSectionClips] } : t
      );
      const recalced = recalcAllStarts(draft, effectiveOrder);
      const finalTrack = recalced.find((t) => t.id === trackId)!;
      const finalClip = finalTrack.clips.find((c) => c.id === newId);

      fetch(`/api/tracks/${trackId}/clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId, trackId, name: clip.name, type: clip.type, color: clip.color,
          start: finalClip?.start ?? 0, duration: clip.duration,
          src: clip.src ?? null, sectionName,
          trimStart: 0, trimEnd: null,
        }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['activity'] }))
        .catch((err) => console.error('Failed to persist timeline clip:', err));

      targetTrack.clips.forEach((old) => {
        const updated = finalTrack.clips.find((c) => c.id === old.id);
        if (updated && updated.start !== old.start) {
          fetch(`/api/timeline-clips/${old.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start: updated.start }),
          }).catch((err) => console.error('Failed to update clip start:', err));
        }
      });

      return recalced;
    });
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const { over } = event;
    setInsertionPoint(null);
    if (!over) { setIsOverGap(false); return; }
    setIsOverGap(String(over.id).startsWith('gap||'));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Capture before clearing — activeDragData holds the enriched clip (with sectionName derived at drag-start)
    const dragData = activeDragData;

    setActiveDragData(null);
    setIsOverGap(false);

    if (!over) { setInsertionPoint(null); return; }

    const activeType = active.data.current?.type;
    const clip = active.data.current?.clip as Clip;
    const overId = over.id as string;

    // ── Gap drop: insert clip at exact gapIndex position within its section ──────
    if (overId.startsWith('gap||')) {
      setInsertionPoint(null);
      const gapIndex = parseInt(overId.slice(5), 10);
      const clipSectionName = dragData?.clip?.sectionName ?? dragData?.sectionName;

      if (!clipSectionName) { return; }

      if (activeType === 'bucket-clip') {
        // Match by trackId (real API clips) or fall back to MOCK_SONG name lookup (mock clips).
        const draggedTrackId = dragData?.trackId;
        const targetTrack = draggedTrackId
          ? tracks.find((t) => t.id === draggedTrackId)
          : tracks.find((t) => {
              const sourceInstrument = MOCK_SONG.instruments.find((inst) =>
                inst.ideas.some((idea) => idea.versions.some((v) => v.id === clip.id))
              );
              return !sourceInstrument || sourceInstrument.name === t.name;
            });
        if (!targetTrack) { return; }
        insertClipInSection(targetTrack.id, clipSectionName, { ...clip, sectionName: clipSectionName }, gapIndex);
      } else {
        // Timeline clip: reinsert at gapIndex within the section's clip array.
        const sourceTrackId = dragData?.trackId;
        if (!sourceTrackId) { return; }
        const sourceTrack = tracks.find((t) => t.id === sourceTrackId);
        if (!sourceTrack) { return; }

        const sectionClips = sourceTrack.clips.filter((c) => c.sectionName === clipSectionName);
        const otherClips = sourceTrack.clips.filter((c) => c.sectionName !== clipSectionName);
        const withoutClip = sectionClips.filter((c) => c.id !== clip.id);
        const clipFromState = sectionClips.find((c) => c.id === clip.id) ?? clip;

        // gapIndex references positions in the original sectionClips array.
        // Removing the dragged clip shifts all subsequent indices down by 1,
        // so adjust when the clip's original position precedes the target gap.
        const oldIndex = sectionClips.findIndex((c) => c.id === clip.id);
        const adjustedGapIndex = oldIndex !== -1 && oldIndex < gapIndex ? gapIndex - 1 : gapIndex;
        const insertIdx = Math.min(adjustedGapIndex, withoutClip.length);
        const spliced = [
          ...withoutClip.slice(0, insertIdx),
          clipFromState,
          ...withoutClip.slice(insertIdx),
        ];

        const draft = tracks.map((t) =>
          t.id === sourceTrackId ? { ...t, clips: [...otherClips, ...spliced] } : t
        );
        const recalced = recalcAllStarts(draft, sectionOrder);

        const recalcedTrack = recalced.find((t) => t.id === sourceTrackId)!;

        setTracks(recalced);

        sourceTrack.clips.forEach((old) => {
          const updated = recalcedTrack.clips.find((c) => c.id === old.id);
          if (updated && updated.start !== old.start) {
            fetch(`/api/timeline-clips/${old.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ start: updated.start }),
            }).catch((err) => console.error('Failed to patch clip start after gap drop:', err));
          }
        });
      }
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Track-level drop (overId is the trackId) ──────────────────────────────
    const trackId = overId;
    const targetTrack = tracks.find((t) => t.id === trackId);
    if (!targetTrack || !clip) { setInsertionPoint(null); return; }

    if (activeType === 'bucket-clip') {
      const draggedTrackId = dragData?.trackId;
      const wrongTrack = draggedTrackId
        ? draggedTrackId !== targetTrack.id
        : (() => {
            const sourceInstrument = MOCK_SONG.instruments.find((inst) =>
              inst.ideas.some((idea) => idea.versions.some((v) => v.id === clip.id))
            );
            return !!(sourceInstrument && sourceInstrument.name !== targetTrack.name);
          })();
      if (wrongTrack) {
        setInsertionPoint(null);
        return;
      }
      const clipSectionName = dragData?.clip?.sectionName ?? dragData?.sectionName;
      if (!clipSectionName) { setInsertionPoint(null); return; }

      // Merge sectionName onto the clip — real API clips carry it on dragData but not on the clip object.
      const clipToInsert = { ...clip, sectionName: clipSectionName };

      // Use insertionPoint index if the cursor was in this section; otherwise append to end.
      const idx =
        insertionPoint?.trackId === trackId && insertionPoint?.sectionName === clipSectionName
          ? insertionPoint.index
          : undefined;
      insertClipInSection(trackId, clipSectionName, clipToInsert, idx);
      setInsertionPoint(null);

    } else if (activeType === 'clip') {
      const sourceTrack = tracks.find((t) => t.clips.some((c) => c.id === clip.id));
      if (sourceTrack && sourceTrack.id !== trackId) { setInsertionPoint(null); return; }

      const clipSection = clip.sectionName;
      if (!clipSection) { setInsertionPoint(null); return; }

      // Bug 1: for leftward drops, confirm the cursor released within the timeline track area
      // (right of the 256px instrument panel). Releases inside the panel are ignored.
      if (event.delta.x < 0) {
        const activatorEvent = event.activatorEvent;
        const startX = 'clientX' in activatorEvent
          ? (activatorEvent as MouseEvent).clientX
          : (activatorEvent as TouchEvent).touches?.[0]?.clientX ?? 0;
        const endX = startX + event.delta.x;
        const trackAreaLeft = timelineRef.current?.getBoundingClientRect().left ?? 0;
        if (endX < trackAreaLeft) {
          setInsertionPoint(null);
          return;
        }
      }

      const capturedPoint =
        insertionPoint?.trackId === trackId && insertionPoint?.sectionName === clipSection
          ? insertionPoint
          : null;

      setTracks((prev) => {
        const track = prev.find((t) => t.id === trackId);
        if (!track) return prev;

        const sectionClips = track.clips.filter((c) => c.sectionName === clipSection);
        const otherClips = track.clips.filter((c) => c.sectionName !== clipSection);
        const withoutClip = sectionClips.filter((c) => c.id !== clip.id);
        const oldIndex = sectionClips.findIndex((c) => c.id === clip.id);

        let newIndex: number;
        if (capturedPoint) {
          newIndex = capturedPoint.index;
          if (oldIndex !== -1 && oldIndex < newIndex) newIndex = Math.max(0, newIndex - 1);
        } else if (event.delta.x < 0) {
          // Dragged leftward — move to beginning of section.
          newIndex = 0;
        } else {
          // Dragged rightward or no movement — snap to end of section.
          newIndex = withoutClip.length;
        }

        // Bug 2: use the clip from prev state (not the closure drag-data clip) so that
        // trimStart/trimEnd are current — stale values would cause recalcAllStarts to
        // compute wrong effective durations and misplace clips.
        const clipFromPrev = sectionClips.find((c) => c.id === clip.id) ?? clip;
        const spliced = [
          ...withoutClip.slice(0, newIndex),
          clipFromPrev,
          ...withoutClip.slice(newIndex),
        ];

        const draft = prev.map((t) =>
          t.id === trackId ? { ...t, clips: [...otherClips, ...spliced] } : t
        );
        const recalced = recalcAllStarts(draft, sectionOrder);
        const finalTrack = recalced.find((t) => t.id === trackId)!;

        track.clips.forEach((old) => {
          const updated = finalTrack.clips.find((c) => c.id === old.id);
          if (updated && updated.start !== old.start) {
            fetch(`/api/timeline-clips/${old.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ start: updated.start }),
            }).catch((err) => console.error('Failed to update clip start:', err));
          }
        });

        return recalced;
      });

      setInsertionPoint(null);
    }
  };

  const handleDeleteTrack = (trackId: string) => {
    fetch(`/api/tracks/${trackId}`, { method: 'DELETE' }).catch(console.error);
    setTracks(prev => prev.filter(t => t.id !== trackId));
    queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
    queryClient.invalidateQueries({ queryKey: ['hidden-tracks', songId] });
  };

  const handleRulerSeek = (pos: number) => {
    const newPos = Math.max(256, pos + 256);
    setPlayheadPosition(newPos);
    const time = Math.max(0, pos / zoom);
    window.dispatchEvent(new CustomEvent('seek-audio', { detail: { time } }));
    window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
  };

  const [location] = useLocation();
  const hasAutoScrolled = React.useRef<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const section = searchParams.get('section');
    const currentSearch = window.location.search;

    if (section && sectionLayout.length > 0 && hasAutoScrolled.current !== currentSearch) {
      const targetSection = sectionLayout.find(
        (s) => s.name.toLowerCase() === section.toLowerCase()
      );
      if (targetSection && timelineRef.current) {
        const scrollX =
          targetSection.start * zoom -
          timelineRef.current.clientWidth / 2 +
          (targetSection.duration * zoom) / 2;
        timelineRef.current.scrollTo({ left: Math.max(0, scrollX), behavior: 'smooth' });
        const newPos = Math.max(256, targetSection.start * zoom + 256);
        setPlayheadPosition(newPos);
        checkAudioMuteState(newPos);
        const time = Math.max(0, (newPos - 256) / zoom);
        window.dispatchEvent(new CustomEvent('seek-audio', { detail: { time } }));
        window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
        hasAutoScrolled.current = currentSearch;
      }
    }
  }, [location, sectionLayout, zoom, setPlayheadPosition, checkAudioMuteState]);

  const [timelineHeight, setTimelineHeight] = useState(
    typeof window !== 'undefined' ? (window.innerHeight - 136) / 2 : 400
  );
  const resizeRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [clearDialogState, setClearDialogState] = useState<'none' | 'checking' | 'simple' | 'enhanced'>('none');

  // Dismiss context menu on click-outside or Escape.
  useEffect(() => {
    if (!contextMenuPos) return;
    const dismiss = () => setContextMenuPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenuPos(null); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenuPos]);

  const handleTimelineContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Suppress on clips and draggable section header labels (all carry cursor-grab).
    if (target.closest('.cursor-grab')) return;
    // Suppress in the 256px sticky track-header zone.
    const containerRect = timelineRef.current?.getBoundingClientRect();
    if (containerRect && e.clientX - containerRect.left < 256) return;
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleClearAll = () => {
    const allClips = tracks.flatMap((t) => t.clips);
    setTracks((prev) => prev.map((t) => ({ ...t, clips: [] })));
    setSectionOrder([]);
    allClips.forEach((clip) => {
      fetch(`/api/timeline-clips/${clip.id}`, { method: 'DELETE' }).catch(console.error);
    });
    setClearDialogState('none');
  };

  const handleLeaveFinalClips = () => {
    fetch(`/api/songs/${songId}/timeline-clips/non-final`, { method: 'DELETE' })
      .then(() => queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] }))
      .catch(console.error);
    setClearDialogState('none');
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current) return;
    const startY = e.clientY;
    const startHeight = timelineHeight;
    const containerHeight = containerRef.current.clientHeight;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(144, Math.min(startHeight + deltaY, containerHeight - 56));
      setTimelineHeight(newHeight);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={trackFirstCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" ref={containerRef}>
        <MediaBucket
          songId={songId}
          onAddToTimeline={(clip, trackId) => {
            const targetTrack = tracks.find((t) => t.id === trackId);
            if (!targetTrack || !clip.sectionName) {
              console.warn('[AddToTimeline] missing', { trackId, sectionName: clip.sectionName });
              return;
            }
            insertClipInSection(targetTrack.id, clip.sectionName, clip);
          }}
        />

        <div
          className="flex flex-col min-w-0 bg-[#09090b] relative overflow-hidden select-none shrink-0"
          style={{ height: `${timelineHeight}px` }}
        >
          <div
            ref={resizeRef}
            className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-50"
            onPointerDown={handleResizePointerDown}
          />
          <div
            className="flex-1 overflow-y-auto overflow-x-auto relative [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] mt-1.5"
            ref={timelineRef}
          >
            <div
              className="pb-32 relative"
              style={{
                width: `${Math.max(endOfTimeline + 15, 0) * zoom + 256}px`,
                minWidth: '100%',
              }}
              onContextMenu={handleTimelineContextMenu}
            >
              <Ruler onSeek={handleRulerSeek} zoom={zoom} />

              {/* Gap zones — rendered at clip boundaries within the active drag's section.
                  One zone before the first clip and one after each clip (N clips → N+1 zones). */}
              {gapZones.map(({ id, left }) => (
                <GapZone key={id} id={id} left={left} trackAreaHeight={64 * tracks.length + 64} />
              ))}

              {/* Section column headers — own DndContext for section reordering */}
              <DndContext
                sensors={sensors}
                onDragStart={handleSectionDragStart}
                onDragMove={handleSectionDragMove}
                onDragEnd={handleSectionDragEnd}
                onDragCancel={handleSectionDragEnd}
              >
                <div className="flex w-full h-6 border-b border-border/50 bg-[#09090b] sticky top-8 z-10">
                  <div className="w-64 shrink-0 bg-card border-r border-border sticky left-0 z-20" />
                  <div className="flex relative">
                    {sectionLayout.map((sec) => (
                      <DraggableSectionHeader
                        key={sec.name}
                        name={sec.name}
                        width={sec.duration * zoom}
                      />
                    ))}
                    {/* Insertion line — appears at the nearest gap while dragging a section header */}
                    {sectionInsertX !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(212,175,55,0.9)] pointer-events-none z-10"
                        style={{ left: sectionInsertX }}
                      />
                    )}
                  </div>
                </div>

                {/* Lightweight column ghost shown while dragging a section header */}
                <DragOverlay modifiers={[restrictToHorizontalAxis]} dropAnimation={null}>
                  {activeSectionName && (() => {
                    const sec = sectionLayout.find((s) => s.name === activeSectionName);
                    if (!sec) return null;
                    const colWidth = sec.duration * zoom;
                    return (
                      <div
                        className="pointer-events-none opacity-90 rounded-sm overflow-hidden border border-primary/40 shadow-[0_0_20px_rgba(212,175,55,0.25)]"
                        style={{ width: colWidth }}
                      >
                        {/* Header label */}
                        <div className="h-6 bg-[#09090b]/95 flex items-center px-2 border-b border-primary/30">
                          <span className="text-[9px] font-bold text-primary uppercase tracking-widest">
                            {activeSectionName}
                          </span>
                        </div>
                        {/* One solid bar per track — shows which tracks have clips in this section */}
                        {tracks.map((track) => {
                          const hasClips = track.clips.some((c) => c.sectionName === activeSectionName);
                          return (
                            <div
                              key={track.id}
                              className="h-16 border-b border-border/20 bg-[#09090b]/80 flex items-center px-1.5"
                            >
                              {hasClips && (
                                <div
                                  className="h-8 rounded flex-1 opacity-60"
                                  style={{ backgroundColor: track.color }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </DragOverlay>
              </DndContext>

              {tracks.map((track) => {
                const invalidSectionsForTrack = new Set<string>();
                let isInvalidDrop = false;

                if (activeDragData) {
                  const { clip, type, trackId: draggedTrackId } = activeDragData;
                  const sourceTrack =
                    type === 'clip'
                      ? tracks.find((t) => t.clips.some((c) => c.id === clip.id))
                      : null;

                  // Track-level invalidity — disables the droppable entirely.
                  if (type === 'bucket-clip') {
                    if (draggedTrackId) {
                      // Real API clip: match by trackId directly.
                      if (draggedTrackId !== track.id) isInvalidDrop = true;
                    } else {
                      // Mock clip fallback: look up instrument by clip ID in MOCK_SONG.
                      const sourceInstrument = MOCK_SONG.instruments.find((inst) =>
                        inst.ideas.some((idea) => idea.versions.some((v) => v.id === clip.id))
                      );
                      if (sourceInstrument && sourceInstrument.name !== track.name) isInvalidDrop = true;
                    }
                  }
                  if (type === 'clip' && sourceTrack && sourceTrack.id !== track.id) isInvalidDrop = true;

                  // Per-section visual grayout — clip must land in its own section column.
                  if (clip.sectionName) {
                    sectionLayout.forEach(({ name: sectionName }) => {
                      if (clip.sectionName !== sectionName) invalidSectionsForTrack.add(sectionName);
                    });
                  }
                }

                return (
                  <TimelineTrack
                    key={track.id}
                    track={track}
                    sections={sectionLayout}
                    invalidSections={invalidSectionsForTrack}
                    isInvalidDrop={isInvalidDrop}
                    isDragging={activeDragData !== null}
                    zoom={zoom}
                    insertionPoint={
                      insertionPoint?.trackId === track.id
                        ? { sectionName: insertionPoint.sectionName, index: insertionPoint.index, x: insertionPoint.x }
                        : undefined
                    }
                    onDeleteTrack={handleDeleteTrack}
                    songId={songId}
                  />
                );
              })}

            </div>
          </div>

          {/* Global Playhead */}
          <div
            className="absolute top-0 bottom-0 w-[16px] z-50 flex justify-center cursor-ew-resize group"
            style={{ left: `${playheadPositionState - timelineScrollLeft}px`, transform: 'translateX(-50%)' }}
            onPointerDown={handlePlayheadPointerDown}
          >
            <div className="w-[1px] h-full bg-primary shadow-[0_0_15px_rgba(212,175,55,0.6)] group-hover:w-[2px] transition-all" />
            <div className="absolute top-0 w-[13px] h-[14px] bg-primary rounded-sm shadow-sm flex items-center justify-center pointer-events-none">
              <div className="w-[1px] h-[8px] bg-black/50" />
            </div>
            <div className="absolute top-[14px] w-0 h-0 border-l-[6.5px] border-l-transparent border-r-[6.5px] border-r-transparent border-t-[6px] border-t-primary pointer-events-none" />
          </div>

          <DawScrollbar
            timelineRef={timelineRef}
            zoom={zoom}
            setZoom={setZoom}
            projectDuration={Math.max(30, endOfTimeline + 5)}
          />
        </div>
      </div>

      <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
        {activeDragData ? (
          <div className="opacity-90 scale-105 rotate-1 cursor-grabbing pointer-events-none z-[9999]">
            <div
              className="h-10 rounded-md border-2 border-primary shadow-[0_0_30px_rgba(212,175,55,0.4)] flex items-center px-4 gap-3 bg-[#0c0c0e] pointer-events-none"
              style={{ width: Math.max(160, ((activeDragData.clip.trimEnd ?? activeDragData.clip.duration) - (activeDragData.clip.trimStart ?? 0)) * zoom) }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeDragData.clip.color }} />
              <span className="text-xs font-bold text-white truncate tracking-tight">
                {activeDragData.clip.name}
              </span>
            </div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Timeline background right-click context menu */}
      {contextMenuPos && (
        <div
          className="fixed z-[9999] bg-popover border border-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-red-400 hover:bg-red-400/10 transition-colors"
            onClick={() => {
              setContextMenuPos(null);
              setClearDialogState('checking');
              fetch(`/api/songs/${songId}/timeline-has-finals`)
                .then((r) => r.json())
                .then(({ hasFinals }: { hasFinals: boolean }) =>
                  setClearDialogState(hasFinals ? 'enhanced' : 'simple')
                )
                .catch(() => setClearDialogState('simple'));
            }}
          >
            Clear Timeline
          </button>
        </div>
      )}

      {/* Simple clear dialog — no finals on the timeline */}
      <AlertDialog
        open={clearDialogState === 'simple'}
        onOpenChange={(open) => { if (!open) setClearDialogState('none'); }}
      >
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Clear Timeline</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove all clips from the timeline? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearAll}
            >
              Clear Timeline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enhanced clear dialog — finals exist on the timeline */}
      <AlertDialog
        open={clearDialogState === 'enhanced'}
        onOpenChange={(open) => { if (!open) setClearDialogState('none'); }}
      >
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Clear Timeline</AlertDialogTitle>
            <AlertDialogDescription>
              Some clips on the timeline are marked as final. You can keep only the final clips or clear everything.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-card text-foreground border border-border hover:bg-muted"
              onClick={handleLeaveFinalClips}
            >
              Leave Final Clips
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearAll}
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  );
}
