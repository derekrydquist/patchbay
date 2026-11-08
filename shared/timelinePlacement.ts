// Where a dragged timeline clip lands inside its home section, and the overlap check
// both the client and the server run. Pure TypeScript — no React, DOM or Node APIs —
// so the client and the server bundle can both import it.
//
// Everything here is in one track's one section: offsets are seconds from that
// section's start, lengths are trimmed lengths (effectiveLength). Legacy full takes
// sit outside sections and never take part.

import { effectiveLength, type LayoutClipInput, type TimelineLayout, type TimelineLayoutInput } from './timelineLayout';
import { parseTimeSignature, secondsPerBeat } from './musicalTime';

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
//   4. No clip ever moves earlier — no reorders, swaps or rotations.
//   5. `minOffset` (default 0, the downbeat) is the lowest offset A may take: the first
//      gap starts there instead of at 0. Below 0 only for a pickup drag (clipDragMinOffset).
//      A clip among `others` that starts before minOffset (an existing pickup, when A
//      may not be one) never moves: the first gap starts at its end instead.
// Assumes the stored clips don't overlap (the server refuses any save that would).
export function placeInGap(
  others: PlacementClip[],
  draggedLength: number,
  wantedOffset: number,
  minOffset = 0,
): PlacementResult {
  const min = Number.isFinite(minOffset) ? Math.min(0, minOffset) : 0;
  const end = (c: PlacementClip) => c.offset + c.length;
  // Clips starting before the minimum stay where they are and only raise the floor.
  const fixed = others.filter((c) => c.offset < min - PLACEMENT_EPSILON);
  const floor = fixed.reduce((m, c) => Math.max(m, end(c)), min);
  const sorted = others.filter((c) => !fixed.includes(c)).sort((a, b) => a.offset - b.offset);
  const s = Number.isFinite(wantedOffset) ? Math.max(floor, wantedOffset) : Math.max(floor, 0);
  // The end of the last clip that ends at or before `at`, or the floor; the start of the
  // first clip that starts at or after `at`, or no limit.
  const gapStartBefore = (at: number) =>
    sorted.filter((c) => end(c) <= at + PLACEMENT_EPSILON).reduce((m, c) => Math.max(m, end(c)), floor);
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

// ── Pickups ──────────────────────────────────────────────────────────────────
// A pickup is a clip with a negative section offset: it belongs to its section but
// starts before the section's downbeat. It can sit anywhere in the pickup area: its
// end may stop before the downbeat (a stick click on beat 2 of the bar before). Hard
// limits, the same on client and server:
//   - its start is no earlier than pickupLeftLimit (below);
//   - "cut, don't push": nothing else ever moves to make room.
// Leniency: a clip already sitting below its limit (a later tempo change, a previous
// clip moved later, a bandmate's edit) stays saveable — a write that doesn't move its
// start further left is always allowed (pickupOffsetError).

// The earliest offset (seconds from the section start, so 0 or negative) a pickup on
// `trackId` in `sectionName` may start at: the latest of one bar before the section
// start (bar length from the song's tempo and time signature), song time 0, and the
// end of the previous clip on that track — the furthest end (layout.clipEnds) of the
// track's clips in earlier sections, legacy full takes and unsectioned clips ignored,
// as the layout's head cut uses. Depends only on earlier sections, never on the clips
// in this section ("cut, don't push": a clip never moves its own section), so the clip
// being moved can stay in the layout. A section that isn't on the timeline (no clips)
// has no start: 0, no pickup.
export function pickupLeftLimit(
  input: Pick<TimelineLayoutInput, 'bpm' | 'timeSignature'> & {
    clips: Pick<LayoutClipInput, 'id' | 'trackId' | 'sectionName' | 'isFullTake'>[];
  },
  layout: Pick<TimelineLayout, 'sections' | 'clipEnds'>,
  trackId: string | number,
  sectionName: string,
): number {
  const index = layout.sections.findIndex((s) => s.name === sectionName);
  if (index < 0) return 0;
  const sectionStart = layout.sections[index].start;
  const barLength = parseTimeSignature(input.timeSignature).beatsPerBar * secondsPerBeat(input.bpm);
  const earlier = new Set(layout.sections.slice(0, index).map((s) => s.name));
  let previousEnd = -Infinity;
  for (const c of input.clips) {
    if (c.trackId !== trackId || c.isFullTake || !c.sectionName || !earlier.has(c.sectionName)) continue;
    const end = layout.clipEnds.get(c.id);
    if (end !== undefined) previousEnd = Math.max(previousEnd, end);
  }
  return Math.min(0, Math.max(sectionStart - barLength, 0, previousEnd) - sectionStart);
}

// Why a sectioned clip can't be saved at `offset`, or null when it can. `currentOffset`
// is the clip's stored offset before this write (null for a new clip): an offset at or
// after it is always allowed (leniency); otherwise the offset must be ≥ `leftLimit`
// (pickupLeftLimit). Where the clip ends doesn't matter.
export function pickupOffsetError(
  offset: number,
  currentOffset: number | null,
  leftLimit: number,
): string | null {
  const floor = currentOffset === null ? Math.min(0, leftLimit) : Math.min(leftLimit, currentOffset);
  if (offset < floor - PLACEMENT_EPSILON) {
    return "A pickup can't start more than one bar before its section, before the end of the previous clip on its track, or before the start of the song.";
  }
  return null;
}

// Whether releasing a dragged clip with placement `result` changes anything: no clip
// pushed, and the dragged clip landing on its drawn offset (within PLACEMENT_EPSILON),
// is a no-op and nothing is saved. `drawnOffset` is where it is drawn now, from its
// section start: its stored offset + the layout's head cut (clipHeadCuts). For a cut
// pickup that is its cut start, not its stored offset, so a drag released back on its
// own spot keeps the stored offset, and the full pickup comes back when room returns.
export function placementChanged(result: PlacementResult, drawnOffset: number): boolean {
  return result.moved.length > 0 || Math.abs(result.offset - drawnOffset) > PLACEMENT_EPSILON;
}

// ── Pickup drags ─────────────────────────────────────────────────────────────
// Only Option creates a pickup. A clip that is a pickup when its drag starts may move
// within the pickup area without Option, until it is dragged on or after the downbeat:
// then it's a normal clip for the rest of that drag, and crossing back needs Option.

export interface PickupDragState {
  wasPickup: boolean;      // its stored offset was below 0 when the drag started
  crossedDownbeat: boolean; // it has landed on or after the downbeat in this drag
}

export function startPickupDrag(storedOffset: number | null | undefined): PickupDragState {
  return { wasPickup: (storedOffset ?? 0) < -PLACEMENT_EPSILON, crossedDownbeat: false };
}

// Whether the drag may place the clip before the downbeat now.
export function pickupAllowed(state: PickupDragState, option: boolean): boolean {
  return option || (state.wasPickup && !state.crossedDownbeat);
}

// The state after a placement at `landedOffset`.
export function afterPickupPlacement(state: PickupDragState, landedOffset: number): PickupDragState {
  return !state.crossedDownbeat && landedOffset >= -PLACEMENT_EPSILON ? { ...state, crossedDownbeat: true } : state;
}

// The lowest offset a dragged clip may take (placeInGap's minOffset): 0 when no pickup
// is allowed; otherwise its left limit (pickupLeftLimit), never above 0.
export function clipDragMinOffset(allowPickup: boolean, leftLimit: number): number {
  return allowPickup ? Math.min(0, leftLimit) : 0;
}

// ── Trims ────────────────────────────────────────────────────────────────────
// A trim changes one clip and nothing else: its neighbours never move and nothing is
// re-packed. Both edges stop at the neighbouring clip on the same track in the same
// section. The left edge moves the clip's start with the audio: when trimStart changes
// by d, the clip's offset changes by the same d, so the audio stays where it is in time.
// Pickups, as for drags: only Option creates one. A normal clip's left edge stops at the
// downbeat; with Option it may go on to its left limit (pickupLeftLimit). A clip that is
// a pickup when the trim starts moves within its limits without Option, until its left
// edge is pulled on or after the downbeat; crossing back then needs Option (the same
// startPickupDrag / pickupAllowed / afterPickupPlacement state as a drag). The right
// edge also stops where a pickup in a later section on the same track is drawn
// (nextPickupStop), never running over it. Option and the pickup stop are client rules;
// the server enforces only the hard limits (writeTimelineClipTrim).

// The shortest a clip on the timeline can be, in seconds — the client's live trim, the
// trim route (writeTimelineClipTrim), apply/reset trim on all instances and Replace's
// cut-short all use it, through minTrimLength.
export const MIN_TRIM_LENGTH = 0.5;

// The minimum length for one clip: MIN_TRIM_LENGTH, or the file's full duration when the
// file itself is shorter (so a very short file stays trimmable and savable).
export function minTrimLength(duration: number): number {
  return Math.min(MIN_TRIM_LENGTH, Math.max(0, duration));
}

// What limits a clip's edges: the end of the clip before it (when there is none: 0, or
// for a pickup its left limit — see trimNeighbours) and the start of the clip after it
// (Infinity when it's the last clip there — its right edge can grow the section).
export interface TrimNeighbours {
  prevEnd: number;
  nextStart: number;
}

// A clip's neighbours among `others` — the other clips on its track in its section,
// never the clip itself. A clip that starts before it is before it; one that starts at
// or after it is after it. With no clip before it, its left edge stops at the downbeat,
// 0 — or, when a pickup is allowed (`allowPickup`: by default only for a clip that is
// already a pickup, offset < 0), at `pickupLimit` (pickupLeftLimit), or at its own
// offset if it already sits below that (leniency). `nextPickupStop` (nextPickupStop,
// default none) caps the right edge for the last clip there.
export function trimNeighbours(
  clip: { offset: number },
  others: PlacementClip[],
  pickupLimit = 0,
  opts: { allowPickup?: boolean; nextPickupStop?: number } = {},
): TrimNeighbours {
  const allowPickup = opts.allowPickup ?? clip.offset < -PLACEMENT_EPSILON;
  let prevEnd = allowPickup ? Math.min(0, pickupLimit, clip.offset) : 0;
  let nextStart = opts.nextPickupStop ?? Infinity;
  for (const c of others) {
    if (c.offset < clip.offset - PLACEMENT_EPSILON) prevEnd = Math.max(prevEnd, c.offset + c.length);
    else nextStart = Math.min(nextStart, c.offset);
  }
  return { prevEnd, nextStart };
}

// Where the right edge of the clips on `trackId` in `sectionName` stops for a pickup in
// a later section on that track: the earliest drawn start (layout.clipStarts — a cut
// pickup's cut start) of such a pickup that sits at or before this section's end, as an
// offset from this section's start; Infinity when there is none. Only pickups (offset
// < 0) set it: a later section's clips at or after its downbeat move along as this
// section grows. A pickup that isn't drawn (its head cut leaves nothing) sets none. The
// layout already cuts every pickup at the end of this track's clips here, so the stop
// is never before their current ends. Pass the stored layout as it was when the trim
// started.
export function nextPickupStop(
  input: { clips: Pick<LayoutClipInput, 'id' | 'trackId' | 'sectionName' | 'sectionOffset' | 'isFullTake'>[] },
  layout: Pick<TimelineLayout, 'sections' | 'clipStarts' | 'clipEnds'>,
  trackId: string | number,
  sectionName: string,
): number {
  const index = layout.sections.findIndex((s) => s.name === sectionName);
  if (index < 0) return Infinity;
  const { start, end } = layout.sections[index];
  const later = new Set(layout.sections.slice(index + 1).map((s) => s.name));
  let stop = Infinity;
  for (const c of input.clips) {
    if (c.trackId !== trackId || c.isFullTake || !c.sectionName || !later.has(c.sectionName)) continue;
    if (!((c.sectionOffset ?? 0) < -PLACEMENT_EPSILON)) continue;
    const drawnStart = layout.clipStarts.get(c.id);
    const drawnEnd = layout.clipEnds.get(c.id);
    if (drawnStart === undefined || drawnEnd === undefined || drawnEnd - drawnStart <= PLACEMENT_EPSILON) continue;
    if (drawnStart > end + PLACEMENT_EPSILON) continue;
    stop = Math.min(stop, drawnStart);
  }
  return stop - start;
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
//   Left edge:  trimStart ≥ 0; the new offset ≥ nb.prevEnd (the previous clip's end;
//               with none, 0 — or a pickup's left limit); unless a pickup is allowed
//               (`opts.allowPickup`, by default only for a clip that is already a
//               pickup; pass the matching trimNeighbours) it never goes below 0; the
//               clip stays at least minTrimLength long.
//   Right edge: trimEnd ≤ duration; the clip's end ≤ the next clip's start (no limit
//               for the last clip); at least minTrimLength long. A pickup's end may
//               go before the downbeat.
// The left edge is settled first, so a left-only change (trimEnd as it was) never moves
// the right edge, and a right-only change never moves the left edge. Returns null when
// there is no allowed trim: the neighbours leave less room than the minimum length (or
// the stored clips already overlap).
export function clampTrim(
  clip: TrimClip,
  wanted: { trimStart: number; trimEnd: number | null },
  nb: TrimNeighbours | null,
  opts: { allowPickup?: boolean } = {},
): TrimResult | null {
  const wantedEnd = wanted.trimEnd ?? clip.duration;
  const wantedStart = Number.isFinite(wanted.trimStart) ? wanted.trimStart : clip.trimStart;
  const minLength = minTrimLength(clip.duration);
  const isPickup = !!nb && clip.offset < -PLACEMENT_EPSILON;
  const allowPickup = opts.allowPickup ?? isPickup;
  // ── Left edge ──
  // When a pickup is allowed the lowest offset is nb.prevEnd as given (its left limit,
  // from trimNeighbours); otherwise it never goes below 0.
  const lowOffset = nb ? (allowPickup ? nb.prevEnd : Math.max(0, nb.prevEnd)) : 0;
  const lowStart = nb ? Math.max(0, clip.trimStart + (lowOffset - clip.offset)) : 0;
  // Moving the left edge keeps the minimum length against the wanted right edge; a
  // right-only change leaves the left edge alone (the right edge yields instead) — for
  // a pickup exactly where it is, whatever its limits say.
  const leftMoves = Math.abs(wantedStart - clip.trimStart) > PLACEMENT_EPSILON;
  const highStart = leftMoves ? Math.min(wantedEnd, clip.duration) - minLength : Infinity;
  const trimStart = isPickup && !leftMoves
    ? clip.trimStart
    : Math.max(lowStart, Math.min(wantedStart, highStart));
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
