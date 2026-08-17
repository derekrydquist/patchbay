import React from 'react';
import { Play, Square, SkipBack, SkipForward, Repeat, Volume2, ChevronDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ExportDialog } from './ExportDialog';

const TIME_SIGNATURES = ['4/4', '3/4', '6/8', '2/4', '5/4'];
const METRONOME_SUBDIVISIONS = ['1/4', '1/8', '1/16'] as const;
type MetronomeSubdivision = typeof METRONOME_SUBDIVISIONS[number];

function MetronomeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 22h12l-4-17h-4L6 22z" />
      <line x1="12" y1="7" x2="16" y2="17" />
    </svg>
  );
}

export function Transport({ songId = 'patchbay-default' }: { songId?: string }) {
  const { data: songData } = useQuery<{ bpm?: number | null; timeSignature?: string | null }>({
    queryKey: ['song', songId],
    queryFn: () => fetch(`/api/songs/${songId}`).then(r => r.json()),
  });

  const [bpm, setBpm] = React.useState<number | null>(null);
  const [bpmInput, setBpmInput] = React.useState('');
  const [timeSignature, setTimeSignature] = React.useState<string | null>(null);
  const songDataInitialized = React.useRef(false);

  React.useEffect(() => {
    if (!songDataInitialized.current && songData != null) {
      songDataInitialized.current = true;
      if (songData.bpm != null) {
        setBpm(songData.bpm);
        setBpmInput(String(songData.bpm));
      }
      const ts = songData.timeSignature ?? '4/4';
      setTimeSignature(ts);
      window.dispatchEvent(new CustomEvent('update-time-signature', { detail: { timeSignature: ts } }));
    }
  }, [songData]);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isLooping, setIsLooping] = React.useState(() => localStorage.getItem(`patchbay-loop-${songId}`) === 'true');
  const [isMetronomeOn, setIsMetronomeOn] = React.useState(() => localStorage.getItem(`patchbay-metronome-${songId}`) === 'true');
  const [metronomeVolume, setMetronomeVolume] = React.useState(() => {
    const saved = localStorage.getItem(`patchbay-metronome-volume-${songId}`);
    if (saved) { const v = Number(saved); if (Number.isFinite(v) && v >= 0 && v <= 100) return v; }
    return 70;
  });
  const [metronomeSubdivision, setMetronomeSubdivision] = React.useState<MetronomeSubdivision>(() => {
    const saved = localStorage.getItem(`patchbay-metronome-subdivision-${songId}`);
    return (METRONOME_SUBDIVISIONS as readonly string[]).includes(saved ?? '') ? (saved as MetronomeSubdivision) : '1/4';
  });
  const metronomeVolumeDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same guard pattern as Track.tsx's Mute/Solo/volume-slider controls — prevents a
  // slider drag from bubbling into any parent click handler.
  const metronomeControlInteractionRef = React.useRef(false);
  const handleMetronomeControlPointerDown = () => { metronomeControlInteractionRef.current = true; };
  const handleMetronomeControlPointerUp = () => { requestAnimationFrame(() => { metronomeControlInteractionRef.current = false; }); };
  const [currentTime, setCurrentTime] = React.useState(0);

  React.useEffect(() => {
    localStorage.setItem(`patchbay-metronome-${songId}`, String(isMetronomeOn));
  }, [isMetronomeOn, songId]);

  React.useEffect(() => {
    return () => {
      if (metronomeVolumeDebounceRef.current) clearTimeout(metronomeVolumeDebounceRef.current);
    };
  }, []);

  const commitMetronomeVolume = (val: number) => {
    setMetronomeVolume(val);
    if (metronomeVolumeDebounceRef.current) clearTimeout(metronomeVolumeDebounceRef.current);
    metronomeVolumeDebounceRef.current = setTimeout(() => {
      localStorage.setItem(`patchbay-metronome-volume-${songId}`, String(val));
      window.dispatchEvent(new CustomEvent('update-metronome-volume', { detail: { volume: val } }));
    }, 150);
  };

  const commitMetronomeSubdivision = (sub: MetronomeSubdivision) => {
    setMetronomeSubdivision(sub);
    localStorage.setItem(`patchbay-metronome-subdivision-${songId}`, sub);
    window.dispatchEvent(new CustomEvent('update-metronome-subdivision', { detail: { subdivision: sub } }));
  };

  React.useEffect(() => {
    const handleUpdateBpm = (e: any) => {
      setBpm(e.detail.bpm);
      setBpmInput(e.detail.bpm.toString());
    };
    window.addEventListener('update-bpm', handleUpdateBpm);
    return () => window.removeEventListener('update-bpm', handleUpdateBpm);
  }, []);

  React.useEffect(() => {
    const handlePlaybackEnded = () => setIsPlaying(false);
    window.addEventListener('playback-ended', handlePlaybackEnded);
    return () => window.removeEventListener('playback-ended', handlePlaybackEnded);
  }, []);

  React.useEffect(() => {
    const handleLoopForceDisabled = () => setIsLooping(false);
    window.addEventListener('loop-force-disabled', handleLoopForceDisabled);
    return () => window.removeEventListener('loop-force-disabled', handleLoopForceDisabled);
  }, []);

  React.useEffect(() => {
    localStorage.setItem(`patchbay-loop-${songId}`, String(isLooping));
  }, [isLooping, songId]);

  const commitBpm = () => {
    let newBpm = parseInt(bpmInput);
    if (isNaN(newBpm)) {
      setBpmInput(bpm !== null ? String(bpm) : '');
      return;
    }
    if (newBpm < 20) newBpm = 20;
    if (newBpm > 300) newBpm = 300;
    setBpm(newBpm);
    setBpmInput(String(newBpm));
    window.dispatchEvent(new CustomEvent('update-bpm', { detail: { bpm: newBpm } }));
    fetch(`/api/songs/${songId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bpm: newBpm }),
    }).catch((err) => console.error('Failed to persist BPM:', err));
  };

  const commitTimeSignature = (ts: string) => {
    setTimeSignature(ts);
    window.dispatchEvent(new CustomEvent('update-time-signature', { detail: { timeSignature: ts } }));
    fetch(`/api/songs/${songId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeSignature: ts }),
    }).catch((err) => console.error('Failed to persist time signature:', err));
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
            disabled={songData == null}
            className="text-xl font-mono text-foreground bg-transparent border-none outline-none w-16 p-0 hover:bg-white/5 focus:bg-white/10 rounded transition-colors text-center disabled:opacity-40 disabled:cursor-default"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Time Sig</span>
          <Select
            value={timeSignature ?? undefined}
            onValueChange={commitTimeSignature}
            disabled={timeSignature == null}
          >
            <SelectTrigger className="h-auto border-none bg-transparent p-0 shadow-none focus:ring-0 w-14 text-xl font-mono text-foreground disabled:opacity-40 disabled:cursor-default [&>svg]:hidden hover:bg-white/5 rounded transition-colors">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {TIME_SIGNATURES.map((ts) => (
                <SelectItem key={ts} value={ts} className="font-mono">
                  {ts}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Center: Controls */}
      <div className="flex items-center justify-center gap-2 w-1/3">
        <Popover>
          <div className="group flex items-center gap-0">
            {/*
              Deliberately NOT the shared Button component here: Button's size="icon" variant is a
              fixed 36px square with the icon centered inside, leaving ~9px of invisible padding on
              every side — that inset (not the flex gap or the chevron's own padding) was what kept
              swallowing every previous attempt to close the visible gap to the chevron. A plain
              button with explicit minimal padding lets the rendered box hug the glyph instead.
              Note: Button also forces all descendant svgs to 16px via a global `[&_svg]:size-4`
              rule, which is why MetronomeIcon's `size` prop (18) never actually rendered at 18px
              before — it was always silently clamped to 16px to match its siblings. Outside Button
              that clamp no longer applies, so size is set explicitly to 16 here to hold that same
              parity rather than accidentally rendering larger than SkipBack/SkipForward/Repeat.
            */}
            <button
              type="button"
              className={cn(
                // group-has-[.metronome-chevron-trigger:hover] wires the chevron as a SECOND
                // trigger for the icon's own existing hover effect (verified by computed-style
                // diff: hovering any transport icon, this one included, only ever changes
                // `color` from text-muted-foreground to text-foreground/text-primary — there is
                // no separate box-shadow/drop-shadow glow anywhere in this row). The icon's own
                // direct hover: classes are untouched; this only adds a second path to the same
                // classes so hovering the chevron reproduces the identical effect.
                "inline-flex items-center justify-center rounded-md p-1 text-muted-foreground ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:text-foreground group-has-[.metronome-chevron-trigger:hover]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0",
                isMetronomeOn && "text-primary hover:text-primary/80 group-has-[.metronome-chevron-trigger:hover]:text-primary/80"
              )}
              onClick={() => {
                const next = !isMetronomeOn;
                setIsMetronomeOn(next);
                window.dispatchEvent(new CustomEvent('toggle-metronome', { detail: { enabled: next } }));
              }}
            >
              <MetronomeIcon size={16} />
            </button>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  // Unstyled at rest — no border/background, matches the icon's own color logic so
                  // the pair reads as one unit. hover:bg-white/5 is the app's established ghost-icon
                  // hover treatment (see AppHeader's gear/avatar triggers).
                  // Deliberately mouse-hover-only, NOT focus-visible: Radix returns focus to this
                  // trigger when the Popover closes (Escape, selecting a subdivision, clicking
                  // outside), and Chromium's focus-visible heuristic treats that programmatic
                  // refocus as visible — a focus-visible background here would stay lit
                  // indefinitely after every popover interaction instead of only on real hover.
                  "metronome-chevron-trigger -ml-0.5 flex items-center justify-center rounded-full px-0.5 py-0.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none",
                  isMetronomeOn && "text-primary hover:text-primary/80"
                )}
              >
                <ChevronDown size={11} strokeWidth={3} />
              </button>
            </PopoverTrigger>
          </div>
          <PopoverContent align="center" className="w-56 space-y-4 bg-[#0c0c0e] border-white/10 p-3">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Volume</span>
                <div
                  className="mt-2"
                  onPointerDown={handleMetronomeControlPointerDown}
                  onPointerUp={handleMetronomeControlPointerUp}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Slider
                    value={[metronomeVolume]}
                    onValueChange={([val]) => commitMetronomeVolume(val)}
                    max={100}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-heading">Subdivision</span>
                <div className="flex mt-2 rounded border border-border overflow-hidden">
                  {METRONOME_SUBDIVISIONS.map((sub, i) => (
                    <button
                      key={sub}
                      onClick={() => commitMetronomeSubdivision(sub)}
                      className={cn(
                        'flex-1 py-1 text-[10px] flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                        i < METRONOME_SUBDIVISIONS.length - 1 && 'border-r border-border',
                        metronomeSubdivision === sub && 'bg-primary text-primary-foreground border-primary'
                      )}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
              </div>
            </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => window.dispatchEvent(new CustomEvent('skip-to-clip', { detail: { direction: 'previous' } }))}
        >
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
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => window.dispatchEvent(new CustomEvent('skip-to-clip', { detail: { direction: 'next' } }))}
        >
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
        <ExportDialog songId={songId}>
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 uppercase text-xs font-bold tracking-wider">
            Export
          </Button>
        </ExportDialog>
      </div>
    </div>
  );
}
