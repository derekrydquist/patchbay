import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle2, Circle, Clock, Ban, Music2, Plus, MessageSquare, Pencil, Trash2, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import type { ProductionTask, TaskComment } from '@shared/schema';

const SONG_ID = 'patchbay-default';

const ASSIGNEES = ['Alex', 'Jamie', 'Sam', 'Jordan', 'Taylor', 'Riley'];

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-red-500', 'bg-orange-500', 'bg-pink-500',
];

type TaskStatus = 'todo' | 'in-progress' | 'complete' | 'will-not-play';

type StatusCfg = {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconClass: string;
  cellBg: string;
};

const STATUS_CONFIG: Record<TaskStatus, StatusCfg> = {
  'todo':          { label: 'TO DO',         icon: Circle,       iconClass: 'text-white/30', cellBg: '' },
  'in-progress':   { label: 'IN PROGRESS',   icon: Clock,        iconClass: 'text-blue-300', cellBg: 'bg-blue-400/10' },
  'complete':      { label: 'COMPLETE',       icon: CheckCircle2, iconClass: 'text-primary',  cellBg: 'bg-primary/10' },
  'will-not-play': { label: 'WILL NOT PLAY', icon: Ban,          iconClass: 'text-red-400/70', cellBg: 'bg-red-950/30 shadow-[inset_0_0_0_1px_rgba(220,38,38,0.3)]' },
};

type BucketClip = { id: string; name: string; isFinal: boolean };
type BucketIdea = { id: string; sectionName: string; clips: BucketClip[] };
type BucketTrack = { id: string; name: string; ideas: BucketIdea[] };

function avatarColor(name: string): string {
  const idx = ASSIGNEES.indexOf(name);
  return idx >= 0 ? AVATAR_COLORS[idx] : 'bg-white/20';
}

