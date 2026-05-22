import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn, capitalize } from '@/lib/utils';
import { Clip, Comment } from '@/lib/daw-data';
import { GripVertical, MessageSquare, Info, Music, Clock, Hash, Activity, HardDrive, User, Calendar, CheckCircle2, Plus, RefreshCw, Download, XCircle, FolderSearch, Pencil, Trash2, Scissors, Wand2, X, Minus } from 'lucide-react';
import { WaveformPlayerCard } from './WaveformPlayerCard';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ClipComment } from '@shared/schema';

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function avatarColor(name: string): string {
  const colors = ['#D4AF37', '#7C3AED', '#2563EB', '#16A34A', '#DC2626', '#EA580C'];
  return colors[name.charCodeAt(0) % colors.length];
}


interface ClipProps {
  clip: Clip;
  isOverlay?: boolean;
  zoom?: number;
  sectionStart?: number;
  trackId?: string;
  songId?: string;
  instanceCount?: number;
}

function InfoStat({ icon: Icon, label, value, mono }: { icon: any, label: string, value: string | number | undefined, mono?: boolean }) {
  return (
    <div className="bg-black/30 p-2.5 rounded border border-white/5 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 opacity-60">
        <Icon size={10} className="text-primary" />
        <span className="text-[9px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <span className={cn("text-xs font-medium text-foreground truncate", mono && "font-mono")}>
        {value || "---"}
      </span>
    </div>
  );
}

