import React, { useState, useRef, KeyboardEvent } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Music2, Plus, Clock, Gauge, X, MoreHorizontal, Trash2, ChevronRight, Circle } from 'lucide-react';
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
import { AppHeader } from '@/components/AppHeader';

const DEFAULT_SECTIONS = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'];
const DEFAULT_INSTRUMENTS = ['Drums', 'Bass', 'Guitar 1', 'Guitar 2', 'Vocals'];

interface Song {
  id: string;
  name: string;
  bpm: number | null;
  sections: string[];
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
  if (event.instrument && event.sectionName) {
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  }
  return `/songs/${event.songId}`;
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
  const queryClient = useQueryClient();

  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBpm, setNewBpm] = useState('120');
  const [newSections, setNewSections] = useState<string[]>(DEFAULT_SECTIONS);
  const [newInstruments, setNewInstruments] = useState<string[]>(DEFAULT_INSTRUMENTS);

  const { data: songs = [], isLoading } = useQuery<Song[]>({
    queryKey: ['songs'],
    queryFn: () => fetch('/api/songs').then(r => r.json()),
  });

  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ['all-tasks'],
    queryFn: () => fetch('/api/tasks').then(r => r.json()),
  });

  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const { data: activityEvents = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['activity'],
    queryFn: () => fetch('/api/activity').then(r => r.json()),
    refetchInterval: 10000,
  });

  const visibleActivity = showAllActivity ? activityEvents : activityEvents.slice(0, 5);

  // TODO: replace with real auth user
  const CURRENT_USER = 'Jordan';

  const activeTasks = sortByDueDate(
    allTasks.filter(t =>
      (t.status === 'todo' || t.status === 'in-progress') && t.assignee === CURRENT_USER
    )
  );
  const visibleTasks = showAllTasks ? activeTasks : activeTasks.slice(0, 5);

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
      closeModal();
      setLocation(`/songs/${song.id}`);
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

  const closeModal = () => {
    setIsNewProjectOpen(false);
    setNewName('');
    setNewBpm('120');
    setNewSections(DEFAULT_SECTIONS);
    setNewInstruments(DEFAULT_INSTRUMENTS);
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
            onClick={() => setIsNewProjectOpen(true)}
            className="h-9 px-4 bg-primary text-black hover:bg-primary/90 font-bold text-xs flex items-center gap-2"
          >
            <Plus size={14} /> New Project
          </Button>
        }
      />

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-heading font-black tracking-tight mb-1">Your Songs</h2>
          <p className="text-sm text-muted-foreground">Select a project to open its workspace.</p>
        </div>

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
              onClick={() => setIsNewProjectOpen(true)}
              className="h-9 px-5 bg-primary text-black hover:bg-primary/90 font-bold text-xs flex items-center gap-2"
            >
              <Plus size={14} /> New Project
            </Button>
          </div>
        )}

        {!isLoading && songs.length > 0 && (
          <div className="flex flex-col gap-3">
            {songs.map(song => (
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
                    {song.bpm && (
                      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-black/40 px-2 py-1 rounded border border-white/5">
                        <Gauge size={10} className="text-primary/60" />
                        {song.bpm} BPM
                      </div>
                    )}
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
            ))}
          </div>
        )}

        {/* ── Upcoming Tasks ─────────────────────────────────────────────────── */}
        {activeTasks.length > 0 && (
          <section className="mt-12">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-white/80">Upcoming Tasks</h2>
            </div>
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
          </section>
        )}
        {/* ── Activity ───────────────────────────────────────────────────────── */}
        {activityEvents.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-4">Activity</h2>
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden divide-y divide-white/5">
              {visibleActivity.map((event, i) => (
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
                      url,
                    });
                    setLocation(url);
                  }}
                  className="flex items-start justify-between px-5 py-3.5 hover:bg-white/[0.03] hover:border-l-2 hover:border-primary/40 transition-all cursor-pointer group gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-white/80 group-hover:text-white transition-colors truncate">
                      {event.description}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{event.songName}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.timestamp)}</span>
                </div>
              ))}
            </div>
            {activityEvents.length > 5 && (
              <button
                onClick={() => setShowAllActivity(v => !v)}
                className="mt-2 w-full text-center text-xs font-bold text-white/40 hover:text-primary transition-colors py-2"
              >
                {showAllActivity ? 'Show less' : `Show ${activityEvents.length - 5} more`}
              </button>
            )}
          </section>
        )}
      </main>

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
