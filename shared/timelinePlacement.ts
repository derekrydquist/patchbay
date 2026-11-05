// Where a dragged timeline clip lands inside its home section, and the overlap check
// both the client and the server run. Pure TypeScript — no React, DOM or Node APIs —
// so the client and the server bundle can both import it.
//
// Everything here is in one track's one section: offsets are seconds from that
// section's start, lengths are trimmed lengths (effectiveLength). Legacy full takes
// sit outside sections and never take part.

import { effectiveLength, type LayoutClipInput } from './timelineLayout';

// Float noise allowed when comparing positions, in seconds. Touching edges are never
// an overlap.
export const PLACEMENT_EPSILON = 1e-6;

export interface PlacementClip {
  id: string;
  offset: number; // seconds from the section start
  length: number; // trimmed length (effectiveLength)
}

export interface PlacementResult {
  offset: number;                          // the dragged clip's new offset
  moved: { id: string; offset: number }[]; // every clip pushed later, with its new offset
}

// A stored clip as a PlacementClip. A null offset counts as 0, as in the layout.
export function toPlacementClip(
  clip: { id: string; sectionOffset: number | null | undefined } & Pick<LayoutClipInput, 'duration' | 'trimStart' | 'trimEnd'>,
): PlacementClip {
  return { id: clip.id, offset: clip.sectionOffset ?? 0, length: effectiveLength(clip) };
}

// Places a dragged clip A (length `draggedLength`) at `wantedOffset` S — already
// snapped, or free — among the other clips on its track in its section. Pass the other
// clips only, never A itself, so A's own old spot is free space.
//   1. Gaps: the free intervals between the clips — from 0 to the first clip, between
//      consecutive clips, and from the last clip's end with no upper limit.
//   2. Which gap: S in free space → the gap holding S. S inside a clip X, or exactly at
//      its start → X's first half picks the gap that ends at X's start, its second
//      half the gap that starts at X's end.
//   3. In that gap [g0, g1]: if A fits, it lands at S clamped to [g0, g1 − length] and
//      nothing else moves (aiming at a clip's half lands A snug against it). If it
//      doesn't, the gap stays: A lands at g0, wherever in the gap it was aimed, and
//      every clip from g1 on moves later by exactly A's length, all together — so the
//      gap (g1 − g0) now sits between A's end and the next clip, and the gaps between
//      the pushed clips keep their size. Clips before the gap never move; the section
//      grows on drop if they run past it.
//   4. No clip ever moves earlier — no reorders, swaps or rotations. Offsets never go
//      below 0 (no pickups yet).
// Assumes the stored clips don't overlap (the server refuses any save that would).
export function placeInGap(
  others: PlacementClip[],
  draggedLength: number,
  wantedOffset: number,
): PlacementResult {
  const sorted = [...others].sort((a, b) => a.offset - b.offset);
  const end = (c: PlacementClip) => c.offset + c.length;
  const s = Number.isFinite(wantedOffset) ? Math.max(0, wantedOffset) : 0;
  // The end of the last clip that ends at or before `at`, or 0; the start of the first
  // clip that starts at or after `at`, or no limit.
  const gapStartBefore = (at: number) =>
    sorted.filter((c) => end(c) <= at + PLACEMENT_EPSILON).reduce((m, c) => Math.max(m, end(c)), 0);
  const gapEndAfter = (at: number) =>
    sorted.find((c) => c.offset >= at - PLACEMENT_EPSILON)?.offset ?? Infinity;

  // ── Rule 2: which gap ──────────────────────────────────────────────────────
  let g0: number;
  let g1: number;
  const x = sorted.find((c) => c.offset - PLACEMENT_EPSILON <= s && s < end(c) - PLACEMENT_EPSILON);
  if (!x) {
    g0 = gapStartBefore(s);
    g1 = gapEndAfter(s);
  } else if (s - x.offset < x.length / 2) {
    g0 = gapStartBefore(x.offset);
    g1 = x.offset;
  } else {
    g0 = end(x);
    g1 = gapEndAfter(end(x));
  }

  // ── Rule 3: place A in [g0, g1] ────────────────────────────────────────────
  if (g1 - g0 >= draggedLength - PLACEMENT_EPSILON) {
    return { offset: Math.max(g0, Math.min(s, g1 - draggedLength)), moved: [] };
  }
  const by = draggedLength;
  return {
    offset: g0,
    moved: sorted
      .filter((c) => c.offset >= g1 - PLACEMENT_EPSILON)
      .map((c) => ({ id: c.id, offset: c.offset + by })),
  };
}

// The first pair of clips in `clips` that overlap, or null. Touching edges (within
// PLACEMENT_EPSILON) don't count.
export function findOverlap(clips: PlacementClip[]): [PlacementClip, PlacementClip] | null {
  const sorted = [...clips].sort((a, b) => a.offset - b.offset);
  let furthest: PlacementClip | null = null; // the clip reaching furthest right so far
  for (const clip of sorted) {
    if (furthest && furthest.offset + furthest.length > clip.offset + PLACEMENT_EPSILON) return [furthest, clip];
    if (!furthest || clip.offset + clip.length > furthest.offset + furthest.length) furthest = clip;
  }
  return null;
}

// Offset for a clip appended to the end of one track's section: the end of the clip
// that ends furthest right (offset + trimmed length), or 0 when there are none. Gaps
// stay: never the sum of the lengths, and nothing is re-packed.
export function appendOffset(clips: PlacementClip[]): number {
  return clips.reduce((end, c) => Math.max(end, c.offset + c.length), 0);
}

