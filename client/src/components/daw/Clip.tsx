import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Clip, Comment } from '@/lib/daw-data';
import { GripVertical, MessageSquare, Info, Tag, Clock } from 'lucide-react';
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

interface ClipProps {
  clip: Clip;
  isOverlay?: boolean;
}

export function ClipInfoWindow({ clip, open, onOpenChange }: { clip: Clip, open: boolean, onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-primary/20">
        <DialogHeader>
          <DialogTitle className="text-primary font-heading uppercase tracking-widest flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: clip.color }} />
            {clip.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground italic">
            File Properties & Metadata
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="bg-black/40 p-3 rounded-lg border border-border">
            <span className="text-[10px] text-muted-foreground uppercase block mb-1">Format</span>
            <span className="text-sm font-mono text-foreground">{clip.metadata?.format || "WAV"}</span>
          </div>
          <div className="bg-black/40 p-3 rounded-lg border border-border">
            <span className="text-[10px] text-muted-foreground uppercase block mb-1">Sample Rate</span>
            <span className="text-sm font-mono text-foreground">{clip.metadata?.sampleRate || "48kHz"}</span>
          </div>
          <div className="bg-black/40 p-3 rounded-lg border border-border">
            <span className="text-[10px] text-muted-foreground uppercase block mb-1">Bit Depth</span>
            <span className="text-sm font-mono text-foreground">{clip.metadata?.bitDepth || "24-bit"}</span>
          </div>
          <div className="bg-black/40 p-3 rounded-lg border border-border">
            <span className="text-[10px] text-muted-foreground uppercase block mb-1">Type</span>
            <span className="text-sm font-mono text-foreground uppercase">{clip.type}</span>
          </div>
        </div>

        <div className="mt-4">
          <span className="text-[10px] text-muted-foreground uppercase block mb-2">Description</span>
          <p className="text-sm text-foreground leading-relaxed bg-black/20 p-3 rounded border border-border">
            {clip.metadata?.description || "No description provided."}
          </p>
        </div>

        <div className="mt-4">
          <span className="text-[10px] text-muted-foreground uppercase block mb-2">Comments & Notes</span>
          <ScrollArea className="h-32 bg-black/20 rounded border border-border p-2">
            {clip.comments && clip.comments.length > 0 ? (
              <div className="space-y-3">
                {clip.comments.map(c => (
                  <div key={c.id} className="text-xs border-b border-border/50 pb-2 last:border-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-primary">{c.author}</span>
                      <span className="text-[10px] text-muted-foreground">{c.createdAt}</span>
                    </div>
                    <p className="text-foreground/80 italic">"{c.text}"</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs italic">
                No notes tracked yet.
              </div>
            )}
          </ScrollArea>
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
        <ContextMenuContent className="bg-popover border-border">
          <ContextMenuItem onClick={() => setShowInfo(true)} className="gap-2">
            <Info size={14} /> More Info
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setShowCommentInput(true)} className="gap-2">
            <MessageSquare size={14} /> Add Note
          </ContextMenuItem>
          <ContextMenuItem className="text-destructive gap-2">
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
        <ContextMenuContent className="bg-popover border-border">
          <ContextMenuItem onClick={() => setShowInfo(true)} className="gap-2">
            <Info size={14} /> More Info
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      
      <ClipInfoWindow clip={clip} open={showInfo} onOpenChange={setShowInfo} />
    </>
  );
}