export function ClipInfoWindow({ clip, open, onOpenChange, onCommentsChange: _onCommentsChange, focusNotes, bucketClipId, audioBuffer, songId = 'patchbay-default' }: { clip: Clip, open: boolean, onOpenChange: (open: boolean) => void, onCommentsChange?: (comments: Comment[]) => void, focusNotes?: boolean, bucketClipId?: string, audioBuffer?: AudioBuffer, songId?: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const effectiveId = bucketClipId ?? clip.id;

  const { data: usersData = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
  });
  const bandMembers = usersData.map(u => u.username);

  // ── Comment state ──────────────────────────────────────────────────────────
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const noteInputRef = useRef<HTMLInputElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // ── Musical Intelligence editable fields ────────────────────────────────────
  const [bpm, setBpm] = useState<string>(clip.metadata?.bpm ? String(clip.metadata.bpm) : '');
  const [keyScale, setKeyScale] = useState<string>(clip.metadata?.key && clip.metadata.key !== 'Unknown' ? clip.metadata.key : '');
  const [timeSignature, setTimeSignature] = useState<string>(clip.metadata?.timeSignature ?? '');
  const [savedField, setSavedField] = useState<string | null>(null);

  // ── Meta Tags ──────────────────────────────────────────────────────────────
  const [tags, setTags] = useState<string[]>(clip.metadata?.tags ?? []);
  const [tagInput, setTagInput] = useState('');

  // ── Peak Level (computed client-side, never stored in DB) ─────────────────
  const [peakLevel, setPeakLevel] = useState<string | null>(null);

  // Re-sync editable fields when clip prop changes (e.g. after bucket refetch)
  useEffect(() => {
    setBpm(clip.metadata?.bpm ? String(clip.metadata.bpm) : '');
    setKeyScale(clip.metadata?.key && clip.metadata.key !== 'Unknown' ? clip.metadata.key : '');
    setTimeSignature(clip.metadata?.timeSignature ?? '');
    setTags(clip.metadata?.tags ?? []);
  }, [clip.id]);

  // Compute peak level — from provided buffer (TimelineClip) or decode on demand (BucketClip)
  useEffect(() => {
    if (!open) return;

    const computePeak = (buf: AudioBuffer) => {
      let peak = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const data = buf.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          const abs = Math.abs(data[i]);
          if (abs > peak) peak = abs;
        }
      }
      if (peak > 0) setPeakLevel(`${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
    };

    if (audioBuffer) {
      computePeak(audioBuffer);
      return;
    }

    if (!clip.src) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(clip.src!);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(ab);
        ctx.close();
        if (cancelled) return;
        computePeak(decoded);
      } catch { /* fail silently */ }
    })();
    return () => { cancelled = true; };
  }, [open, audioBuffer, clip.src]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const flashSaved = (field: string) => {
    setSavedField(field);
    setTimeout(() => setSavedField(null), 1500);
  };

  const patchMeta = async (updates: Partial<NonNullable<Clip['metadata']>>) => {
    const merged = { ...(clip.metadata ?? {}), ...updates } as NonNullable<Clip['metadata']>;
    try {
      await fetch(`/api/clips/${effectiveId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata: merged }),
      });
      queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
    } catch (err) {
      console.error('[clip meta] patch failed:', err);
    }
  };

  const formatDuration = (secs: number): string => {
    if (secs < 60) return `${secs.toFixed(2)}s`;
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}m ${s}s`;
  };

  // ── Mention autocomplete ────────────────────────────────────────────────────
  const mentionMatches = mentionQuery !== null
    ? bandMembers.filter((m: string) => m.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : [];

  const insertMention = (name: string) => {
    const input = noteInputRef.current;
    if (!input) return;
    const cursor = input.selectionStart ?? newComment.length;
    const atIdx = newComment.slice(0, cursor).lastIndexOf('@');
    const inserted = `${newComment.slice(0, atIdx)}@${name} ${newComment.slice(cursor)}`;
    setNewComment(inserted);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      input.focus();
      const pos = atIdx + name.length + 2;
      input.setSelectionRange(pos, pos);
    });
  };

  const handleNoteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewComment(val);
    const cursor = e.target.selectionStart ?? val.length;
    const atMatch = val.slice(0, cursor).match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const handleNoteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionMatches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
      if (e.key === 'Enter')     { e.preventDefault(); insertMention(mentionMatches[mentionIndex]); return; }
      if (e.key === 'Escape')    { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter') handleAddComment();
  };

  // ── Comment API ────────────────────────────────────────────────────────────
  const { data: clipCommentsList = [] } = useQuery<ClipComment[]>({
    queryKey: ["clip-comments", effectiveId],
    queryFn: async () => {
      const res = await fetch(`/api/clips/${effectiveId}/comments`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (open && focusNotes) {
      const timer = setTimeout(() => noteInputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [open, focusNotes]);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await fetch(`/api/clips/${effectiveId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: user?.username ?? 'Unknown', text: newComment.trim() }),
      });
      setNewComment("");
      queryClient.invalidateQueries({ queryKey: ["clip-comments", effectiveId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    } catch (err) {
      console.error('[clip comment] add failed:', err);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editText.trim()) return;
    try {
      await fetch(`/api/clip-comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText.trim() }),
      });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["clip-comments", effectiveId] });
    } catch (err) {
      console.error('[clip comment] edit failed:', err);
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await fetch(`/api/clip-comments/${id}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ["clip-comments", effectiveId] });
    } catch (err) {
      console.error('[clip comment] delete failed:', err);
    }
  };

  // ── Tag helpers ────────────────────────────────────────────────────────────
  const addTag = async () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!t || tags.includes(t)) { setTagInput(''); return; }
    const next = [...tags, t];
    setTags(next);
    setTagInput('');
    await patchMeta({ tags: next });
    flashSaved('tags');
  };

  const removeTag = async (tag: string) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    await patchMeta({ tags: next });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#0c0c0e] border-primary/30 shadow-2xl p-0 overflow-hidden gap-0" onPointerDown={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-primary/20 to-transparent p-6 border-b border-primary/10">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg shadow-lg flex items-center justify-center border border-white/10" style={{ backgroundColor: clip.color }}>
                <Music size={20} className="text-black/70" />
              </div>
              <div className="flex flex-col">
                <DialogTitle className="text-2xl font-heading font-bold text-white tracking-tight uppercase">
                  {clip.name} {clip.isFinal && <span className="text-primary ml-2">(FINAL)</span>}
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>
        </div>

        <ScrollArea className="max-h-[70vh]">
          <div className="p-6 space-y-6">

            {/* ── Technical stats (read-only) ── */}
            <div className="grid grid-cols-4 gap-3">
              <InfoStat icon={Clock} label="Duration" value={formatDuration(clip.duration)} mono />
              <InfoStat icon={Hash} label="Sample Rate" value={clip.metadata?.sampleRate} mono />
              <InfoStat icon={Activity} label="Bit Depth" value={clip.metadata?.bitDepth} mono />
              <InfoStat icon={HardDrive} label="Format" value={clip.metadata?.format} mono />
            </div>

            {/* ── Musical Intelligence (editable) ── */}
            <div>
              <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold mb-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-primary/20" /> Musical Intelligence
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {/* BPM */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 opacity-60">
                    <Activity size={10} className="text-primary" />
                    <span className="text-[9px] uppercase tracking-wider font-semibold">BPM</span>
                    {savedField === 'bpm' && <span className="text-[9px] text-green-400 ml-auto">Saved</span>}
                  </div>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={bpm}
                    onChange={e => setBpm(e.target.value)}
                    onBlur={async () => {
                      const v = parseFloat(bpm);
                      if (!isNaN(v) && v > 0) { await patchMeta({ bpm: v }); flashSaved('bpm'); }
                    }}
                    placeholder="—"
                    className="bg-black/30 border-white/5 text-xs h-7 font-mono"
                  />
                </div>
                {/* Time Signature */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 opacity-60">
                    <Clock size={10} className="text-primary" />
                    <span className="text-[9px] uppercase tracking-wider font-semibold">Time Sign.</span>
                    {savedField === 'timeSignature' && <span className="text-[9px] text-green-400 ml-auto">Saved</span>}
                  </div>
                  <Input
                    value={timeSignature}
                    onChange={e => setTimeSignature(e.target.value)}
                    onBlur={async () => {
                      await patchMeta({ timeSignature });
                      flashSaved('timeSignature');
                    }}
                    placeholder="4/4"
                    className="bg-black/30 border-white/5 text-xs h-7 font-mono"
                  />
                </div>
                {/* Key / Scale */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 opacity-60">
                    <Music size={10} className="text-primary" />
                    <span className="text-[9px] uppercase tracking-wider font-semibold">Key / Scale</span>
                    {savedField === 'key' && <span className="text-[9px] text-green-400 ml-auto">Saved</span>}
                  </div>
                  <Input
                    value={keyScale}
                    onChange={e => setKeyScale(e.target.value)}
                    onBlur={async () => {
                      await patchMeta({ key: keyScale });
                      flashSaved('key');
                    }}
                    placeholder="e.g. C Minor"
                    className="bg-black/30 border-white/5 text-xs h-7 placeholder:text-[10px] placeholder:text-muted-foreground placeholder:italic"
                  />
                </div>
              </div>
            </div>

            {/* ── Asset Chain (read-only) ── */}
            <div>
              <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold mb-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-primary/20" /> Asset Chain
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <InfoStat icon={User} label="Uploaded By" value={clip.metadata?.uploadedBy ? capitalize(clip.metadata.uploadedBy) : undefined} />
                <InfoStat icon={Calendar} label="Date Added" value={clip.metadata?.uploadedDate} mono />
                <div className="col-span-2">
                  <InfoStat icon={Info} label="Original File Name" value={clip.metadata?.originalFileName} mono />
                </div>
              </div>
            </div>

            {/* ── Technical + Meta Tags ── */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                  <div className="h-px flex-1 bg-primary/20" /> Technical
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Channels</span>
                    <span className="text-foreground font-mono">{clip.metadata?.channels || '—'}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Peak Level</span>
                    <span className="text-foreground font-mono">{peakLevel ?? '—'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                  <div className="h-px flex-1 bg-primary/20" /> Meta Tags
                  {savedField === 'tags' && <span className="text-[9px] text-green-400 normal-case font-normal tracking-normal">Saved</span>}
                </h4>
                <div className="flex flex-wrap gap-1.5 min-h-[22px]">
                  {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-muted-foreground">
                      #{tag}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => removeTag(tag)}
                        className="ml-0.5 hover:text-red-400 transition-colors"
                      >
                        <X size={8} />
                      </button>
                    </span>
                  ))}
                </div>
                <Input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Add tag and press Enter…"
                  className="bg-black/40 border-white/10 text-xs h-7 placeholder:text-[10px] placeholder:text-muted-foreground placeholder:italic"
                />
              </div>
            </div>

            {/* ── Session Notes ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2 flex-1">
                  <div className="h-px flex-1 bg-primary/20" /> Session Notes
                </h4>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={noteInputRef}
                      placeholder="Add a collaboration note..."
                      value={newComment}
                      onChange={handleNoteChange}
                      onKeyDown={handleNoteKeyDown}
                      className="bg-black/40 border-white/10 text-xs h-9 w-full placeholder:text-[10px] placeholder:text-muted-foreground placeholder:italic"
                    />
                    {mentionQuery !== null && mentionMatches.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-xl overflow-hidden">
                        {mentionMatches.map((name, i) => (
                          <button
                            key={name}
                            onMouseDown={(e) => { e.preventDefault(); insertMention(name); }}
                            className={cn(
                              'w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors',
                              i === mentionIndex ? 'bg-white/10 text-white' : 'text-muted-foreground hover:bg-white/10 hover:text-white'
                            )}
                          >
                            <div
                              className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-black shrink-0"
                              style={{ backgroundColor: avatarColor(name) }}
                            >
                              {capitalize(name).charAt(0)}
                            </div>
                            @{capitalize(name)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button size="sm" onClick={handleAddComment} className="h-9 px-3">
                    <Plus size={14} />
                  </Button>
                </div>

                <div className="bg-black/30 rounded border border-white/5 p-1 max-h-[300px] overflow-y-auto">
                  {clipCommentsList.length > 0 ? (
                    <div className="space-y-1">
                      {clipCommentsList.map(c => (
                        <div key={c.id} className="p-3 hover:bg-white/5 transition-colors rounded group/comment">
                          <div className="flex justify-between items-start mb-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-black shrink-0"
                                style={{ backgroundColor: avatarColor(c.author) }}
                              >
                                {capitalize(c.author).charAt(0)}
                              </div>
                              <span className="text-[11px] font-bold text-primary">{capitalize(c.author)}</span>
                              <span className="text-[9px] text-muted-foreground font-mono opacity-50">{formatRelativeTime(c.timestamp)}</span>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                              <button
                                onClick={() => { setEditingId(c.id); setEditText(c.text); }}
                                className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Pencil size={10} />
                              </button>
                              <button
                                onClick={() => handleDeleteComment(c.id)}
                                className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-red-400 transition-colors"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          </div>
                          {editingId === c.id ? (
                            <div className="flex gap-2 mt-2">
                              <Input
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveEdit(c.id);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                className="bg-black/40 border-white/10 text-xs h-7 flex-1"
                                autoFocus
                              />
                              <Button size="sm" onClick={() => handleSaveEdit(c.id)} className="h-7 px-2 text-[10px]">Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 px-2 text-[10px]">Cancel</Button>
                            </div>
                          ) : (
                            <p className="text-xs text-foreground/80 leading-relaxed italic">"{c.text}"</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 flex flex-col items-center justify-center text-muted-foreground text-[11px] italic opacity-40">
                      <MessageSquare size={16} className="mb-2" />
                      No collaboration notes for this asset.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
        <div className="p-4 bg-black/40 border-t border-white/5 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-[10px] uppercase tracking-widest h-8 font-bold">Close Inspector</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ReplacementClip = {
  id: string;
  name: string;
  duration: number;
  src: string | null;
  isFinal: boolean;
  createdAt: string;
};

export function TimelineClip({ clip, isOverlay, zoom = 80, sectionStart = 0, trackId, songId = 'patchbay-default', instanceCount = 1 }: ClipProps) {
  const { user } = useAuth();
  const [showInfo, setShowInfo] = useState(false);
  const [focusNotes, setFocusNotes] = useState(false);
  const [isFinal, setIsFinal] = useState(clip.isFinal);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [replacements, setReplacements] = useState<ReplacementClip[] | null>(null);
  const [replacementsLoading, setReplacementsLoading] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<ReplacementClip | null>(null);
  const [trimStart, setTrimStart] = useState(clip.trimStart ?? 0);
  const [trimEnd, setTrimEnd] = useState<number | null>(clip.trimEnd ?? null);
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  const [isHovered, setIsHovered] = useState(false);
  const [isTrimDragging, setIsTrimDragging] = useState(false);
  const [hasDecodedBuffer, setHasDecodedBuffer] = useState(false);
  const [detectedTrim, setDetectedTrim] = useState<{ trimStart: number; trimEnd: number } | null>(null);
  const [showApplyTrimConfirm, setShowApplyTrimConfirm] = useState(false);
  const [applyTrimInstanceCount, setApplyTrimInstanceCount] = useState(0);
  const [showResetTrimAllConfirm, setShowResetTrimAllConfirm] = useState(false);
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  // Always keep drawRef current so ResizeObserver and trim effects get fresh values
  drawRef.current = () => {
    const canvas = canvasRef.current;
    const buffer = decodedBufferRef.current;
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

    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const startSample = Math.floor(trimStart * sampleRate);
    const endSample = Math.floor((trimEnd ?? clip.duration) * sampleRate);
    const samples = channelData.slice(startSample, Math.min(endSample, channelData.length));

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';

    const samplesPerPixel = samples.length / w;
    const midY = h / 2;

    for (let x = 0; x < w; x++) {
      const startIdx = Math.floor(x * samplesPerPixel);
      const endIdx = Math.floor((x + 1) * samplesPerPixel);
      let min = 0;
      let max = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const s = samples[i];
        if (s < min) min = s;
        if (s > max) max = s;
      }
      const yTop = midY - max * midY;
      const yBottom = midY - min * midY;
      ctx.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
    }
  };

  // TODO: implement waveform caching (Option A) if performance becomes an issue
  // Fetch and decode audio — only re-runs when src changes; buffer is cached in decodedBufferRef
  useEffect(() => {
    if (!clip.src || isOverlay) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(clip.src!);
        if (cancelled) return;
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        audioCtx.close();
        if (cancelled) return;

        decodedBufferRef.current = decoded;
        setHasDecodedBuffer(true);
        drawRef.current?.();
      } catch {
        // fail silently — clip renders normally without waveform
      }
    })();

    return () => { cancelled = true; };
  }, [clip.src, isOverlay]);

  // Redraw when trim changes — buffer already decoded, no re-fetch needed
  useEffect(() => {
    drawRef.current?.();
  }, [trimStart, trimEnd, clip.duration]);

  // Redraw on zoom/resize — fires whenever the canvas CSS width changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current?.());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setIsFinal(clip.isFinal ?? false);
  }, [clip.isFinal]);

  useEffect(() => {
    setTrimStart(clip.trimStart ?? 0);
    trimStartRef.current = clip.trimStart ?? 0;
    setTrimEnd(clip.trimEnd ?? null);
    trimEndRef.current = clip.trimEnd ?? null;
  }, [clip.trimStart, clip.trimEnd]);

  const patchTrim = async (newTrimStart: number, newTrimEnd: number | null) => {
    try {
      const res = await fetch(`/api/timeline-clips/${clip.id}/trim`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trimStart: newTrimStart, trimEnd: newTrimEnd }),
      });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      }
    } catch (err) {
      console.error('Failed to patch trim:', err);
    }
  };

  const handleLeftTrimDrag = (e: React.PointerEvent) => {
    if (isOverlay) return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    setIsTrimDragging(true);
    const startX = e.clientX;
    const startTrimStart = trimStartRef.current;

    const onMove = (moveE: PointerEvent) => {
      const delta = moveE.clientX - startX;
      const deltaSecs = delta / zoom;
      const maxTrimStart = (trimEndRef.current ?? clip.duration) - 0.5;
      const newTrimStart = Math.max(0, Math.min(maxTrimStart, startTrimStart + deltaSecs));
      trimStartRef.current = newTrimStart;
      setTrimStart(newTrimStart);
      window.dispatchEvent(new CustomEvent('trim-preview', {
        detail: { clipId: clip.id, trimStart: newTrimStart, trimEnd: trimEndRef.current },
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setIsTrimDragging(false);
      patchTrim(trimStartRef.current, trimEndRef.current);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleRightTrimDrag = (e: React.PointerEvent) => {
    if (isOverlay) return;
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    setIsTrimDragging(true);
    const startX = e.clientX;
    const startTrimEnd = trimEndRef.current ?? clip.duration;

    const onMove = (moveE: PointerEvent) => {
      const delta = moveE.clientX - startX;
      const deltaSecs = delta / zoom;
      const minTrimEnd = trimStartRef.current + 0.5;
      const newTrimEnd = Math.max(minTrimEnd, Math.min(clip.duration, startTrimEnd + deltaSecs));
      trimEndRef.current = newTrimEnd;
      setTrimEnd(newTrimEnd);
      window.dispatchEvent(new CustomEvent('trim-preview', {
        detail: { clipId: clip.id, trimStart: trimStartRef.current, trimEnd: newTrimEnd },
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setIsTrimDragging(false);
      // Store null when trim is at the very end of the file (no right trim)
      const finalTrimEnd = trimEndRef.current;
      const storedTrimEnd = finalTrimEnd !== null && finalTrimEnd >= clip.duration - 0.01 ? null : finalTrimEnd;
      trimEndRef.current = storedTrimEnd;
      setTrimEnd(storedTrimEnd);
      patchTrim(trimStartRef.current, storedTrimEnd);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleResetTrim = async () => {
    setTrimStart(0);
    setTrimEnd(null);
    trimStartRef.current = 0;
    trimEndRef.current = null;
    await patchTrim(0, null);
  };

  const detectTrimPoints = () => {
    const buffer = decodedBufferRef.current;
    if (!buffer) return;

    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const totalSamples = channelData.length;
    const windowSize = Math.floor(sampleRate * 0.1); // 100ms windows

    // Find peak amplitude across all samples
    let peak = 0;
    for (let i = 0; i < totalSamples; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > peak) peak = abs;
    }
    if (peak === 0) return; // pure silence — nothing to detect

    const threshold = peak * 0.01; // 1% of peak

    // Scan forward: find first 100ms window whose average exceeds threshold
    let detectedStart = 0;
    for (let i = 0; i < totalSamples; i += windowSize) {
      const windowEnd = Math.min(i + windowSize, totalSamples);
      let sum = 0;
      for (let j = i; j < windowEnd; j++) sum += Math.abs(channelData[j]);
      if (sum / (windowEnd - i) > threshold) {
        detectedStart = i / sampleRate;
        break;
      }
    }

    // Scan backward: find last 100ms window (from end) whose average exceeds threshold
    let detectedEnd = clip.duration;
    for (let i = totalSamples - windowSize; i >= 0; i -= windowSize) {
      const windowStart = Math.max(i, 0);
      const windowEnd = Math.min(windowStart + windowSize, totalSamples);
      let sum = 0;
      for (let j = windowStart; j < windowEnd; j++) sum += Math.abs(channelData[j]);
      if (sum / (windowEnd - windowStart) > threshold) {
        detectedEnd = windowEnd / sampleRate;
        break;
      }
    }

    // Enforce minimum effective duration of 0.5s
    if (detectedEnd - detectedStart < 0.5) {
      const mid = (detectedStart + detectedEnd) / 2;
      detectedStart = Math.max(0, mid - 0.25);
      detectedEnd = Math.min(clip.duration, mid + 0.25);
    }

    setDetectedTrim({ trimStart: detectedStart, trimEnd: detectedEnd });
  };

  const handleApplyTrimToInstances = () => {
    // instanceCount includes this clip; "other" count = instanceCount - 1.
    // The menu item is only rendered when instanceCount > 1, so this is always >= 1.
    setApplyTrimInstanceCount(instanceCount - 1);
    setShowApplyTrimConfirm(true);
  };

  const performApplyTrimToInstances = async () => {
    setShowApplyTrimConfirm(false);
    try {
      await fetch('/api/timeline-clips/apply-trim-to-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, name: clip.name, trimStart, trimEnd }),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
    } catch (err) {
      console.error('Failed to apply trim to instances:', err);
    }
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: clip.id,
    data: { clip: { ...clip, isFinal }, type: 'clip', trackId },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const displayWidth = ((trimEnd ?? clip.duration) - trimStart) * zoom;

  const positionStyle: React.CSSProperties = isOverlay ? { width: displayWidth } : {
    width: displayWidth,
    left: (clip.start - sectionStart) * zoom,
    position: 'absolute',
    zIndex: 1,
    ...(isTrimDragging ? {} : style),
  };

  const handleMarkFinal = async () => {
    const newIsFinal = !isFinal;
    setIsFinal(newIsFinal); // optimistic
    try {
      const res = await fetch(`/api/timeline-clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFinal: newIsFinal, author: user?.username ?? 'Unknown' }),
      });
      if (!res.ok) {
        setIsFinal(!newIsFinal); // revert
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
      queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
    } catch {
      setIsFinal(!newIsFinal); // revert
    }
  };

  const fetchReplacements = async () => {
    setReplacementsLoading(true);
    try {
      const res = await fetch(`/api/timeline-clips/${clip.id}/replacements`);
      if (res.ok) setReplacements(await res.json());
    } catch {
      // leave replacements null — "No other versions found" will show
    } finally {
      setReplacementsLoading(false);
    }
  };

  const performReplace = async (replacement: ReplacementClip) => {
    try {
      const res = await fetch(`/api/timeline-clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: replacement.name,
          src: replacement.src ?? null,
          duration: replacement.duration,
          type: 'audio',
          color: clip.color,
          isFinal: false,
          trimStart: 0,
          trimEnd: null,
        }),
      });
      if (res.ok) {
        setDetectedTrim(null);
        window.dispatchEvent(new CustomEvent('clip-replaced', { detail: { clipId: clip.id } }));
        queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
        queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
        queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
        queryClient.invalidateQueries({ queryKey: ['activity'] });
      }
    } catch (err) {
      console.error('Failed to replace clip:', err);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            style={positionStyle}
            {...listeners}
            {...attributes}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
              "h-full rounded-md border border-white/10 flex items-center overflow-hidden group cursor-grab active:cursor-grabbing shadow-sm touch-none select-none",
              isOverlay && "shadow-2xl scale-105 opacity-90",
              isFinal && "ring-1 ring-primary/50"
            )}
          >
            <div
              className="absolute inset-0 opacity-80"
              style={{ backgroundColor: clip.color || 'hsl(var(--primary))' }}
            />

            {isFinal && (
              <div className="absolute top-0 right-0 p-0.5 bg-primary rounded-bl shadow-lg z-10">
                <CheckCircle2 size={10} className="text-black" />
              </div>
            )}

            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />

            {/* Left trim handle — at the left edge of the (already-trimmed) clip */}
            {!isOverlay && (
              <div
                onPointerDown={handleLeftTrimDrag}
                className="absolute z-20 transition-opacity"
                style={{
                  top: 0,
                  left: 0,
                  width: 8,
                  height: '100%',
                  opacity: isHovered ? 1 : 0,
                  pointerEvents: isHovered ? 'auto' : 'none',
                  cursor: 'ew-resize',
                  background: 'rgba(212,175,55,0.9)',
                  borderRadius: '2px',
                }}
              />
            )}

            {/* Right trim handle — at the right edge of the (already-trimmed) clip */}
            {!isOverlay && (
              <div
                onPointerDown={handleRightTrimDrag}
                className="absolute z-20 transition-opacity"
                style={{
                  top: 0,
                  right: 0,
                  width: 8,
                  height: '100%',
                  opacity: isHovered ? 1 : 0,
                  pointerEvents: isHovered ? 'auto' : 'none',
                  cursor: 'ew-resize',
                  background: 'rgba(212,175,55,0.9)',
                  borderRadius: '2px',
                }}
              />
            )}

            <div className="relative z-10 px-2 flex items-center gap-1 w-full justify-between pointer-events-none">
              <div className="flex items-center gap-1 truncate">
                <GripVertical size={12} className="text-black/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className={cn(
                  "text-xs font-medium text-black truncate select-none mix-blend-multiply",
                  isFinal && "font-bold"
                )}>
                  {clip.name}
                </span>
              </div>

              {clip.comments && clip.comments.length > 0 && (
                <div className="flex items-center bg-black/20 rounded px-1 shrink-0">
                  <MessageSquare size={10} className="text-black" />
                  <span className="text-[10px] font-bold text-black ml-0.5">{clip.comments.length}</span>
                </div>
              )}
            </div>

            {/* AI trim detection overlay */}
            {!isOverlay && detectedTrim && (() => {
              const currentEnd = trimEnd ?? clip.duration;
              const leftPx = Math.max(0, Math.min(displayWidth, (detectedTrim.trimStart - trimStart) * zoom));
              const rightPx = Math.max(0, Math.min(displayWidth, (currentEnd - detectedTrim.trimEnd) * zoom));
              const activeLeft = leftPx;
              const activeWidth = Math.max(0, displayWidth - leftPx - rightPx);
              return (
                <>
                  {leftPx > 0 && (
                    <div style={{ position: 'absolute', top: 0, left: 0, width: leftPx, bottom: 0, backgroundColor: 'rgba(59,130,246,0.4)', zIndex: 15, pointerEvents: 'none' }} />
                  )}
                  {rightPx > 0 && (
                    <div style={{ position: 'absolute', top: 0, right: 0, width: rightPx, bottom: 0, backgroundColor: 'rgba(59,130,246,0.4)', zIndex: 15, pointerEvents: 'none' }} />
                  )}
                  <div style={{ position: 'absolute', top: 0, left: activeLeft, width: activeWidth, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 25 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const newTrimStart = detectedTrim.trimStart;
                          const rawEnd = detectedTrim.trimEnd;
                          const newTrimEnd = rawEnd >= clip.duration - 0.01 ? null : rawEnd;
                          setTrimStart(newTrimStart);
                          setTrimEnd(newTrimEnd);
                          trimStartRef.current = newTrimStart;
                          trimEndRef.current = newTrimEnd;
                          window.dispatchEvent(new CustomEvent('trim-preview', {
                            detail: { clipId: clip.id, trimStart: newTrimStart, trimEnd: newTrimEnd },
                          }));
                          patchTrim(newTrimStart, newTrimEnd);
                          setDetectedTrim(null);
                        }}
                        style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', backgroundColor: '#D4AF37', color: 'black', borderRadius: 3, border: 'none', cursor: 'pointer', letterSpacing: '0.05em', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
                      >
                        Apply
                      </button>
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                        onClick={(e) => { e.stopPropagation(); setDetectedTrim(null); }}
                        style={{ padding: '1px 6px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', backgroundColor: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.7)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="bg-popover border-border min-w-[160px]">
          <ContextMenuItem onClick={() => setShowInfo(true)} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <Info size={14} className="text-primary" /> More Info
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { setShowInfo(true); setFocusNotes(true); }} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <MessageSquare size={14} className="text-primary" /> Add Note
          </ContextMenuItem>
          
          <ContextMenuItem onClick={handleMarkFinal} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <CheckCircle2 size={14} className={isFinal ? "text-primary" : "text-muted-foreground"} />
            {isFinal ? "Unmark Final" : "Mark as Final"}
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => {
              window.dispatchEvent(new CustomEvent('find-in-bucket', {
                detail: { trackId, sectionName: clip.sectionName, clipName: clip.name },
              }));
            }}
            className="gap-2 text-xs uppercase tracking-wider font-semibold"
          >
            <FolderSearch size={14} className="text-primary" /> Show in File Browser
          </ContextMenuItem>

          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2 text-xs uppercase tracking-wider font-semibold">
              <Scissors size={14} className="text-primary" /> Trim
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="bg-popover border-border min-w-[200px]">
              <ContextMenuItem onClick={detectTrimPoints} disabled={!hasDecodedBuffer} className="gap-2 text-xs uppercase tracking-wider font-semibold">
                <Wand2 size={14} className="text-primary" /> Detect Trim Points
              </ContextMenuItem>
              {instanceCount > 1 && (trimStart > 0 || trimEnd !== null) && (
                <ContextMenuItem onClick={handleApplyTrimToInstances} className="gap-2 text-xs uppercase tracking-wider font-semibold">
                  <Scissors size={14} className="text-primary" /> Apply Trim to All Instances
                </ContextMenuItem>
              )}
              {instanceCount > 1 && (trimStart > 0 || trimEnd !== null) && (
                <ContextMenuItem onClick={() => setShowResetTrimAllConfirm(true)} className="gap-2 text-xs uppercase tracking-wider font-semibold">
                  <Scissors size={14} className="text-primary" /> Reset Trim on All Instances
                </ContextMenuItem>
              )}
              {(trimStart > 0 || trimEnd !== null) && (
                <ContextMenuItem onClick={handleResetTrim} className="gap-2 text-xs uppercase tracking-wider font-semibold">
                  <Scissors size={14} className="text-primary" /> Reset Trim
                </ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <Separator className="my-1 bg-border/50" />

          <ContextMenuSub onOpenChange={(open) => { if (open) fetchReplacements(); }}>
            <ContextMenuSubTrigger className="gap-2 text-xs uppercase tracking-wider font-semibold">
              <RefreshCw size={14} className="text-primary" /> Replace
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="bg-popover border-border min-w-[200px]">
              {replacementsLoading ? (
                <div className="p-4 text-[10px] text-muted-foreground italic text-center uppercase tracking-widest">Loading…</div>
              ) : replacements && replacements.length > 0 ? (
                replacements.map((r) => (
                  <ContextMenuItem
                    key={r.id}
                    className="text-xs flex flex-col items-start gap-0.5 py-2"
                    onClick={() => {
                      if (isFinal) {
                        setPendingReplacement(r);
                        setShowReplaceConfirm(true);
                      } else {
                        performReplace(r);
                      }
                    }}
                  >
                    <span className="font-bold">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.duration}s{r.isFinal ? ' · Final' : ''}
                    </span>
                  </ContextMenuItem>
                ))
              ) : (
                <div className="p-4 text-[10px] text-muted-foreground italic text-center uppercase tracking-widest">No other versions found</div>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          <Separator className="my-1 bg-border/50" />
          
          <ContextMenuItem onClick={(e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = clip.src || '#'; // In a real app this would be the actual audio URL
            link.download = clip.metadata?.originalFileName || `${clip.name}.wav`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <Download size={14} className="text-primary" /> Download
          </ContextMenuItem>

          <Separator className="my-1 bg-border/50" />
          
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation();
              if (isFinal) {
                setShowRemoveConfirm(true);
              } else {
                window.dispatchEvent(new CustomEvent('remove-clip', { detail: { clipId: clip.id } }));
              }
            }}
            className="text-red-400 gap-2 text-xs uppercase tracking-wider font-semibold focus:text-red-300 focus:bg-red-400/10"
          >
            <XCircle size={14} className="text-red-400" />
            Remove Clip
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ClipInfoWindow
        clip={{...clip, isFinal}}
        open={showInfo}
        onOpenChange={(open) => { setShowInfo(open); if (!open) setFocusNotes(false); }}
        focusNotes={focusNotes}
        songId={songId}
        audioBuffer={decodedBufferRef.current ?? undefined}
        bucketClipId={(() => {
          const bucketData = queryClient.getQueryData<any[]>(['bucket', songId]);
          if (!bucketData || !trackId) return undefined;
          const track = bucketData.find((t: any) => t.id === trackId);
          const idea = track?.ideas?.find((i: any) => i.sectionName === clip.sectionName);
          return idea?.clips?.find((c: any) => c.name === clip.name)?.id as string | undefined;
        })()}
      />

      <AlertDialog open={showRemoveConfirm} onOpenChange={setShowRemoveConfirm}>
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Remove Final Clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This clip has been marked as final. Are you sure you want to remove it from the timeline?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('remove-clip', { detail: { clipId: clip.id } }));
                setShowRemoveConfirm(false);
              }}
            >
              Remove Clip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showReplaceConfirm} onOpenChange={(open) => { if (!open) { setShowReplaceConfirm(false); setPendingReplacement(null); } }}>
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Replace Final Clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This clip is marked as final. Replacing it will set it as non-final. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingReplacement) performReplace(pendingReplacement);
                setShowReplaceConfirm(false);
                setPendingReplacement(null);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetTrimAllConfirm} onOpenChange={(open) => { if (!open) setShowResetTrimAllConfirm(false); }}>
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Reset Trim on All Instances?</AlertDialogTitle>
            <AlertDialogDescription>
              Reset trim on all {instanceCount - 1} other {instanceCount - 1 === 1 ? 'instance' : 'instances'} of &ldquo;{clip.name}&rdquo;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              setShowResetTrimAllConfirm(false);
              try {
                await fetch('/api/timeline-clips/apply-trim-to-instances', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ trackId, name: clip.name, trimStart: 0, trimEnd: null }),
                });
                queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
              } catch (err) {
                console.error('Failed to reset trim on instances:', err);
              }
            }}>
              Reset All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showApplyTrimConfirm} onOpenChange={(open) => { if (!open) setShowApplyTrimConfirm(false); }}>
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Apply Trim to All Instances?</AlertDialogTitle>
            <AlertDialogDescription>
              Apply this trim to all {applyTrimInstanceCount} other {applyTrimInstanceCount === 1 ? 'instance' : 'instances'} of &ldquo;{clip.name}&rdquo;? This will overwrite any existing trim on those clips.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performApplyTrimToInstances}>
              Apply to All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface BucketClipProps {
  clip: Clip;
  trackId?: string;
  songId?: string;
  onAddToTimeline?: (clip: Clip) => void;
  siblingClips?: Clip[];
  autoOpenInfo?: boolean;
}