// After Replace: the trimEnd that cuts a clip short so it ends exactly where the next
// clip on its track in its section starts (non-destructive — duration is untouched),
// or null when it already fits or is the last clip there (the section grows instead).
// `others` are the other clips in that track's section, never the clip itself.
export function trimEndBeforeNext(
  clip: { offset: number; duration: number; trimStart: number; trimEnd: number | null },
  others: PlacementClip[],
): number | null {
  const next = others
    .filter((c) => c.offset >= clip.offset - PLACEMENT_EPSILON)
    .reduce<number>((min, c) => Math.min(min, c.offset), Infinity);
  if (!Number.isFinite(next)) return null;
  const room = Math.max(0, next - clip.offset);
  const length = (clip.trimEnd ?? clip.duration) - clip.trimStart;
  return length > room + PLACEMENT_EPSILON ? clip.trimStart + room : null;
}

// ── Trims ────────────────────────────────────────────────────────────────────
// A trim changes one clip and nothing else: its neighbours never move and nothing is
// re-packed. Both edges stop at the neighbouring clip on the same track in the same
// section. The left edge moves the clip's start with the audio: when trimStart changes
// by d, the clip's offset changes by the same d, so the audio stays where it is in time.

// The shortest a clip on the timeline can be, in seconds — the client's live trim, the
// trim route (writeTimelineClipTrim), apply/reset trim on all instances and Replace's
// cut-short all use it, through minTrimLength.
export const MIN_TRIM_LENGTH = 0.5;

// The minimum length for one clip: MIN_TRIM_LENGTH, or the file's full duration when the
// file itself is shorter (so a very short file stays trimmable and savable).
export function minTrimLength(duration: number): number {
  return Math.min(MIN_TRIM_LENGTH, Math.max(0, duration));
}

// What limits a clip's edges: the end of the clip before it (0 when there is none) and
// the start of the clip after it (Infinity when it's the last clip there — its right
// edge can grow the section).
export interface TrimNeighbours {
  prevEnd: number;
  nextStart: number;
}

// A clip's neighbours among `others` — the other clips on its track in its section,
// never the clip itself. A clip that starts before it is before it; one that starts at
// or after it is after it.
export function trimNeighbours(clip: { offset: number }, others: PlacementClip[]): TrimNeighbours {
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const c of others) {
    if (c.offset < clip.offset - PLACEMENT_EPSILON) prevEnd = Math.max(prevEnd, c.offset + c.length);
    else nextStart = Math.min(nextStart, c.offset);
  }
  return { prevEnd, nextStart };
}

export interface TrimClip {
  offset: number;          // seconds from the section start
  duration: number;        // full file length
  trimStart: number;
  trimEnd: number | null;  // null = plays to the end of the file
}

export interface TrimResult {
  trimStart: number;
  trimEnd: number | null;  // null when it reaches the end of the file
  offset: number;          // offset + (new trimStart − old trimStart)
  clamped: boolean;        // true when it isn't exactly the trim asked for
}

// The closest allowed trim to `wanted` for `clip`, from its current state. `nb` null
// means no neighbours and no offset limits (a legacy full take, or an unsectioned
// clip): only 0 ≤ trimStart and trimEnd ≤ duration apply, and the offset stays.
//   Left edge:  trimStart ≥ 0; the new offset ≥ 0 (no pickups yet) and ≥ the previous
//               clip's end; the clip stays at least minTrimLength long.
//   Right edge: trimEnd ≤ duration; the clip's end ≤ the next clip's start (no limit
//               for the last clip); at least minTrimLength long.
// The left edge is settled first, so a left-only change (trimEnd as it was) never moves
// the right edge, and a right-only change never moves the left edge. Returns null when
// there is no allowed trim: the neighbours leave less room than the minimum length (or
// the stored clips already overlap).
export function clampTrim(
  clip: TrimClip,
  wanted: { trimStart: number; trimEnd: number | null },
  nb: TrimNeighbours | null,
): TrimResult | null {
  const wantedEnd = wanted.trimEnd ?? clip.duration;
  const wantedStart = Number.isFinite(wanted.trimStart) ? wanted.trimStart : clip.trimStart;
  const minLength = minTrimLength(clip.duration);
  // ── Left edge ──
  const lowStart = nb
    ? Math.max(0, clip.trimStart + (Math.max(0, nb.prevEnd) - clip.offset))
    : 0;
  // Moving the left edge keeps the minimum length against the wanted right edge; a
  // right-only change leaves the left edge alone (the right edge yields instead).
  const leftMoves = Math.abs(wantedStart - clip.trimStart) > PLACEMENT_EPSILON;
  const highStart = leftMoves ? Math.min(wantedEnd, clip.duration) - minLength : Infinity;
  const trimStart = Math.max(lowStart, Math.min(wantedStart, highStart));
  const offset = nb ? clip.offset + (trimStart - clip.trimStart) : clip.offset;
  // ── Right edge ──
  const highEnd = nb ? Math.min(clip.duration, trimStart + (nb.nextStart - offset)) : clip.duration;
  const lowEnd = trimStart + minLength;
  let trimEnd = Math.min(highEnd, Math.max(lowEnd, Number.isFinite(wantedEnd) ? wantedEnd : clip.duration));
  if (trimEnd <= trimStart + PLACEMENT_EPSILON) return null;
  if (trimEnd - trimStart < minLength - PLACEMENT_EPSILON) return null;
  const storedEnd = trimEnd >= clip.duration - PLACEMENT_EPSILON ? null : trimEnd;
  if (storedEnd === null) trimEnd = clip.duration;
  const clamped = Math.abs(trimStart - wanted.trimStart) > PLACEMENT_EPSILON
    || Math.abs(trimEnd - wantedEnd) > PLACEMENT_EPSILON;
  return { trimStart, trimEnd: storedEnd, offset, clamped };
}
