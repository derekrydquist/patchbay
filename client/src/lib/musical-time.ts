// Musical time for the Workspace timeline: bars/beats math shared by the ruler, the lane
// gridlines and the Transport readout. Pure functions, no React.
//
// Beats are counted from song time 0 with the metronome's own expression,
// Math.floor(t / secondsPerBeat), so a beat changes at the same instant the click fires.
// Like the metronome, every beat is a quarter note: 6/8 is six quarter-note beats per bar.

// Tempo used when a song's stored bpm is null.
export const DEFAULT_BPM = 120;

// gridDensity thresholds, in pixels.
export const BAR_LINE_MIN_PX = 24;          // closer bars are thinned to every 2nd, 4th, 8th...
export const BEAT_LINE_MIN_PX = 8;          // beat lines only when beats are at least this far apart
export const EIGHTH_LINE_MIN_PX_PER_BEAT = 48;
export const SIXTEENTH_LINE_MIN_PX_PER_BEAT = 96;
export const BAR_LABEL_MIN_PX = 48;         // bar-number labels at least this far apart

export interface TimeSignatureParts {
  beatsPerBar: number;
  denominator: number; // returned for later use; nothing reads it yet
}

export function parseTimeSignature(ts: string | null | undefined): TimeSignatureParts {
  const [num, den] = (ts ?? '').split('/');
  // Same `|| 4` fallback as the metronome.
  const beatsPerBar = parseInt(num, 10) || 4;
  const denominator = parseInt(den, 10) || 4;
  return { beatsPerBar, denominator };
}

export function secondsPerBeat(bpm: number | null | undefined): number {
  const b = typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? bpm : DEFAULT_BPM;
  return 60 / b;
}

export interface BarsBeats {
  bar: number;       // 1-based
  beat: number;      // 1-based
  sixteenth: number; // 1-based, 1–4 within the beat
}

export function secondsToBarsBeats(
  t: number,
  bpm: number | null | undefined,
  timeSignature: string | null | undefined,
): BarsBeats {
  const time = Number.isFinite(t) && t > 0 ? t : 0;
  const spb = secondsPerBeat(bpm);
  const { beatsPerBar } = parseTimeSignature(timeSignature);
  const beatIndex = Math.floor(time / spb);
  // spb / 4 is an exact division, so this index always agrees with beatIndex
  // (same form as the metronome's 1/16 tick).
  const sixteenthIndex = Math.floor(time / (spb / 4));
  return {
    bar: Math.floor(beatIndex / beatsPerBar) + 1,
    beat: (beatIndex % beatsPerBar) + 1,
    sixteenth: (sixteenthIndex % 4) + 1,
  };
}

export function formatBarsBeats(
  t: number,
  bpm: number | null | undefined,
  timeSignature: string | null | undefined,
): string {
  const { bar, beat, sixteenth } = secondsToBarsBeats(t, bpm, timeSignature);
  return `${bar}.${beat}.${sixteenth}`;
}

// Song time (seconds) where a 1-based bar starts.
export function barStartSeconds(
  bar: number,
  bpm: number | null | undefined,
  timeSignature: string | null | undefined,
): number {
  const { beatsPerBar } = parseTimeSignature(timeSignature);
  return (bar - 1) * beatsPerBar * secondsPerBeat(bpm);
}

export interface GridDensity {
  pxPerBeat: number;
  pxPerBar: number;
  barStep: number;            // draw a bar line every N bars (1, 2, 4, 8...)
  showBeats: boolean;         // beat lines (only when every bar is drawn)
  subdivisionsPerBeat: 1 | 2 | 4; // 2 = 1/8 lines, 4 = 1/16 lines
  labelStep: number;          // bar-number label every N bars (a multiple of barStep)
}

function powerOfTwoStep(pxPerUnit: number, minPx: number, from = 1): number {
  let step = from;
  // Cap so a zero/negative width can't loop forever.
  while (pxPerUnit * step < minPx && step < 1 << 20) step *= 2;
  return step;
}

export function gridDensity(pxPerBeat: number, beatsPerBar: number): GridDensity {
  const pxPerBar = pxPerBeat * beatsPerBar;
  const barStep = powerOfTwoStep(pxPerBar, BAR_LINE_MIN_PX);
  const showBeats = barStep === 1 && pxPerBeat >= BEAT_LINE_MIN_PX;
  const subdivisionsPerBeat: 1 | 2 | 4 =
    !showBeats ? 1
      : pxPerBeat >= SIXTEENTH_LINE_MIN_PX_PER_BEAT ? 4
      : pxPerBeat >= EIGHTH_LINE_MIN_PX_PER_BEAT ? 2
      : 1;
  const labelStep = powerOfTwoStep(pxPerBar, BAR_LABEL_MIN_PX, barStep);
  return { pxPerBeat, pxPerBar, barStep, showBeats, subdivisionsPerBeat, labelStep };
}

export type GridLineKind = 'bar' | 'beat' | 'subdivision';

// Lines inside one repeating grid tile: the tile is barStep bars wide, starts on a bar line at
// x = 0, and holds beat/subdivision lines when the density allows. Offsets are in pixels.
export function gridTile(density: GridDensity, beatsPerBar: number): {
  width: number;
  lines: { x: number; kind: GridLineKind }[];
} {
  const { pxPerBeat, pxPerBar, barStep, showBeats, subdivisionsPerBeat } = density;
  const lines: { x: number; kind: GridLineKind }[] = [{ x: 0, kind: 'bar' }];
  if (showBeats) {
    for (let b = 0; b < beatsPerBar; b++) {
      if (b > 0) lines.push({ x: b * pxPerBeat, kind: 'beat' });
      for (let s = 1; s < subdivisionsPerBeat; s++) {
        lines.push({ x: (b + s / subdivisionsPerBeat) * pxPerBeat, kind: 'subdivision' });
      }
    }
  }
  return { width: pxPerBar * barStep, lines };
}
