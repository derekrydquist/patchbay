import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import { type Clip } from '@/lib/daw-data';
import {
  type ApiClip, type ApiIdea, type ApiTrack, type ApiLooseFile,
  fetchBucket, bucketKeys, fetchLooseFiles, looseFileKeys,
} from '@/lib/bucket-api';
import {
  useAddInstrument, useAddSection, useAddFullTake,
  useDeleteTrack, useRestoreTrack,
  useHideIdea, useRestoreSectionSongWide,
} from '@/hooks/use-bucket-mutations';
import { bucketSectionDropId, bucketVersionsDropId } from '@/hooks/use-loose-file-organize-dnd';
import { BucketClip } from './Clip';
import { LooseFileRow } from './LooseFileRow';
import { UploadModal } from './UploadModal';
import { AddInstrumentModal } from './modals/AddInstrumentModal';
import { AddSectionModal } from './modals/AddSectionModal';
import {
  ChevronRight, Folder, Search,
  Upload, Plus, Loader2, AlertCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from '@/components/ui/context-menu';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// ─── Convert ApiClip → daw-data Clip (for BucketClip component) ──────────────

function toClip(apiClip: ApiClip): Clip {
  return {
    id: apiClip.id,
    name: apiClip.name,
    type: apiClip.type as Clip['type'],
    color: apiClip.color,
    start: apiClip.start,
    duration: apiClip.duration,
    src: apiClip.src ?? undefined,
    isFinal: apiClip.isFinal,
    isFullTake: apiClip.isFullTake ?? false,
    sectionName: apiClip.sectionName ?? undefined,
    metadata: apiClip.metadata as unknown as Clip['metadata'],
  };
}

// ─── Section row — Sections column ─────────────────────────────────────────────
// Extracted so useDroppable can be called once per row. Doubles as the organize
// drop target for a dragged loose file (id from bucketSectionDropId, data carries
// trackId/sectionName directly — read by the shared use-loose-file-organize-dnd
// hook's handleDragEnd, called from Timeline.tsx's own handleDragEnd since
// MediaBucket is rendered inside Timeline's DndContext and does not own drag-end
// handling itself). Native onDragOver/onDragLeave/onDrop handlers (OS file drag)
// are unrelated and untouched.

interface SectionFolderRowProps {
  idea: ApiIdea;
  isSelected: boolean;
  onSelect: () => void;
  onFileDrop: (e: React.DragEvent) => void;
  onRemove: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}

function SectionFolderRow({ idea, isSelected, onSelect, onFileDrop, onRemove, buttonRef }: SectionFolderRowProps) {
  const hasFiles = idea.clips.length > 0;
  const { setNodeRef, isOver } = useDroppable({
    id: bucketSectionDropId(idea.id),
    data: { trackId: idea.trackId, sectionName: idea.sectionName },
  });
  const combinedRef = (node: HTMLButtonElement | null) => {
    setNodeRef(node);
    if (buttonRef) (buttonRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={combinedRef}
          onClick={onSelect}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('bg-primary/10', 'border', 'border-primary/50');
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
          }}
          onDrop={onFileDrop}
          className={cn(
            "w-full flex items-center justify-between p-2 rounded text-xs transition-all border border-transparent",
            isSelected
              ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]"
              : "text-muted-foreground hover:bg-white/5 hover:text-white",
            isOver && "bg-primary/10 border-primary/50"
          )}
        >
          <div className="flex items-center gap-2">
            <Folder
              size={14}
              className={isSelected ? "text-primary" : "text-muted-foreground"}
              fill={hasFiles ? "currentColor" : "none"}
            />
            <span className="font-bold tracking-tight">{idea.sectionName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {idea.hasNew && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
            <ChevronRight size={12} className="opacity-40" />
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="bg-popover border-border">
        <ContextMenuItem
          className="text-red-400 focus:text-red-400 focus:bg-red-400/10 text-xs"
          onClick={onRemove}
        >
          Remove Section
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MediaBucketProps {
  songId: string;
  onAddToTimeline?: (clip: Clip, trackId?: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaBucket({ songId, onAddToTimeline }: MediaBucketProps) {
  const queryClient = useQueryClient();

  const viewIdeaMutation = useMutation({
    mutationFn: (ideaId: string) =>
      fetch(`/api/ideas/${ideaId}/view`, { method: 'POST' }).then(r => {
        if (!r.ok) throw new Error('Failed to mark idea as viewed');
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
    },
  });

  const [selectedTrack, setSelectedTrack] = useState<ApiTrack | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<ApiIdea | null>(null);
  const [autoOpenClipId, setAutoOpenClipId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<'placed' | 'loose'>('placed');
  const [uploadInitialIdeaId, setUploadInitialIdeaId] = useState('');
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [addSectionError, setAddSectionError] = useState<string | null>(null);
  const [isAddInstrumentOpen, setIsAddInstrumentOpen] = useState(false);
  const [newInstrumentName, setNewInstrumentName] = useState('');
  const [addInstrumentError, setAddInstrumentError] = useState<string | null>(null);
  const [isVersionsDragOver, setIsVersionsDragOver] = useState(false);
  const sessionRestored = useRef(false);
  const tracksRef = useRef<ApiTrack[]>([]);
  const selectedTrackRef = useRef<HTMLButtonElement | null>(null);
  const selectedIdeaRef = useRef<HTMLButtonElement | null>(null);
  const [location] = useLocation();

  // ── Fetch bucket from API ────────────────────────────────────────────────────

  const { data: tracks = [], isLoading, isError } = useQuery<ApiTrack[]>({
    queryKey: bucketKeys.bucket(songId),
    queryFn: () => fetchBucket(songId),
  });

  const { data: looseFiles = [] } = useQuery<ApiLooseFile[]>({
    queryKey: looseFileKeys.list(songId),
    queryFn: () => fetchLooseFiles(songId),
  });


  const { data: hiddenIdeas = [] } = useQuery<{ id: string; sectionName: string }[]>({
    queryKey: bucketKeys.hiddenIdeas(selectedTrack?.id),
    queryFn: async () => {
      const res = await fetch(`/api/tracks/${selectedTrack!.id}/hidden-ideas`);
      return res.json();
    },
    enabled: isAddSectionOpen && !!selectedTrack?.id,
  });

  const { data: hiddenTracks = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: bucketKeys.hiddenTracks(songId),
    queryFn: async () => {
      const res = await fetch(`/api/songs/${songId}/hidden-tracks`);
      return res.json();
    },
    enabled: isAddInstrumentOpen,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // ── Keep selected items in sync when data refreshes ─────────────────────────

  useEffect(() => {
    if (!tracks.length) return;
    tracksRef.current = tracks;
    if (selectedTrack) {
      const fresh = tracks.find(t => t.id === selectedTrack.id);
      setSelectedTrack(fresh ?? null);
      if (selectedIdea && fresh) {
        const freshIdea = fresh.ideas.find(i => i.id === selectedIdea.id);
        setSelectedIdea(freshIdea ?? null);
      }
    }
  }, [tracks]);

  // ── "Find in File Browser" from timeline clip right-click ─────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const { trackId, instrumentName, sectionName } = (e as CustomEvent).detail as {
        trackId?: string; instrumentName?: string; sectionName?: string;
      };
      const track = trackId
        ? tracksRef.current.find(t => t.id === trackId)
        : instrumentName
          ? tracksRef.current.find(t => t.name.toLowerCase() === instrumentName.toLowerCase())
          : null;
      if (!track) return;
      const idea = sectionName
        ? track.ideas.find(i => i.sectionName.toLowerCase() === sectionName.toLowerCase()) ?? null
        : null;
      setSelectedTrack(track);
      setSelectedIdea(idea);
    };
    window.addEventListener('find-in-bucket', handler);
    return () => window.removeEventListener('find-in-bucket', handler);
  }, []);

  // ── Persist selection to localStorage ───────────────────────────────────────

  useEffect(() => {
    if (selectedTrack) {
      localStorage.setItem(`patchbay-selected-track-${songId}`, selectedTrack.id);
    }
    if (selectedIdea) {
      localStorage.setItem(`patchbay-selected-idea-${songId}`, selectedIdea.id);
    }
    if (selectedTrack && selectedIdea) {
      localStorage.setItem(`patchbay-last-session-${songId}`, JSON.stringify({
        instrument: selectedTrack.name,
        section: selectedIdea.sectionName,
      }));
    }
  }, [selectedTrack?.id, selectedIdea?.id, songId]);

  // ── Session restore: URL params take priority, localStorage as fallback ────────

  useEffect(() => {
    if (!tracks.length) return;
    if (sessionRestored.current) return;
    sessionRestored.current = true;

    const params = new URLSearchParams(window.location.search);
    const urlInstrument = params.get('instrument');
    const urlSection = params.get('section');
    const urlFile = params.get('file');
    const urlClipId = params.get('clipId');
    const urlOpenComments = params.get('openComments');
    if (urlClipId && urlOpenComments === 'true') {
      setAutoOpenClipId(urlClipId);
    }

    // URL params win — used when navigating from task clicks or external links
    if (urlInstrument || urlFile) {
      let targetTrack: ApiTrack | null = null;

      if (urlInstrument) {
        targetTrack = tracks.find(t => t.name.toLowerCase() === urlInstrument.toLowerCase()) ?? null;
      } else if (urlFile) {
        targetTrack = tracks.find(t => t.ideas.some(i => i.clips.some(c => c.id === urlFile))) ?? null;
      }

      if (targetTrack) {
        setSelectedTrack(targetTrack);
        let targetIdea: ApiIdea | null = null;
        if (urlSection) {
          targetIdea = targetTrack.ideas.find(i => i.sectionName.toLowerCase().includes(urlSection.toLowerCase())) ?? null;
        } else if (urlFile) {
          targetIdea = targetTrack.ideas.find(i => i.clips.some(c => c.id === urlFile)) ?? null;
        }
        setSelectedIdea(targetIdea);
      }
      return;
    }

    // Fall back to localStorage session persistence (scoped per song)
    const savedTrackId = localStorage.getItem(`patchbay-selected-track-${songId}`);
    const savedIdeaId = localStorage.getItem(`patchbay-selected-idea-${songId}`);

    if (savedTrackId) {
      const track = tracks.find(t => t.id === savedTrackId);
      if (track) {
        setSelectedTrack(track);
        if (savedIdeaId) {
          const idea = track.ideas.find(i => i.id === savedIdeaId);
          if (idea) setSelectedIdea(idea);
        }
      }
    }
  }, [location, tracks]);

  useEffect(() => {
    selectedTrackRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedTrack?.id]);

  useEffect(() => {
    selectedIdeaRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdea?.id]);

  // ── Mark idea as viewed whenever a section is selected ───────────────────────

  useEffect(() => {
    if (selectedIdea) viewIdeaMutation.mutate(selectedIdea.id);
  }, [selectedIdea?.id]);

  // ── Bucket mutations (add/delete/restore instrument and section) ─────────────

  const addInstrumentMutation = useAddInstrument(songId, {
    onCreated: (newTrack) => {
      setIsAddInstrumentOpen(false);
      setNewInstrumentName('');
      queryClient.fetchQuery<ApiTrack[]>({ queryKey: bucketKeys.bucket(songId), queryFn: () => fetchBucket(songId) }).then(fresh => {
        const track = fresh.find(t => t.id === newTrack.id);
        if (track) { setSelectedTrack(track); setSelectedIdea(null); }
      }).catch(err => console.error('Failed to auto-select new instrument:', err));
    },
    onError: (msg) => setAddInstrumentError(msg),
  });

  const addSectionMutation = useAddSection(songId, tracks, {
    onCreated: (sectionName) => {
      setIsAddSectionOpen(false);
      setNewSectionName('');
      if (selectedTrack) {
        queryClient.fetchQuery<ApiTrack[]>({
          queryKey: bucketKeys.bucket(songId),
          queryFn: () => fetchBucket(songId),
        }).then(fresh => {
          const track = fresh.find(t => t.id === selectedTrack.id);
          const newIdea = track?.ideas.find(i => i.sectionName === sectionName);
          if (newIdea) setSelectedIdea(newIdea);
        }).catch(err => console.error('Failed to auto-select new section:', err));
      }
    },
    onError: (msg) => setAddSectionError(msg),
  });

  const deleteTrackMutation = useDeleteTrack(songId, {
    onSuccess: () => { setSelectedTrack(null); setSelectedIdea(null); },
    onError: (msg) => console.error('[removeInstrument] error:', msg),
  });

  const restoreTrackMutation = useRestoreTrack(songId, {
    onSuccess: () => { setIsAddInstrumentOpen(false); },
    onError: (msg) => setAddInstrumentError(msg),
  });

  const hideIdeaMutation = useHideIdea(songId, selectedTrack?.id, {
    onSuccess: () => setSelectedIdea(null),
    onError: (msg) => console.error('[hideIdea] error:', msg),
  });

  const restoreSectionMutation = useRestoreSectionSongWide(songId, {
    onSuccess: () => { setIsAddSectionOpen(false); },
  });

  const addFullTakeMutation = useAddFullTake(songId, {
    onCreated: (idea) => {
      queryClient.fetchQuery<ApiTrack[]>({
        queryKey: bucketKeys.bucket(songId),
        queryFn: () => fetchBucket(songId),
      }).then(fresh => {
        const track = fresh.find(t => t.id === selectedTrack?.id);
        const newIdea = track?.ideas.find(i => i.id === idea.id);
        if (newIdea) setSelectedIdea(newIdea);
      }).catch(err => console.error('[addFullTake] auto-select failed:', err));
    },
  });

  // ── File input helpers ───────────────────────────────────────────────────────

  const handleIdeaFileDrop = (e: React.DragEvent, idea: ApiIdea, track: ApiTrack) => {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
    if (!e.dataTransfer.files?.length) return;
    const audioFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (!audioFiles.length) return;
    setUploadMode('placed');
    setUploadInitialFiles(audioFiles);
    setUploadInitialIdeaId(idea.id);
    setIsUploadOpen(true);
    setSelectedTrack(track);
    setSelectedIdea(idea);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────

  const filteredIdeas = selectedTrack
    ? selectedTrack.ideas.filter(idea => {
        if (!searchQuery) return true;
        return idea.clips.some(clip => {
          const q = searchQuery.toLowerCase();
          return (
            clip.name.toLowerCase().includes(q) ||
            (clip.metadata as any)?.originalFileName?.toLowerCase().includes(q)
          );
        });
      })
    : [];

  const selectedTrackHasFullTake = selectedTrack?.ideas.some(i => i.isFullTake) ?? false;

  const filteredVersions = selectedIdea
    ? selectedIdea.clips.filter((clip: ApiClip) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          clip.name.toLowerCase().includes(q) ||
          (clip.metadata as any)?.originalFileName?.toLowerCase().includes(q)
        );
      })
    : [];

  // Versions column organize drop target — same (trackId, sectionName) pair as the
  // Section row one level out (one-idea-per-section), so this is a second entry point
  // onto the identical organize call, not a new backend concept. Distinct id prefix
  // from the Section row's bucketSectionDropId (a real DOM node can't be registered
  // under the same dnd-kit id twice) — see matchOrganizeDropTarget in
  // use-loose-file-organize-dnd.ts (used by Timeline.tsx's trackFirstCollision) for
  // the matching precise-bounds collision pass, which matches on this id's prefix,
  // not the full id, so a stable suffix is safe.
  //
  // Suffix ('media-bucket-files-column') is a fixed constant, NOT derived from
  // selectedIdea.id. The organize handler reads over.data.current for
  // trackId/sectionName, never over.id, so the id string itself carries no meaning
  // beyond being a stable dnd-kit registry key. Deriving it from selectedIdea.id (as
  // this used to) re-keys the registration on every idea/section switch — dnd-kit's
  // registration effect is keyed off `[id]` and tears down + re-registers on change,
  // independently of the disabled/data reactivity (those update in place by design,
  // via useLatestValue). The default collision algorithm looks up droppableRects by
  // the CURRENT id and silently skips this droppable if no rect is on record for it —
  // so switching sections and then dragging could land on a fresh id with no measured
  // rect yet, and the drop would silently miss. Found and fixed this exact bug in
  // Dashboard.tsx's Songs quick-browser equivalent first; same root cause here.
  const { setNodeRef: setVersionsDroppableRef, isOver: isVersionsDropTarget } = useDroppable({
    id: bucketVersionsDropId('media-bucket-files-column'),
    disabled: !selectedIdea,
    data: selectedIdea ? { trackId: selectedIdea.trackId, sectionName: selectedIdea.sectionName } : undefined,
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex-1 border-b border-border bg-sidebar/80 backdrop-blur-xl flex flex-col z-20 min-h-0">

      {/* Header */}
      <div className="flex items-center justify-end px-6 h-14 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search project assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-black/40 border-white/5 focus:border-primary/50"
            />
          </div>

          <Button
            size="sm"
            className="h-8 text-[10px] uppercase tracking-widest font-bold"
            onClick={() => { setUploadMode('loose'); setUploadInitialFiles([]); setUploadInitialIdeaId(''); setIsUploadOpen(true); }}
          >
            <Upload size={14} className="mr-2" /> Upload
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden divide-x divide-white/5">

        {/* ── Instruments column ── */}
        <div className="w-1/4 flex flex-col">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/header">
            <span>Instruments</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5">
                  <Plus size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px]">
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={() => setIsAddInstrumentOpen(true)}
                >
                  Add Track
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={() => { setUploadMode('loose'); setUploadInitialFiles([]); setUploadInitialIdeaId(''); setIsUploadOpen(true); }}
                >
                  Add Files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {isLoading && (
                <div className="flex items-center justify-center mt-10 gap-2 text-[10px] text-muted-foreground/40">
                  <Loader2 size={12} className="animate-spin" /> Loading…
                </div>
              )}
              {isError && (
                <div className="flex items-center justify-center mt-10 gap-2 text-[10px] text-red-400">
                  <AlertCircle size={12} /> Failed to load
                </div>
              )}
              {tracks
                .filter(track => {
                  if (!searchQuery) return true;
                  return track.ideas.some(idea =>
                    idea.clips.some(clip => {
                      const q = searchQuery.toLowerCase();
                      return (
                        clip.name.toLowerCase().includes(q) ||
                        (clip.metadata as any)?.originalFileName?.toLowerCase().includes(q)
                      );
                    })
                  );
                })
                .map(track => {
                  const hasFiles = track.ideas.some(i => i.clips.length > 0);
                  const trackHasNew = track.ideas.some(i => i.active && i.hasNew);
                  return (
                    <ContextMenu key={track.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          ref={selectedTrack?.id === track.id ? selectedTrackRef : undefined}
                          onClick={() => { setSelectedTrack(track); setSelectedIdea(null); }}
                          className={cn(
                            "w-full flex items-center justify-between p-2 rounded text-xs transition-all",
                            selectedTrack?.id === track.id
                              ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]"
                              : "text-muted-foreground hover:bg-white/5 hover:text-white"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Folder
                              size={14}
                              className={selectedTrack?.id === track.id ? "text-primary" : "text-muted-foreground"}
                              fill={hasFiles ? "currentColor" : "none"}
                            />
                            <span className="font-bold tracking-tight">{track.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {trackHasNew && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                            <ChevronRight size={12} className="opacity-40" />
                          </div>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="bg-popover border-border">
                        <ContextMenuItem
                          className="text-red-400 focus:text-red-400 focus:bg-red-400/10 text-xs"
                          onClick={() => deleteTrackMutation.mutate(track.id)}
                        >
                          Remove Instrument
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              {looseFiles.map(lf => (
                <LooseFileRow key={lf.id} looseFile={lf} songId={songId} />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* ── Sections column ── */}
        <div className="w-1/4 flex flex-col bg-black/10">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/header">
            <span>Sections</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5">
                  <Plus size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border-border min-w-[160px]">
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={() => setIsAddSectionOpen(true)}
                >
                  Named Section
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs cursor-pointer"
                  onClick={() => { if (selectedTrack) addFullTakeMutation.mutate(selectedTrack.id); }}
                  disabled={!selectedTrack || selectedTrackHasFullTake || addFullTakeMutation.isPending}
                >
                  Full Takes Section
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedTrack ? filteredIdeas.map(idea => (
                <SectionFolderRow
                  key={idea.id}
                  idea={idea}
                  isSelected={selectedIdea?.id === idea.id}
                  onSelect={() => setSelectedIdea(idea)}
                  onFileDrop={(e) => handleIdeaFileDrop(e, idea, selectedTrack)}
                  onRemove={() => hideIdeaMutation.mutate(idea.id)}
                  buttonRef={selectedIdea?.id === idea.id ? selectedIdeaRef : undefined}
                />
              )) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                  Select an instrument to view sections
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Versions column ── */}
        <div
          ref={setVersionsDroppableRef}
          className={cn('flex-1 flex flex-col bg-black/20 transition-colors', isVersionsDropTarget && 'bg-primary/5')}
          onDragOver={(e) => {
            if (!selectedIdea || !selectedTrack) return;
            e.preventDefault();
            setIsVersionsDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setIsVersionsDragOver(false);
            }
          }}
          onDrop={(e) => {
            setIsVersionsDragOver(false);
            if (!selectedIdea || !selectedTrack) return;
            handleIdeaFileDrop(e, selectedIdea, selectedTrack);
          }}
        >
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
            Versions
          </div>
          {selectedIdea && filteredVersions.length === 0 && !searchQuery ? (
            /* Empty state — rendered outside ScrollArea so h-full fills the column */
            <div className="flex-1 p-2">
              <div className={cn(
                'flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors',
                isVersionsDragOver ? 'border-primary/50 bg-primary/5' : 'border-white/[0.08]'
              )}>
                <Upload size={18} className={cn('mb-2', isVersionsDragOver ? 'text-primary/60' : 'text-white/15')} />
                <p className={cn('text-[10px] uppercase tracking-widest mb-1', isVersionsDragOver ? 'text-primary/70' : 'text-muted-foreground/50')}>
                  {isVersionsDragOver ? 'Drop to upload' : 'No files yet'}
                </p>
                <p className="text-[10px] text-muted-foreground/30">Drop audio files or use Upload above</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {selectedIdea ? (
                  filteredVersions.length === 0 && searchQuery ? (
                    <div className="flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                      No versions match your search
                    </div>
                  ) : (
                    filteredVersions.map(clip => (
                      <BucketClip
                        key={clip.id}
                        clip={toClip({ ...clip, isFullTake: selectedIdea?.isFullTake ?? false })}
                        trackId={selectedTrack?.id}
                        songId={songId}
                        onAddToTimeline={onAddToTimeline}
                        autoOpenInfo={clip.id === autoOpenClipId}
                      />
                    ))
                  )
                ) : (
                  <div className="flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                    Select a section to view or add versions
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

      </div>

      <UploadModal
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        songId={songId}
        mode={uploadMode}
        defaultIdeaId={uploadInitialIdeaId || undefined}
        defaultInstrumentName={uploadInitialIdeaId ? tracks.find(t => t.ideas.some(i => i.id === uploadInitialIdeaId))?.name : undefined}
        defaultSectionName={uploadInitialIdeaId ? tracks.flatMap(t => t.ideas).find(i => i.id === uploadInitialIdeaId)?.sectionName : undefined}
        initialFiles={uploadInitialFiles}
        onUploadSuccess={({ destTrackId, destIdeaId }) => {
          queryClient.fetchQuery<ApiTrack[]>({ queryKey: bucketKeys.bucket(songId), queryFn: () => fetchBucket(songId) }).then(fresh => {
            const track = fresh.find(t => t.id === destTrackId);
            if (track) {
              setSelectedTrack(track);
              const idea = track.ideas.find(i => i.id === destIdeaId);
              setSelectedIdea(idea ?? null);
            }
          });
        }}
      />

      <AddInstrumentModal
        open={isAddInstrumentOpen}
        onOpenChange={(open) => {
          setIsAddInstrumentOpen(open);
          if (!open) { setNewInstrumentName(''); setAddInstrumentError(null); }
        }}
        value={newInstrumentName}
        onChange={setNewInstrumentName}
        onClearError={() => setAddInstrumentError(null)}
        onSubmit={() => {
          const name = newInstrumentName.trim();
          if (tracks.some(t => t.name.trim().toLowerCase() === name.toLowerCase())) {
            setAddInstrumentError('An instrument with this name already exists');
            return;
          }
          const hiddenMatch = hiddenTracks.find(t => t.name.trim().toLowerCase() === name.toLowerCase());
          if (hiddenMatch) {
            setAddInstrumentError(`An instrument named "${name}" already exists. It's currently hidden — restore it using the option below.`);
            return;
          }
          setAddInstrumentError(null);
          addInstrumentMutation.mutate(name);
        }}
        isPending={addInstrumentMutation.isPending}
        error={addInstrumentError}
        hiddenTracks={hiddenTracks}
        onRestoreTrack={(id) => restoreTrackMutation.mutate(id)}
        isRestoring={restoreTrackMutation.isPending}
      />

      <AddSectionModal
        open={isAddSectionOpen}
        onOpenChange={(open) => {
          setIsAddSectionOpen(open);
          if (!open) { setNewSectionName(''); setAddSectionError(null); }
        }}
        value={newSectionName}
        onChange={setNewSectionName}
        onClearError={() => setAddSectionError(null)}
        onSubmit={() => {
          const name = newSectionName.trim();
          if (tracks.some(t => t.ideas.some(i => i.sectionName.trim().toLowerCase() === name.toLowerCase()))) {
            setAddSectionError('A section with this name already exists');
            return;
          }
          setAddSectionError(null);
          addSectionMutation.mutate(name);
        }}
        isPending={addSectionMutation.isPending}
        error={addSectionError}
        hiddenSections={hiddenIdeas}
        onRestoreSection={(id) => {
            const section = hiddenIdeas.find(h => h.id === id);
            if (section) restoreSectionMutation.mutate(section.sectionName);
          }}
        isRestoring={restoreSectionMutation.isPending}
      />
    </div>
  );
}
