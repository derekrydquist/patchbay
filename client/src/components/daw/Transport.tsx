import React from 'react';
import { Play, Square, Circle, Mic, SkipBack, SkipForward, Repeat, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { INITIAL_TRACKS } from '@/lib/daw-data';

export function Transport() {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isRecording, setIsRecording] = React.useState(false);
  
  const isPlayingRef = React.useRef(isPlaying);
  const audioRefMuted = React.useRef<{ [trackId: string]: boolean }>({});
  const audioRefs = React.useRef<{ [trackId: string]: HTMLAudioElement }>({});
  const masterVolumeRef = React.useRef(80);
  const trackVolumesRef = React.useRef<{ [trackId: string]: number }>({});

  React.useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const [masterVolume, setMasterVolume] = React.useState(80);
  
  React.useEffect(() => {
    const handleMasterVolume = (e: any) => {
      const newVol = e.detail.volume;
      setMasterVolume(newVol);
      masterVolumeRef.current = newVol;
      Object.entries(audioRefs.current).forEach(([id, audio]) => {
        const trackVol = trackVolumesRef.current[id] ?? 80;
        audio.volume = (newVol / 100) * (trackVol / 100);
      });
    };
    window.addEventListener('update-master-volume', handleMasterVolume);
    return () => window.removeEventListener('update-master-volume', handleMasterVolume);
  }, []);

  React.useEffect(() => {
    const sources = [
      'https://assets.mixkit.co/active_storage/sfx/135/135-preview.mp3', // Drums
      'https://assets.mixkit.co/active_storage/sfx/123/123-preview.mp3', // Bass
      'https://assets.mixkit.co/active_storage/sfx/144/144-preview.mp3', // Guitar 1
      'https://assets.mixkit.co/active_storage/sfx/143/143-preview.mp3', // Guitar 2
      'https://assets.mixkit.co/active_storage/sfx/141/141-preview.mp3'  // Vocals
    ];

    INITIAL_TRACKS.forEach((track, index) => {
      const audio = new Audio(sources[index % sources.length]);
      audio.loop = true;
      audio.volume = (track.volume / 100) * (masterVolumeRef.current / 100);
      audio.muted = true;
      audioRefs.current[track.id] = audio;
      trackVolumesRef.current[track.id] = track.volume;
      audioRefMuted.current[track.id] = true;
    });
    
    const handleSeek = (e: any) => {
      Object.values(audioRefs.current).forEach(audio => {
        audio.currentTime = e.detail.time;
      });
    };
    
    const handleMuteState = (e: any) => {
      const states = e.detail.trackMuteStates;
      if (!states) return;
      Object.entries(states).forEach(([trackId, muted]) => {
        if (audioRefs.current[trackId]) {
          audioRefs.current[trackId].muted = muted as boolean;
        }
        audioRefMuted.current[trackId] = muted as boolean;
      });
    };

    const handleTrackVolume = (e: any) => {
      const { trackId, volume } = e.detail;
      trackVolumesRef.current[trackId] = volume;
      if (audioRefs.current[trackId]) {
        audioRefs.current[trackId].volume = (volume / 100) * (masterVolumeRef.current / 100);
      }
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' && 
        e.target instanceof HTMLElement && 
        e.target.tagName !== 'INPUT' && 
        e.target.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        
        if (isPlayingRef.current) {
          Object.values(audioRefs.current).forEach(audio => audio.pause());
          setIsPlaying(false);
          window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: false } }));
        } else {
          Object.entries(audioRefs.current).forEach(([trackId, audio]) => {
            audio.muted = audioRefMuted.current[trackId] ?? true;
            audio.play().catch(err => console.error("Audio play failed:", err));
          });
          setIsPlaying(true);
          window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: true } }));
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('seek-audio', handleSeek);
    window.addEventListener('audio-mute-state', handleMuteState);
    window.addEventListener('update-track-volume', handleTrackVolume);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('seek-audio', handleSeek);
      window.removeEventListener('audio-mute-state', handleMuteState);
      window.removeEventListener('update-track-volume', handleTrackVolume);
      Object.values(audioRefs.current).forEach(audio => {
        audio.pause();
      });
      audioRefs.current = {};
    };
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      Object.values(audioRefs.current).forEach(audio => audio.pause());
      setIsPlaying(false);
      window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: false } }));
    } else {
      Object.entries(audioRefs.current).forEach(([trackId, audio]) => {
        audio.muted = audioRefMuted.current[trackId] ?? true;
        audio.play().catch(e => console.error("Audio play failed:", e));
      });
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent('toggle-play', { detail: { isPlaying: true } }));
    }
  };

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
          onClick={togglePlay}
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
          <Slider 
            defaultValue={[80]} 
            onValueChange={([val]) => {
              window.dispatchEvent(new CustomEvent('update-master-volume', { detail: { volume: val } }));
            }}
            max={100} step={1} className="w-full" 
          />
        </div>
        <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 uppercase text-xs font-bold tracking-wider">
          Export
        </Button>
      </div>
    </div>
  );
}
