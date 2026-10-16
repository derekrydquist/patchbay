import React from 'react';
import {
  gridDensity, gridTile, parseTimeSignature, secondsPerBeat, type GridLineKind,
} from '@/lib/musical-time';

// Tick heights in px, measured up from the ruler's bottom edge. Labelled bars get a
// full-height line from the label's own left border.
const TICK_HEIGHTS: Record<GridLineKind, number> = { bar: 12, beat: 7, subdivision: 4 };
const TICK_OPACITY: Record<GridLineKind, number> = { bar: 0.5, beat: 0.35, subdivision: 0.32 };
const TICK_BAND_HEIGHT = 16;

// Bar numbers and bar/beat/subdivision ticks. Memoized on primitives: Timeline re-renders
// every frame during playback, and a long song can have thousands of labels.
const RulerMarks = React.memo(function RulerMarks({ zoom, bpm, timeSignature, contentSeconds }: {
  zoom: number;
  bpm: number;
  timeSignature: string;
  contentSeconds: number;
}) {
  const patternId = `ruler-ticks-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { beatsPerBar } = parseTimeSignature(timeSignature);
  const density = gridDensity(zoom * secondsPerBeat(bpm), beatsPerBar);
  const tile = gridTile(density, beatsPerBar);

  const labels: number[] = [];
  const barCount = Math.ceil((contentSeconds * zoom) / density.pxPerBar);
  for (let i = 0; i < barCount; i += density.labelStep) labels.push(i);

  return (
    <>
      <svg
        className="absolute bottom-0 left-0 w-full text-muted-foreground pointer-events-none"
        style={{ height: TICK_BAND_HEIGHT }}
        aria-hidden="true"
      >
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" x={0} y={0} width={tile.width} height={TICK_BAND_HEIGHT}>
            {tile.lines.map(({ x, kind }) => (
              <rect
                key={`${kind}-${x}`}
                x={x}
                y={TICK_BAND_HEIGHT - TICK_HEIGHTS[kind]}
                width={1}
                height={TICK_HEIGHTS[kind]}
                fill="currentColor"
                fillOpacity={TICK_OPACITY[kind]}
              />
            ))}
          </pattern>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {labels.map((i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 border-l border-muted-foreground/40 text-[9px] leading-none text-muted-foreground pl-1 pt-1 font-mono pointer-events-none"
          style={{ left: i * density.pxPerBar }}
        >
          {i + 1}
        </div>
      ))}
    </>
  );
});

export function Ruler({ onSeek, zoom = 80, bpm, timeSignature, contentSeconds }: {
  onSeek?: (pos: number) => void;
  zoom?: number;
  bpm: number;
  timeSignature: string;
  contentSeconds: number; // song seconds the scroll content spans past the track panel
}) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (onSeek) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = e.clientX - rect.left;
      onSeek(pos);
    }
  };

  return (
    <div className="h-8 border-b border-border bg-card flex items-end sticky top-1.5 z-30 select-none">
       {/* Layout placeholder — z-50 cover provided by content-root sibling spacer in Timeline */}
       <div className="w-64 shrink-0 bg-card border-r border-border h-full" />

       <div
         className="flex-1 relative h-full cursor-text"
         onClick={handleClick}
       >
         <RulerMarks zoom={zoom} bpm={bpm} timeSignature={timeSignature} contentSeconds={contentSeconds} />
       </div>
    </div>
  );
}
