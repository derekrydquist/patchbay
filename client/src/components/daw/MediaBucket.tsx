import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useDroppable } from '@dnd-kit/core';
import { type Clip } from '@/lib/daw-data';
import {
  type ApiClip, type ApiIdea, type ApiTrack, type ApiLooseFile,
  fetchBucket, bucketKeys, fetchLooseFiles, fetchTrackLooseFiles, looseFileKeys, liveCommentRefetch,
  apiClipToClip,
} from '@/lib/bucket-api';
import {
  useAddInstrument, useAddSection, useAddFullTake,
  useDeleteTrack, useRestoreTrack,
  useHideIdea, useRestoreSection,
} from '@/hooks/use-bucket-mutations';
import {
  bucketSectionDropId, bucketVersionsDropId, bucketTrackDropId,
  bucketSectionsBackgroundDropId, bucketTracksBackgroundDropId, useActiveOrganizeDrag,
  organizeDropRules, type ActiveOrganizeDrag, type SectionDropTarget, type TrackDropTarget, type TracksDropTarget,
  DRAG_SURFACE_GROUP, DRAG_SURFACE_ROW_HOVER, useDragSurfaceAttrs,
  useSpringLoadedRows, useNativeSpringLoadedRows, flashSpringOpenedColumn, springRowAttrs,
  type SpringLoadedRowsOptions,
} from '@/hooks/use-loose-file-organize-dnd';
import {
  useNativeFileDrop, takeAudioFiles, NATIVE_DROP_ROW_CLASS, NATIVE_DROP_COLUMN_CLASS,
  type NativeFileHold,
} from '@/hooks/use-native-file-drop';
import { requestLandingFlash, clipLandingZone } from '@/hooks/use-landing-flash';
import { startDropUpload } from '@/lib/drop-upload';
import { apiRequest } from '@/lib/queryClient';
import { BucketClip, useLiveClipCommentSummary } from './Clip';
import { LooseFileRow, LooseFileInfoProvider, useLooseFileInfoWindow } from './LooseFileRow';
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

// ─── Section row — Sections column ─────────────────────────────────────────────
// Extracted so useDroppable can be called once per row. Doubles as the organize
// drop target for a dragged loose file (id from bucketSectionDropId, data carries
// trackId/sectionName directly — read by the shared use-loose-file-organize-dnd
// hook's handleDragEnd, called from Timeline.tsx's own handleDragEnd since
// MediaBucket is rendered inside Timeline's DndContext and does not own drag-end
// handling itself). A Finder file drop is a separate, native mechanism
// (useNativeFileDrop) — it uploads into this section as a real clip.

interface SectionFolderRowProps {
  idea: ApiIdea;
  isSelected: boolean;
  onSelect: () => void;
  onFileDrop: (files: File[]) => void;
  onRemove: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  /** From MediaBucket's useActiveOrganizeDrag — null when no organize drag is active. */
  activeDrag: ActiveOrganizeDrag | null;
  songId: string;
  trackName: string;
  /** Finder-drag spring (useNativeSpringLoadedRows) — undefined for the selected section. */
  nativeHold?: NativeFileHold;
}

