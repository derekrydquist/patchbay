import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import { type Clip } from '@/lib/daw-data';
import { BucketClip } from './Clip';
import {
  ChevronRight, Folder, Music, User, Library, Search,
  Upload, FileAudio, X, Plus, Loader2, AlertCircle,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiClip {
  id: string;
  ideaId: string;
  name: string;
  type: string;
  color: string;
  start: number;
  duration: number;
  src: string | null;
  isFinal: boolean;
  sectionName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ApiIdea {
  id: string;
  trackId: string;
  name: string;
  sectionName: string;
  sortOrder: number;
  clips: ApiClip[];
}

interface ApiTrack {
  id: string;
  songId: string;
  name: string;
  type: string;
  color: string | null;
  sortOrder: number;
  ideas: ApiIdea[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const DEFAULT_SONG_ID = 'patchbay-default';

async function fetchBucket(): Promise<ApiTrack[]> {
  const res = await fetch(`/api/songs/${DEFAULT_SONG_ID}/bucket`);
  if (!res.ok) throw new Error('Failed to load bucket');
  return res.json();
}

async function uploadFile(
  file: File,
  instrument: string,
  section: string,
  ideaId: string,
): Promise<{ url: string; duration: number; format: string; originalFileName: string }> {
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface MediaBucketProps {
  onAddToTimeline?: (clip: Clip) => void;
  onInstrumentAdded?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaBucket({ onAddToTimeline, onInstrumentAdded }: MediaBucketProps) {
  const queryClient = useQueryClient();

  const [selectedTrack, setSelectedTrack] = useState<ApiTrack | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<ApiIdea | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<{ name: string; size: string; file: File }[]>([]);
  const [uploadDestination, setUploadDestination] = useState<string>(''); // ideaId
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [addSectionError, setAddSectionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [location] = useLocation();

  // ── Fetch bucket from API ────────────────────────────────────────────────────

  const { data: tracks = [], isLoading, isError } = useQuery<ApiTrack[]>({
    queryKey: ['bucket', DEFAULT_SONG_ID],
    queryFn: fetchBucket,
  });

  // ── Keep selected items in sync when data refreshes ─────────────────────────

  useEffect(() => {
    if (!tracks.length) return;
    if (selectedTrack) {
      const fresh = tracks.find(t => t.id === selectedTrack.id);
      setSelectedTrack(fresh ?? null);
      if (selectedIdea && fresh) {
        const freshIdea = fresh.ideas.find(i => i.id === selectedIdea.id);
        setSelectedIdea(freshIdea ?? null);
      }
    }
  }, [tracks]);

  // ── URL param context (instrument / section / file) ──────────────────────────

  useEffect(() => {
    if (!tracks.length) return;
    const params = new URLSearchParams(window.location.search);
    const urlInstrument = params.get('instrument');
    const urlSection = params.get('section');
    const urlFile = params.get('file');

    if (!urlInstrument && !urlSection && !urlFile) return;

    let targetTrack: ApiTrack | null = null;
    let targetIdea: ApiIdea | null = null;

    if (urlInstrument) {
      targetTrack = tracks.find(t => t.name.toLowerCase() === urlInstrument.toLowerCase()) ?? null;
    } else if (urlFile) {
      targetTrack = tracks.find(t => t.ideas.some(i => i.clips.some(c => c.id === urlFile))) ?? null;
    }

    if (targetTrack) {
      setSelectedTrack(targetTrack);
      if (urlSection) {
        targetIdea = targetTrack.ideas.find(i => i.sectionName.toLowerCase().includes(urlSection.toLowerCase())) ?? null;
      } else if (urlFile) {
        targetIdea = targetTrack.ideas.find(i => i.clips.some(c => c.id === urlFile)) ?? null;
      }
      setSelectedIdea(targetIdea);
    }
  }, [location, tracks]);

  // ── Upload mutation ──────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadDestination || uploadFiles.length === 0) return;
      setUploadError(null);

      // Find which track + idea the destination belongs to
      let destTrack: ApiTrack | null = null;
      let destIdea: ApiIdea | null = null;
      for (const t of tracks) {
        const idea = t.ideas.find(i => i.id === uploadDestination);
        if (idea) { destTrack = t; destIdea = idea; break; }
      }
      if (!destTrack || !destIdea) throw new Error('Destination not found');

      // Upload each file sequentially so version numbers increment correctly
      for (const { file } of uploadFiles) {
        const { url, duration, format, originalFileName } = await uploadFile(
          file,
          destTrack.name,
          destIdea.sectionName,
          destIdea.id,
        );

        // Count existing clips to name this version
        const existingCount = destIdea.clips.length;
        const versionNum = existingCount + 1;
        const clipName = `${destTrack.name} ${destIdea.sectionName} V${versionNum}`;

        await createClip(destIdea.id, {
          id: nanoid(),
          name: clipName,
          type: destTrack.type === 'vocal' ? 'vocal' : 'audio',
          color: destTrack.color ?? 'hsl(var(--primary))',
          duration,
          src: url,
          sectionName: destIdea.sectionName,
          isFinal: false,
          metadata: {
            format,
            originalFileName,
            uploadedBy: 'You',
            uploadedDate: new Date().toISOString().split('T')[0],
            sampleRate: '48kHz',
            bitDepth: '24-bit',
            timeSignature: '4/4',
            key: 'Unknown',
            bpm: 120,
            channels: 'Stereo',
            peakLevel: '-1.0 dBFS',
            description: `Uploaded file: ${originalFileName}`,
            tags: ['upload', 'raw'],
          },
        });

        // Optimistically update destIdea clip count for next iteration
        destIdea = { ...destIdea, clips: [...destIdea.clips, {} as ApiClip] };
      }

      return { destTrackId: destTrack.id, destIdeaId: uploadDestination };
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: ['bucket', DEFAULT_SONG_ID] });
      setIsUploadOpen(false);
      setUploadFiles([]);
      setUploadDestination('');

      // Auto-select the destination after refetch
      queryClient.fetchQuery<ApiTrack[]>({ queryKey: ['bucket', DEFAULT_SONG_ID], queryFn: fetchBucket }).then(fresh => {
        const track = fresh.find(t => t.id === result.destTrackId);
        if (track) {
          setSelectedTrack(track);
          const idea = track.ideas.find(i => i.id === result.destIdeaId);
          setSelectedIdea(idea ?? null);
        }
      });
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ['bucket', DEFAULT_SONG_ID] });
      setIsAddSectionOpen(false);
      setNewSectionName('');
    },
    onError: (err: Error) => {
      setAddSectionError(err.message);
    },
  });

  // ── File input helpers ───────────────────────────────────────────────────────

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).map(f => ({
      name: f.name,
      size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
      file: f,
    }));
    setUploadFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files).map(f => ({
      name: f.name,
      size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
      file: f,
    }));
    setUploadFiles(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const handleIdeaFileDrop = (e: React.DragEvent, idea: ApiIdea, track: ApiTrack) => {
    e.preventDefault();
    e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
    if (!e.dataTransfer.files?.length) return;
    const audioFiles = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('audio/'))
      .map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f }));
    if (!audioFiles.length) return;
    // Pre-fill the upload dialog
    setUploadFiles(audioFiles);
    setUploadDestination(idea.id);
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
            Project: Midnight Horizon
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

          {/* Upload dialog */}
          <Dialog open={isUploadOpen} onOpenChange={(open) => {
            setIsUploadOpen(open);
            if (!open) { setUploadFiles([]); setUploadDestination(''); setUploadError(null); }
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-[10px] uppercase tracking-widest font-bold">
                <Upload size={14} className="mr-2" /> Upload
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-xl p-0 overflow-hidden">
              <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
                <DialogTitle className="text-sm uppercase tracking-widest font-heading">Asset Ingestion</DialogTitle>
                <p className="text-[10px] text-muted-foreground mt-1 uppercase">Drop files to add them to the project</p>
              </div>
              <div className="p-6 space-y-6">
                {/* Drop zone */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-xl p-10 flex flex-col items-center justify-center gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    multiple
                    accept="audio/*"
                    onChange={handleFileSelect}
                  />
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload size={24} className="text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">Click or drag audio files here</p>
                    <p className="text-xs text-muted-foreground mt-1">WAV, AIFF, or MP3 up to 50MB</p>
                  </div>
                </div>

                {/* File list + destination */}
                {uploadFiles.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] uppercase font-bold text-muted-foreground">
                      Pending Uploads ({uploadFiles.length})
                    </h4>
                    <ScrollArea className="max-h-40 pr-4">
                      <div className="space-y-2">
                        {uploadFiles.map((f, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg">
                            <div className="flex items-center gap-3">
                              <FileAudio size={16} className="text-primary" />
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-white">{f.name}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{f.size}</span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}
                            >
                              <X size={14} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Destination Section</label>
                        <Select value={uploadDestination} onValueChange={setUploadDestination}>
                          <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9">
                            <SelectValue placeholder="Select Destination" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            {tracks.map(track => (
                              <React.Fragment key={track.id}>
                                <div className="px-2 py-1 text-[9px] uppercase font-bold text-primary opacity-50">
                                  {track.name}
                                </div>
                                {track.ideas.map(idea => (
                                  <SelectItem key={idea.id} value={idea.id} className="text-xs pl-4">
                                    {idea.sectionName}
                                  </SelectItem>
                                ))}
                              </React.Fragment>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <Button
                          className="w-full h-9 uppercase tracking-widest text-[10px] font-bold"
                          onClick={() => uploadMutation.mutate()}
                          disabled={!uploadDestination || uploadFiles.length === 0 || uploadMutation.isPending}
                        >
                          {uploadMutation.isPending
                            ? <><Loader2 size={14} className="mr-2 animate-spin" /> Uploading…</>
                            : 'Confirm Ingestion'}
                        </Button>
                      </div>
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
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden divide-x divide-white/5">

        {/* ── Instruments column ── */}
        <div className="w-1/4 flex flex-col">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
            Instruments
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
                    <button
                      key={track.id}
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
                  <button
                    key={idea.id}
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
          className="flex-1 flex flex-col bg-black/20 transition-all border border-transparent"
          onDragOver={(e) => {
            if (!selectedIdea || !selectedTrack) return;
            e.preventDefault();
            e.currentTarget.classList.add('bg-primary/5', 'border-primary/30');
          }}
          onDragLeave={(e) => {
            if (!selectedIdea || !selectedTrack) return;
            e.currentTarget.classList.remove('bg-primary/5', 'border-primary/30');
          }}
          onDrop={(e) => {
            if (!selectedIdea || !selectedTrack) return;
            handleIdeaFileDrop(e, selectedIdea, selectedTrack);
          }}
        >
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
            Versions
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedIdea ? (
                filteredVersions.length > 0
                  ? filteredVersions.map(clip => (
                      <BucketClip
                        key={clip.id}
                        clip={toClip(clip)}
                        trackId={selectedTrack?.id}
                        onAddToTimeline={onAddToTimeline}
                      />
                    ))
                  : (
                    <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                      {searchQuery ? 'No versions match your search' : 'No versions yet — drop a file here to upload'}
                    </div>
                  )
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                  Select a section to view or add versions
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Activity column ── */}
        <div className="w-1/5 flex flex-col bg-black/30 p-4 border-l border-white/5">
          <div className="text-[10px] uppercase tracking-tighter text-muted-foreground font-bold mb-4">Activity</div>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <User size={12} className="text-primary" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-white">Dave uploaded V2</span>
                <span className="text-[9px] text-muted-foreground uppercase">2 hours ago</span>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <User size={12} className="text-blue-400" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-white">Sarah added a note</span>
                <span className="text-[9px] text-muted-foreground uppercase">Yesterday</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
