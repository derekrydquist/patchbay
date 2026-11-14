// The section-end handle's write: song_sections.base_length, in whole beats (null =
// fit to content). PUT /api/songs/:songId/sections/base-length validates its body here,
// and the client's handle uses the same limit. Pure — no React, DOM or Node APIs.

// The longest base length the handle may set, in beats (1024 bars of 4/4).
export const MAX_SECTION_BASE_BEATS = 4096;

// Whether `value` is a base length the route accepts: null, or a whole number of beats
// from 1 to MAX_SECTION_BASE_BEATS. Rejects fractions, NaN, Infinity, 0, negatives,
// strings and anything above the maximum.
export function isValidBaseLength(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SECTION_BASE_BEATS);
}

export type SectionBaseLengthBody = { section: string; baseLength: number | null };

// The route's body, or the 400 message for it. `section` must be a non-empty string;
// `baseLength` must be present (null to fit to content) and valid (isValidBaseLength).
export function parseSectionBaseLengthBody(body: unknown): { ok: true; value: SectionBaseLengthBody } | { ok: false; message: string } {
  const { section, baseLength } = (body ?? {}) as { section?: unknown; baseLength?: unknown };
  if (typeof section !== 'string' || section.length === 0) {
    return { ok: false, message: 'section must be a section name' };
  }
  if (baseLength === undefined || !isValidBaseLength(baseLength)) {
    return { ok: false, message: `baseLength must be null or a whole number of beats from 1 to ${MAX_SECTION_BASE_BEATS}` };
  }
  return { ok: true, value: { section, baseLength } };
}

// ── The section-end handle's steps (step 4g2) ─────────────────────────────────
// Everything here is in whole beats counted from song time 0 (bar 1 = beat 0), the
// same beats the layout and the ruler use.

export interface SectionEndRange {
  startBeat: number;   // the section's start
  minEndBeat: number;  // start + content need (contentNeedBeats, at least one beat)
  maxEndBeat: number;  // the latest end the handle may set: start + MAX_SECTION_BASE_BEATS,
                       // or minEndBeat when the content already needs more than that
}

// The range a section's end can be dragged over. needBeats is contentNeedBeats for the
// section (already at least 1).
export function sectionEndRange(startBeat: number, needBeats: number): SectionEndRange {
  const minEndBeat = startBeat + Math.max(1, needBeats);
  return { startBeat, minEndBeat, maxEndBeat: Math.max(minEndBeat, startBeat + MAX_SECTION_BASE_BEATS) };
}

// The stop nearest `pointerBeat` (fractional beats from song time 0). Bar steps: the
// stops are minEndBeat, then every bar line after it (song-wide, from bar 1) up to
// maxEndBeat — so a section starting mid-bar can be stretched to end on a downbeat.
// Otherwise (snap 1/4, 1/8, 1/16, snap off or Shift held): every whole beat from
// minEndBeat to maxEndBeat. Exactly halfway between two stops picks the later one.
export function nearestSectionEndStop(
  range: SectionEndRange,
  pointerBeat: number,
  barSteps: boolean,
  beatsPerBar: number,
): number {
  const { minEndBeat, maxEndBeat } = range;
  if (!Number.isFinite(pointerBeat) || pointerBeat <= minEndBeat) return minEndBeat;
  const p = Math.min(pointerBeat, maxEndBeat);
  if (!barSteps || beatsPerBar <= 0) {
    return Math.min(maxEndBeat, Math.max(minEndBeat, Math.round(p)));
  }
  // The candidates: minEndBeat and the bar lines on either side of the pointer that
  // are past it and within the maximum.
  const below = Math.floor(p / beatsPerBar) * beatsPerBar;
  const above = below + beatsPerBar;
  const candidates = [minEndBeat];
  if (below > minEndBeat && below <= maxEndBeat) candidates.push(below);
  if (above > minEndBeat && above <= maxEndBeat) candidates.push(above);
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - p) <= Math.abs(best - p)) best = c;
  }
  return best;
}

// The base length to store for a section ending at endBeat: null (fit to content) at
// the minimum, otherwise the whole length in beats.
export function baseLengthForEnd(range: SectionEndRange, endBeat: number): number | null {
  return endBeat <= range.minEndBeat ? null : endBeat - range.startBeat;
}

// A number of beats as bars and beats, e.g. "10 bars", "8 bars 3 beats", "1 bar 1 beat",
// "3 beats".
export function formatBarsAndBeats(beats: number, beatsPerBar: number): string {
  const perBar = beatsPerBar > 0 ? beatsPerBar : 4;
  const bars = Math.floor(beats / perBar);
  const rest = beats - bars * perBar;
  const barText = bars > 0 ? `${bars} bar${bars === 1 ? '' : 's'}` : '';
  const beatText = rest > 0 || bars === 0 ? `${rest} beat${rest === 1 ? '' : 's'}` : '';
  return [barText, beatText].filter(Boolean).join(' ');
}

// The handle's readout: "<Section> · fit" at the minimum, otherwise
// "<Section> · <length> (+<empty> empty)".
export function sectionEndReadout(name: string, range: SectionEndRange, endBeat: number, beatsPerBar: number): string {
  if (endBeat <= range.minEndBeat) return `${name} · fit`;
  const length = formatBarsAndBeats(endBeat - range.startBeat, beatsPerBar);
  const empty = formatBarsAndBeats(endBeat - range.minEndBeat, beatsPerBar);
  return `${name} · ${length} (+${empty} empty)`;
}

// What a handle release sends: { baseLength } to save, or null to send nothing.
// A different end sends its base length (baseLengthForEnd). A release at the minimum
// end ("fit") sends null whenever a base length is stored, even when the drawn end
// didn't change — a stored value shorter than the current content is invisible now
// but would come back as empty space if clips were removed, so fit always clears it.
// No change with nothing stored sends nothing.
export function sectionEndRelease(
  range: SectionEndRange,
  storedEndBeat: number,
  storedBaseLength: number | null,
  endBeat: number,
): { baseLength: number | null } | null {
  if (endBeat !== storedEndBeat) return { baseLength: baseLengthForEnd(range, endBeat) };
  if (endBeat <= range.minEndBeat && storedBaseLength !== null) return { baseLength: null };
  return null;
}
