import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Clip, Comment } from '@/lib/daw-data';
import { GripVertical, MessageSquare, Info, Music, Clock, Hash, Activity, HardDrive, User, Calendar, CheckCircle2, Plus, RefreshCw, Download, XCircle } from 'lucide-react';
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

interface ClipProps {
  clip: Clip;
  isOverlay?: boolean;
  zoom?: number;
  sectionStart?: number;
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

export function ClipInfoWindow({ clip, open, onOpenChange, onCommentsChange }: { clip: Clip, open: boolean, onOpenChange: (open: boolean) => void, onCommentsChange?: (comments: Comment[]) => void }) {
  const [newComment, setNewComment] = useState("");
  const [comments, setComments] = useState(clip.comments || []);

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      author: "Current User",
      text: newComment,
      timestamp: Date.now(),
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const updatedComments = [comment, ...comments];
    setComments(updatedComments);
    onCommentsChange?.(updatedComments);
    setNewComment("");
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
                  <Input 
                    placeholder="Add a collaboration note..." 
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                    className="bg-black/40 border-white/10 text-xs h-9"
                  />
                  <Button size="sm" onClick={handleAddComment} className="h-9 px-3">
                    <Plus size={14} />
                  </Button>
                </div>

                <div className="bg-black/30 rounded border border-white/5 p-1 max-h-[300px] overflow-y-auto">
                  {comments.length > 0 ? (
                    <div className="space-y-1">
                      {comments.map(c => (
                        <div key={c.id} className="p-3 hover:bg-white/5 transition-colors rounded">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                              <User size={10} /> {c.author}
                            </span>
                            <span className="text-[9px] text-muted-foreground font-mono opacity-50">{c.createdAt}</span>
                          </div>
                          <p className="text-xs text-foreground/80 leading-relaxed italic">"{c.text}"</p>
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

export function TimelineClip({ clip, isOverlay, zoom = 80, sectionStart = 0 }: ClipProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [isFinal, setIsFinal] = useState(clip.isFinal);
  const [comments, setComments] = useState(clip.comments || []);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [replacements, setReplacements] = useState<ReplacementClip[] | null>(null);
  const [replacementsLoading, setReplacementsLoading] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<ReplacementClip | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setIsFinal(clip.isFinal ?? false);
  }, [clip.isFinal]);
  
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: clip.id,
    data: { clip: { ...clip, isFinal, comments }, type: 'clip' },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  const width = clip.duration * zoom;
  
  const positionStyle: React.CSSProperties = isOverlay ? { width } : {
    width,
    left: (clip.start - sectionStart) * zoom,
    position: 'absolute',
    zIndex: 1,
    ...style,
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      author: "Current User",
      text: newComment,
      timestamp: Date.now(),
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setComments([comment, ...comments]);
    setShowCommentInput(false);
    setNewComment("");
  };

  const handleUpdateComments = (newComments: Comment[]) => {
    setComments(newComments);
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
      queryClient.invalidateQueries({ queryKey: ['production-tasks', 'patchbay-default'] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', 'patchbay-default'] });
      queryClient.invalidateQueries({ queryKey: ['bucket', 'patchbay-default'] });
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
        }),
      });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('clip-replaced', { detail: { clipId: clip.id } }));
        queryClient.invalidateQueries({ queryKey: ['/api/songs/patchbay-default/timeline'] });
        queryClient.invalidateQueries({ queryKey: ['bucket', 'patchbay-default'] });
        queryClient.invalidateQueries({ queryKey: ['final-clips', 'patchbay-default'] });
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
                  <path d={`M0,${50 + Math.random() * 10} Q${width/4},${20} ${width/2},${50} T${width},${50}`} fill="none" stroke="black" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
               </svg>
            </div>

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
          <ContextMenuItem onClick={() => setShowCommentInput(true)} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <MessageSquare size={14} className="text-primary" /> Add Note
          </ContextMenuItem>
          
          <ContextMenuItem onClick={handleMarkFinal} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <CheckCircle2 size={14} className={isFinal ? "text-primary" : "text-muted-foreground"} /> 
            {isFinal ? "Unmark Final" : "Mark as Final"}
          </ContextMenuItem>

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
        clip={{...clip, isFinal, comments}} 
        open={showInfo} 
        onOpenChange={setShowInfo} 
        onCommentsChange={handleUpdateComments}
      />

      <Dialog open={showCommentInput} onOpenChange={setShowCommentInput}>
        <DialogContent className="max-w-sm bg-card border-primary/20">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-widest font-heading">Add Note to {clip.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Leave a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="bg-black/40 border-border"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCommentInput(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddComment}>Save Note</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
  onAddToTimeline?: (clip: Clip) => void;
  siblingClips?: Clip[];
}

import { useLocation } from 'wouter';

export function BucketClip({ clip, trackId, onAddToTimeline, siblingClips = [] }: BucketClipProps) {
  const [showInfo, setShowInfo] = useState(false);
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
      queryClient.invalidateQueries({ queryKey: ['bucket', 'patchbay-default'] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', 'patchbay-default'] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', 'patchbay-default'] });
      queryClient.invalidateQueries({ queryKey: ['/api/songs/patchbay-default/timeline'] });
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
        onOpenChange={setShowInfo}
        onCommentsChange={handleUpdateComments}
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
