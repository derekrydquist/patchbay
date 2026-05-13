import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Clip, Comment } from '@/lib/daw-data';
import { GripVertical, MessageSquare, Info, Music, Clock, Hash, Activity, HardDrive, User, Calendar, CheckCircle2, Plus, RefreshCw, Download, XCircle, FolderSearch, Pencil, Trash2, Scissors } from 'lucide-react';
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
import { Badge } from "@/components/ui/badge";
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

const BAND_MEMBERS = ["Alex", "Jamie", "Sam", "Jordan", "Taylor", "Riley"];

interface ClipProps {
  clip: Clip;
  isOverlay?: boolean;
  zoom?: number;
  sectionStart?: number;
  trackId?: string;
  songId?: string;
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

export function ClipInfoWindow({ clip, open, onOpenChange, onCommentsChange, focusNotes, bucketClipId }: { clip: Clip, open: boolean, onOpenChange: (open: boolean) => void, onCommentsChange?: (comments: Comment[]) => void, focusNotes?: boolean, bucketClipId?: string }) {
  const queryClient = useQueryClient();
  const effectiveId = bucketClipId ?? clip.id;
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const noteInputRef = useRef<HTMLInputElement | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionMatches = mentionQuery !== null
    ? BAND_MEMBERS.filter(m => m.toLowerCase().startsWith(mentionQuery.toLowerCase()))
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
        body: JSON.stringify({ author: 'Unknown', text: newComment.trim() }),
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
                <div className="flex items-center gap-2 mt-1">
                   <Badge variant="outline" className="text-[10px] bg-primary/10 border-primary/20 text-primary uppercase">{clip.type}</Badge>
                   <span className="text-[10px] text-muted-foreground font-mono">{clip.id}</span>
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>

        <ScrollArea className="max-h-[70vh]">
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-4 gap-3">
              <InfoStat icon={Clock} label="Duration" value={`${clip.duration} Units`} mono />
              <InfoStat icon={Hash} label="Sample Rate" value={clip.metadata?.sampleRate} mono />
              <InfoStat icon={Activity} label="Bit Depth" value={clip.metadata?.bitDepth} mono />
              <InfoStat icon={HardDrive} label="Format" value={clip.metadata?.format} mono />
            </div>

            <div>
              <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold mb-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-primary/20" /> Musical Intelligence
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <InfoStat icon={Music} label="Key / Scale" value={clip.metadata?.key} />
                <InfoStat icon={Clock} label="Time Sign." value={clip.metadata?.timeSignature} mono />
                <InfoStat icon={Activity} label="BPM" value={clip.metadata?.bpm} mono />
              </div>
            </div>

            <div>
              <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold mb-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-primary/20" /> Asset Chain
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <InfoStat icon={User} label="Uploaded By" value={clip.metadata?.uploadedBy} />
                <InfoStat icon={Calendar} label="Date Added" value={clip.metadata?.uploadedDate} mono />
                <div className="col-span-2">
                   <InfoStat icon={Info} label="Original File Name" value={clip.metadata?.originalFileName} mono />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                 <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                  <div className="h-px flex-1 bg-primary/20" /> Technical
                </h4>
                <div className="space-y-2">
                   <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Channels</span>
                      <span className="text-foreground">{clip.metadata?.channels}</span>
                   </div>
                   <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Peak Level</span>
                      <span className="text-foreground">{clip.metadata?.peakLevel}</span>
                   </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                  <div className="h-px flex-1 bg-primary/20" /> Meta Tags
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {clip.metadata?.tags.map(tag => (
                    <span key={tag} className="text-[9px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-muted-foreground hover:text-primary transition-colors cursor-default">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

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
                      className="bg-black/40 border-white/10 text-xs h-9 w-full"
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
                              {name.charAt(0)}
                            </div>
                            @{name}
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
                                {c.author.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[11px] font-bold text-primary">{c.author}</span>
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

export function TimelineClip({ clip, isOverlay, zoom = 80, sectionStart = 0, trackId, songId = 'patchbay-default' }: ClipProps) {
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
  const queryClient = useQueryClient();

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

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: clip.id,
    data: { clip: { ...clip, isFinal }, type: 'clip' },
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
        body: JSON.stringify({ isFinal: newIsFinal, author: 'Unknown' }),
      });
      if (!res.ok) {
        setIsFinal(!newIsFinal); // revert
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
      queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
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
        window.dispatchEvent(new CustomEvent('clip-replaced', { detail: { clipId: clip.id } }));
        queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
        queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
        queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
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
              <div className="absolute top-0 right-0 p-0.5 bg-primary rounded-bl shadow-lg">
                <CheckCircle2 size={10} className="text-black" />
              </div>
            )}

            <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
               <svg width="100%" height="100%" preserveAspectRatio="none">
                  <path d={`M0,${50 + Math.random() * 10} Q${displayWidth/4},${20} ${displayWidth/2},${50} T${displayWidth},${50}`} fill="none" stroke="black" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
               </svg>
            </div>

            {/* Left trim handle — at the left edge of the (already-trimmed) clip */}
            {!isOverlay && (
              <div
                onPointerDown={handleLeftTrimDrag}
                className="absolute z-20 pointer-events-auto transition-opacity"
                style={{
                  top: 0,
                  left: 0,
                  width: 8,
                  height: '100%',
                  opacity: isHovered ? 1 : 0,
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
                className="absolute z-20 pointer-events-auto transition-opacity"
                style={{
                  top: 0,
                  right: 0,
                  width: 8,
                  height: '100%',
                  opacity: isHovered ? 1 : 0,
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

          {(trimStart > 0 || trimEnd !== null) && (
            <ContextMenuItem onClick={handleResetTrim} className="gap-2 text-xs uppercase tracking-wider font-semibold">
              <Scissors size={14} className="text-primary" /> Reset Trim
            </ContextMenuItem>
          )}

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
  const [showInfo, setShowInfo] = useState(false);
  const [focusNotes, setFocusNotes] = useState(false);
  const [isFinal, setIsFinal] = useState(clip.isFinal ?? false);
  const [comments, setComments] = useState(clip.comments || []);
  const [showChangeFinalConfirm, setShowChangeFinalConfirm] = useState(false);
  const [location] = useLocation();

  const [isHighlighted, setIsHighlighted] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isRightClicking = useRef(false);
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

  const handleMouseEnter = () => {
    if (!clip.src || isRightClicking.current || contextMenuOpen) return;
    const audio = new Audio(clip.src);
    audio.volume = 0.7;
    audioRef.current = audio;
    audio.play().catch(() => {});
  };

  const handleMouseLeave = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setTimeout(() => { isRightClicking.current = false; }, 100);
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const urlFile = searchParams.get('file');
    if (urlFile === clip.id) {
      setIsHighlighted(true);
      const timer = setTimeout(() => setIsHighlighted(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [location, clip.id]);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bucket-${clip.id}`,
    data: { clip: { ...clip, isFinal, comments }, type: 'bucket-clip', trackId },
  });

  const handleUpdateComments = (newComments: Comment[]) => {
    setComments(newComments);
  };

  // Fixed drag style - ensures transform is applied correctly for dnd-kit
  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const executeMark = async (newIsFinal: boolean) => {
    setIsFinal(newIsFinal); // optimistic update
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFinal: newIsFinal, author: 'Unknown' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        console.error('[markFinal] error:', err.message);
        setIsFinal(!newIsFinal); // revert on failure
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['bucket', songId] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    } catch (err) {
      console.error('[markFinal] network error:', err);
      setIsFinal(!newIsFinal); // revert on failure
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

  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToTimeline?.(clip);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={() => { isRightClicking.current = true; }}
        className={cn(
          "p-2 py-1.5 rounded-md border border-border bg-card hover:bg-accent/50 flex items-center gap-3 transition-all duration-500 group h-10 w-full relative overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing",
          isFinal && "border-primary/50 bg-primary/5 shadow-[0_0_15px_rgba(212,175,55,0.1)]",
          isHighlighted && "bg-primary/20 border-primary/50 shadow-[inset_0_0_15px_rgba(212,175,55,0.2)]"
        )}
      >
        <div 
          className="w-1.5 h-full rounded-full shrink-0" 
          style={{ backgroundColor: clip.color || 'hsl(var(--primary))' }}
        />
        <div className="flex flex-1 items-center justify-between min-w-0 pointer-events-none select-none">
          <div className="flex items-center gap-2 truncate">
            <span className={cn(
              "text-xs font-bold truncate transition-colors tracking-tight",
              isFinal ? "text-primary" : "text-white group-hover:text-primary"
            )}>{clip.name}</span>
            {isFinal && <CheckCircle2 size={10} className="text-primary" />}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {clip.comments && clip.comments.length > 0 && <MessageSquare size={10} className="text-primary/60" />}
            <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-tighter">{clip.duration}s</span>
          </div>
        </div>

        <ContextMenu onOpenChange={(open) => {
            setContextMenuOpen(open);
            if (open && audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
              audioRef.current = null;
            }
          }}>
          <ContextMenuTrigger 
            className="absolute inset-0 z-0" 
            onMouseDown={(e) => {
              // Ensure context menu doesn't steal the drag event
              if (e.button !== 2) e.stopPropagation();
            }}
          />
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
            <ContextMenuItem onClick={handleAddClick} className="gap-2 text-xs uppercase tracking-wider font-semibold">
              <Plus size={14} className="text-primary" /> Add to Timeline
            </ContextMenuItem>
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
          </ContextMenuContent>
        </ContextMenu>
      </div>
      
      <ClipInfoWindow
        clip={{...clip, isFinal, comments}}
        open={showInfo}
        onOpenChange={(open) => { setShowInfo(open); if (!open) setFocusNotes(false); }}
        onCommentsChange={handleUpdateComments}
        bucketClipId={clip.id}
        focusNotes={focusNotes}
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
