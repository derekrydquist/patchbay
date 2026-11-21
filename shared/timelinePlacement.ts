// Where a dragged timeline clip lands inside its home section, and the overlap check
// both the client and the server run. Pure TypeScript — no React, DOM or Node APIs —
// so the client and the server bundle can both import it.
//
// Everything here is in one track's one section: offsets are seconds from that
// section's start, lengths are trimmed lengths (effectiveLength). Legacy full takes
// sit outside sections and never take part.

import { effectiveLength, pickupRoomEnd, type LayoutClipInput, type TimelineLayout, type TimelineLayoutInput } from './timelineLayout';
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
//   6. `maxOffset` (default none) is the highest offset A may take in the LAST gap only
//      (the one after every other clip, which otherwise has no end): an overhang drag
//      (clipDragMaxOffset). Inner gaps are untouched. A limit below the last gap's start
//      leaves no room, and is ignored there: A is placed as a normal clip (the section
//      grows), never squeezed.
// Assumes the stored clips don't overlap (the server refuses any save that would).
export function placeInGap(
  others: PlacementClip[],
  draggedLength: number,
  wantedOffset: number,
  minOffset = 0,
  maxOffset = Infinity,
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

  // ── Rule 6: the last gap ends where A's start may go no further ────────────
  if (g1 === Infinity && Number.isFinite(maxOffset) && maxOffset >= g0 - PLACEMENT_EPSILON) {
    g1 = Math.max(g0, maxOffset) + draggedLength;
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

// ── Snap for clip drags ──────────────────────────────────────────────────────
// With snap on (and no Shift), a dragged clip's start snaps to whichever candidate is
// nearest its free (unsnapped) start, all as offsets from its section's start:
//   - the nearest grid point: the snap step in song time, as snapTime rounds it ("Bar"
//     = the ruler's bar lines), so k × step − sectionStart;
//   - the section's start (0) — with Bar snap a section can start mid-bar;
//   - flush against every other clip on its track in its section, where it's drawn
//     (cut pickups at their cut start): starting at its end, and ending at its start
//     (its start − the dragged clip's played length);
//   - the drag's minimum offset, when it's below 0 (a pickup allowed: the pickup limit);
//   - the dragged clip's current drawn start (stored offset + head cut), so dropping it
//     back near where it was keeps it exactly there, even off the beat;
//   - when an overhang is possible (`overhang`, the mirror of the pickup limit): ending
//     flush against the stop (stop − its length) and ending exactly at its section's
//     frozen end (sectionLength − its length, a normal clip again).
// "Its length" is always the dragged clip's full trimmed length: the result is an offset,
// and a clip at offset X ends at X + trimmed length whatever its cuts are now.
// A tie goes to the later spot, as snapTime rounds halfway later. `grid` null (snap off
// or Shift) → the free start, unchanged. The result goes into placeInGap as the wanted
// offset; the gaps model decides where it lands. Pass the other clips only in `others`,
// never the dragged clip itself (its current spot comes in as `currentOffset`).
export interface SnapDragStartInput {
  freeOffset: number;                           // the unsnapped start, from the section start
  grid: { step: number; sectionStart: number } | null; // snapGridSeconds + the section's layout start
  others: { start: number; end: number }[];     // the other clips' drawn spans, as offsets
  draggedLength: number;                        // the dragged clip's trimmed length
  minOffset: number;                            // clipDragMinOffset
  currentOffset?: number;                       // the dragged clip's drawn start now
  overhang?: OverhangLimits | null;             // only when an overhang is possible
}

export function snapDragStart({ freeOffset, grid, others, draggedLength, minOffset, currentOffset, overhang }: SnapDragStartInput): number {
  if (!grid || !Number.isFinite(freeOffset) || !(grid.step > 0)) return freeOffset;
  const candidates = [
    Math.round((grid.sectionStart + freeOffset) / grid.step) * grid.step - grid.sectionStart,
    0,
  ];
  for (const o of others) candidates.push(o.end, o.start - draggedLength);
  if (minOffset < 0) candidates.push(minOffset);
  if (currentOffset !== undefined && Number.isFinite(currentOffset)) candidates.push(currentOffset);
  if (overhang) {
    if (Number.isFinite(overhang.stop)) candidates.push(overhang.stop - draggedLength);
    candidates.push(overhang.sectionLength - draggedLength);
  }
  let best = candidates[0];
  for (const c of candidates) {
    const d = Math.abs(c - freeOffset);
    const bestD = Math.abs(best - freeOffset);
    if (d < bestD - PLACEMENT_EPSILON || (Math.abs(d - bestD) <= PLACEMENT_EPSILON && c > best)) best = c;
  }
  return best;
}

// ── Placing a dragged clip: snap, then the gaps model ────────────────────────
// The core both drag kinds share — a timeline clip drag (computeClipDragPlacement in
// Timeline.tsx) and a Media Bucket version drag (computeFileDropPlacement below): the
// wanted start is snapped (snapDragStart) and then placed among the other clips on its
// track in its section (placeInGap). The other clips come in twice: as stored
// (`others`, offset + trimmed length, for the gaps) and as drawn (`drawnOthers`, a cut
// pickup at its cut start, for flush snapping).
// Overhangs (4h3): pass `overhang` only while one is allowed (overhangAllowed). Then the
// last gap ends at clipDragMaxOffset, the two overhang snap candidates join, and the
// result's tailSeconds is the overhang (tailFromPlacement). With no room for an overhang
// (clipDragMaxOffset is Infinity) everything is as for a normal clip: tail 0.
export interface DragPlacementInput {
  freeOffset: number;                           // the unsnapped start, from the section start
  grid: { step: number; sectionStart: number } | null; // null = snap off or Shift
  others: PlacementClip[];                      // the other clips as stored
  drawnOthers: { start: number; end: number }[]; // the other clips' drawn spans, as offsets
  length: number;                               // the dragged clip's trimmed length (flush snapping too)
  minOffset: number;                            // placeInGap's minOffset (clipDragMinOffset)
  currentOffset?: number;                       // its drawn start now (a clip already placed)
  // Only while an overhang is allowed; `wall` when Option itself is held (a wall at
  // the section's end when there's no room to hang over — clipDragMaxOffset).
  overhang?: (OverhangLimits & { wall?: boolean }) | null;
}

export interface DragPlacementResult extends PlacementResult {
  tailSeconds: number; // the dragged clip's overhang after this placement (0: none)
}

export function placeDraggedClip(input: DragPlacementInput): DragPlacementResult {
  const maxOffset = input.overhang
    ? clipDragMaxOffset({ ...input.overhang, length: input.length, others: input.others, minOffset: input.minOffset })
    : Infinity;
  const overhang = input.overhang && overhangPossible(maxOffset, input.length, input.overhang.sectionLength)
    ? input.overhang
    : null;
  // A wall (Option, no room to hang over): the only extra snap point is ending exactly
  // at the section's end.
  const wall = !overhang && input.overhang && Number.isFinite(maxOffset)
    ? { sectionLength: input.overhang.sectionLength, stop: Infinity }
    : null;
  const wantedOffset = snapDragStart({
    freeOffset: input.freeOffset,
    grid: input.grid,
    others: input.drawnOthers,
    draggedLength: input.length,
    minOffset: input.minOffset,
    currentOffset: input.currentOffset,
    overhang: overhang ?? wall,
  });
  const result = placeInGap(input.others, input.length, wantedOffset, input.minOffset, maxOffset);
  const tailSeconds = overhang
    ? tailFromPlacement(result, { length: input.length, sectionLength: overhang.sectionLength, others: input.others })
    : 0;
  return { ...result, tailSeconds };
}

// A file dragged in from the Media Bucket (a version): a new clip with no current
// offset, its full file length (bucket clips have no trim), never a pickup — so its
// minimum offset is the section's start (0): a drop aimed before the section's start
// lands at its start, after any pickups there. `others` / `drawnOthers` are every
// non-full-take clip on its track in its section. Snap and the gaps model are the same
// as for a timeline clip drag. Never an overhang.
export function computeFileDropPlacement(input: {
  freeOffset: number;
  grid: { step: number; sectionStart: number } | null;
  others: PlacementClip[];
  drawnOthers: { start: number; end: number }[];
  length: number;
}): PlacementResult {
  const { offset, moved } = placeDraggedClip({ ...input, minOffset: 0 });
  return { offset, moved };
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
// track's clips in earlier sections, each counted only up to its own section's end
// (pickupRoomEnd: a pickup may use the space an earlier clip's tail hangs into), legacy
// full takes and unsectioned clips ignored, as the layout's head cut uses. Depends only on earlier sections, never on the clips
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
  const earlierEnds = new Map(layout.sections.slice(0, index).map((s) => [s.name, s.end]));
  let previousEnd = -Infinity;
  for (const c of input.clips) {
    if (c.trackId !== trackId || c.isFullTake || !c.sectionName) continue;
    const sectionEnd = earlierEnds.get(c.sectionName);
    const end = layout.clipEnds.get(c.id);
    if (sectionEnd === undefined || end === undefined) continue;
    previousEnd = Math.max(previousEnd, pickupRoomEnd(end, sectionEnd, input.bpm));
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

// ── Overhangs (tails) ────────────────────────────────────────────────────────
// The mirror of a pickup: tail_seconds is the last part of a clip that may hang past
// its section's end; the layout cuts it where the next clip on its track is drawn
// (clipTailCuts). Only Option creates one (a client rule); the server enforces:
//   - a sent tail is a finite number ≥ 0, shorter than the clip's trimmed length (so
//     its start stays inside its section), and > 0 only on the last clip on its track
//     in its section (a non-last clip may keep a hidden stored tail it didn't send);
//   - leniency: a written clip's tail cut after the write is no larger than before it
//     (0 if it wasn't cut). A push on an already-cut clip that doesn't cut it further
//     passes; moving it further into the next clip doesn't. Cutting ANOTHER clip's
//     tail is never a reason to refuse a write.

// A tail sent for a clip in this write, with what the check needs to know about it.
export interface SentTail {
  tailSeconds: number;
  trimmedLength: number; // (trimEnd ?? duration) − trimStart, after the write
  isLast: boolean;       // last clip on its track in its section, after the write
}

// Why a write can't save a clip's tail, or null when it can. `cutBefore` / `cutAfter`
// are the clip's tail cut (layout.clipTailCuts) in the layout before and after the
// whole write; `sent` is the tail the write sends for it, if any.
export function tailWriteError(cutBefore: number, cutAfter: number, sent?: SentTail | null): string | null {
  if (sent) {
    const { tailSeconds, trimmedLength, isLast } = sent;
    if (typeof tailSeconds !== 'number' || !Number.isFinite(tailSeconds) || tailSeconds < 0) {
      return "tailSeconds must be a finite number of seconds, 0 or more";
    }
    if (tailSeconds > trimmedLength - PLACEMENT_EPSILON) {
      return "An overhang must be shorter than the clip: its start has to stay inside its section.";
    }
    if (tailSeconds > PLACEMENT_EPSILON && !isLast) {
      return "Only the last clip on its track in its section can hang over the section's end.";
    }
  }
  if (cutAfter > Math.max(0, cutBefore) + PLACEMENT_EPSILON) {
    return "An overhang can't run into the next clip on its track.";
  }
  return null;
}

// ── Overhangs through trims and Replace (step 4h2b) ──────────────────────────
// A trim or Replace never leaves the written clip cut ("writes stop at limits"); its
// tail is derived from the layout BEFORE the write: the section's length S (seconds,
// from its start) and whether the clip was overhanging (endsPastSection on its full
// end). Tails below PLACEMENT_EPSILON count as 0 (float noise, not an overhang).

function cleanTail(seconds: number): number {
  return seconds > PLACEMENT_EPSILON ? seconds : 0;
}

// The tail a trim leaves. `newEnd` is the clip's full end after the trim (new offset +
// new trimmed length, from its section's start). An overhanging clip keeps hanging past
// S: a right trim uses up the overhang first (the section's end stays put), extending
// grows it. A clip that wasn't overhanging (a normal clip, or a hidden stored tail) gets
// 0 — the section grows as it always has — unless the trim was sent with allowOverhang
// (Option, a client rule; the caller checks it's the last clip there).
export function tailAfterTrim(
  newEnd: number, sectionLength: number, overhanging: boolean, allowOverhang = false,
): number {
  return overhanging || allowOverhang ? cleanTail(newEnd - sectionLength) : 0;
}

// The tail Replace leaves. An overhanging clip keeps its part inside the section,
// P = S − offset, and hangs the rest of the new file (`newLength`, trimmed and cut)
// past the end: max(0, newLength − P) — a file no longer than P leaves no tail and the
// section shrinks. A clip that wasn't overhanging gets 0 (Replace never creates one).
export function tailAfterReplace(
  newLength: number, offset: number, sectionLength: number, overhanging: boolean,
): number {
  return overhanging ? cleanTail(newLength - (sectionLength - offset)) : 0;
}

// Where an overhanging clip in `sectionName` on `trackId` must stop: the earliest drawn
// start (layout.clipStarts) of a clip on that track in any later section — normal clip
// or pickup, at its cut start — as an offset from this section's start, as the layout's
// tail cuts measure it; clips drawn at zero length don't count. Infinity when there is
// none (the tail may ring past the last section) or the section isn't on the timeline.
// Pass the stored layout as it was before the write.
export function nextClipStop(
  input: { clips: Pick<LayoutClipInput, 'id' | 'trackId' | 'sectionName' | 'isFullTake'>[] },
  layout: Pick<TimelineLayout, 'sections' | 'clipStarts' | 'clipEnds'>,
  trackId: string | number,
  sectionName: string,
): number {
  const index = layout.sections.findIndex((s) => s.name === sectionName);
  if (index < 0) return Infinity;
  const later = new Set(layout.sections.slice(index + 1).map((s) => s.name));
  let stop = Infinity;
  for (const c of input.clips) {
    if (c.trackId !== trackId || c.isFullTake || !c.sectionName || !later.has(c.sectionName)) continue;
    const start = layout.clipStarts.get(c.id);
    const end = layout.clipEnds.get(c.id);
    if (start === undefined || end === undefined || end - start <= PLACEMENT_EPSILON) continue;
    stop = Math.min(stop, start);
  }
  return stop - layout.sections[index].start;
}

// Whether releasing a dragged clip with placement `result` changes anything: no clip
// pushed, and the dragged clip landing on its drawn offset (within PLACEMENT_EPSILON),
// is a no-op and nothing is saved. `drawnOffset` is where it is drawn now, from its
// section start: its stored offset + the layout's head cut (clipHeadCuts). For a cut
// pickup that is its cut start, not its stored offset, so a drag released back on its
// own spot keeps the stored offset, and the full pickup comes back when room returns.
// Overhangs (4h3): the tail counts too — `result.tailSeconds` (missing = 0) against
// `tailBefore`, the overhang as drawn at drag start (tailAtDragStart: 0 for a clip that
// wasn't overhanging, so a hidden stored tail released on its own spot is no change).
export function placementChanged(
  result: PlacementResult & { tailSeconds?: number },
  drawnOffset: number,
  tailBefore = 0,
): boolean {
  return result.moved.length > 0
    || Math.abs(result.offset - drawnOffset) > PLACEMENT_EPSILON
    || Math.abs((result.tailSeconds ?? 0) - tailBefore) > PLACEMENT_EPSILON;
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

// ── Overhang drags (4h3) ─────────────────────────────────────────────────────
// The mirror of pickup drags. Only Option creates an overhang. A clip that is drawn past
// its section's end when its drag starts (endsPastSection on the stored layout — never
// just "has a stored tail") may move within its space without Option, until its end
// lands at or before the section's end: then it's a normal clip for the rest of that
// drag, and crossing back needs Option. While an overhang is allowed the section's end
// is frozen at its length when the drag started (S0): the clip's tail is how far it ends
// past S0, and nothing later moves. A normal clip without Option grows its section.
// All offsets below are seconds from the section's start; `sectionLength` is S0.

export interface OverhangDragState {
  wasOverhanging: boolean; // drawn past its section's end when the drag started
  backInside: boolean;     // its end has landed at or before the section's end in this drag
}

export function startOverhangDrag(wasOverhanging: boolean): OverhangDragState {
  return { wasOverhanging, backInside: false };
}

// Whether the drag may let the clip hang past its section's end now.
export function overhangAllowed(state: OverhangDragState, option: boolean): boolean {
  return option || (state.wasOverhanging && !state.backInside);
}

// The state after a placement whose end (offset + trimmed length) is `newEnd`.
export function afterOverhangPlacement(state: OverhangDragState, newEnd: number, sectionLength: number): OverhangDragState {
  return !state.backInside && newEnd <= sectionLength + PLACEMENT_EPSILON ? { ...state, backInside: true } : state;
}

// What limits an overhang: the section's frozen length S0 and the stop (nextClipStop on
// the stored layout at drag start, as an offset from this section's start; Infinity
// when no later clip on the track).
export interface OverhangLimits {
  sectionLength: number;
  stop: number;
}

// The highest offset the dragged clip may take in its last gap while an overhang is
// allowed: min(stop − length, S0 − minTrimLength(length)) — it never runs into the next
// clip on its track, and at least 0.5 s of it (the whole clip, if shorter) stays inside
// its section. Infinity — no limit, a normal clip whose section grows — whenever an
// overhang isn't possible:
//   - the limit is below the last gap's start (the end of the furthest other clip, or
//     minOffset): no room;
//   - even at the limit the clip wouldn't end past S0: the stop is at or before S0 (a
//     clip on the downbeat of the next section, or a pickup into it), or the clip is no
//     longer than minTrimLength (it must stay wholly inside).
//
// `wall` (Option held — the key, not just an overhanging clip moving without it): when
// an overhang isn't possible, the section's end is a wall instead — the mirror of a
// pickup drag stopping at the section's start when there's no pickup room. The limit
// is then S0 − length (the clip ends at most exactly at the section's end: tail 0, the
// section doesn't grow). Exception: when even the last gap's start can't fit the clip
// inside the section, Infinity as before (the section grows). Without `wall` an
// impossible overhang is always Infinity. A limit with an overhang possible is told
// apart from a wall by overhangPossible.
export function clipDragMaxOffset(input: OverhangLimits & {
  length: number;
  others: PlacementClip[];
  minOffset?: number;
  wall?: boolean;
}): number {
  const { sectionLength, stop, length, others } = input;
  if (!Number.isFinite(sectionLength) || !(length > 0) || Number.isNaN(stop)) return Infinity;
  const max = Math.min(stop - length, sectionLength - minTrimLength(length));
  const lastGapStart = others.reduce((m, c) => Math.max(m, c.offset + c.length), Math.min(0, input.minOffset ?? 0));
  if (max >= lastGapStart - PLACEMENT_EPSILON && max + length > sectionLength + PLACEMENT_EPSILON) return max;
  // No overhang possible.
  if (!input.wall) return Infinity;
  const wallAt = sectionLength - length;
  return wallAt >= lastGapStart - PLACEMENT_EPSILON ? wallAt : Infinity;
}

// Whether a limit from clipDragMaxOffset lets the clip hang over (its end may go past
// S0), as opposed to a wall at the section's end or no limit at all.
export function overhangPossible(maxOffset: number, length: number, sectionLength: number): boolean {
  return Number.isFinite(maxOffset) && maxOffset + length > sectionLength + PLACEMENT_EPSILON;
}

// The dragged clip's tail after a placement: how far it ends past the section's frozen
// length S0, when it landed in the last gap (no other clip on its track in its section
// starts after it, nothing pushed); otherwise 0. Pass this only while an overhang is
// possible (clipDragMaxOffset finite); with none the tail is 0. Float noise counts as 0.
export function tailFromPlacement(
  result: PlacementResult,
  input: { length: number; sectionLength: number; others: PlacementClip[] },
): number {
  if (result.moved.length > 0) return 0;
  if (input.others.some((c) => c.offset > result.offset + PLACEMENT_EPSILON)) return 0;
  const tail = result.offset + input.length - input.sectionLength;
  return tail > PLACEMENT_EPSILON ? tail : 0;
}

// The overhang as drawn when the drag starts, for placementChanged: how far its end
// (stored offset + trimmed length) is past S0 when it was overhanging, else 0 — a hidden
// stored tail counts as none.
export function tailAtDragStart(end: number, sectionLength: number, wasOverhanging: boolean): number {
  if (!wasOverhanging) return 0;
  const tail = end - sectionLength;
  return tail > PLACEMENT_EPSILON ? tail : 0;
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
  // The highest offset the left edge may move to (default none). Apply / reset trim on
  // all instances sets it for an overhanging instance, so its start stays inside its
  // section (its tail stays shorter than the clip).
  maxOffset?: number;
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
//               with none, 0 — or a pickup's left limit) and ≤ nb.maxOffset when set
//               (a left move only); unless a pickup is allowed
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
  const highStart = leftMoves
    ? Math.min(
      Math.min(wantedEnd, clip.duration) - minLength,
      nb?.maxOffset !== undefined ? clip.trimStart + (nb.maxOffset - clip.offset) : Infinity,
    )
    : Infinity;
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
