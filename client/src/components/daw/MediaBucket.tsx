import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import { type Clip } from '@/lib/daw-data';
import { type ApiClip, type ApiIdea, type ApiTrack, fetchBucket, bucketKeys } from '@/lib/bucket-api';
import { BucketClip } from './Clip';
import {
  ChevronRight, Folder, Music, Library, Search,
  Upload, FileAudio, X, Plus, Loader2, AlertCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from '@/components/ui/context-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ─── API helpers ──────────────────────────────────────────────────────────────

async function uploadFile(
  file: File,
  instrument: string,
  section: string,
  ideaId: string,
): Promise<{ url: string; duration: number; format: string; originalFileName: string; sampleRate: string; bitDepth: string; channels: string; uploadedDate: string; uploadedBy: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('instrument', instrument);
  form.append('section', section);
  form.append('ideaId', ideaId);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(err.message ?? 'Upload failed');
  }
  return res.json();
}

async function createClip(ideaId: string, payload: {
  id: string;
  name: string;
  type: string;
  color: string;
  duration: number;
  src: string;
  sectionName: string;
  isFinal: boolean;
  metadata: Record<string, unknown>;
}): Promise<ApiClip> {
  const res = await fetch(`/api/ideas/${ideaId}/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ideaId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to save clip' }));
    throw new Error(err.message ?? 'Failed to save clip');
  }
  return res.json();
}

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
    sectionName: apiClip.sectionName ?? undefined,
    metadata: apiClip.metadata as unknown as Clip['metadata'],
  };
}

// ─── UploadModal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: string;
  defaultIdeaId?: string;
  defaultInstrumentName?: string;
  defaultSectionName?: string;
  initialFiles?: File[];
  songType?: 'song' | 'idea';
  onUploadSuccess?: (result: { destTrackId: string; destIdeaId: string }) => void;
}

export function UploadModal({
  open, onOpenChange, songId,
  defaultIdeaId, defaultInstrumentName, defaultSectionName,
  initialFiles, songType = 'song', onUploadSuccess,
}: UploadModalProps) {
  const queryClient = useQueryClient();
  const [uploadFiles, setUploadFiles] = useState<{ name: string; size: string; file: File }[]>([]);
  const [uploadDestination, setUploadDestination] = useState(defaultIdeaId ?? '');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tracks = [] } = useQuery<ApiTrack[]>({
    queryKey: bucketKeys.bucket(songId),
    queryFn: () => fetchBucket(songId),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setUploadDestination(defaultIdeaId ?? '');
      setUploadError(null);
      if (initialFiles?.length) {
        setUploadFiles(initialFiles.map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f })));
      }
    } else {
      setUploadFiles([]);
      setUploadDestination('');
      setUploadError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('audio/'))
      .map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f }));
    setUploadFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files).map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f }));
    setUploadFiles(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const destId = uploadDestination;
      if (!destId || uploadFiles.length === 0) return;
      setUploadError(null);
      let destTrack: ApiTrack | null = null;
      let destIdea: ApiIdea | null = null;
      for (const t of tracks) {
        const idea = t.ideas.find(i => i.id === destId);
        if (idea) { destTrack = t; destIdea = idea; break; }
      }
      if (!destTrack || !destIdea) throw new Error('Destination not found');
      const usingDefault = defaultIdeaId && uploadDestination === defaultIdeaId;
      const instrumentForUpload = (usingDefault && defaultInstrumentName) ? defaultInstrumentName : destTrack.name;
      const sectionForUpload = (usingDefault && defaultSectionName) ? defaultSectionName : destIdea.sectionName;
      for (const { file } of uploadFiles) {
        const { url, duration, format, originalFileName, sampleRate, bitDepth, channels, uploadedDate, uploadedBy } =
          await uploadFile(file, instrumentForUpload, sectionForUpload, destIdea.id);
        const versionNum = destIdea.clips.length + 1;
        const clipName = songType === 'idea'
          ? (originalFileName || file.name)
          : `${destTrack.name} ${destIdea.sectionName} V${versionNum}`;
        await createClip(destIdea.id, {
          id: nanoid(),
          name: clipName,
          type: destTrack.type === 'vocal' ? 'vocal' : 'audio',
          color: destTrack.color ?? 'hsl(var(--primary))',
          duration, src: url, sectionName: destIdea.sectionName, isFinal: false,
          metadata: {
            format, originalFileName, uploadedBy, uploadedDate, sampleRate, bitDepth,
            channels: (channels as 'Mono' | 'Stereo' | '5.1') || 'Stereo',
            peakLevel: '', timeSignature: '', key: '', bpm: 0, description: '', tags: [],
          },
        });
        destIdea = { ...destIdea, clips: [...destIdea.clips, {} as ApiClip] };
      }
      return { destTrackId: destTrack.id, destIdeaId: destId };
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      onOpenChange(false);
      setUploadFiles([]);
      setUploadDestination('');
      onUploadSuccess?.(result);
    },
    onError: (err: Error) => setUploadError(err.message),
  });

  const isPrefilled = !!defaultIdeaId;

  return (
    <Dialog open={open} onOpenChange={open => {
      onOpenChange(open);
      if (!open) { setUploadFiles([]); setUploadDestination(defaultIdeaId ?? ''); setUploadError(null); }
    }}>
      <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-xl p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
          <DialogTitle className="text-sm uppercase tracking-widest font-heading">Asset Ingestion</DialogTitle>
          <p className="text-[10px] text-muted-foreground mt-1 uppercase">Drop files to add them to the project</p>
        </div>
        <div className="p-6 space-y-6">
          {/* Destination — show static label for idea uploads; full dropdown for song uploads */}
          {songType === 'idea' ? (
            defaultInstrumentName && (
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Uploading to</label>
                <p className="text-xs text-white/80 font-medium px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-md">
                  {defaultInstrumentName}{defaultSectionName ? ` → ${defaultSectionName}` : ''}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Destination Section</label>
              <Select value={uploadDestination} onValueChange={setUploadDestination}>
                <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9">
                  <SelectValue placeholder="Select Destination" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-64 overflow-y-auto">
                  {tracks.flatMap(track =>
                    track.ideas.map(idea => (
                      <SelectItem key={idea.id} value={idea.id} className="text-xs">
                        {track.name} → {idea.sectionName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/10 rounded-xl p-10 flex flex-col items-center justify-center gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
          >
            <input type="file" ref={fileInputRef} className="hidden" multiple accept="audio/*" onChange={handleFileSelect} />
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Upload size={24} className="text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">Click or drag audio files here</p>
              <p className="text-xs text-muted-foreground mt-1">WAV, AIFF, or MP3 up to 50MB</p>
            </div>
          </div>
          {uploadFiles.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] uppercase font-bold text-muted-foreground">
                Pending Uploads ({uploadFiles.length})
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10">
                {uploadFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileAudio size={16} className="text-primary" />
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-white">{f.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{f.size}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}>
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-white/5 flex justify-end">
                <Button
                  className="h-9 uppercase tracking-widest text-[10px] font-bold"
                  onClick={() => uploadMutation.mutate()}
                  disabled={!uploadDestination || uploadFiles.length === 0 || uploadMutation.isPending}
                >
                  {uploadMutation.isPending
                    ? <><Loader2 size={14} className="mr-2 animate-spin" />Uploading…</>
                    : 'Confirm Ingestion'}
                </Button>
              </div>
              {uploadError && (
                <div className="flex items-center gap-2 text-[10px] text-red-400 pt-1">
                  <AlertCircle size={12} /> {uploadError}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MediaBucketProps {
  songId: string;
  onAddToTimeline?: (clip: Clip) => void;
  onInstrumentAdded?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaBucket({ songId, onAddToTimeline, onInstrumentAdded }: MediaBucketProps) {
  const queryClient = useQueryClient();

  const [selectedTrack, setSelectedTrack] = useState<ApiTrack | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<ApiIdea | null>(null);
  const [autoOpenClipId, setAutoOpenClipId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadInitialIdeaId, setUploadInitialIdeaId] = useState('');
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [addSectionError, setAddSectionError] = useState<string | null>(null);
  const [isAddInstrumentOpen, setIsAddInstrumentOpen] = useState(false);
  const [newInstrumentName, setNewInstrumentName] = useState('');
  const [addInstrumentError, setAddInstrumentError] = useState<string | null>(null);
  const [selectedHiddenIdeaId, setSelectedHiddenIdeaId] = useState('');
  const [selectedHiddenTrackId, setSelectedHiddenTrackId] = useState('');
  const [isVersionsDragOver, setIsVersionsDragOver] = useState(false);
  const sessionRestored = useRef(false);
  const tracksRef = useRef<ApiTrack[]>([]);
  const [location] = useLocation();

  // ── Fetch bucket from API ────────────────────────────────────────────────────

  const { data: tracks = [], isLoading, isError } = useQuery<ApiTrack[]>({
    queryKey: bucketKeys.bucket(songId),
    queryFn: () => fetchBucket(songId),
  });

  const { data: songData } = useQuery<{ name: string }>({
    queryKey: ['song', songId],
    queryFn: () => fetch(`/api/songs/${songId}`).then(r => r.json()),
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

  // ── Add section mutation — creates the idea on every track simultaneously ────

  const addSectionMutation = useMutation({
    mutationFn: async (sectionName: string) => {
      setAddSectionError(null);
      await Promise.all(
        tracks.map((track, i) =>
          fetch(`/api/tracks/${track.id}/ideas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${track.name} ${sectionName}`,
              sectionName,
              sortOrder: track.ideas.length + i,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({ message: 'Failed to create section' }));
              throw new Error(err.message ?? 'Failed to create section');
            }
            return res.json();
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setIsAddSectionOpen(false);
      setNewSectionName('');
    },
    onError: (err: Error) => {
      setAddSectionError(err.message);
    },
  });

  // ── Add instrument mutation ──────────────────────────────────────────────────

  const addInstrumentMutation = useMutation({
    mutationFn: async (name: string) => {
      setAddInstrumentError(null);
      const res = await fetch(`/api/songs/${songId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to create instrument' }));
        throw new Error(err.message ?? 'Failed to create instrument');
      }
      return res.json() as Promise<ApiTrack>;
    },
    onSuccess: (newTrack) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setIsAddInstrumentOpen(false);
      setNewInstrumentName('');
      // Auto-select the new instrument after refetch
      queryClient.fetchQuery<ApiTrack[]>({ queryKey: bucketKeys.bucket(songId), queryFn: () => fetchBucket(songId) }).then(fresh => {
        const track = fresh.find(t => t.id === newTrack.id);
        if (track) { setSelectedTrack(track); setSelectedIdea(null); }
      });
      onInstrumentAdded?.();
    },
    onError: (err: Error) => {
      setAddInstrumentError(err.message);
    },
  });

  // ── Delete track mutation ────────────────────────────────────────────────────

  const deleteTrackMutation = useMutation({
    mutationFn: async (trackId: string) => {
      const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        throw new Error(err.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenTracks(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setSelectedTrack(null);
      setSelectedIdea(null);
    },
    onError: (err: Error) => {
      console.error('[removeInstrument] error:', err.message);
    },
  });

  const restoreTrackMutation = useMutation({
    mutationFn: (trackId: string) =>
      fetch(`/api/tracks/${trackId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenTracks(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      setSelectedHiddenTrackId('');
      setIsAddInstrumentOpen(false);
    },
  });

  // ── Delete section mutation ──────────────────────────────────────────────────

  const deleteSectionMutation = useMutation({
    mutationFn: async ({ sectionName }: { sectionName: string }) => {
      const res = await fetch(`/api/songs/${songId}/sections/${encodeURIComponent(sectionName)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        throw new Error(err.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setSelectedIdea(null);
    },
    onError: (err: Error) => {
      console.error('[removeSection] error:', err.message);
    },
  });

  const restoreSectionMutation = useMutation({
    mutationFn: (ideaId: string) =>
      fetch(`/api/ideas/${ideaId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenIdeas(selectedTrack?.id) });
      setSelectedHiddenIdeaId('');
      setIsAddSectionOpen(false);
    },
  });

  // ── File input helpers ───────────────────────────────────────────────────────

  const handleIdeaFileDrop = (e: React.DragEvent, idea: ApiIdea, track: ApiTrack) => {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
    if (!e.dataTransfer.files?.length) return;
    const audioFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (!audioFiles.length) return;
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

  const filteredVersions = selectedIdea
    ? selectedIdea.clips.filter(clip => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
          clip.name.toLowerCase().includes(q) ||
          (clip.metadata as any)?.originalFileName?.toLowerCase().includes(q)
        );
      })
    : [];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex-1 border-b border-border bg-sidebar/80 backdrop-blur-xl flex flex-col z-20 min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <Library size={18} className="text-primary" />
          <h2 className="text-sm font-heading font-bold uppercase tracking-widest text-white">
            Project: {songData?.name ?? '…'}
          </h2>
        </div>
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
            onClick={() => { setUploadInitialFiles([]); setUploadInitialIdeaId(''); setIsUploadOpen(true); }}
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
            <Dialog open={isAddInstrumentOpen} onOpenChange={(open) => {
              setIsAddInstrumentOpen(open);
              if (!open) { setNewInstrumentName(''); setAddInstrumentError(null); }
            }}>
              <DialogTrigger asChild>
                <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5">
                  <Plus size={12} />
                </button>
              </DialogTrigger>
              <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-sm uppercase tracking-widest font-heading">Add Instrument</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Instrument Name</label>
                    <Input
                      placeholder="e.g. Keys"
                      value={newInstrumentName}
                      onChange={(e) => setNewInstrumentName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newInstrumentName.trim()) {
                          addInstrumentMutation.mutate(newInstrumentName.trim());
                        }
                      }}
                      className="bg-black/40 border-white/10 text-xs h-9"
                      autoFocus
                    />
                    <p className="text-[9px] text-muted-foreground">
                      All default sections will be created automatically.
                    </p>
                  </div>
                  {addInstrumentError && (
                    <div className="flex items-center gap-2 text-[10px] text-red-400">
                      <AlertCircle size={12} /> {addInstrumentError}
                    </div>
                  )}
                  {hiddenTracks.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Restore a removed instrument</label>
                      <div className="flex gap-2">
                        <Select value={selectedHiddenTrackId} onValueChange={setSelectedHiddenTrackId}>
                          <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9 flex-1">
                            <SelectValue placeholder="Select instrument…" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border max-h-48 overflow-y-auto">
                            {hiddenTracks.map(track => (
                              <SelectItem key={track.id} value={track.id} className="text-xs">
                                {track.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="uppercase tracking-widest text-[10px] font-bold shrink-0"
                          onClick={() => selectedHiddenTrackId && restoreTrackMutation.mutate(selectedHiddenTrackId)}
                          disabled={!selectedHiddenTrackId || restoreTrackMutation.isPending}
                        >
                          {restoreTrackMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Restore'}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setIsAddInstrumentOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="uppercase tracking-widest text-[10px] font-bold"
                      onClick={() => newInstrumentName.trim() && addInstrumentMutation.mutate(newInstrumentName.trim())}
                      disabled={!newInstrumentName.trim() || addInstrumentMutation.isPending}
                    >
                      {addInstrumentMutation.isPending
                        ? <><Loader2 size={12} className="mr-1 animate-spin" /> Adding…</>
                        : 'Add Instrument'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
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
                  return (
                    <ContextMenu key={track.id}>
                      <ContextMenuTrigger asChild>
                        <button
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
                          <ChevronRight size={12} className="opacity-40" />
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
            </div>
          </ScrollArea>
        </div>

        {/* ── Sections column ── */}
        <div className="w-1/4 flex flex-col bg-black/10">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/header">
            <span>Sections</span>
            <Dialog open={isAddSectionOpen} onOpenChange={(open) => {
              setIsAddSectionOpen(open);
              if (!open) { setNewSectionName(''); setAddSectionError(null); }
            }}>
              <DialogTrigger asChild>
                <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5">
                  <Plus size={12} />
                </button>
              </DialogTrigger>
              <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-sm uppercase tracking-widest font-heading">Add Section</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Section Name</label>
                    <Input
                      placeholder="e.g. Pre-Chorus"
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSectionName.trim()) {
                          addSectionMutation.mutate(newSectionName.trim());
                        }
                      }}
                      className="bg-black/40 border-white/10 text-xs h-9"
                      autoFocus
                    />
                    <p className="text-[9px] text-muted-foreground">
                      This section will be added to all instrument tracks simultaneously.
                    </p>
                  </div>
                  {addSectionError && (
                    <div className="flex items-center gap-2 text-[10px] text-red-400">
                      <AlertCircle size={12} /> {addSectionError}
                    </div>
                  )}
                  {hiddenIdeas.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Restore a removed section</label>
                      <div className="flex gap-2">
                        <Select value={selectedHiddenIdeaId} onValueChange={setSelectedHiddenIdeaId}>
                          <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9 flex-1">
                            <SelectValue placeholder="Select section…" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border max-h-48 overflow-y-auto">
                            {hiddenIdeas.map(idea => (
                              <SelectItem key={idea.id} value={idea.id} className="text-xs">
                                {idea.sectionName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="uppercase tracking-widest text-[10px] font-bold shrink-0"
                          onClick={() => selectedHiddenIdeaId && restoreSectionMutation.mutate(selectedHiddenIdeaId)}
                          disabled={!selectedHiddenIdeaId || restoreSectionMutation.isPending}
                        >
                          {restoreSectionMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Restore'}
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setIsAddSectionOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="uppercase tracking-widest text-[10px] font-bold"
                      onClick={() => newSectionName.trim() && addSectionMutation.mutate(newSectionName.trim())}
                      disabled={!newSectionName.trim() || addSectionMutation.isPending}
                    >
                      {addSectionMutation.isPending
                        ? <><Loader2 size={12} className="mr-1 animate-spin" /> Adding…</>
                        : 'Add Section'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedTrack ? filteredIdeas.map(idea => {
                const hasFiles = idea.clips.length > 0;
                return (
                  <ContextMenu key={idea.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        onClick={() => setSelectedIdea(idea)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('bg-primary/10', 'border', 'border-primary/50');
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
                        }}
                        onDrop={(e) => handleIdeaFileDrop(e, idea, selectedTrack)}
                        className={cn(
                          "w-full flex items-center justify-between p-2 rounded text-xs transition-all border border-transparent",
                          selectedIdea?.id === idea.id
                            ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]"
                            : "text-muted-foreground hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Folder
                            size={14}
                            className={selectedIdea?.id === idea.id ? "text-primary" : "text-muted-foreground"}
                            fill={hasFiles ? "currentColor" : "none"}
                          />
                          <span className="font-bold tracking-tight">{idea.sectionName}</span>
                        </div>
                        <ChevronRight size={12} className="opacity-40" />
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="bg-popover border-border">
                      <ContextMenuItem
                        className="text-red-400 focus:text-red-400 focus:bg-red-400/10 text-xs"
                        onClick={() => deleteSectionMutation.mutate({ sectionName: idea.sectionName })}
                      >
                        Remove Section
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              }) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                  Select an instrument to view sections
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Versions column ── */}
        <div
          className="flex-1 flex flex-col bg-black/20"
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
                        clip={toClip(clip)}
                        trackId={selectedTrack?.id}
                        songId={songId}
                        onAddToTimeline={onAddToTimeline}
                        siblingClips={selectedIdea.clips.map(toClip)}
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
    </div>
  );
}
