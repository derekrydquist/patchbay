import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WaveformPlayerCardProps {
  src: string | null | undefined;
  name: string;
  duration: number;
  isFinal: boolean;
  color?: string;
  waveformHeight?: number;
  className?: string;
  children?: React.ReactNode;
}

export function WaveformPlayerCard({
  src, name, duration, isFinal, color, waveformHeight = 20, className, children,
}: WaveformPlayerCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  function formatDur(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // Reassigned each render so the draw function always captures current state
  drawRef.current = function drawWaveform() {
    const canvas = canvasRef.current;
    const buffer = bufferRef.current;
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
    const data = buffer.getChannelData(0);
    const totalSamples = data.length;
    const progress = duration > 0 ? currentTime / duration : 0;
    for (let x = 0; x < w; x++) {
      const start = Math.floor((x / w) * totalSamples);
      const end = Math.min(Math.floor(((x + 1) / w) * totalSamples), totalSamples);
      let max = 0;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(data[i]);
        if (abs > max) max = abs;
      }
      const barH = Math.max(1, max * h * 0.9);
      const midY = h / 2;
      ctx.fillStyle = x / w < progress ? 'rgba(212,175,55,0.85)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(x, midY - barH / 2, 1, barH);
    }
  };

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    fetch(src)
      .then(r => r.arrayBuffer())
      .then(ab => {
        if (cancelled) return null;
        const actx = new AudioContext();
        return actx.decodeAudioData(ab).then(buf => { actx.close(); return buf; });
      })
      .then(buf => {
        if (cancelled || !buf) return;
        bufferRef.current = buf;
        drawRef.current?.();
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    drawRef.current?.();
  }, [currentTime]);

  useEffect(() => {
    if (!src) return;
    const audio = new Audio(src);
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    });
    audioRef.current = audio;
    return () => { audio.pause(); audioRef.current = null; };
  }, [src]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !src) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const newTime = fraction * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  return (
    <div className={cn(
      'flex flex-col rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors relative overflow-hidden',
      isFinal && 'border-primary/30 bg-primary/[0.04]',
      className,
    )}>
      {color && (
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ backgroundColor: color }}
        />
      )}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={toggle}
          className="relative z-10 w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 hover:bg-primary/30 transition-colors"
        >
          {isPlaying
            ? <Pause size={11} className="text-primary" />
            : <Play size={11} className="text-primary ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn('text-xs font-medium truncate', isFinal ? 'text-primary' : 'text-white/80')}>
                {name}
              </span>
              {isFinal && <CheckCircle2 size={10} className="text-primary shrink-0" />}
            </div>
            <span className="text-[10px] text-white/30 ml-2 shrink-0 font-mono">
              {formatDur(isPlaying ? currentTime : duration)}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            className="w-full rounded relative z-10 cursor-pointer"
            style={{ height: waveformHeight }}
            onPointerDown={e => e.stopPropagation()}
            onClick={handleCanvasClick}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
