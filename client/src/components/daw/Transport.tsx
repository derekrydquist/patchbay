import React from 'react';
import { Play, Square, Circle, Mic, SkipBack, SkipForward, Repeat, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

export function Transport() {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);

  return (
    <div className="h-16 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between px-6 select-none z-50 relative shadow-md">
      {/* Left: Time Display */}
      <div className="flex items-center gap-6 w-1/3">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Timecode</span>
          <span className="text-2xl font-mono text-primary font-bold tracking-tight shadow-glow">00:00:12:04</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">BPM</span>
          <span className="text-xl font-mono text-foreground">120.00</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Sign</span>
          <span className="text-xl font-mono text-foreground">4/4</span>
        </div>
      </div>

      {/* Center: Controls */}
      <div className="flex items-center justify-center gap-2 w-1/3">
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <SkipBack size={18} />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className={cn("text-muted-foreground hover:text-foreground", isRecording && "text-destructive hover:text-destructive/80")}
          onClick={() => setIsRecording(!isRecording)}
        >
          <Circle size={18} fill={isRecording ? "currentColor" : "none"} />
        </Button>
        <Button 
          size="icon" 
          className={cn(
            "h-12 w-12 rounded-full border-2 border-primary/20 shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:shadow-[0_0_25px_rgba(212,175,55,0.4)] transition-all",
            isPlaying ? "bg-primary text-primary-foreground" : "bg-transparent text-primary hover:bg-primary/10"
          )}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Square fill="currentColor" size={20} /> : <Play fill="currentColor" className="ml-1" size={20} />}
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <SkipForward size={18} />
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <Repeat size={18} />
        </Button>
      </div>

      {/* Right: Master Volume */}
      <div className="flex items-center justify-end gap-4 w-1/3">
        <div className="flex items-center gap-2 w-48">
          <Volume2 size={16} className="text-muted-foreground" />
          <Slider defaultValue={[80]} max={100} step={1} className="w-full" />
        </div>
        <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 uppercase text-xs font-bold tracking-wider">
          Export
        </Button>
      </div>
    </div>
  );
}
