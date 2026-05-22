import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { capitalize } from '@/lib/utils';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Music2, Lightbulb, Plus, Clock, X, MoreHorizontal, Trash2, ChevronRight, Circle, Search, ArrowUpDown, Check, Folder, Play, Pause, Upload, Info, MessageSquare, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ClipInfoWindow } from '@/components/daw/Clip';
import { Clip as DawClip } from '@/lib/daw-data';
import { AppHeader } from '@/components/AppHeader';

const DEFAULT_SECTIONS = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'];
const DEFAULT_INSTRUMENTS = ['Drums', 'Bass', 'Guitar 1', 'Guitar 2', 'Vocals'];

interface Song {
  id: string;
  name: string;
  bpm: number | null;
  sections: string[];
  type?: 'song' | 'idea';
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  songId: string;
  songName: string;
  instrument: string;
  sectionName: string;
  status: string;
  assignee: string;
  dueDate: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function activityUrl(event: ActivityEvent): string {
  const base = `/songs/${event.songId}/workspace`;
  const songBase = `/songs/${event.songId}`;
  if (event.type === 'status-change' && event.taskId) {
    return `${base}?tab=production&taskId=${event.taskId}`;
  }
  if (event.type === 'task-comment' && event.source === 'task' && event.taskId) {
    return `${base}?tab=production&taskId=${event.taskId}`;
  }
  if (event.type === 'clip-comment' && event.source === 'clip' && event.instrument && event.sectionName) {
    const params = new URLSearchParams({
      instrument: event.instrument,
      section: event.sectionName,
      ...(event.clipId ? { clipId: event.clipId } : {}),
      openComments: 'true',
    });
    return `${base}?${params}`;
  }
  if (event.type === 'review-shared' && event.reviewId) {
    return `${songBase}?tab=review&reviewId=${event.reviewId}`;
  }
  if ((event.type === 'review-comment' || event.type === 'review-reply') && event.reviewId) {
    const params = new URLSearchParams({ tab: 'review', reviewId: event.reviewId });
    if (event.commentId) params.set('commentId', event.commentId);
    return `${songBase}?${params}`;
  }
  if (event.instrument && event.sectionName) {
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  }
  return songBase;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: number;
  songId: string;
  songName: string;
  instrument?: string;
  sectionName?: string;
  taskId?: string;
  source?: 'clip' | 'task';
  clipId?: string;
  reviewId?: string;
  commentId?: string;
}

interface ApiClipDash {
  id: string;
  name: string;
  duration: number;
  src: string | null;
  isFinal: boolean;
  metadata?: DawClip['metadata'];
}

interface ApiIdeaDash {
  id: string;
  sectionName: string;
  clips: ApiClipDash[];
}

interface ApiTrackDash {
  id: string;
  name: string;
  ideas: ApiIdeaDash[];
}

function sortByDueDate(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });
}

interface EditableTagListProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}

function EditableTagList({ label, items, onChange }: EditableTagListProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startAdding = () => {
    setIsAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    const val = draft.trim();
    if (val && !items.includes(val)) onChange([...items, val]);
    setDraft('');
    setIsAdding(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setDraft(''); setIsAdding(false); }
  };

  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="min-h-[44px] rounded-md border border-white/10 bg-black/40 px-2 py-1.5 flex flex-wrap gap-1.5 items-center">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 bg-white/8 border border-white/10 rounded px-2 py-0.5 text-xs font-medium text-white/80"
          >
            {item}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-white/40 hover:text-white transition-colors leading-none"
              tabIndex={-1}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {isAdding ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            className="inline-flex bg-white/8 border border-primary/50 rounded px-2 py-0.5 text-xs text-white outline-none min-w-[80px] w-24"
          />
        ) : (
          <button
            type="button"
            onClick={startAdding}
            className="inline-flex items-center gap-1 border border-dashed border-white/20 rounded px-2 py-0.5 text-xs font-medium text-white/35 hover:text-white/70 hover:border-white/35 transition-colors"
          >
            <Plus size={10} /> Add
          </button>
        )}
      </div>
    </div>
  );
}

