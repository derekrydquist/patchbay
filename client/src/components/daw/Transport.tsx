import React from 'react';
import { Play, Square, SkipBack, SkipForward, Repeat, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { MOCK_SONG } from '@/lib/daw-data';
import { ExportDialog } from './ExportDialog';

export function Transport() {
  const [bpm, setBpm] = React.useState(MOCK_SONG.bpm || 120);
  const [bpmInput, setBpmInput] = React.useState(String(bpm));
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isLooping, setIsLooping] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);

  React.useEffect(() => {
    const handleUpdateBpm = (e: any) => {
      setBpm(e.detail.bpm);
      setBpmInput(e.detail.bpm.toString());
    };
    window.addEventListener('update-bpm', handleUpdateBpm);
    return () => window.removeEventListener('update-bpm', handleUpdateBpm);
  }, []);

  const commitBpm = () => {
    let newBpm = parseInt(bpmInput);
    if (isNaN(newBpm)) {
      setBpmInput(String(bpm));
      return;
    }
    if (newBpm < 20) newBpm = 20;
    if (newBpm > 300) newBpm = 300;
    setBpm(newBpm);
    setBpmInput(String(newBpm));
    window.dispatchEvent(new CustomEvent('update-bpm', { detail: { bpm: newBpm } }));
  };

  const handleBpmKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const isPlayingRef = React.useRef(isPlaying);

  React.useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        e.target instanceof HTMLElement &&
        e.target.tagName !== 'INPUT' &&
        e.target.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        if (isPlayingRef.current) {
          setIsPlaying(false);
          window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: false } }));
        } else {
          setIsPlaying(true);
          window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: true } }));
        }
      }
    };

    const handleTimeUpdate = (e: any) => {
      setCurrentTime(e.detail.time);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('time-update', handleTimeUpdate);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('time-update', handleTimeUpdate);
    };
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: false } }));
    } else {
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: true } }));
    }
  };

  const formatTimecode = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-16 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between px-6 select-none z-50 relative shadow-md">
      {/* Left: Time Display */}
      <div className="flex items-center gap-6 w-1/3">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Timecode</span>
          <span className="text-2xl font-mono text-primary font-bold tracking-tight shadow-glow">{formatTimecode(currentTime)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Tempo</span>
          <input
            type="text"
            value={bpmInput}
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={handleBpmKeyDown}
            className="text-xl font-mono text-foreground bg-transparent border-none outline-none w-16 p-0 hover:bg-white/5 focus:bg-white/10 rounded transition-colors text-center"
          />
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
          size="icon"
          className={cn(
            "h-12 w-12 rounded-full border-2 border-primary/20 shadow-[0_0_15px_rgba(212,175,55,0.2)] hover:shadow-[0_0_25px_rgba(212,175,55,0.4)] transition-all",
            isPlaying ? "bg-primary text-primary-foreground" : "bg-transparent text-primary hover:bg-primary/10"
          )}
          onClick={togglePlay}
        >
          {isPlaying ? <Square fill="currentColor" size={20} /> : <Play fill="currentColor" className="ml-1" size={20} />}
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
          <SkipForward size={18} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground hover:text-foreground", isLooping && "text-primary hover:text-primary/80")}
          onClick={() => {
            setIsLooping(!isLooping);
            window.dispatchEvent(new CustomEvent('toggle-loop', { detail: { isLooping: !isLooping } }));
          }}
        >
          <Repeat size={18} />
        </Button>
      </div>

      {/* Right: Master Volume */}
      <div className="flex items-center justify-end gap-4 w-1/3">
        <div className="flex items-center gap-2 w-48">
          <Volume2 size={16} className="text-muted-foreground" />
          <Slider
            defaultValue={[80]}
            onValueChange={([val]) => {
              window.dispatchEvent(new CustomEvent('update-master-volume', { detail: { volume: val } }));
            }}
            max={100} step={1} className="w-full"
          />
        </div>
        <ExportDialog>
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 uppercase text-xs font-bold tracking-wider">
            Export
          </Button>
        </ExportDialog>
      </div>
    </div>
  );
}