function SectionFolderRow({ idea, isSelected, onSelect, onFileDrop, onRemove, buttonRef, activeDrag, songId, trackName, nativeHold }: SectionFolderRowProps) {
  const hasFiles = idea.clips.length > 0;
  const nativeDrop = useNativeFileDrop({ onDrop: onFileDrop, hold: nativeHold });
  const target: SectionDropTarget = {
    trackId: idea.trackId, sectionName: idea.sectionName, ideaId: idea.id,
    songId, isFullTake: idea.isFullTake ?? false, trackName,
  };
  const dropId = bucketSectionDropId(idea.id);
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: target,
  });
  // Highlight only when this row accepts the active drag (organizeDropRules).
  const accepts = organizeDropRules.sectionRow(activeDrag, target);
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
          {...nativeDrop.handlers}
          {...springRowAttrs(dropId)}
          className={cn(
            "w-full flex items-center justify-between p-2 rounded text-xs transition-all border border-transparent",
            isSelected
              ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]"
              // Plain hover is off during any drag (DRAG_SURFACE_ROW_HOVER).
              : cn("text-muted-foreground", DRAG_SURFACE_ROW_HOVER),
            ((isOver && accepts) || nativeDrop.isOver) && NATIVE_DROP_ROW_CLASS
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

// ─── Track row — Tracks column ─────────────────────────────────────────────────
// Extracted so useDroppable can be called once per row, mirroring SectionFolderRow
// above. Doubles as the assign-track drop target for a dragged loose file (id from
// bucketTrackDropId, data carries trackId only — read by the shared
// use-loose-file-organize-dnd hook's handleDragEnd). Dropping a loose file here
// moves it into the Track-scoped resting tier (trackId set, no sectionName yet)
// rather than organizing it into a real clip — see loose_files in root CLAUDE.md.
// A Finder file drop lands in the same tier (a loose file on THIS track), via
// useNativeFileDrop — it no longer falls through to the Tracks-column background.

interface TrackFolderRowProps {
  track: ApiTrack;
  isSelected: boolean;
  onSelect: () => void;
  onFileDrop: (files: File[]) => void;
  onRemove: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  /** From MediaBucket's useActiveOrganizeDrag — null when no organize drag is active. */
  activeDrag: ActiveOrganizeDrag | null;
  /** Finder-drag spring (useNativeSpringLoadedRows) — undefined for the selected Track. */
  nativeHold?: NativeFileHold;
}

function TrackFolderRow({ track, isSelected, onSelect, onFileDrop, onRemove, buttonRef, activeDrag, nativeHold }: TrackFolderRowProps) {
  const nativeDrop = useNativeFileDrop({ onDrop: onFileDrop, hold: nativeHold });
  // Any content beneath the track counts — an organized clip in any of its ideas,
  // OR a Track-scoped loose file resting below the Section list (not yet organized
  // into a clip). See ApiTrack.hasLooseFiles / storage.getBucket.
  const hasFiles = track.ideas.some(i => i.clips.length > 0) || track.hasLooseFiles;
  const trackHasNew = track.ideas.some(i => i.active && i.hasNew);
  // The row is always an ENABLED droppable, and highlights only when it accepts the
  // active drag (organizeDropRules.trackRow). A loose file already scoped to THIS
  // track is not accepted — the row still wins collision over the Tracks-column
  // background (which would otherwise un-assign the file) but shows no highlight,
  // and handleDragEnd in use-loose-file-organize-dnd.ts treats the drop as a cancel
  // — no mutation, file stays put. Disabling it instead made dnd-kit skip the row
  // and let the drop fall through to the background. A plain Tracks-column file
  // (trackId null) or one scoped to a DIFFERENT track is a normal assign target.
  //
  // The active drag comes in as a prop (MediaBucket calls useActiveOrganizeDrag
  // once) rather than via useDndContext here — useDndContext's value changes on every
  // pointer move during any drag, which re-rendered every Track row each frame.
  const target: TrackDropTarget = { trackId: track.id, songId: track.songId, trackName: track.name };
  const accepts = organizeDropRules.trackRow(activeDrag, target);
  const dropId = bucketTrackDropId(track.id);
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: target,
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
          {...nativeDrop.handlers}
          {...springRowAttrs(dropId)}
          className={cn(
            "w-full flex items-center justify-between p-2 rounded text-xs transition-all border border-transparent",
            isSelected
              ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]"
              // Plain hover is off during any drag (DRAG_SURFACE_ROW_HOVER).
              : cn("text-muted-foreground", DRAG_SURFACE_ROW_HOVER),
            // No glow unless the row accepts the drag — e.g. the own-track row for a
            // shelf file is a cancel (see handleDragEnd), so it must not advertise it.
            ((isOver && accepts) || nativeDrop.isOver) && NATIVE_DROP_ROW_CLASS
          )}
        >
          <div className="flex items-center gap-2">
            <Folder
              size={14}
              className={isSelected ? "text-primary" : "text-muted-foreground"}
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
          onClick={onRemove}
        >
          Remove Track
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MediaBucketProps {
  songId: string;
  onAddToTimeline?: (clip: Clip, trackId?: string) => void;
  /** Arrangement/Production mode tab switcher, rendered left-aligned in the toolbar row */
  modeTabs?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaBucket({ songId, onAddToTimeline, modeTabs }: MediaBucketProps) {
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [addSectionError, setAddSectionError] = useState<string | null>(null);
  const [isAddInstrumentOpen, setIsAddInstrumentOpen] = useState(false);
  const [newInstrumentName, setNewInstrumentName] = useState('');
  const [addInstrumentError, setAddInstrumentError] = useState<string | null>(null);
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

  // Song name for the Finder-drop toast of a song-level loose file. Same key (and
  // cache entry) Workspace and SongHome already fill.
  const { data: song } = useQuery<{ name: string }>({
    queryKey: ['song', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}`).then(r => r.json()),
  });

  const { data: looseFiles = [] } = useQuery<ApiLooseFile[]>({
    queryKey: looseFileKeys.list(songId),
    queryFn: () => fetchLooseFiles(songId),
    ...liveCommentRefetch,
  });

  // Track-scoped resting tier — files dragged off the Tracks column onto this
  // specific Track row, not yet organized into a Section. Rendered below the
  // Section list in Column 2.
  const { data: trackLooseFiles = [] } = useQuery<ApiLooseFile[]>({
    queryKey: looseFileKeys.byTrack(selectedTrack?.id),
    queryFn: () => fetchTrackLooseFiles(selectedTrack!.id),
    enabled: !!selectedTrack?.id,
    ...liveCommentRefetch,
  });

  // Keeps the BucketClip comment badges current (one observer for the whole bucket).
  useLiveClipCommentSummary(songId);

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
    // A link that names one file — ?file= (Add to Song / Promote to Song toasts) or
    // ?clipId= (comment feed rows) — scrolls it into view and flashes it once its
    // section's Files column renders it (shared landing flash, see BucketClip).
    const linkedClipId = urlFile ?? urlClipId;
    if (linkedClipId) {
      const linkedIdea = tracks.flatMap(t => t.ideas).find(i => i.clips.some(c => c.id === linkedClipId));
      if (linkedIdea) requestLandingFlash([{ id: linkedClipId, zone: clipLandingZone(linkedIdea.id) }]);
    }
    // Arrival params are one-shot: consume them so a refresh, the Arrangement/Production
    // switch (which copies the query string) or a later remount never re-triggers them.
    // replaceState adds no history entry and leaves the pathname (wouter's `location`)
    // alone, so no [location] effect re-runs. instrument/section stay — Timeline still
    // reads section to scroll once its layout loads.
    if (params.has('clipId') || params.has('openComments') || params.has('file')) {
      params.delete('clipId');
      params.delete('openComments');
      params.delete('file');
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
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
  // Not while a spring holds it: a drag that springs a Track or Section open sets
  // springViewHeldRef, and nothing is marked until the drag settles
  // (onSpringSettled clears it and bumps viewSettleNonce). Then the section still
  // selected is marked if it differs from the last one seen outside a spring — the
  // sprung section when the drop kept it, nothing when the restore put the
  // drag-start section back.
  const springViewHeldRef = useRef(false);
  const lastSeenIdeaIdRef = useRef<string | null>(null);
  const [viewSettleNonce, setViewSettleNonce] = useState(0);

  useEffect(() => {
    if (springViewHeldRef.current) return;
    const id = selectedIdea?.id ?? null;
    if (id && id !== lastSeenIdeaIdRef.current) viewIdeaMutation.mutate(id);
    lastSeenIdeaIdRef.current = id;
  }, [selectedIdea?.id, viewSettleNonce]);

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

  // Per-track: brings the section back for the selected track only (the hidden list
  // is that track's).
  const restoreSectionMutation = useRestoreSection(songId, {
    onSuccess: () => { setIsAddSectionOpen(false); },
    onError: (msg) => setAddSectionError(msg),
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

  // Finder file drops (useNativeFileDrop) upload immediately, no dialog
  // (startDropUpload — progress and Undo live in a toast). A drop carries its own
  // destination: Section row / Files column → a real clip in that section; Track
  // row / Sections-column background → a loose file on that Track; Tracks-column
  // background → a song-level loose file. The drop selects the destination now;
  // nothing moves the selection when the upload finishes. Native drag events and
  // dnd-kit's pointer-sensor drags are independent mechanisms that never intercept
  // each other.
  const handleIdeaFileDrop = (files: File[], idea: ApiIdea, track: ApiTrack) => {
    const audioFiles = takeAudioFiles(files);
    if (!audioFiles.length) return;
    startDropUpload({
      files: audioFiles,
      destination: { kind: 'placed', songId, ideaId: idea.id },
      label: `${track.name} › ${idea.sectionName}`,
    });
    setSelectedTrack(track);
    setSelectedIdea(idea);
  };

  const handleTrackFileDrop = (files: File[], track: ApiTrack) => {
    const audioFiles = takeAudioFiles(files);
    if (!audioFiles.length) return;
    startDropUpload({
      files: audioFiles,
      destination: { kind: 'loose', songId, trackId: track.id },
      label: track.name,
    });
    if (selectedTrack?.id !== track.id) { setSelectedTrack(track); setSelectedIdea(null); }
  };

  const handleTracksFileDrop = (files: File[]) => {
    const audioFiles = takeAudioFiles(files);
    if (!audioFiles.length) return;
    startDropUpload({
      files: audioFiles,
      destination: { kind: 'loose', songId, trackId: null },
      label: song?.name ?? 'this song',
    });
  };

  const tracksColumnDrop = useNativeFileDrop({ onDrop: handleTracksFileDrop });
  // No Track selected → catch and discard (no highlight, no toast): the drop has
  // no destination, but the browser must still never open the file.
  const sectionsColumnDrop = useNativeFileDrop({
    enabled: !!selectedTrack,
    onDrop: (files) => { if (selectedTrack) handleTrackFileDrop(files, selectedTrack); },
  });
  const filesColumnDrop = useNativeFileDrop({
    enabled: !!selectedIdea && !!selectedTrack,
    onDrop: (files) => { if (selectedIdea && selectedTrack) handleIdeaFileDrop(files, selectedIdea, selectedTrack); },
  });

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
  // The active organize drag (loose file or version), read once here and passed to
  // every row — see organizeDropRules for what each target accepts.
  const activeDrag = useActiveOrganizeDrag();

  // Same SectionDropTarget as the selected section's own row.
  const filesColumnTarget: SectionDropTarget | null = selectedIdea && selectedTrack
    ? {
        trackId: selectedIdea.trackId, sectionName: selectedIdea.sectionName, ideaId: selectedIdea.id,
        songId, isFullTake: selectedIdea.isFullTake ?? false, trackName: selectedTrack.name,
      }
    : null;
  const { setNodeRef: setVersionsDroppableRef, isOver: isVersionsOver } = useDroppable({
    id: bucketVersionsDropId('media-bucket-files-column'),
    disabled: !filesColumnTarget,
    data: filesColumnTarget ?? undefined,
  });
  // Same node, also held for the spring-open flash when a Section springs open. The
  // column div never unmounts on a section change (only its contents swap).
  const filesColumnRef = useRef<HTMLDivElement | null>(null);
  const setFilesColumnRef = useCallback((node: HTMLDivElement | null) => {
    filesColumnRef.current = node;
    setVersionsDroppableRef(node);
  }, [setVersionsDroppableRef]);
  // A version drag starts INSIDE this column, so isOver is true from its first
  // frame — only the rule decides whether that means anything (its own section
  // never accepts it).
  const isVersionsDropTarget = isVersionsOver && organizeDropRules.filesColumn(activeDrag, filesColumnTarget);

  // Sections-column background organize drop target — a second entry point onto the
  // exact same Track-scoped resting tier as a Track row's own droppable (identical
  // { trackId } data, routed to the identical assign-track mutation in the shared
  // hook). Scoped to whichever Track is currently selected, since that's the same
  // Track whose Section rows/Sections-column list are visible here. Same stable-
  // suffix-id fix as the Versions column above (not derived from selectedTrack.id) —
  // deriving it from the selection would re-key the registration on every track
  // switch and risk a drop silently missing on a freshly-selected track.
  //
  // Geometrically nests every Section row inside this same column, so a Section-row
  // hit must always win over this one — handled in matchOrganizeDropTarget itself
  // (background matches are remembered but not returned until every other organize
  // target has been checked), not here.
  const sectionsBackgroundTarget: TrackDropTarget | null = selectedTrack
    ? { trackId: selectedTrack.id, songId, trackName: selectedTrack.name }
    : null;
  const { setNodeRef: setSectionsBackgroundDroppableRef, isOver: isSectionsBackgroundOver } = useDroppable({
    id: bucketSectionsBackgroundDropId('media-bucket-sections-column'),
    disabled: !selectedTrack,
    data: sectionsBackgroundTarget ?? undefined,
  });
  // Same node, also held for the spring-open flash. The column div never unmounts
  // on a track change (only its contents swap), so the animation isn't lost.
  const sectionsColumnRef = useRef<HTMLDivElement | null>(null);
  const setSectionsColumnRef = useCallback((node: HTMLDivElement | null) => {
    sectionsColumnRef.current = node;
    setSectionsBackgroundDroppableRef(node);
  }, [setSectionsBackgroundDroppableRef]);

  // Tracks-column background drop target — the reverse of a Track-row drop: a
  // Track-scoped loose file dropped here has its trackId cleared and returns to the
  // plain song-scoped shelf in this column (see useUnassignLooseFileTrack). Enabled
  // ONLY while the active drag is a Track-scoped loose file (organizeDropRules.
  // tracksBackground decides both enabled and highlight) — disabled for a plain
  // Tracks-column file (already here, nothing to un-assign) and for every other drag
  // type, including bucket-clip drags from the Versions column (dnd-kit excludes
  // disabled droppables from collision detection entirely, so those drags can't be
  // swallowed by this target). Stable id suffix, same reasoning as the Versions and
  // Sections-background targets above.
  //
  // Nests every Track row; Track rows win via matchOrganizeDropTarget's background
  // fallback, same as the Sections background vs. Section rows.
  const tracksBackgroundTarget: TracksDropTarget = { unassign: true, songId };
  const isTracksBackgroundDisabled = !organizeDropRules.tracksBackground(activeDrag, tracksBackgroundTarget);
  const { setNodeRef: setTracksBackgroundDroppableRef, isOver: isTracksBackgroundOver } = useDroppable({
    id: bucketTracksBackgroundDropId('media-bucket-tracks-column'),
    disabled: isTracksBackgroundDisabled,
    data: tracksBackgroundTarget,
  });
  // isOver doesn't know about `disabled` — gate the highlight on both.
  const isTracksBackgroundDropTarget = isTracksBackgroundOver && !isTracksBackgroundDisabled;

  // Spring-loaded Track and Section rows: resting a drag on a Track row opens it,
  // exactly like a click (selects the Track, clears the Section) and flashes the
  // Sections column; resting on a Section row of the selected Track selects that
  // section, as a click does, and flashes the Files column. The selection is this
  // component's own state, so it's set directly. A drag that ends without moving
  // the file puts the drag-start Track + Section back (by id, re-resolved from
  // fresh bucket data), with the same setters. Every spring holds off "mark
  // viewed" until the drag settles (see springViewHeldRef). The same options drive
  // both the in-app (dnd-kit) spring and the Finder-drag spring (nativeHolds,
  // passed to each TrackFolderRow and SectionFolderRow).
  const springOptions: SpringLoadedRowsOptions<{ trackId: string | null; ideaId: string | null }> = {
    selectedTrackId: selectedTrack?.id ?? null,
    selectedSectionId: selectedIdea?.id ?? null,
    onOpenTrack: (trackId) => {
      const track = tracksRef.current.find(t => t.id === trackId);
      if (track) {
        springViewHeldRef.current = true;
        setSelectedTrack(track); setSelectedIdea(null);
        flashSpringOpenedColumn(sectionsColumnRef.current);
      }
    },
    onOpenSection: (ideaId) => {
      const idea = tracksRef.current.find(t => t.id === selectedTrack?.id)?.ideas.find(i => i.id === ideaId);
      if (idea) {
        springViewHeldRef.current = true;
        setSelectedIdea(idea);
        flashSpringOpenedColumn(filesColumnRef.current);
      }
    },
    captureSelection: () => ({ trackId: selectedTrack?.id ?? null, ideaId: selectedIdea?.id ?? null }),
    restoreSelection: ({ trackId, ideaId }) => {
      const track = trackId ? tracksRef.current.find(t => t.id === trackId) ?? null : null;
      setSelectedTrack(track);
      setSelectedIdea(track && ideaId ? track.ideas.find(i => i.id === ideaId) ?? null : null);
    },
    onSpringSettled: () => {
      if (!springViewHeldRef.current) return;
      springViewHeldRef.current = false;
      setViewSettleNonce(n => n + 1);
    },
  };
  useSpringLoadedRows(springOptions);
  const nativeHolds = useNativeSpringLoadedRows(springOptions);

  // Sections-background highlight (organizeDropRules.sectionsBackground): no glow when
  // the dragged file is already scoped to the selected track — that drop is a cancel
  // in handleDragEnd — and none for a version yet. Highlight-only; the droppable
  // itself stays enabled so collision behavior is unchanged.
  const isSectionsBackgroundDropTarget =
    isSectionsBackgroundOver && organizeDropRules.sectionsBackground(activeDrag, sectionsBackgroundTarget);

  // data-dnd-active on the root during any drag — rows drop their plain hover.
  const dragSurfaceAttrs = useDragSurfaceAttrs();

  // One More Info / Add Note window for every loose-file row in this bucket.
  const looseFileInfo = useLooseFileInfoWindow();

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <LooseFileInfoProvider value={looseFileInfo.open}>
    {/* data-media-bucket: Timeline's collision detection skips timeline track rows and
        gap zones while the pointer is inside these bounds (see trackFirstCollision). */}
    <div data-media-bucket="" {...dragSurfaceAttrs} className={cn('w-full flex-1 border-b border-border bg-sidebar/80 backdrop-blur-xl flex flex-col z-20 min-h-0', DRAG_SURFACE_GROUP)}>

      {/* Header */}
      <div className={cn('flex items-center px-6 h-14 border-b border-white/5 shrink-0', modeTabs ? 'justify-between' : 'justify-end')}>
        {modeTabs}
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
            onClick={() => setIsUploadOpen(true)}
          >
            <Upload size={14} className="mr-2" /> Upload
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden divide-x divide-white/5">

        {/* ── Instruments column ── */}
        <div
          ref={setTracksBackgroundDroppableRef}
          className={cn('w-1/4 flex flex-col transition-colors', isTracksBackgroundDropTarget && 'bg-primary/5', tracksColumnDrop.isOver && NATIVE_DROP_COLUMN_CLASS)}
          {...tracksColumnDrop.handlers}
        >
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/header">
            <span>Tracks</span>
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
                  onClick={() => setIsUploadOpen(true)}
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
                .map(track => (
                  <TrackFolderRow
                    key={track.id}
                    track={track}
                    isSelected={selectedTrack?.id === track.id}
                    onSelect={() => { setSelectedTrack(track); setSelectedIdea(null); }}
                    onFileDrop={(files) => handleTrackFileDrop(files, track)}
                    onRemove={() => deleteTrackMutation.mutate(track.id)}
                    buttonRef={selectedTrack?.id === track.id ? selectedTrackRef : undefined}
                    activeDrag={activeDrag}
                    nativeHold={nativeHolds.trackHold(track.id)}
                  />
                ))}
              {looseFiles.map(lf => (
                <LooseFileRow key={lf.id} looseFile={lf} songId={songId} />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* ── Sections column ── */}
        <div
          ref={setSectionsColumnRef}
          className={cn('w-1/4 flex flex-col bg-black/10 transition-colors', isSectionsBackgroundDropTarget && 'bg-primary/5', sectionsColumnDrop.isOver && NATIVE_DROP_COLUMN_CLASS)}
          {...sectionsColumnDrop.handlers}
        >
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
              {selectedTrack ? (
                <>
                  {filteredIdeas.map(idea => (
                    <SectionFolderRow
                      key={idea.id}
                      idea={idea}
                      isSelected={selectedIdea?.id === idea.id}
                      onSelect={() => setSelectedIdea(idea)}
                      onFileDrop={(files) => handleIdeaFileDrop(files, idea, selectedTrack)}
                      onRemove={() => hideIdeaMutation.mutate(idea.id)}
                      buttonRef={selectedIdea?.id === idea.id ? selectedIdeaRef : undefined}
                      activeDrag={activeDrag}
                      songId={songId}
                      trackName={selectedTrack.name}
                      nativeHold={nativeHolds.sectionHold(idea.id)}
                    />
                  ))}
                  {/* Track-scoped resting tier — dragged off the Tracks column onto this
                      Track row, not yet organized into a Section. Always sorted below
                      the Section list. */}
                  {trackLooseFiles.map(lf => (
                    <LooseFileRow key={lf.id} looseFile={lf} songId={songId} />
                  ))}
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                  Select an instrument to view sections
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Versions column ── */}
        <div
          ref={setFilesColumnRef}
          className={cn('flex-1 flex flex-col bg-black/20 transition-colors', isVersionsDropTarget && 'bg-primary/5', filesColumnDrop.isOver && NATIVE_DROP_COLUMN_CLASS)}
          {...filesColumnDrop.handlers}
        >
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
            Files
          </div>
          {selectedIdea && filteredVersions.length === 0 && !searchQuery ? (
            /* Empty state — rendered outside ScrollArea so h-full fills the column */
            <div className="flex-1 p-2">
              <div className={cn(
                'flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors',
                filesColumnDrop.isOver ? 'border-primary/50 bg-primary/5' : 'border-white/[0.08]'
              )}>
                <Upload size={18} className={cn('mb-2', filesColumnDrop.isOver ? 'text-primary/60' : 'text-white/15')} />
                <p className={cn('text-[10px] uppercase tracking-widest mb-1', filesColumnDrop.isOver ? 'text-primary/70' : 'text-muted-foreground/50')}>
                  No files yet
                </p>
                <p className="text-[10px] text-muted-foreground/30">Drop audio files or use Upload above</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {selectedIdea ? (
                  <>
                  {filteredVersions.length === 0 && searchQuery ? (
                    <div className="flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                      No files match your search
                    </div>
                  ) : (
                    filteredVersions.map(clip => (
                      <BucketClip
                        key={clip.id}
                        clip={apiClipToClip({ ...clip, isFullTake: selectedIdea?.isFullTake ?? false })}
                        trackId={selectedTrack?.id}
                        trackName={selectedTrack?.name}
                        songId={songId}
                        onAddToTimeline={onAddToTimeline}
                        autoOpenInfo={clip.id === autoOpenClipId}
                        onAutoOpenHandled={() => setAutoOpenClipId(null)}
                      />
                    ))
                  )}
                  </>
                ) : (
                  <div className="flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                    Select a section to view or add files
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

      </div>

      {/* Upload button and Tracks "Add Files" only — song-level loose files. Finder
          drops upload without a dialog (startDropUpload). */}
      <UploadModal
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        songId={songId}
        mode="loose"
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
            setAddInstrumentError('A track with this name already exists');
            return;
          }
          const hiddenMatch = hiddenTracks.find(t => t.name.trim().toLowerCase() === name.toLowerCase());
          if (hiddenMatch) {
            setAddInstrumentError(`A track named "${name}" already exists. It's currently hidden — restore it using the option below.`);
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
        onRestoreSection={(id) => restoreSectionMutation.mutate(id)}
        isRestoring={restoreSectionMutation.isPending}
      />
      {looseFileInfo.infoWindow}
    </div>
    </LooseFileInfoProvider>
  );
}
