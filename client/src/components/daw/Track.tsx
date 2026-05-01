import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Track, Clip } from '@/lib/daw-data';
import { TimelineClip } from './Clip';
import { Mic, Headphones, Activity } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

export interface SectionInfo {
  name: string;
  start: number;
  duration: number;
}

interface SectionCellProps {
  sectionStart: number;
  sectionDuration: number;
  clips: Clip[];
  zoom: number;
  isInvalid: boolean;
  insertionX?: number;
}

function SectionCell({
  sectionStart,
  sectionDuration,
  clips,
  zoom,
  isInvalid,
  insertionX,
}: SectionCellProps) {
  return (
    <div
      className="relative h-full border-r border-border/20 overflow-hidden"
      style={{ width: sectionDuration * zoom, minWidth: sectionDuration * zoom }}
    >
      {clips.map((clip) => (
        <TimelineClip key={clip.id} clip={clip} zoom={zoom} sectionStart={sectionStart} />
      ))}
      {insertionX !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(212,175,55,0.8)] z-20 pointer-events-none"
          style={{ left: insertionX }}
        />
      )}
    </div>
  );
}

interface TrackProps {
  track: Track;
  sections: SectionInfo[];
  invalidSections: Set<string>;
  isInvalidDrop: boolean;
  isDragging: boolean;
  zoom: number;
  insertionPoint?: { sectionName: string; index: number; x: number };
}

export function TimelineTrack({
  track,
  sections,
  invalidSections,
  isInvalidDrop,
  isDragging,
  zoom,
  insertionPoint,
}: TrackProps) {
  const { setNodeRef } = useDroppable({
    id: track.id,
    data: { trackId: track.id, type: 'track' },
    disabled: isInvalidDrop,
  });

  const isValidTarget = isDragging && !isInvalidDrop;
  const isInvalidTarget = isDragging && isInvalidDrop;

  return (
    <div className="relative flex w-full h-16 border-b border-border bg-card/20 group">
      {/* Gold border on the valid drop target — explicit inline positioning for scrollable container reliability */}
      {isValidTarget && (
        <div
          className="pointer-events-none z-10"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
            border: '1px solid rgba(212,175,55,0.6)',
          }}
        />
      )}
      {/* Dark veil on invalid tracks — sits above clips, does not change row opacity */}
      {isInvalidTarget && (
        <div
          className="pointer-events-none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
            zIndex: 20,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* Track Header */}
      <div className="w-64 shrink-0 bg-card border-r border-border px-3 flex items-center gap-3 sticky left-0 z-20">
        <div className="w-1 h-full absolute left-0 top-0 bottom-0" style={{ backgroundColor: track.color }} />

        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
          {track.type === 'vocal' ? (
            <Mic size={14} className="text-muted-foreground" />
          ) : track.type === 'instrument' ? (
            <Activity size={14} className="text-muted-foreground" />
          ) : (
            <Headphones size={14} className="text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-heading font-bold uppercase tracking-wider text-[11px] truncate text-foreground block">
            {track.name}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex gap-0.5">
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('toggle-track-mute', { detail: { trackId: track.id } })
                  )
                }
                className={cn(
                  'text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  track.muted && 'bg-destructive text-destructive-foreground border-destructive'
                )}
              >
                M
              </button>
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('toggle-track-solo', { detail: { trackId: track.id } })
                  )
                }
                className={cn(
                  'text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  track.solo && 'bg-primary text-primary-foreground border-primary'
                )}
              >
                S
              </button>
            </div>
            <Slider
              value={[track.volume ?? 80]}
              onValueChange={([val]) =>
                window.dispatchEvent(
                  new CustomEvent('update-track-volume', { detail: { trackId: track.id, volume: val } })
                )
              }
              max={100}
              step={1}
              className="w-16 h-1"
            />
          </div>
        </div>
      </div>

      {/* Section cells — full row is the droppable target */}
      <div
        ref={setNodeRef}
        className="flex h-full bg-[linear-gradient(90deg,transparent_19px,rgba(255,255,255,0.02)_20px)]"
        style={{ backgroundSize: `${zoom / 4}px 100%` }}
      >
        {sections.map((section) => {
          const sectionClips = track.clips.filter((c) => c.sectionName === section.name);
          return (
            <SectionCell
              key={section.name}
              sectionStart={section.start}
              sectionDuration={section.duration}
              clips={sectionClips}
              zoom={zoom}
              isInvalid={invalidSections.has(section.name)}
              insertionX={
                insertionPoint?.sectionName === section.name ? insertionPoint.x : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}
