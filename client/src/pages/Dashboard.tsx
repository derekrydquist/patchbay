import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { capitalize } from '@/lib/utils';
import { useLocation, useSearch } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Music2, Lightbulb, Plus, Clock, X, MoreHorizontal, Trash2, ChevronRight, Circle, Search, ArrowUpDown, Check, Folder, Upload, Info, MessageSquare, CheckCircle2, Share2, Sparkles } from 'lucide-react';
import { WaveformPlayerCard } from '@/components/daw/WaveformPlayerCard';
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
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ClipInfoWindow } from '@/components/daw/Clip';
import { UploadModal } from '@/components/daw/MediaBucket';
import { Clip as DawClip } from '@/lib/daw-data';
import { type ApiClip, type ApiIdea, type ApiTrack, type AddedToSong, fetchBucket, bucketKeys } from '@/lib/bucket-api';
import { AppHeader } from '@/components/AppHeader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

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
  hasFiles?: boolean;
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
  if (event.type === 'song-created') {
    return `/?tab=files&filter=songs&songId=${event.songId}`;
  }
  if (event.type === 'idea-created') {
    return `/?tab=files&filter=ideas&ideaId=${event.songId}`;
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


export default function Dashboard() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [isChoiceOpen, setIsChoiceOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [createSongSource, setCreateSongSource] = useState<'header' | 'browser'>('header');
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

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()),
  });

  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ['all-tasks'],
    queryFn: () => fetch('/api/tasks').then(r => r.json()),
  });

  const tabParam = new URLSearchParams(search).get('tab');
  const filterParam = new URLSearchParams(search).get('filter');
  const activeTab: 'dashboard' | 'files' = tabParam === 'files' ? 'files' : 'dashboard';
  const filesFilter: 'songs' | 'ideas' = filterParam === 'ideas' ? 'ideas' : 'songs';
  const [filesSort, setFilesSort] = useState<'recent' | 'name-asc' | 'name-desc'>('recent');
  const [selectedFile, setSelectedFile] = useState<Song | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<ApiTrack | null>(null);
  const [selectedSection, setSelectedSection] = useState<ApiIdea | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadInitialFiles, setUploadInitialFiles] = useState<File[]>([]);
  const [infoClip, setInfoClip] = useState<ApiClip | null>(null);
  const [infoFocusNotes, setInfoFocusNotes] = useState(false);

  const [addToSongClip, setAddToSongClip] = useState<ApiClip | null>(null);
  const [destSongId, setDestSongId] = useState('');
  const [destInstrumentId, setDestInstrumentId] = useState('');
  const [destSectionId, setDestSectionId] = useState('');
  const [isAddingToSong, setIsAddingToSong] = useState(false);
  const [addToSongDuplicateError, setAddToSongDuplicateError] = useState<string | null>(null);

  const [promoteClip, setPromoteClip] = useState<ApiClip | null>(null);
  const [promoteSongName, setPromoteSongName] = useState('');
  const [promoteInstrument, setPromoteInstrument] = useState('');
  const [promoteSection, setPromoteSection] = useState('');
  const [isPromoting, setIsPromoting] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [newInstrumentName, setNewInstrumentName] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [isAddInstrumentOpen, setIsAddInstrumentOpen] = useState(false);
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [isAddPartOpen, setIsAddPartOpen] = useState(false);
  const pendingInstrumentIdRef = useRef<string | null>(null);
  const pendingSectionNameRef = useRef<string | null>(null);
  const pendingSectionIdRef = useRef<string | null>(null);
  const appliedSearchRef = useRef<string | null>(null);
  const hasRestoredFromUrl = useRef<boolean>(false);
  const pendingNewIdeaIdRef = useRef<string | null>(null);

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

  const { toast } = useToast();

  const { data: fileBucket = [] } = useQuery<ApiTrack[]>({
    queryKey: bucketKeys.bucket(selectedFile?.id),
    queryFn: () => fetchBucket(selectedFile!.id),
    enabled: !!selectedFile && activeTab === 'files',
  });

  const { data: destBucket = [] } = useQuery<ApiTrack[]>({
    queryKey: bucketKeys.bucket(destSongId),
    queryFn: () => fetchBucket(destSongId),
    enabled: !!destSongId && !!addToSongClip,
  });

  // Sync selectedInstrument/selectedSection from fresh bucket data; also handles
  // pending auto-selection after instrument or section creation.
  useEffect(() => {
    if (pendingInstrumentIdRef.current) {
      const found = fileBucket.find(t => t.id === pendingInstrumentIdRef.current);
      if (found) {
        pendingInstrumentIdRef.current = null;
        setSelectedInstrument(found);
        if (pendingSectionIdRef.current) {
          const idea = found.ideas.find(i => i.id === pendingSectionIdRef.current);
          pendingSectionIdRef.current = null;
          setSelectedSection(idea ?? null);
        } else {
          setSelectedSection(null);
        }
        return;
      }
    }
    if (pendingSectionNameRef.current) {
      const trackToSearch = selectedInstrument
        ? fileBucket.find(t => t.id === selectedInstrument.id)
        : null;
      if (trackToSearch) {
        const newIdea = trackToSearch.ideas.find(i => i.sectionName === pendingSectionNameRef.current);
        if (newIdea) {
          pendingSectionNameRef.current = null;
          setSelectedInstrument(trackToSearch);
          setSelectedSection(newIdea);
          return;
        }
      }
    }
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

  useEffect(() => {
    if (!songs.length || appliedSearchRef.current === search) return;
    const params = new URLSearchParams(search);
    if (params.get('tab') !== 'files') return;
    appliedSearchRef.current = search;
    // activeTab and filesFilter are now derived from URL params — no setState needed here
    const filter = params.get('filter');
    if (filter === 'ideas') {
      const ideaId = params.get('ideaId');
      if (ideaId) {
        const idea = songs.find(s => s.id === ideaId);
        if (idea) {
          setSelectedFile(idea);
          setSelectedInstrument(null);
          setSelectedSection(null);
          if (!hasRestoredFromUrl.current) {
            const partId = params.get('partId');
            if (partId) pendingInstrumentIdRef.current = partId;
          }
          hasRestoredFromUrl.current = true;
        }
        // if idea not found yet (query hasn't refetched), leave hasRestoredFromUrl false
        // so the retry effect below can select it once songs updates
      }
      // no ideaId in params: leave hasRestoredFromUrl false so the retry effect can fire
      // if setLocation adds an ideaId after mount (e.g. immediately after idea creation)
    } else {
      const songId = params.get('songId');
      if (songId) {
        const song = songs.find(s => s.id === songId);
        if (song) {
          setSelectedFile(song);
          setSelectedInstrument(null);
          setSelectedSection(null);
          if (!hasRestoredFromUrl.current) {
            const instrumentId = params.get('instrumentId');
            const sectionId = params.get('sectionId');
            if (instrumentId) pendingInstrumentIdRef.current = instrumentId;
            if (sectionId) pendingSectionIdRef.current = sectionId;
          }
          hasRestoredFromUrl.current = true;
        }
      }
      // no songId in params: leave hasRestoredFromUrl false for the same reason
    }
  }, [songs, search]);

  // Retry idea auto-selection after songs query refetches with the newly created idea.
  // The effect above sets appliedSearchRef immediately but leaves hasRestoredFromUrl false
  // when the idea isn't in the list yet (race between navigation and query invalidation).
  useEffect(() => {
    if (hasRestoredFromUrl.current) return;
    const params = new URLSearchParams(search);
    if (params.get('tab') !== 'files' || params.get('filter') !== 'ideas') return;
    const ideaId = params.get('ideaId');
    if (!ideaId || !songs.length) return;
    const ideas = songs.filter(s => s.type === 'idea');
    const idea = ideas.find(s => s.id === ideaId);
    if (!idea) return;
    setSelectedFile(idea);
    setSelectedInstrument(null);
    setSelectedSection(null);
    const partId = params.get('partId');
    if (partId) pendingInstrumentIdRef.current = partId;
    hasRestoredFromUrl.current = true;
  }, [songs]);

  // Direct selection path for newly created ideas — bypasses URL restoration entirely.
  // Sets pendingNewIdeaIdRef in onSuccess, then picks up the idea here once songs refetches.
  useEffect(() => {
    if (!pendingNewIdeaIdRef.current || !songs.length) return;
    const idea = songs.find(s => s.type === 'idea' && s.id === pendingNewIdeaIdRef.current);
    if (!idea) return;
    setSelectedFile(idea);
    setSelectedInstrument(null);
    setSelectedSection(null);
    pendingNewIdeaIdRef.current = null;
  }, [songs]);

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
    if (t.status === 'complete' || t.status === 'will-not-play') acc[t.songId].completed += 1;
    return acc;
  }, {});

  const filteredFiles = songs
    .filter(s => filesFilter === 'songs' ? (s.type === 'song' || !s.type) : s.type === 'idea')
    .sort((a, b) => {
      if (filesSort === 'name-asc') return a.name.localeCompare(b.name);
      if (filesSort === 'name-desc') return b.name.localeCompare(a.name);
      // Ideas sort by createdAt so newly created ideas always appear at the top.
      // Songs sort by updatedAt to surface recently active projects first.
      const dateKey = filesFilter === 'ideas' ? 'createdAt' : 'updatedAt';
      return new Date(b[dateKey]).getTime() - new Date(a[dateKey]).getTime();
    });

  const createSong = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          bpm: newBpm ? parseInt(newBpm, 10) : null,
          sections: newSections.length > 0 ? newSections : (settings?.defaultSections ?? DEFAULT_SECTIONS),
          instruments: newInstruments.length > 0 ? newInstruments : (settings?.defaultInstruments ?? DEFAULT_INSTRUMENTS),
        }),
      });
      if (!res.ok) throw new Error('Failed to create song');
      return res.json() as Promise<Song>;
    },
    onSuccess: (song) => {
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      closeModal();
      toast({ description: `Song '${song.name}' created` });
      if (createSongSource === 'browser') {
        setSelectedFile(song);
        setSelectedInstrument(null);
        setSelectedSection(null);
        const s = `tab=files&filter=songs&songId=${song.id}`;
        appliedSearchRef.current = s;
        setLocation(`/?${s}`);
      } else {
        setLocation(`/songs/${song.id}`);
      }
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
    onSuccess: (newIdea) => {
      pendingNewIdeaIdRef.current = newIdea.id;
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setIsNewIdeaOpen(false);
      setNewIdeaName('');
      toast({ description: `Idea '${newIdea.name}' created` });
      setLocation(`/?tab=files&filter=ideas&ideaId=${newIdea.id}`);
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
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(selectedFile?.id) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const addPartMutation = useMutation({
    mutationFn: async (name: string) => {
      const trackRes = await fetch(`/api/songs/${selectedFile!.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!trackRes.ok) throw new Error('Failed to create part');
      const newTrack = await trackRes.json();
      await fetch(`/api/tracks/${newTrack.id}/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sectionName: name, sortOrder: 0 }),
      });
      return newTrack;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(selectedFile?.id) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setIsAddPartOpen(false);
      setNewPartName('');
    },
  });

  const addInstrumentSongMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/songs/${selectedFile!.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create instrument');
      return res.json();
    },
    onSuccess: (newTrack) => {
      pendingInstrumentIdRef.current = newTrack.id;
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(selectedFile?.id) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setIsAddInstrumentOpen(false);
      setNewInstrumentName('');
    },
  });

  const addSectionSongMutation = useMutation({
    mutationFn: async (sectionName: string) => {
      await Promise.all(
        fileBucket.map((track, i) =>
          fetch(`/api/tracks/${track.id}/ideas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${track.name} ${sectionName}`,
              sectionName,
              sortOrder: track.ideas.length + i,
            }),
          })
        )
      );
    },
    onSuccess: (_, sectionName) => {
      pendingSectionNameRef.current = sectionName;
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(selectedFile?.id) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      setIsAddSectionOpen(false);
      setNewSectionName('');
    },
  });

  const closeAddToSongModal = () => {
    setAddToSongClip(null);
    setDestSongId('');
    setDestInstrumentId('');
    setDestSectionId('');
    setIsAddingToSong(false);
    setAddToSongDuplicateError(null);
  };

  const closePromoteModal = () => {
    setPromoteClip(null);
    setPromoteSongName('');
    setPromoteInstrument('');
    setPromoteSection('');
  };

  const handlePromoteToSong = async () => {
    if (!promoteClip?.src || !promoteInstrument || !promoteSection || !promoteSongName.trim()) return;
    setIsPromoting(true);
    try {
      const songRes = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: promoteSongName.trim(),
          bpm: settings?.defaultBpm ?? 120,
          sections: settings?.defaultSections ?? DEFAULT_SECTIONS,
          instruments: settings?.defaultInstruments ?? DEFAULT_INSTRUMENTS,
          type: 'song',
        }),
      });
      if (!songRes.ok) throw new Error('Failed to create song');
      const newSong = await songRes.json();

      const bucket = await fetchBucket(newSong.id);

      const destTrack = bucket.find(t => t.name === promoteInstrument);
      const destIdea = destTrack?.ideas?.find(i => i.sectionName === promoteSection);
      if (!destTrack || !destIdea) throw new Error('Could not find instrument/section in new song');

      const fileRes = await fetch(promoteClip.src!);
      if (!fileRes.ok) throw new Error('Failed to fetch source file');
      const blob = await fileRes.blob();
      const originalFileName = (promoteClip.metadata as any)?.originalFileName ?? promoteClip.name;
      const file = new File([blob], originalFileName, { type: blob.type || 'audio/mpeg' });

      const fd = new FormData();
      fd.append('file', file);
      fd.append('instrument', destTrack.name);
      fd.append('section', destIdea.sectionName);
      fd.append('ideaId', destIdea.id);

      const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const up = await uploadRes.json();

      const clipName = `${destTrack.name} ${destIdea.sectionName} V1`;
      const clipRes = await fetch(`/api/ideas/${destIdea.id}/clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: clipName,
          type: 'audio',
          color: destTrack.color ?? 'hsl(var(--primary))',
          start: 0,
          duration: up.duration,
          src: up.url,
          isFinal: false,
          active: true,
          sectionName: destIdea.sectionName,
          metadata: {
            format: up.format, originalFileName: up.originalFileName,
            uploadedBy: up.uploadedBy, uploadedDate: up.uploadedDate,
            sampleRate: up.sampleRate, bitDepth: up.bitDepth,
            channels: up.channels || 'Stereo',
            peakLevel: '', timeSignature: '', key: '', bpm: 0, description: '', tags: [],
          },
        }),
      });
      if (!clipRes.ok) throw new Error('Failed to create clip record');

      const currentAddedTo = promoteClip.addedToSongs ?? [];
      const newAddedToSongs = [
        ...currentAddedTo,
        { songId: newSong.id, songName: newSong.name, instrument: destTrack.name, section: destIdea.sectionName },
      ];
      const sourceClipId = promoteClip.id;
      const sourceFileId = selectedFile?.id;
      await fetch(`/api/clips/${sourceClipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addedToSongs: newAddedToSongs }),
      });

      setSelectedInstrument(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          ideas: prev.ideas.map(idea => ({
            ...idea,
            clips: idea.clips.map(c =>
              c.id === sourceClipId ? { ...c, addedToSongs: newAddedToSongs } : c
            ),
          })),
        };
      });

      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(sourceFileId) });
      queryClient.invalidateQueries({ queryKey: ['songs'] });

      const instrName = destTrack.name;
      const sectName = destIdea.sectionName;
      const navSongId = newSong.id;
      const songName = newSong.name;

      closePromoteModal();

      toast({
        title: `Promoted to ${songName} — ${instrName} · ${sectName}`,
        action: (
          <ToastAction
            altText="Open Workspace"
            className="bg-primary text-black border-primary hover:bg-primary/90 font-bold text-xs"
            onClick={() => setLocation(`/songs/${navSongId}/workspace?instrument=${encodeURIComponent(instrName)}&section=${encodeURIComponent(sectName)}`)}
          >
            Open Workspace →
          </ToastAction>
        ),
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to promote to song', description: (err as Error).message });
    } finally {
      setIsPromoting(false);
    }
  };

  const handleAddToSong = async () => {
    if (!addToSongClip?.src || !destSectionId) return;
    const destTrack = destBucket.find(t => t.ideas.some(i => i.id === destSectionId));
    const destIdea = destBucket.flatMap(t => t.ideas).find(i => i.id === destSectionId);
    const destSong = songs.find(s => s.id === destSongId);
    if (!destTrack || !destIdea || !destSong) return;

    // Capture source ID before any awaits so it stays stable through the async chain
    const sourceClipId = addToSongClip.id;
    const sourceFileId = selectedFile?.id;

    // Duplicate check: reject if destination already contains a clip with the same originalFileName
    const sourceOriginalFilename = (addToSongClip.metadata as { originalFileName?: string } | undefined)?.originalFileName;
    if (sourceOriginalFilename) {
      const dup = destIdea.clips.find(c => {
        const m = c.metadata as { originalFileName?: string } | undefined;
        return m?.originalFileName === sourceOriginalFilename;
      });
      if (dup) {
        setAddToSongDuplicateError(
          `This file was already added as '${dup.name}' in ${destTrack.name} · ${destIdea.sectionName} of ${destSong.name}`
        );
        return;
      }
    }

    setIsAddingToSong(true);
    setAddToSongDuplicateError(null);
    try {
      // Fetch the source file and re-upload it to the destination
      const fileRes = await fetch(addToSongClip.src);
      if (!fileRes.ok) throw new Error('Failed to fetch source file');
      const blob = await fileRes.blob();
      const origName = sourceOriginalFilename ?? addToSongClip.name;
      const file = new File([blob], origName, { type: blob.type || 'audio/mpeg' });

      const fd = new FormData();
      fd.append('file', file);
      fd.append('instrument', destTrack.name);
      fd.append('section', destIdea.sectionName);
      fd.append('ideaId', destSectionId);

      const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const up = await uploadRes.json();

      const versionNum = destIdea.clips.length + 1;
      const clipName = `${destTrack.name} ${destIdea.sectionName} V${versionNum}`;

      const clipRes = await fetch(`/api/ideas/${destSectionId}/clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          name: clipName,
          type: 'audio',
          color: destTrack.color ?? 'hsl(var(--primary))',
          start: 0,
          duration: up.duration,
          src: up.url,
          isFinal: false,
          active: true,
          sectionName: destIdea.sectionName,
          metadata: {
            format: up.format, originalFileName: up.originalFileName,
            uploadedBy: up.uploadedBy, uploadedDate: up.uploadedDate,
            sampleRate: up.sampleRate, bitDepth: up.bitDepth,
            channels: up.channels || 'Stereo',
            peakLevel: '', timeSignature: '', key: '', bpm: 0, description: '', tags: [],
          },
        }),
      });
      if (!clipRes.ok) throw new Error('Failed to create clip record');

      // Track which songs this idea file has been added to, then update local state immediately
      const currentAddedTo = addToSongClip.addedToSongs ?? [];
      const newAddedToSongs = [
        ...currentAddedTo,
        { songId: destSongId, songName: destSong.name, instrument: destTrack.name, section: destIdea.sectionName },
      ];
      const patchRes = await fetch(`/api/clips/${sourceClipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addedToSongs: newAddedToSongs }),
      });
      const patchBody = await patchRes.json().catch(() => null);
      console.log('[AddToSong PATCH]', { ok: patchRes.ok, status: patchRes.status, body: patchBody });
      if (patchRes.ok) {
        // Update selectedInstrument immediately so pills appear without waiting for refetch
        setSelectedInstrument(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            ideas: prev.ideas.map(idea => ({
              ...idea,
              clips: idea.clips.map(c =>
                c.id === sourceClipId ? { ...c, addedToSongs: newAddedToSongs } : c
              ),
            })),
          };
        });
      }

      // Background refetch to keep cache consistent
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(sourceFileId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(destSongId) });
      queryClient.invalidateQueries({ queryKey: ['songs'] });

      const instrName = destTrack.name;
      const sectName = destIdea.sectionName;
      const songName = destSong.name;
      const navSongId = destSongId;

      closeAddToSongModal();

      toast({
        title: `Added to ${songName} — ${instrName} · ${sectName}`,
        action: (
          <ToastAction
            altText="Open Workspace"
            className="bg-primary text-black border-primary hover:bg-primary/90 font-bold text-xs"
            onClick={() => setLocation(`/songs/${navSongId}/workspace?instrument=${encodeURIComponent(instrName)}&section=${encodeURIComponent(sectName)}`)}
          >
            Open Workspace →
          </ToastAction>
        ),
      });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to add to song', description: (err as Error).message });
    } finally {
      setIsAddingToSong(false);
    }
  };

  const openProjectModal = () => {
    setNewName('');
    setNewBpm(String(settings?.defaultBpm ?? 120));
    setNewSections(settings?.defaultSections ?? DEFAULT_SECTIONS);
    setNewInstruments(settings?.defaultInstruments ?? DEFAULT_INSTRUMENTS);
    setIsNewProjectOpen(true);
  };

  const closeModal = () => {
    setIsNewProjectOpen(false);
    setNewName('');
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
            onClick={() => { setCreateSongSource('header'); setIsChoiceOpen(true); }}
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
            onClick={() => setLocation('/')}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-bold transition-all',
              activeTab === 'dashboard' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            )}
          >
            Dashboard
          </button>
          <button
            onClick={() => setLocation(`/?tab=files&filter=${filesFilter}`)}
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
                const realSongs = songs.filter(s => s.type === 'song' || !s.type);
                const recentSongs = realSongs.slice(0, 3);
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
                const filteredSongs = realSongs.filter(s =>
                  s.name.toLowerCase().includes(songSearch.toLowerCase())
                );
                return (
                  <div className="flex flex-col gap-3">
                    {recentSongs.map(renderCard)}
                    {realSongs.length > 3 && (
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
                {(['songs', 'ideas'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => { setLocation(`/?tab=files&filter=${f}`); setSelectedFile(null); setSelectedInstrument(null); setSelectedSection(null); }}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                      filesFilter === f ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                    )}
                  >
                    {f === 'songs' ? 'Songs' : 'Ideas'}
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

            {/* Browser — conditional by mode */}
            {filesFilter === 'songs' ? (
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden flex h-[560px] relative">

              {/* Column 1 — Songs */}
              <div className="w-52 shrink-0 border-r border-white/5 flex flex-col">
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/songsheader">
                  <span>Songs</span>
                  <button
                    onClick={() => { setCreateSongSource('browser'); openProjectModal(); }}
                    className="opacity-0 group-hover/songsheader:opacity-100 hover:text-primary transition-all p-0.5"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {filteredFiles.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-8 px-2 uppercase tracking-widest">No items</p>
                  ) : filteredFiles.map(item => {
                    const isIdea = item.type === 'idea';
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setSelectedFile(item); setSelectedInstrument(null); setSelectedSection(null);
                          const s = `tab=files&filter=songs&songId=${item.id}`;
                          appliedSearchRef.current = s; setLocation(`/?${s}`);
                        }}
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
                            : <Music2 size={13} className="shrink-0" fill={item.hasFiles ? 'currentColor' : 'none'} />}
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
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/instrheader">
                  <span>{selectedFile?.type === 'idea' ? 'Folders' : 'Instruments'}</span>
                  {selectedFile && selectedFile.type !== 'idea' && (
                    <button
                      onClick={() => { setNewInstrumentName(''); setIsAddInstrumentOpen(true); }}
                      className="opacity-0 group-hover/instrheader:opacity-100 hover:text-primary transition-all p-0.5"
                    >
                      <Plus size={12} />
                    </button>
                  )}
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
                        onClick={() => {
                          setSelectedInstrument(track); setSelectedSection(null);
                          if (selectedFile) {
                            const s = `tab=files&filter=songs&songId=${selectedFile.id}&instrumentId=${track.id}`;
                            appliedSearchRef.current = s; setLocation(`/?${s}`);
                          }
                        }}
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
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/sectheader">
                  <span>{selectedFile?.type === 'idea' ? 'Subfolders' : 'Sections'}</span>
                  {selectedInstrument && selectedFile?.type !== 'idea' && (
                    <button
                      onClick={() => { setNewSectionName(''); setIsAddSectionOpen(true); }}
                      className="opacity-0 group-hover/sectheader:opacity-100 hover:text-primary transition-all p-0.5"
                    >
                      <Plus size={12} />
                    </button>
                  )}
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
                        onClick={() => {
                          setSelectedSection(idea);
                          if (selectedFile && selectedInstrument) {
                            const s = `tab=files&filter=songs&songId=${selectedFile.id}&instrumentId=${selectedInstrument.id}&sectionId=${idea.id}`;
                            appliedSearchRef.current = s; setLocation(`/?${s}`);
                          }
                        }}
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
                  if (selectedSection && e.dataTransfer.files.length > 0) {
                    const audioFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
                    if (audioFiles.length > 0) { setUploadInitialFiles(audioFiles); setIsUploadOpen(true); }
                  }
                }}
              >
                <div className="px-3 h-8 flex items-center justify-between border-b border-white/5 bg-white/[0.02] shrink-0">
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
                        onClick={() => { setUploadInitialFiles([]); setIsUploadOpen(true); }}
                        className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors rounded px-2 py-1 font-bold"
                      >
                        <Upload size={10} />
                        Upload
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {!selectedSection ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">
                      {!selectedInstrument
                        ? 'Select an instrument to browse sections'
                        : `Select a ${selectedFile?.type === 'idea' ? 'subfolder' : 'section'} to view files`}
                    </p>
                  ) : selectedSection.clips.length === 0 ? (
                    <div className={cn(
                      'flex flex-col items-center justify-start pt-4 border-2 border-dashed rounded-lg transition-colors mx-1',
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
                            <div><WaveformPlayerCard src={clip.src} name={clip.name} duration={clip.duration} isFinal={clip.isFinal} waveformHeight={20} /></div>
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
            ) : (
            /* Ideas — 3-column browser */
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden flex h-[560px] relative">

              {/* Column 1 — Ideas list */}
              <div className="w-52 shrink-0 border-r border-white/5 flex flex-col">
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/ideasheader">
                  <span>Ideas</span>
                  <button
                    onClick={() => { setNewIdeaName(''); setIsNewIdeaOpen(true); }}
                    className="opacity-0 group-hover/ideasheader:opacity-100 hover:text-primary transition-all p-0.5"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {filteredFiles.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-8 px-2 uppercase tracking-widest">No ideas yet</p>
                  ) : filteredFiles.map(idea => (
                    <button
                      key={idea.id}
                      onClick={() => {
                        setSelectedFile(idea); setSelectedInstrument(null); setSelectedSection(null);
                        const s = `tab=files&filter=ideas&ideaId=${idea.id}`;
                        appliedSearchRef.current = s; setLocation(`/?${s}`);
                      }}
                      className={cn(
                        'w-full flex items-center justify-between p-2 rounded text-xs transition-all',
                        selectedFile?.id === idea.id
                          ? 'bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]'
                          : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Lightbulb size={13} className="shrink-0" fill={idea.hasFiles ? 'currentColor' : 'none'} />
                        <span className="font-bold tracking-tight truncate">{idea.name}</span>
                      </div>
                      <ChevronRight size={12} className="opacity-40 shrink-0 ml-1" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Column 2 — Parts (instrument_tracks) */}
              <div className="w-44 shrink-0 border-r border-white/5 flex flex-col bg-black/10">
                <div className="px-3 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/partsheader">
                  <span>Parts</span>
                  {selectedFile && (
                    <button
                      onClick={() => { setNewPartName(''); setIsAddPartOpen(true); }}
                      className="opacity-0 group-hover/partsheader:opacity-100 hover:text-primary transition-all p-0.5"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {!selectedFile ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">Select an idea</p>
                  ) : fileBucket.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 leading-relaxed">No parts yet. Add a part to get started.</p>
                  ) : fileBucket.map(track => {
                    const hasFiles = track.ideas.some(i => i.clips.length > 0);
                    return (
                      <button
                        key={track.id}
                        onClick={() => {
                          setSelectedInstrument(track); setSelectedSection(track.ideas[0] ?? null);
                          if (selectedFile) {
                            const s = `tab=files&filter=ideas&ideaId=${selectedFile.id}&partId=${track.id}`;
                            appliedSearchRef.current = s; setLocation(`/?${s}`);
                          }
                        }}
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

              {/* Column 3 — Files (first idea slot of selected part) */}
              <div
                className={cn('flex-1 flex flex-col transition-colors', isDragOver && selectedSection ? 'bg-primary/5' : 'bg-black/20')}
                onDragOver={e => { e.preventDefault(); if (selectedSection) setIsDragOver(true); }}
                onDragLeave={e => { const rel = e.relatedTarget; if (!rel || !e.currentTarget.contains(rel as Node)) setIsDragOver(false); }}
                onDrop={e => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (selectedSection && e.dataTransfer.files.length > 0) {
                    const audioFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
                    if (audioFiles.length > 0) { setUploadInitialFiles(audioFiles); setIsUploadOpen(true); }
                  }
                }}
              >
                <div className="px-3 h-8 flex items-center justify-between border-b border-white/5 bg-white/[0.02] shrink-0">
                  <span className="text-[10px] uppercase tracking-tighter text-muted-foreground font-bold">Files</span>
                  {selectedSection && (
                    <button
                      onClick={() => { setUploadInitialFiles([]); setIsUploadOpen(true); }}
                      className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors rounded px-2 py-1 font-bold"
                    >
                      <Upload size={10} />
                      Upload
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                  {!selectedInstrument ? (
                    <p className="text-[10px] text-muted-foreground/40 italic text-center mt-10 px-3 uppercase tracking-widest leading-relaxed">
                      Select a part to view files
                    </p>
                  ) : (() => {
                    const clips = selectedInstrument.ideas[0]?.clips ?? [];
                    if (clips.length === 0) return (
                      <div className={cn(
                        'flex flex-col items-center justify-start pt-4 border-2 border-dashed rounded-lg transition-colors mx-1',
                        isDragOver ? 'border-primary/50 bg-primary/5' : 'border-white/8'
                      )}>
                        <Upload size={20} className={cn('mb-3', isDragOver ? 'text-primary/60' : 'text-white/15')} />
                        <p className={cn('text-[10px] uppercase tracking-widest mb-1', isDragOver ? 'text-primary/70' : 'text-muted-foreground/50')}>
                          {isDragOver ? 'Drop to upload' : 'No files yet'}
                        </p>
                        <p className="text-[10px] text-muted-foreground/30">Drop audio files or use Upload above</p>
                      </div>
                    );
                    return (
                      <>
                        {isDragOver && (
                          <div className="border-2 border-dashed border-primary/50 rounded-lg p-2 text-center mb-1">
                            <p className="text-[10px] text-primary/70 uppercase tracking-widest">Drop to add more files</p>
                          </div>
                        )}
                        {clips.map(clip => (
                          <ContextMenu key={clip.id}>
                            <ContextMenuTrigger asChild>
                              <div>
                                <WaveformPlayerCard src={clip.src} name={clip.name} duration={clip.duration} isFinal={clip.isFinal} waveformHeight={20}>
                                  {clip.addedToSongs && clip.addedToSongs.length > 0 && (
                                    <div className="flex flex-wrap gap-1 px-2.5 pb-1.5 pt-0.5 border-t border-white/[0.04]">
                                      {clip.addedToSongs.map((a, i) => (
                                        <span key={i} className="text-[9px] font-bold tracking-tight bg-primary/15 text-primary border border-primary/25 rounded-sm px-1.5 py-0.5 max-w-[120px] truncate">
                                          {a.songName}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </WaveformPlayerCard>
                              </div>
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
                              <ContextMenuItem
                                onClick={() => setAddToSongClip(clip)}
                                className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2"
                              >
                                <Share2 size={13} className="text-white/50" /> Add to Song
                              </ContextMenuItem>
                              <ContextMenuSeparator className="bg-white/5" />
                              <ContextMenuItem
                                onClick={() => {
                                  setPromoteClip(clip);
                                  setPromoteSongName(clip.name.replace(/\.[^.]+$/, ''));
                                  setPromoteInstrument(settings?.defaultInstruments?.[0] ?? DEFAULT_INSTRUMENTS[0]);
                                  setPromoteSection(settings?.defaultSections?.[0] ?? DEFAULT_SECTIONS[0]);
                                }}
                                className="text-xs text-primary/80 focus:bg-white/8 focus:text-primary cursor-pointer flex items-center gap-2"
                              >
                                <Sparkles size={13} className="text-primary/50" /> Promote to Song
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>

            </div>
            )}

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
                  metadata: infoClip.metadata ?? undefined,
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

      {/* Add to Song Modal */}
      <Dialog open={!!addToSongClip} onOpenChange={open => { if (!open) closeAddToSongModal(); }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              Add to Song
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {addToSongClip && (
              <p className="text-xs text-muted-foreground truncate">
                Copying <span className="text-white/80 font-medium">{addToSongClip.name}</span> to a song destination.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Song</Label>
              <Select
                value={destSongId}
                onValueChange={v => { setDestSongId(v); setDestInstrumentId(''); setDestSectionId(''); setAddToSongDuplicateError(null); }}
              >
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder="Select a song…" />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {songs.filter(s => s.type === 'song' || !s.type).map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-xs focus:bg-white/8 focus:text-white">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Instrument</Label>
              <Select
                value={destInstrumentId}
                onValueChange={v => { setDestInstrumentId(v); setDestSectionId(''); setAddToSongDuplicateError(null); }}
                disabled={!destSongId || destBucket.length === 0}
              >
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder={destSongId ? 'Select an instrument…' : 'Select a song first'} />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {destBucket.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs focus:bg-white/8 focus:text-white">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Section</Label>
              <Select
                value={destSectionId}
                onValueChange={v => { setDestSectionId(v); setAddToSongDuplicateError(null); }}
                disabled={!destInstrumentId}
              >
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder={destInstrumentId ? 'Select a section…' : 'Select an instrument first'} />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {(destBucket.find(t => t.id === destInstrumentId)?.ideas ?? []).map(idea => (
                    <SelectItem key={idea.id} value={idea.id} className="text-xs focus:bg-white/8 focus:text-white">
                      {idea.sectionName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {addToSongDuplicateError && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-md px-3 py-2 mt-2 leading-snug">
              {addToSongDuplicateError}
            </p>
          )}
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs"
              onClick={closeAddToSongModal}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddToSong}
              disabled={!destSectionId || isAddingToSong}
              className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
            >
              {isAddingToSong ? 'Adding…' : 'Add to Song'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promote to Song Modal */}
      <Dialog open={!!promoteClip} onOpenChange={open => { if (!open) closePromoteModal(); }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              Promote to Song
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {promoteClip && (
              <p className="text-xs text-muted-foreground truncate">
                Creating a new song from <span className="text-white/80 font-medium">{promoteClip.name}</span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Song Name</Label>
              <Input
                autoFocus
                value={promoteSongName}
                onChange={e => setPromoteSongName(e.target.value)}
                placeholder="e.g. Neon Static"
                className="bg-black/40 border-white/10 text-xs h-9 focus-visible:ring-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Place in Instrument</Label>
              <Select value={promoteInstrument} onValueChange={setPromoteInstrument}>
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder="Select an instrument…" />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {(settings?.defaultInstruments ?? DEFAULT_INSTRUMENTS).map((instr: string) => (
                    <SelectItem key={instr} value={instr} className="text-xs focus:bg-white/8 focus:text-white">
                      {instr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Place in Section</Label>
              <Select value={promoteSection} onValueChange={setPromoteSection}>
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder="Select a section…" />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {(settings?.defaultSections ?? DEFAULT_SECTIONS).map((sect: string) => (
                    <SelectItem key={sect} value={sect} className="text-xs focus:bg-white/8 focus:text-white">
                      {sect}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs"
              onClick={closePromoteModal}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePromoteToSong}
              disabled={!promoteSongName.trim() || !promoteInstrument || !promoteSection || isPromoting}
              className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
            >
              {isPromoting ? 'Promoting…' : 'Promote to Song'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Modal */}
      {selectedSection && (
        <UploadModal
          open={isUploadOpen}
          onOpenChange={setIsUploadOpen}
          songId={selectedFile?.id ?? ''}
          defaultIdeaId={selectedSection.id}
          defaultInstrumentName={filesFilter === 'ideas' ? (selectedFile?.name ?? '') : (selectedInstrument?.name ?? '')}
          defaultSectionName={filesFilter === 'ideas' ? (selectedInstrument?.name ?? '') : selectedSection.sectionName}
          songType={filesFilter === 'ideas' ? 'idea' : 'song'}
          initialFiles={uploadInitialFiles}
          onUploadSuccess={() => {
            if (filesFilter === 'ideas') queryClient.invalidateQueries({ queryKey: ['songs'] });
          }}
        />
      )}

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
              onClick={() => { setIsChoiceOpen(false); setCreateSongSource('header'); openProjectModal(); }}
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

      {/* Add Instrument Modal */}
      <Dialog open={isAddInstrumentOpen} onOpenChange={open => { if (!open) { setIsAddInstrumentOpen(false); setNewInstrumentName(''); } }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              Add Instrument
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); if (newInstrumentName.trim()) addInstrumentSongMutation.mutate(newInstrumentName.trim()); }} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Instrument Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Keys"
                value={newInstrumentName}
                onChange={e => setNewInstrumentName(e.target.value)}
                className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50"
              />
              <p className="text-[11px] text-muted-foreground">This instrument will be added across all sections.</p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="border-white/10 hover:bg-white/5 text-xs" onClick={() => { setIsAddInstrumentOpen(false); setNewInstrumentName(''); }}>Cancel</Button>
              <Button type="submit" disabled={!newInstrumentName.trim() || addInstrumentSongMutation.isPending} className="bg-primary text-black hover:bg-primary/90 font-bold text-xs">
                {addInstrumentSongMutation.isPending ? 'Adding…' : 'Add Instrument'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Section Modal */}
      <Dialog open={isAddSectionOpen} onOpenChange={open => { if (!open) { setIsAddSectionOpen(false); setNewSectionName(''); } }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              Add Section
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); if (newSectionName.trim()) addSectionSongMutation.mutate(newSectionName.trim()); }} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Section Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Pre-Chorus"
                value={newSectionName}
                onChange={e => setNewSectionName(e.target.value)}
                className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50"
              />
              <p className="text-[11px] text-muted-foreground">This section will be added to all instrument tracks simultaneously.</p>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="border-white/10 hover:bg-white/5 text-xs" onClick={() => { setIsAddSectionOpen(false); setNewSectionName(''); }}>Cancel</Button>
              <Button type="submit" disabled={!newSectionName.trim() || addSectionSongMutation.isPending} className="bg-primary text-black hover:bg-primary/90 font-bold text-xs">
                {addSectionSongMutation.isPending ? 'Adding…' : 'Add Section'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Part Modal */}
      <Dialog open={isAddPartOpen} onOpenChange={open => { if (!open) { setIsAddPartOpen(false); setNewPartName(''); } }}>
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              Add Part
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); if (newPartName.trim()) addPartMutation.mutate(newPartName.trim()); }} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Part Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Guitar"
                value={newPartName}
                onChange={e => setNewPartName(e.target.value)}
                className="bg-black/40 border-white/10 text-sm focus-visible:ring-primary/50"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="border-white/10 hover:bg-white/5 text-xs" onClick={() => { setIsAddPartOpen(false); setNewPartName(''); }}>Cancel</Button>
              <Button type="submit" disabled={!newPartName.trim() || addPartMutation.isPending} className="bg-primary text-black hover:bg-primary/90 font-bold text-xs">
                {addPartMutation.isPending ? 'Adding…' : 'Add Part'}
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