function formatTimestamp(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

// ── CellModal ─────────────────────────────────────────────────────────────────

function CellModal({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: ProductionTask;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newComment, setNewComment] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savedField, setSavedField] = useState<string | null>(null);

  const { data: comments = [] } = useQuery<TaskComment[]>({
    queryKey: ['task-comments', task.id],
    queryFn: () => fetch(`/api/production-tasks/${task.id}/comments`).then(r => r.json()),
    enabled: open,
  });

  const patchTask = useMutation({
    mutationFn: async (updates: Partial<ProductionTask>) => {
      const r = await fetch(`/api/production-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updates, author: 'Unknown' }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to update task');
      }
      return r.json();
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['production-tasks', SONG_ID] });
      const prev = queryClient.getQueryData<ProductionTask[]>(['production-tasks', SONG_ID]);
      queryClient.setQueryData<ProductionTask[]>(['production-tasks', SONG_ID], (old) =>
        old?.map(t => t.id === task.id ? { ...t, ...updates } : t)
      );
      return { prev };
    },
    onSuccess: (_data, variables) => {
      const field = 'status' in variables ? 'status' : 'assignee' in variables ? 'assignee' : 'dueDate' in variables ? 'dueDate' : null;
      if (field) {
        setSavedField(field);
        setTimeout(() => setSavedField(null), 1500);
      }
    },
    onError: (err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['production-tasks', SONG_ID], context.prev);
      toast({
        title: 'Cannot update task',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['production-tasks', SONG_ID] });
      queryClient.invalidateQueries({ queryKey: ['task-comments', task.id] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', 'patchbay-default'] });
      queryClient.invalidateQueries({ queryKey: ['bucket', 'patchbay-default'] });
    },
  });

  const addComment = useMutation({
    mutationFn: (text: string) =>
      fetch(`/api/production-tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'You', text }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', task.id] });
      queryClient.invalidateQueries({ queryKey: ['task-comment-counts', SONG_ID] });
      setNewComment('');
    },
  });

  const editComment = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      fetch(`/api/task-comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', task.id] });
      setEditingId(null);
    },
  });

  const deleteComment = useMutation({
    mutationFn: (id: string) => fetch(`/api/task-comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-comments', task.id] });
    },
  });

  const status = task.status as TaskStatus;

  function submitComment() {
    const text = newComment.trim();
    if (text) addComment.mutate(text);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0c0c0e] border-primary/20 p-0 overflow-hidden flex flex-col max-h-[85vh]">
        {/* ── Header ── */}
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent shrink-0">
          <DialogHeader>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-primary/70">{task.instrument}</div>
              <DialogTitle className="text-xl font-heading font-bold text-white uppercase">{task.sectionName}</DialogTitle>
            </div>
          </DialogHeader>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-4 space-y-6">

            {/* ── STATUS ── */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1 flex items-center">
                Status
                {savedField === 'status' && (
                  <span className="text-green-400 text-xs flex items-center gap-1 ml-2">
                    <Check size={10} /> Saved
                  </span>
                )}
              </label>
              <div className="space-y-1.5">
                {(Object.entries(STATUS_CONFIG) as [TaskStatus, StatusCfg][]).map(([s, cfg]) => {
                  const Icon = cfg.icon;
                  const isSelected = status === s;
                  return (
                    <button
                      key={s}
                      onClick={() => patchTask.mutate({ status: s })}
                      className={cn(
                        'w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all',
                        isSelected && s === 'will-not-play'
                          ? 'border-red-800/50 bg-red-950/40'
                          : isSelected
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.05]'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={14} className={cfg.iconClass} />
                        <span className={cn(
                          'text-xs uppercase tracking-[0.2em] font-bold',
                          s === 'will-not-play' ? 'text-red-400/70' : 'text-white/80'
                        )}>
                          {cfg.label}
                        </span>
                      </div>
                      {isSelected && <CheckCircle2 size={14} className={s === 'will-not-play' ? 'text-red-400/70' : 'text-primary'} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── ASSIGNEE ── */}
            <div className="space-y-2 pt-4 border-t border-white/5">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1 flex items-center">
                Assignee
                {savedField === 'assignee' && (
                  <span className="text-green-400 text-xs flex items-center gap-1 ml-2">
                    <Check size={10} /> Saved
                  </span>
                )}
              </label>
              <div className="px-1">
                <Select
                  value={task.assignee || 'unassigned'}
                  onValueChange={(val) => patchTask.mutate({ assignee: val === 'unassigned' ? '' : val })}
                >
                  <SelectTrigger className="w-full bg-black/40 border-white/10 text-xs h-10">
                    <div className="flex items-center gap-2 flex-1">
                      {task.assignee ? (
                        <>
                          <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0', avatarColor(task.assignee))}>
                            {task.assignee.charAt(0)}
                          </div>
                          <span>{task.assignee}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#0c0c0e] border-white/10">
                    <SelectItem value="unassigned" className="text-xs text-muted-foreground focus:bg-white/5 focus:text-white">
                      Unassigned
                    </SelectItem>
                    {ASSIGNEES.map(name => (
                      <SelectItem key={name} value={name} className="text-xs focus:bg-white/5 focus:text-white">
                        <div className="flex items-center gap-2">
                          <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white', avatarColor(name))}>
                            {name.charAt(0)}
                          </div>
                          {name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── DUE DATE ── */}
            <div className="space-y-2 pt-4 border-t border-white/5">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1 flex items-center">
                Due Date
                {savedField === 'dueDate' && (
                  <span className="text-green-400 text-xs flex items-center gap-1 ml-2">
                    <Check size={10} /> Saved
                  </span>
                )}
              </label>
              <div className="px-1">
                <Input
                  type="date"
                  value={task.dueDate || ''}
                  onChange={(e) => patchTask.mutate({ dueDate: e.target.value || null })}
                  className="bg-black/40 border-white/10 text-xs h-10 w-full"
                />
              </div>
            </div>

            {/* ── SESSION NOTES ── */}
            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2 flex-1">
                  <div className="h-px flex-1 bg-primary/20" /> Session Notes
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a collaboration note..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                    className="bg-black/40 border-white/10 text-xs h-9"
                  />
                  <Button size="sm" onClick={submitComment} className="h-9 px-3">
                    <Plus size={14} />
                  </Button>
                </div>

                <div className="bg-black/30 rounded border border-white/5 p-1 max-h-[300px] overflow-y-auto">
                  {comments.length > 0 ? (
                    <div className="space-y-1">
                      {comments.map(c => (
                        <div key={c.id} className="p-3 hover:bg-white/5 transition-colors rounded">
                          {editingId === c.id ? (
                            <div className="space-y-2">
                              <Input
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="bg-black/40 border-white/10 text-xs h-8"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') editComment.mutate({ id: c.id, text: editText });
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="h-7 text-[10px] px-2" onClick={() => editComment.mutate({ id: c.id, text: editText })}>
                                  Save
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2 text-muted-foreground" onClick={() => setEditingId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                                  <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white', avatarColor(c.author))}>
                                    {c.author.charAt(0)}
                                  </div>
                                  {c.author}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] text-muted-foreground font-mono opacity-50">{formatTimestamp(c.timestamp)}</span>
                                  <button
                                    onClick={() => { setEditingId(c.id); setEditText(c.text); }}
                                    className="text-white/20 hover:text-white/60 transition-colors"
                                  >
                                    <Pencil size={10} />
                                  </button>
                                  <button
                                    onClick={() => deleteComment.mutate(c.id)}
                                    className="text-white/20 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-foreground/80 leading-relaxed italic">"{c.text}"</p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 flex flex-col items-center justify-center text-muted-foreground text-[11px] italic opacity-40">
                      <MessageSquare size={16} className="mb-2" />
                      No collaboration notes for this cell.
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <div className="p-4 border-t border-white/5 shrink-0 flex justify-end">
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 uppercase text-xs font-bold tracking-wider"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── ProductionTracker ─────────────────────────────────────────────────────────

export function ProductionTracker() {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const { data: song } = useQuery<{ name: string }>({
    queryKey: ['song', SONG_ID],
    queryFn: () => fetch(`/api/songs/${SONG_ID}`).then(r => r.json()),
  });

  const { data: tasks = [] } = useQuery<ProductionTask[]>({
    queryKey: ['production-tasks', SONG_ID],
    queryFn: () => fetch(`/api/songs/${SONG_ID}/production-tasks`).then(r => r.json()),
  });

  const { data: bucket = [] } = useQuery<BucketTrack[]>({
    queryKey: ['bucket', SONG_ID],
    queryFn: () => fetch(`/api/songs/${SONG_ID}/bucket`).then(r => r.json()),
  });

  const { data: finalClipsBucket = [] } = useQuery<BucketTrack[]>({
    queryKey: ['final-clips', SONG_ID],
    queryFn: () => fetch(`/api/songs/${SONG_ID}/bucket`).then(r => r.json()),
  });

  const { data: commentCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ['task-comment-counts', SONG_ID],
    queryFn: () => fetch(`/api/songs/${SONG_ID}/task-comment-counts`).then(r => r.json()),
  });

  // Map of `${instrument}__${sectionName}` → final clip name
  const finalClipsMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const track of finalClipsBucket) {
      for (const idea of track.ideas) {
        const finalClip = idea.clips?.find(c => c.isFinal);
        if (finalClip) map[`${track.name}__${idea.sectionName}`] = finalClip.name;
      }
    }
    return map;
  }, [finalClipsBucket]);

  // Deduplicated sections in first-appearance order across all tracks
  const sections = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const track of bucket) {
      for (const idea of track.ideas) {
        if (!seen.has(idea.sectionName)) {
          seen.add(idea.sectionName);
          result.push(idea.sectionName);
        }
      }
    }
    return result;
  }, [bucket]);

  const activeTask = tasks.find(t => t.id === activeTaskId) ?? null;

  function findTask(trackName: string, section: string): ProductionTask | null {
    return tasks.find(t => t.instrument === trackName && t.sectionName === section) ?? null;
  }

  return (
    <div className="h-full flex flex-col bg-[#09090b] text-foreground overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 py-4 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Music2 size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-heading font-bold uppercase tracking-[0.2em] text-white">Production Whiteboard</h2>
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Track each instrument against the song structure</p>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-[1100px] border border-white/5 bg-white/[0.02] shadow-2xl shadow-black/40 overflow-hidden">
          <div
            className="grid"
            style={{ gridTemplateColumns: `220px repeat(${bucket.length}, minmax(150px, 1fr))` }}
          >
            {/* Column headers */}
            <div className="sticky left-0 z-20 bg-[#0c0c0e] border-r border-white/5 px-4 py-4 flex items-center">
              <span className="text-[10px] uppercase tracking-widest text-primary/70 font-bold">{song?.name ?? 'Song Sections'}</span>
            </div>
            {bucket.map((track) => (
              <div key={track.id} className="border-l border-white/5 px-4 py-4 bg-[#0c0c0e]">
                <div className="text-[11px] font-heading font-bold uppercase tracking-wider text-white/70 truncate">{track.name}</div>
              </div>
            ))}

            {/* Data rows */}
            {sections.map((section) => (
              <React.Fragment key={section}>
                <div className="sticky left-0 z-10 bg-[#0b0b0d] border-r border-t border-white/5 px-4 py-4 flex items-center justify-center text-center">
                  <div className="text-[10px] uppercase tracking-widest text-white/80 font-bold">{section}</div>
                </div>
                {bucket.map((track) => {
                  const task = findTask(track.name, section);
                  const status = (task?.status ?? 'todo') as TaskStatus;
                  const cfg = STATUS_CONFIG[status];
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={track.id}
                      onClick={() => task && setActiveTaskId(task.id)}
                      className={cn(
                        'relative border-t border-l border-white/5 min-h-[78px] p-3 text-left transition-all cursor-pointer flex flex-col',
                        'hover:bg-white/5 hover:shadow-[inset_0_0_0_1px_#D4AF37] focus:outline-none focus:ring-2 focus:ring-primary/40',
                        cfg.cellBg
                      )}
                    >
                      {/* TOP ZONE */}
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon size={13} className={cfg.iconClass} />
                          <span className={cn(
                            'text-[9px] uppercase tracking-[0.2em] font-bold truncate',
                            status === 'complete'      && 'text-primary',
                            status === 'in-progress'   && 'text-blue-300',
                            status === 'will-not-play' && 'text-red-400/70',
                            status === 'todo'          && 'text-white/45'
                          )}>
                            {cfg.label}
                          </span>
                        </div>
                        {status === 'complete' && (
                          <div className="text-[10px] text-primary truncate font-bold font-mono">
                            {finalClipsMap[`${track.name}__${section}`] ?? task?.title}
                          </div>
                        )}
                      </div>

                      {/* BOTTOM ZONE */}
                      {task && (
                        (commentCounts[task.id] ?? 0) > 0 || task.assignee || task.dueDate
                      ) && (
                        <div className="flex items-center justify-between w-full mt-auto pt-1">
                          <div className="flex items-center gap-1.5">
                            {task?.assignee && (
                              <div className={cn('w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0', avatarColor(task.assignee))}>
                                {task.assignee.charAt(0)}
                              </div>
                            )}
                            {task?.dueDate && (
                              <div className="text-[9px] font-mono text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded">
                                {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 text-white/50">
                            {(commentCounts[task.id] ?? 0) > 0 && (
                              <>
                                <MessageSquare size={10} />
                                <span className="text-[9px] font-mono">{commentCounts[task.id]}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* ── Task detail modal ── */}
      {activeTask && (
        <CellModal
          key={activeTask.id}
          open={true}
          onOpenChange={(v) => !v && setActiveTaskId(null)}
          task={activeTask}
        />
      )}
    </div>
  );
}