function ClipPlayer({ clip }: { clip: ApiClipDash }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);

  function formatDur(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function drawWaveform(time: number) {
    const canvas = canvasRef.current;
    const buffer = bufferRef.current;
    if (!canvas || !buffer) return;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const data = buffer.getChannelData(0);
    const totalSamples = data.length;
    const progress = clip.duration > 0 ? time / clip.duration : 0;
    for (let x = 0; x < w; x++) {
      const start = Math.floor((x / w) * totalSamples);
      const end = Math.min(Math.floor(((x + 1) / w) * totalSamples), totalSamples);
      let max = 0;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(data[i]);
        if (abs > max) max = abs;
      }
      const barH = Math.max(1, max * h * 0.9);
      const midY = h / 2;
      ctx.fillStyle = x / w < progress ? 'rgba(212,175,55,0.85)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, midY - barH / 2, 1, barH);
    }
  }

  useEffect(() => {
    if (!clip.src) return;
    let cancelled = false;
    fetch(clip.src)
      .then(r => r.arrayBuffer())
      .then(ab => {
        if (cancelled) return null;
        const actx = new AudioContext();
        return actx.decodeAudioData(ab).then(buf => { actx.close(); return buf; });
      })
      .then(buf => {
        if (cancelled || !buf) return;
        bufferRef.current = buf;
        drawWaveform(0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clip.src]);

  useEffect(() => {
    drawWaveform(currentTime);
  }, [currentTime]);

  useEffect(() => {
    if (!clip.src) return;
    const audio = new Audio(clip.src);
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('ended', () => { setIsPlaying(false); setCurrentTime(0); audio.currentTime = 0; });
    audioRef.current = audio;
    return () => { audio.pause(); audioRef.current = null; };
  }, [clip.src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !clip.src) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    if (!audio || !clip.src) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const newTime = fraction * clip.duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors">
      <button
        onClick={toggle}
        className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 hover:bg-primary/30 transition-colors"
      >
        {isPlaying
          ? <Pause size={11} className="text-primary" />
          : <Play size={11} className="text-primary ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className={cn('text-xs font-medium truncate', clip.isFinal ? 'text-primary' : 'text-white/80')}>
            {clip.name}
            {clip.isFinal && (
              <span className="ml-1.5 text-[9px] text-primary/60 font-bold uppercase tracking-wider">Final</span>
            )}
          </span>
          <span className="text-[10px] text-white/30 ml-2 shrink-0 font-mono">{formatDur(currentTime)}</span>
        </div>
        <canvas
          ref={canvasRef}
          className="w-full h-5 rounded cursor-pointer"
          onClick={handleCanvasClick}
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [isChoiceOpen, setIsChoiceOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBpm, setNewBpm] = useState('120');
  const [newSections, setNewSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [newInstruments, setNewInstruments] = useState<string[]>(DEFAULT_INSTRUMENTS);

  const [isNewIdeaOpen, setIsNewIdeaOpen] = useState(false);
  const [newIdeaName, setNewIdeaName] = useState('');

  const { data: songs = [], isLoading } = useQuery<Song[]>({
    queryKey: ['songs'],
    queryFn: () => fetch('/api/songs').then(r => r.json()),
  });

  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ['all-tasks'],
    queryFn: () => fetch('/api/tasks').then(r => r.json()),
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'files'>('dashboard');
  const [filesFilter, setFilesFilter] = useState<'all' | 'songs' | 'ideas'>('all');
  const [filesSort, setFilesSort] = useState<'recent' | 'name-asc' | 'name-desc'>('recent');
  const [selectedFile, setSelectedFile] = useState<Song | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<ApiTrackDash | null>(null);
  const [selectedSection, setSelectedSection] = useState<ApiIdeaDash | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [infoClip, setInfoClip] = useState<ApiClipDash | null>(null);
  const [infoFocusNotes, setInfoFocusNotes] = useState(false);

  const [showAllTasks, setShowAllTasks] = useState(false);
  const [songSearch, setSongSearch] = useState('');
  const [activityHeight, setActivityHeight] = useState<number | null>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const hasMeasured = useRef(false);

  const { data: activityEvents = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['activity'],
    queryFn: () => fetch('/api/activity').then(r => r.json()),
    refetchInterval: 10000,
  });

  const { data: fileBucket = [] } = useQuery<ApiTrackDash[]>({
    queryKey: ['bucket', selectedFile?.id],
    queryFn: () => fetch(`/api/songs/${selectedFile!.id}/bucket`).then(r => r.json()),
    enabled: !!selectedFile && activeTab === 'files',
  });

  // Sync selectedInstrument and selectedSection from fresh bucket data after upload/refetch
  useEffect(() => {
    if (!selectedInstrument) return;
    const freshTrack = fileBucket.find(t => t.id === selectedInstrument.id);
    if (!freshTrack) return;
    setSelectedInstrument(freshTrack);
    if (selectedSection) {
      const freshIdea = freshTrack.ideas.find(i => i.id === selectedSection.id);
      if (freshIdea) setSelectedSection(freshIdea);
    }
  }, [fileBucket]);

  // Measure the left column height once after songs first load, then never again.
  useEffect(() => {
    if (hasMeasured.current || !leftColRef.current || songs.length === 0) return;
    hasMeasured.current = true;
    setActivityHeight(leftColRef.current.getBoundingClientRect().height);
  }, [songs.length, allTasks.length]);

  const CURRENT_USER = user?.username ?? '';

  const activeTasks = sortByDueDate(
    allTasks.filter(t =>
      (t.status === 'todo' || t.status === 'in-progress') &&
      t.assignee.toLowerCase() === CURRENT_USER.toLowerCase()
    )
  );
  const visibleTasks = showAllTasks ? activeTasks : activeTasks.slice(0, 5);

  const taskCountsBySong = allTasks.reduce<Record<string, { completed: number; total: number }>>((acc, t) => {
    if (!acc[t.songId]) acc[t.songId] = { completed: 0, total: 0 };
    acc[t.songId].total += 1;
    if (t.status === 'complete') acc[t.songId].completed += 1;
    return acc;
  }, {});

  const filteredFiles = songs
    .filter(s => {
      if (filesFilter === 'songs') return s.type === 'song' || !s.type;
      if (filesFilter === 'ideas') return s.type === 'idea';
      return true;
    })
    .sort((a, b) => {
      if (filesSort === 'name-asc') return a.name.localeCompare(b.name);
      if (filesSort === 'name-desc') return b.name.localeCompare(a.name);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const createSong = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          bpm: newBpm ? parseInt(newBpm, 10) : null,
          sections: newSections.length > 0 ? newSections : DEFAULT_SECTIONS,
          instruments: newInstruments.length > 0 ? newInstruments : DEFAULT_INSTRUMENTS,
        }),
      });
      if (!res.ok) throw new Error('Failed to create song');
      return res.json() as Promise<Song>;
    },
    onSuccess: (song) => {
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      closeModal();
      setLocation(`/songs/${song.id}`);
    },
  });

  const createIdea = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newIdeaName.trim(), type: 'idea', sections: [] }),
      });
      if (!res.ok) throw new Error('Failed to create idea');
      return res.json() as Promise<Song>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      setIsNewIdeaOpen(false);
      setNewIdeaName('');
      setLocation('/');
    },
  });

  const [songToDelete, setSongToDelete] = useState<Song | null>(null);

  const deleteSong = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/songs/${id}`, { method: 'DELETE' }).then(r => {
        if (!r.ok) throw new Error('Delete failed');
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      setSongToDelete(null);
    },
  });

  const markFinalMutation = useMutation({
    mutationFn: async (clipId: string) => {
      const res = await fetch(`/api/clips/${clipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFinal: true, author: user?.username ?? 'Unknown' }),
      });
      if (!res.ok) throw new Error('Failed to mark as final');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bucket', selectedFile?.id] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const closeModal = () => {
    setIsNewProjectOpen(false);
    setNewName('');
    setNewBpm('120');
    setNewSections(DEFAULT_SECTIONS);
    setNewInstruments(DEFAULT_INSTRUMENTS);
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!selectedFile || !selectedInstrument || !selectedSection) return;
    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('instrument', selectedInstrument.name);
        formData.append('section', selectedSection.sectionName);
        formData.append('ideaId', selectedSection.id);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) continue;
        const { url, duration, originalFileName } = await uploadRes.json();
        await fetch(`/api/ideas/${selectedSection.id}/clips`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            ideaId: selectedSection.id,
            name: originalFileName || file.name,
            type: 'audio',
            color: '#D4AF37',
            start: 0,
            duration,
            src: url,
            isFinal: false,
            sectionName: selectedSection.sectionName,
          }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ['bucket', selectedFile.id] });
    } catch (e) {
      console.error('Upload failed:', e);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createSong.mutate();
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-primary/30">
      <AppHeader
        actionSlot={
          <Button
            onClick={() => setIsChoiceOpen(true)}
            className="h-9 px-4 bg-primary text-black hover:bg-primary/90 font-bold text-xs flex items-center gap-2"
          >
            <Plus size={14} /> New Project
          </Button>
        }
      />

      <main className="max-w-5xl mx-auto px-6 py-12">

        {/* Personalized greeting */}
        <div className="mb-6">
          <h1 className="text-3xl font-heading font-black tracking-tight text-white">
            {(() => {
              const h = new Date().getHours();
              const name = capitalize(user?.username ?? '');
              if (h >= 5 && h < 12) return `Good morning, ${name}. Let's make something.`;
              if (h >= 12 && h < 17) return `Good afternoon, ${name}. The band's waiting.`;
              if (h >= 17 && h < 21) return `Good evening, ${name}. Let's get loud.`;
              return `Hey ${name}. Those riffs aren't going to record themselves.`;
            })()}
          </h1>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 mb-8 bg-white/[0.04] rounded-lg p-1 w-fit border border-white/5">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-bold transition-all',
              activeTab === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            )}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-bold transition-all',
              activeTab === 'files' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            )}
          >
            Files
          </button>
        </div>

        {activeTab === 'dashboard' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

          {/* Left column — Songs + Tasks */}
          <div ref={leftColRef} className="lg:col-span-2 space-y-12">

            {/* Song list */}
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-1">Your Songs</h2>
              <p className="text-sm text-muted-foreground mb-4">Select a project to open its workspace.</p>
              {isLoading && (
                <div className="text-sm text-muted-foreground">Loading…</div>
              )}

              {!isLoading && songs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center mb-4">
                    <Music2 size={28} className="text-primary/60" />
                  </div>
                  <p className="text-sm font-bold text-white/60 mb-2">No songs yet</p>
                  <p className="text-xs text-muted-foreground mb-6">Create your first project to get started.</p>
                  <Button
                    onClick={() => setIsChoiceOpen(true)}
                    className="h-9 px-5 bg-primary text-black hover:bg-primary/90 font-bold text-xs flex items-center gap-2"
                  >
                    <Plus size={14} /> New Project
                  </Button>
                </div>
              )}

              {!isLoading && songs.length > 0 && (() => {
                const recentSongs = songs.slice(0, 3);
                const renderCard = (song: Song) => (
                  <div
                    key={song.id}
                    onClick={() => setLocation(`/songs/${song.id}`)}
                    className="bg-gradient-to-r from-[#181C26] to-[#181C26]/80 rounded-2xl p-6 border border-white/5 hover:border-primary/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.08)] transition-all cursor-pointer group relative overflow-hidden"
                  >
                    <div className="absolute right-0 top-0 bottom-0 w-48 bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0 group-hover:border-primary/40 transition-colors">
                          <Music2 size={18} className="text-primary/70" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-xl font-heading font-black tracking-tight text-white group-hover:text-primary transition-colors truncate mb-1">
                            {song.name}
                          </h3>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Clock size={10} className="text-primary/40 shrink-0" />
                            Updated {formatDate(song.updatedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        {(() => {
                          const counts = taskCountsBySong[song.id];
                          if (!counts) return null;
                          const allDone = counts.completed === counts.total;
                          return (
                            <div className={cn(
                              'text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border',
                              allDone
                                ? 'bg-primary/10 text-primary border-primary/20'
                                : 'bg-black/40 text-muted-foreground border-white/5'
                            )}>
                              {counts.completed}/{counts.total} tasks
                            </div>
                          );
                        })()}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={e => e.stopPropagation()}
                              className="w-7 h-7 rounded flex items-center justify-center text-white/0 group-hover:text-white/40 hover:!text-white hover:bg-white/8 transition-colors"
                            >
                              <MoreHorizontal size={15} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="bg-[#0c0c0e] border-white/10 min-w-[130px]"
                            onClick={e => e.stopPropagation()}
                          >
                            <DropdownMenuItem
                              className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer text-xs flex items-center gap-2"
                              onClick={e => { e.stopPropagation(); setSongToDelete(song); }}
                            >
                              <Trash2 size={13} /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-primary transition-all">
                          <ChevronRight size={20} className="text-primary group-hover:text-black" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
                const filteredSongs = songs.filter(s =>
                  s.name.toLowerCase().includes(songSearch.toLowerCase())
                );
                return (
                  <div className="flex flex-col gap-3">
                    {recentSongs.map(renderCard)}
                    {songs.length > 3 && (
                      <Popover onOpenChange={open => { if (!open) setSongSearch(''); }}>
                        <PopoverTrigger asChild>
                          <button className="self-start text-xs text-white/30 hover:text-white/55 transition-colors py-1">
                            Show all songs ↓
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={8}
                          className="w-80 p-0 bg-[#0c0c0e] border-white/10"
                        >
                          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
                            <Search size={13} className="text-white/30 shrink-0" />
                            <input
                              autoFocus
                              value={songSearch}
                              onChange={e => setSongSearch(e.target.value)}
                              placeholder="Search songs…"
                              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/25 outline-none"
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto divide-y divide-white/5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                            {filteredSongs.length === 0 ? (
                              <p className="px-4 py-5 text-xs text-white/30 text-center">No songs match.</p>
                            ) : filteredSongs.map(song => {
                              const counts = taskCountsBySong[song.id];
                              const allDone = counts && counts.completed === counts.total;
                              return (
                                <button
                                  key={song.id}
                                  onClick={() => setLocation(`/songs/${song.id}`)}
                                  className="w-full text-left flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors group"
                                >
                                  <span className="text-sm text-white/70 group-hover:text-white transition-colors truncate">{song.name}</span>
                                  <div className="flex items-center gap-2.5 shrink-0 ml-3">
                                    {counts && (
                                      <span className={cn(
                                        'text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border',
                                        allDone
                                          ? 'bg-primary/10 text-primary border-primary/20'
                                          : 'bg-black/40 text-white/30 border-white/5'
                                      )}>
                                        {counts.completed}/{counts.total}
                                      </span>
                                    )}
                                    <ChevronRight size={13} className="text-white/20 group-hover:text-white/50 transition-colors" />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Upcoming Tasks */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold uppercase tracking-widest text-white/80">Upcoming Tasks</h2>
              </div>
              {activeTasks.length === 0 ? (
                <div className="bg-[#181C26]/60 rounded-xl border border-white/5 px-5 py-8 text-center">
                  <p className="text-xs text-muted-foreground">You have no upcoming tasks.</p>
                </div>
              ) : (
                <>
                <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden divide-y divide-white/5">
                  {visibleTasks.map(task => (
                    <div
                      key={task.id}
                      onClick={() => setLocation(`/songs/${task.songId}/workspace?instrument=${encodeURIComponent(task.instrument)}&section=${encodeURIComponent(task.sectionName)}`)}
                      className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Circle
                          size={14}
                          className={cn(
                            'shrink-0',
                            task.status === 'in-progress' ? 'text-primary fill-primary/20' : 'text-white/20'
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white/90 group-hover:text-primary transition-colors truncate">
                            {task.instrument}
                            <span className="mx-1.5 text-white/20 font-normal">·</span>
                            <span className="text-white/50 font-normal">{task.sectionName}</span>
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">{task.songName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        {task.dueDate && (
                          <span className={cn(
                            'flex items-center gap-1 text-[10px] font-medium',
                            parseLocalDate(task.dueDate) < new Date() ? 'text-red-400' : 'text-muted-foreground'
                          )}>
                            <Clock size={10} className={parseLocalDate(task.dueDate) < new Date() ? 'text-red-400' : 'text-primary/40'} />
                            {formatDueDate(task.dueDate)}
                          </span>
                        )}
                        <span className={cn(
                          'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border',
                          task.status === 'in-progress'
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : 'bg-white/5 text-white/50 border-white/10'
                        )}>
                          {STATUS_LABEL[task.status] ?? task.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {activeTasks.length > 5 && (
                  <button
                    onClick={() => setShowAllTasks(v => !v)}
                    className="mt-2 w-full text-center text-xs font-bold text-white/40 hover:text-primary transition-colors py-2"
                  >
                    {showAllTasks ? 'Show less' : `Show all ${activeTasks.length} tasks`}
                  </button>
                )}
                </>
              )}
            </section>

          </div>

          {/* Right column — Activity sidebar */}
          <div className="lg:col-span-1">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-4">Activity</h2>
            {activityEvents.length === 0 ? (
              <div className="bg-[#181C26]/60 rounded-xl border border-white/5 px-5 py-8 text-center">
                <p className="text-xs text-muted-foreground">No activity yet.</p>
              </div>
            ) : (
              <div
                className="bg-[#181C26] rounded-xl border border-white/5 divide-y divide-white/5 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent"
                style={{ height: activityHeight ?? 500, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
              >
                {activityEvents.map((event: ActivityEvent, i: number) => (
                  <div
                    key={i}
                    onClick={() => {
                      const url = activityUrl(event);
                      console.log('[Activity click]', {
                        type: event.type,
                        source: event.source,
                        clipId: event.clipId,
                        taskId: event.taskId,
                        songId: event.songId,
                        instrument: event.instrument,
                        sectionName: event.sectionName,
                        reviewId: event.reviewId,
                        commentId: event.commentId,
                        url,
                      });
                      setLocation(url);
                    }}
                    className="flex items-start justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer group gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white/80 group-hover:text-white transition-colors leading-snug">
                        {capitalize(event.description)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{event.songName}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
        )}

        {/* ── Files tab ──────────────────────────────────────────────────────── */}
        {activeTab === 'files' && (
          <div>
            {/* Controls row — filter buttons + sort dropdown */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1 border border-white/5">
                {(['all', 'songs', 'ideas'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => { setFilesFilter(f); setSelectedFile(null); setSelectedInstrument(null); setSelectedSection(null); }}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                      filesFilter === f ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                    )}
                  >
                    {f === 'all' ? 'All' : f === 'songs' ? 'Songs' : 'Ideas'}
                  </button>
                ))}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-md border border-white/8 bg-white/[0.02] hover:bg-white/[0.04]">
                    <ArrowUpDown size={11} />
                    {filesSort === 'recent' ? 'Recent' : filesSort === 'name-asc' ? 'Name A–Z' : 'Name Z–A'}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-[#0c0c0e] border-white/10 min-w-[130px]">
                  {(['recent', 'name-asc', 'name-desc'] as const).map(s => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() => setFilesSort(s)}
                      className="text-xs flex items-center justify-between cursor-pointer"
                    >
                      {s === 'recent' ? 'Recent' : s === 'name-asc' ? 'Name A–Z' : 'Name Z–A'}
                      {filesSort === s && <Check size={12} className="text-primary ml-3" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Hidden file input for upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files) { handleUploadFiles(e.target.files); e.target.value = ''; } }}
            />

            {/* Four-column browser */}
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden flex h-[560px] relative">

              {/* Column 1 — Projects */}
              <div className="w-52 shrink-0 border-r border-white/5 flex flex-col">
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
                  {filesFilter === 'ideas' ? 'Ideas' : filesFilter === 'songs' ? 'Songs' : 'All Projects'}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {filteredFiles.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-8 px-2 uppercase tracking-widest">No items</p>
                  ) : filteredFiles.map(item => {
                    const isIdea = item.type === 'idea';
                    return (
                      <button
                        key={item.id}
                        onClick={() => { setSelectedFile(item); setSelectedInstrument(null); setSelectedSection(null); }}
                        className={cn(
                          'w-full flex items-center justify-between p-2 rounded text-xs transition-all',
                          selectedFile?.id === item.id
                            ? 'bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isIdea
                            ? <Lightbulb size={13} className="shrink-0" />
                            : <Music2 size={13} className="shrink-0" />}
                          <span className="font-bold tracking-tight truncate">{item.name}</span>
                        </div>
                        <ChevronRight size={12} className="opacity-40 shrink-0 ml-1" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Column 2 — Instruments / Folders */}
              <div className="w-44 shrink-0 border-r border-white/5 flex flex-col bg-black/10">
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
                  {selectedFile?.type === 'idea' ? 'Folders' : 'Instruments'}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {!selectedFile ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">Select a project</p>
                  ) : fileBucket.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">
                      No {selectedFile.type === 'idea' ? 'folders' : 'instruments'}
                    </p>
                  ) : fileBucket.map(track => {
                    const hasFiles = track.ideas.some(i => i.clips.length > 0);
                    return (
                      <button
                        key={track.id}
                        onClick={() => { setSelectedInstrument(track); setSelectedSection(null); }}
                        className={cn(
                          'w-full flex items-center justify-between p-2 rounded text-xs transition-all',
                          selectedInstrument?.id === track.id
                            ? 'bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder size={13} className="shrink-0" fill={hasFiles ? 'currentColor' : 'none'} />
                          <span className="font-bold tracking-tight truncate">{track.name}</span>
                        </div>
                        <ChevronRight size={12} className="opacity-40 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Column 3 — Sections / Subfolders */}
              <div className="w-44 shrink-0 border-r border-white/5 flex flex-col bg-black/[0.15]">
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">
                  {selectedFile?.type === 'idea' ? 'Subfolders' : 'Sections'}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {!selectedInstrument ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">
                      Select {selectedFile?.type === 'idea' ? 'a folder' : 'an instrument'}
                    </p>
                  ) : selectedInstrument.ideas.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">No sections</p>
                  ) : selectedInstrument.ideas.map(idea => {
                    const hasFiles = idea.clips.length > 0;
                    return (
                      <button
                        key={idea.id}
                        onClick={() => setSelectedSection(idea)}
                        className={cn(
                          'w-full flex items-center justify-between p-2 rounded text-xs transition-all',
                          selectedSection?.id === idea.id
                            ? 'bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder size={13} className="shrink-0" fill={hasFiles ? 'currentColor' : 'none'} />
                          <span className="font-bold tracking-tight truncate">{idea.sectionName}</span>
                        </div>
                        {hasFiles && (
                          <span className="text-[9px] text-muted-foreground/50 shrink-0 ml-1 tabular-nums">{idea.clips.length}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Column 4 — Files */}
              <div
                className={cn('flex-1 flex flex-col transition-colors', isDragOver && selectedSection ? 'bg-primary/5' : 'bg-black/20')}
                onDragOver={e => { e.preventDefault(); if (selectedSection) setIsDragOver(true); }}
                onDragLeave={e => { const rel = e.relatedTarget; if (!rel || !e.currentTarget.contains(rel as Node)) setIsDragOver(false); }}
                onDrop={e => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (selectedSection && e.dataTransfer.files.length > 0) handleUploadFiles(e.dataTransfer.files);
                }}
              >
                <div className="px-3 py-2 flex items-center justify-between border-b border-white/5 bg-white/[0.02] shrink-0">
                  <span className="text-[10px] uppercase tracking-tighter text-muted-foreground font-bold">Files</span>
                  {selectedSection && (
                    <div className="flex items-center gap-3">
                      {selectedFile?.type !== 'idea' && selectedInstrument && (
                        <button
                          onClick={() => setLocation(`/songs/${selectedFile!.id}/workspace?instrument=${encodeURIComponent(selectedInstrument.name)}&section=${encodeURIComponent(selectedSection.sectionName)}`)}
                          className="text-[10px] text-primary/70 hover:text-primary transition-colors font-bold"
                        >
                          Open in Workspace ↗
                        </button>
                      )}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 disabled:opacity-50 transition-colors rounded px-2 py-1 font-bold"
                      >
                        <Upload size={10} />
                        {isUploading ? 'Uploading…' : 'Upload'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {!selectedSection ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-[10px] text-muted-foreground/40 italic text-center uppercase tracking-widest leading-relaxed px-4">
                        {!selectedInstrument
                          ? 'Select an instrument to browse sections'
                          : `Select a ${selectedFile?.type === 'idea' ? 'subfolder' : 'section'} to view files`}
                      </p>
                    </div>
                  ) : selectedSection.clips.length === 0 ? (
                    <div className={cn(
                      'flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors mx-1',
                      isDragOver ? 'border-primary/50 bg-primary/5' : 'border-white/8'
                    )}>
                      <Upload size={20} className={cn('mb-3', isDragOver ? 'text-primary/60' : 'text-white/15')} />
                      <p className={cn('text-[10px] uppercase tracking-widest mb-1', isDragOver ? 'text-primary/70' : 'text-muted-foreground/50')}>
                        {isDragOver ? 'Drop to upload' : 'No files yet'}
                      </p>
                      <p className="text-[10px] text-muted-foreground/30">Drop audio files or use Upload above</p>
                    </div>
                  ) : (
                    <>
                      {isDragOver && (
                        <div className="border-2 border-dashed border-primary/50 rounded-lg p-2 text-center mb-1">
                          <p className="text-[10px] text-primary/70 uppercase tracking-widest">Drop to add more files</p>
                        </div>
                      )}
                      {selectedSection.clips.map(clip => (
                        <ContextMenu key={clip.id}>
                          <ContextMenuTrigger asChild>
                            <div><ClipPlayer clip={clip} /></div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="bg-[#0c0c0e] border-white/10 min-w-[160px] shadow-xl">
                            <ContextMenuItem
                              onClick={() => { setInfoClip(clip); setInfoFocusNotes(false); }}
                              className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2"
                            >
                              <Info size={13} className="text-white/50" /> More Info
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => { setInfoClip(clip); setInfoFocusNotes(true); }}
                              className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2"
                            >
                              <MessageSquare size={13} className="text-white/50" /> Add Note
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => markFinalMutation.mutate(clip.id)}
                              disabled={clip.isFinal}
                              className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2 disabled:opacity-40"
                            >
                              <CheckCircle2 size={13} className={clip.isFinal ? 'text-primary' : 'text-white/50'} />
                              {clip.isFinal ? 'Already Final' : 'Mark as Final'}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </>
                  )}
                </div>
              </div>

            </div>

            {infoClip && (
              <ClipInfoWindow
                clip={{
                  id: infoClip.id,
                  name: infoClip.name,
                  type: 'audio',
                  color: '#D4AF37',
                  start: 0,
                  duration: infoClip.duration,
                  src: infoClip.src ?? undefined,
                  isFinal: infoClip.isFinal,
                  metadata: infoClip.metadata,
                }}
                open={true}
                onOpenChange={open => { if (!open) { setInfoClip(null); setInfoFocusNotes(false); } }}
                bucketClipId={infoClip.id}
                songId={selectedFile?.id ?? 'patchbay-default'}
                focusNotes={infoFocusNotes}
              />
            )}
          </div>
        )}

      </main>

      {/* Choice Modal — Song vs Idea */}
      <Dialog open={isChoiceOpen} onOpenChange={setIsChoiceOpen}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              What would you like to create?
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 pt-2 pb-1">
            <button
              onClick={() => { setIsChoiceOpen(false); setIsNewProjectOpen(true); }}
              className="flex flex-col items-center gap-3 rounded-md border-2 border-white/5 bg-white/[0.02] p-5 text-left hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:border-primary/40 transition-colors">
                <Music2 size={20} className="text-primary/70" />
              </div>
              <div>
                <p className="text-sm font-bold text-white text-center mb-1">Song</p>
                <p className="text-[11px] text-muted-foreground text-center leading-snug">A structured project with timeline, sections, and production tracking</p>
              </div>
            </button>
            <button
              onClick={() => { setIsChoiceOpen(false); setIsNewIdeaOpen(true); }}
              className="flex flex-col items-center gap-3 rounded-md border-2 border-white/5 bg-white/[0.02] p-5 text-left hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:border-primary/40 transition-colors">
                <Lightbulb size={20} className="text-primary/70" />
              </div>
              <div>
                <p className="text-sm font-bold text-white text-center mb-1">Idea</p>
                <p className="text-[11px] text-muted-foreground text-center leading-snug">A free-form bucket to capture loose ideas and inspiration</p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Idea Dialog */}
      <Dialog open={isNewIdeaOpen} onOpenChange={open => { if (!open) { setIsNewIdeaOpen(false); setNewIdeaName(''); } }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              New Idea
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={e => { e.preventDefault(); if (newIdeaName.trim()) createIdea.mutate(); }}
            className="space-y-4 pt-2"
          >
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Summer Riff Ideas"
                value={newIdeaName}
                onChange={e => setNewIdeaName(e.target.value)}
                className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-white/10 hover:bg-white/5 text-xs"
                onClick={() => { setIsNewIdeaOpen(false); setNewIdeaName(''); }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newIdeaName.trim() || createIdea.isPending}
                className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
              >
                {createIdea.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Project Dialog */}
      <Dialog open={isNewProjectOpen} onOpenChange={open => { if (!open) closeModal(); }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              New Project
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Song Name</Label>
                <Input
                  autoFocus
                  placeholder="e.g. Midnight Horizon"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50"
                />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">BPM</Label>
                <Input
                  type="number"
                  min={40}
                  max={300}
                  placeholder="120"
                  value={newBpm}
                  onChange={e => setNewBpm(e.target.value)}
                  className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50"
                />
              </div>
            </div>

            <EditableTagList
              label="Instruments"
              items={newInstruments}
              onChange={setNewInstruments}
            />

            <EditableTagList
              label="Sections"
              items={newSections}
              onChange={setNewSections}
            />

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="border-white/10 hover:bg-white/5 text-xs"
                onClick={closeModal}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!newName.trim() || createSong.isPending}
                className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
              >
                {createSong.isPending ? 'Creating…' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!songToDelete} onOpenChange={open => { if (!open) setSongToDelete(null); }}>
        <AlertDialogContent className="bg-[#0c0c0e] border-white/10 max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-bold text-white">Delete "{songToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              This will permanently delete the song and all its tracks, files, and tasks. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 hover:bg-white/5 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold"
              onClick={() => songToDelete && deleteSong.mutate(songToDelete.id)}
            >
              {deleteSong.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
