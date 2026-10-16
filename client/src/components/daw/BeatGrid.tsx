import React from 'react';
import {
  gridDensity, gridTile, parseTimeSignature, secondsPerBeat, type GridLineKind,
} from '@/lib/musical-time';

// Lane gridline colors — tune here.
export const GRID_BAR_LINE_COLOR = 'rgba(255,255,255,0.10)';
export const GRID_BEAT_LINE_COLOR = 'rgba(255,255,255,0.045)';
export const GRID_SUBDIVISION_LINE_COLOR = 'rgba(255,255,255,0.04)';

const LINE_COLORS: Record<GridLineKind, string> = {
  bar: GRID_BAR_LINE_COLOR,
  beat: GRID_BEAT_LINE_COLOR,
  subdivision: GRID_SUBDIVISION_LINE_COLOR,
};

// Taller than any lane, so the pattern never repeats vertically.
const TILE_HEIGHT = 256;

// Bar/beat gridlines behind a track lane. Rendered as the lane div's first child with no
// z-index, so it paints below the section cells and clips and is invisible to hit-testing.
// One SVG <pattern> tile per barStep bars, starting at x = 0 = song time 0; SVG keeps
// fractional tile widths exact, so the grid never drifts over a long song.
export const BeatGrid = React.memo(function BeatGrid({ zoom, bpm, timeSignature }: {
  zoom: number;
  bpm: number | null | undefined;
  timeSignature: string | null | undefined;
}) {
  const patternId = `beat-grid-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { beatsPerBar } = parseTimeSignature(timeSignature);
  const density = gridDensity(zoom * secondsPerBeat(bpm), beatsPerBar);
  const tile = gridTile(density, beatsPerBar);

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" x={0} y={0} width={tile.width} height={TILE_HEIGHT}>
          {tile.lines.map(({ x, kind }) => (
            <rect key={`${kind}-${x}`} x={x} y={0} width={1} height={TILE_HEIGHT} fill={LINE_COLORS[kind]} />
          ))}
        </pattern>
      </defs>
      <rect x={0} y={0} width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
});