import { useLocation } from 'wouter';

export function BucketClip({ clip, trackId, songId = 'patchbay-default', onAddToTimeline, siblingClips = [], autoOpenInfo }: BucketClipProps) {
  const { user } = useAuth();
  const [showInfo, setShowInfo] = useState(false);
  const [focusNotes, setFocusNotes] = useState(false);
  const [isFinal, setIsFinal] = useState(clip.isFinal ?? false);
  const [comments, setComments] = useState(clip.comments || []);
  const [showChangeFinalConfirm, setShowChangeFinalConfirm] = useState(false);
  const [location] = useLocation();
  const [isHighlighted, setIsHighlighted] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setIsFinal(clip.isFinal ?? false);
  }, [clip.isFinal]);

  useEffect(() => {
    if (autoOpenInfo) {
      setShowInfo(true);
      setFocusNotes(true);
    }
  }, [autoOpenInfo]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const urlFile = searchParams.get('file');
    if (urlFile === clip.id) {
      setIsHighlighted(true);
      const timer = setTimeout(() => setIsHighlighted(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [location, clip.id]);

  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `bucket-${clip.id}`,
    data: { clip: { ...clip, isFinal, comments }, type: 'bucket-clip', trackId },
  });

  const handleUpdateComments = (newComments: Comment[]) => {
    setComments(newComments);
  };

  const style = { transform: CSS.Translate.toString(transform) };

  const executeMark = async (newIsFinal: boolean) => {
    setIsFinal(newIsFinal);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFinal: newIsFinal, author: user?.username ?? 'Unknown' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        console.error('[markFinal] error:', err.message);
        setIsFinal(!newIsFinal);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    } catch (err) {
      console.error('[markFinal] network error:', err);
      setIsFinal(!newIsFinal);
    }
  };

  const handleToggleFinal = () => {
    const newIsFinal = !isFinal;
    if (newIsFinal) {
      const anotherIsFinal = siblingClips.some(c => c.id !== clip.id && c.isFinal);
      if (anotherIsFinal) {
        setShowChangeFinalConfirm(true);
        return;
      }
    }
    executeMark(newIsFinal);
  };

  const handleRemove = async () => {
    try {
      await fetch(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
    } catch (err) {
      console.error('[removeClip] error:', err);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className="select-none touch-none cursor-grab active:cursor-grabbing"
          >
            <WaveformPlayerCard
              src={clip.src}
              name={clip.name}
              duration={clip.duration}
              isFinal={isFinal}
              color={clip.color}
              waveformHeight={32}
              className={cn(
                isHighlighted && 'ring-1 ring-primary/50 shadow-[inset_0_0_15px_rgba(212,175,55,0.2)]'
              )}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="bg-popover border-border min-w-[160px]">
          <ContextMenuItem onClick={() => setShowInfo(true)} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <Info size={14} className="text-primary" /> More Info
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { setShowInfo(true); setFocusNotes(true); }} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <MessageSquare size={14} className="text-primary" /> Add Note
          </ContextMenuItem>
          <ContextMenuItem onClick={(e) => { e.stopPropagation(); handleToggleFinal(); }} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <CheckCircle2 size={14} className={isFinal ? "text-primary" : "text-primary/40"} />
            {isFinal ? "Unmark Final" : "Mark as Final"}
          </ContextMenuItem>
          <ContextMenuItem onClick={(e) => { e.stopPropagation(); onAddToTimeline?.(clip); }} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <Plus size={14} className="text-primary" /> Add to Timeline
          </ContextMenuItem>
          <Separator className="my-1 bg-border/50" />
          <ContextMenuItem onClick={(e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = clip.src || '#';
            link.download = clip.metadata?.originalFileName || `${clip.name}.wav`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <Download size={14} className="text-primary" /> Download
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => { e.stopPropagation(); handleRemove(); }}
            className="gap-2 text-xs uppercase tracking-wider font-semibold text-red-400 focus:text-red-400 focus:bg-red-400/10"
          >
            <Minus size={14} /> Remove
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ClipInfoWindow
        clip={{...clip, isFinal, comments}}
        open={showInfo}
        onOpenChange={(open) => { setShowInfo(open); if (!open) setFocusNotes(false); }}
        onCommentsChange={handleUpdateComments}
        bucketClipId={clip.id}
        focusNotes={focusNotes}
        songId={songId}
      />

      <AlertDialog open={showChangeFinalConfirm} onOpenChange={setShowChangeFinalConfirm}>
        <AlertDialogContent className="bg-[#0c0c0e] border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Change Final Version?</AlertDialogTitle>
            <AlertDialogDescription>
              Another version is already marked as final for this section. Do you want to make this version the final instead?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { executeMark(true); setShowChangeFinalConfirm(false); }}
            >
              Make Final
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
