import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Clip, Comment } from '@/lib/daw-data';
import { GripVertical, MessageSquare, Info, Tag, Clock, User, Calendar, Music, Hash, Activity, HardDrive } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ClipProps {
  clip: Clip;
  isOverlay?: boolean;
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

export function ClipInfoWindow({ clip, open, onOpenChange }: { clip: Clip, open: boolean, onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#0c0c0e] border-primary/30 shadow-2xl p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-r from-primary/20 to-transparent p-6 border-b border-primary/10">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg shadow-lg flex items-center justify-center border border-white/10" style={{ backgroundColor: clip.color }}>
                <Music size={20} className="text-black/70" />
              </div>
              <div className="flex flex-col">
                <DialogTitle className="text-2xl font-heading font-bold text-white tracking-tight uppercase">
                  {clip.name}
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
            {/* Essential Audio Stats */}
            <div className="grid grid-cols-4 gap-3">
              <InfoStat icon={Clock} label="Duration" value={`${clip.duration} Units`} mono />
              <InfoStat icon={Hash} label="Sample Rate" value={clip.metadata?.sampleRate} mono />
              <InfoStat icon={Activity} label="Bit Depth" value={clip.metadata?.bitDepth} mono />
              <InfoStat icon={HardDrive} label="Format" value={clip.metadata?.format} mono />
            </div>

            {/* Musical Context */}
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

            {/* Upload & Ownership */}
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

            {/* Technical Detail Summary */}
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

            {/* Comments Section */}
            <div>
              <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold mb-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-primary/20" /> Session Notes
              </h4>
              <div className="bg-black/30 rounded border border-white/5 p-1">
                {clip.comments && clip.comments.length > 0 ? (
                  <div className="space-y-1">
                    {clip.comments.map(c => (
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
        </ScrollArea>
        <div className="p-4 bg-black/40 border-t border-white/5 flex justify-end">
           <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-[10px] uppercase tracking-widest h-8">Close Inspector</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TimelineClip({ clip, isOverlay }: ClipProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [newComment, setNewComment] = useState("");
  
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: clip.id,
    data: { clip, type: 'clip' },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const width = clip.duration * 20;
  
  const positionStyle: React.CSSProperties = isOverlay ? { width } : {
    width,
    left: clip.start * 20,
    position: 'absolute',
    ...style,
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    setShowCommentInput(false);
    setNewComment("");
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            ref={setNodeRef}
            style={positionStyle}
            {...listeners}
            {...attributes}
            className={cn(
              "h-full rounded-md border border-white/10 flex items-center overflow-hidden group cursor-grab active:cursor-grabbing shadow-sm z-10",
              isDragging && "opacity-50 ring-2 ring-primary ring-offset-2 ring-offset-background z-50",
              isOverlay && "shadow-2xl scale-105 opacity-90 z-50"
            )}
          >
            <div 
              className="absolute inset-0 opacity-80" 
              style={{ backgroundColor: clip.color }}
            />
            
            <div className="absolute inset-0 flex items-center justify-center opacity-30 pointer-events-none">
               <svg width="100%" height="100%" preserveAspectRatio="none">
                  <path d={`M0,${50 + Math.random() * 10} Q${width/4},${20} ${width/2},${50} T${width},${50}`} fill="none" stroke="black" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
               </svg>
            </div>

            <div className="relative z-10 px-2 flex items-center gap-1 w-full justify-between">
              <div className="flex items-center gap-1 truncate">
                <GripVertical size={12} className="text-black/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="text-xs font-medium text-black truncate select-none mix-blend-multiply">
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
            
            <div 
              className="absolute inset-0 z-20 cursor-text opacity-0 hover:opacity-100 bg-white/5 transition-opacity flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                setShowCommentInput(true);
              }}
            >
              <MessageSquare size={14} className="text-white drop-shadow-lg" />
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
          <Separator className="my-1 bg-border/50" />
          <ContextMenuItem className="text-destructive gap-2 text-xs uppercase tracking-wider font-semibold">
            Delete Clip
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ClipInfoWindow clip={clip} open={showInfo} onOpenChange={setShowInfo} />

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
    </>
  );
}

export function BucketClip({ clip }: { clip: Clip }) {
  const [showInfo, setShowInfo] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bucket-${clip.id}`,
    data: { clip, type: 'bucket-clip' },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            className={cn(
              "p-2 rounded-md border border-border bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing flex items-center gap-3 transition-colors group",
              isDragging && "opacity-0"
            )}
          >
            <div 
              className="w-3 h-8 rounded-sm shrink-0" 
              style={{ backgroundColor: clip.color }}
            />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors">{clip.name}</span>
                {clip.comments && clip.comments.length > 0 && <MessageSquare size={10} className="text-primary/60" />}
              </div>
              <span className="text-xs text-muted-foreground uppercase">{clip.type} • {clip.duration}s</span>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="bg-popover border-border min-w-[160px]">
          <ContextMenuItem onClick={() => setShowInfo(true)} className="gap-2 text-xs uppercase tracking-wider font-semibold">
            <Info size={14} className="text-primary" /> More Info
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      
      <ClipInfoWindow clip={clip} open={showInfo} onOpenChange={setShowInfo} />
    </>
  );
}
