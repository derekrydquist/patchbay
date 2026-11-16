// The timeline's section layout: where each section starts, how long it is, and where
// every clip lands. One algorithm meant for the Workspace timeline, Export and the
// server (timeline placement rebuild). Pure TypeScript — no React, DOM or Node APIs —
// so the client and the server bundle can both import it.
//
// Rules:
//   - Section order comes only from song_sections.sort_order. Sections with clips but
//     no row ("orphans") follow all the rows, alphabetically by name.
//   - Only sections holding at least one non-full-take clip take space.
//   - Section length, in whole beats = max(baseLength ?? 0, content need rounded up to
//     the next beat, 1). baseLength is stored in whole beats (song_sections.base_length),
//     so a tempo change keeps a section's bars. Every section starts on a beat; bar 1 is
//     song time 0.
//   - A sectioned clip sits at its section's start + sectionOffset. Its stored start
//     is ignored.
//   - Pickups (a negative sectionOffset) hang back into the end of the previous
//     section and never move a section ("cut, don't push"). Where there isn't room —
//     the clip would start before the end of the furthest clip already placed on its
//     track in an earlier section, or before song time 0 — its head is cut: it is laid
//     out from the point where there is room (clipHeadCuts), and the stored offset is
//     left alone, so the full pickup comes back by itself when room returns.
//   - Tails (tailSeconds, the mirror of a pickup) are the last seconds of a clip that
//     may hang past its section's end; they count toward no section's length. A clip
//     drawn past its section's end is cut where the next clip on its track is drawn
//     (any later section, normal clip or pickup): clipTailCuts. The stored tail stays,
//     so the full tail comes back when room returns. The pickup wins: a pickup's head
//     is never cut by another clip's tail.
//   - Legacy full takes keep their stored absolute start and take no part in the
//     section layout (they go away in step 8). Non-full-take clips with no section
//     name are treated the same way.
//
// The layout is computed in whole beats (integers) and only converted to seconds at
// the end, so float error never builds up from one section to the next.

import { parseTimeSignature, secondsPerBeat } from './musicalTime';

export interface LayoutSectionInput {
  name: string;
  sortOrder: number;
  baseLength: number | null; // whole beats; null = fit to content
}

export interface LayoutClipInput {
  id: string | number;
  trackId: string | number;
  sectionName: string | null | undefined;
  sectionOffset: number | null; // seconds from the section start; null counts as 0
  duration: number;             // full file length; never changed by trim
  trimStart: number;
  trimEnd: number | null;
  isFullTake: boolean;
  start: number;                // read only for full takes (and unsectioned clips)
  // Seconds at the clip's end that may hang past its section's end (timeline_clips.
  // tail_seconds). Missing, negative or non-finite counts as 0; capped at the trimmed
  // length (storedTailSeconds). Ignored for full takes and unsectioned clips.
  tailSeconds?: number;
}

export interface LayoutSection {
  name: string;
  start: number;       // seconds
  end: number;         // seconds; exactly equal to the next section's start
  length: number;      // seconds = lengthBeats × secondsPerBeat
  lengthBeats: number; // integer
  startBeat: number;   // integer, 0-based from song time 0
  startBar: number;    // 1-based bar the section starts in
  contentNeed: number; // seconds the section's clips need (before rounding)
  baseLength: number | null; // whole beats, as stored; null = fit to content
}

export interface TimelineLayoutInput {
  sections: LayoutSectionInput[];
  clips: LayoutClipInput[];
  bpm: number | null;
  timeSignature: string | null;
}

export interface TimelineLayout {
  sections: LayoutSection[]; // display order
  // Where each clip is drawn and played from: its section's start + sectionOffset +
  // its head cut (a full take or unsectioned clip: its stored start).
  clipStarts: Map<string | number, number>;
  // Where each clip ends: the uncut end, which neither a head cut nor a tail cut moves.
  // Consumers subtract the tail cut for the drawn/played end, as they add the head cut
  // for the drawn start.
  clipEnds: Map<string | number, number>;
  // Seconds cut from the start of each clip because there was no room for its pickup
  // (0 for every clip that isn't a cut pickup). Drawn/played length = trimmed length −
  // head cut; a clip whose head cut is its whole trimmed length has zero length in this
  // layout (clipStarts = clipEnds) and must be skipped.
  clipHeadCuts: Map<string | number, number>;
  // Seconds cut from the end of each clip drawn past its section's end, where the next
  // clip on its track is drawn (0 for every other clip). Drawn/played end = clipEnds −
  // tail cut.
  clipTailCuts: Map<string | number, number>;
  // The later of the last section's end and the furthest drawn (cut) end of any
  // sectioned clip — a tail past the last section rings past it. 0 with no sections.
  // Legacy full takes don't count (Export takes them into account itself).
  timelineEnd: number;
  orphans: string[];         // section names that had clips but no song_sections row
}

// Float noise allowed when rounding up to a beat, in beats.
const BEAT_EPSILON = 1e-6;
// A head cut shorter than this (seconds) is float noise — a previous clip that ends
// exactly where the pickup starts — and counts as no cut.
const HEAD_CUT_EPSILON = 1e-9;

// A stored tail as the layout reads it: 0 for anything that isn't a positive finite
// number, and never more than the clip's trimmed length.
export function storedTailSeconds(
  clip: Pick<LayoutClipInput, 'duration' | 'trimStart' | 'trimEnd' | 'tailSeconds'>,
): number {
  const tail = clip.tailSeconds;
  if (tail === undefined || tail === null || !Number.isFinite(tail) || tail <= 0) return 0;
  return Math.min(tail, Math.max(0, effectiveLength(clip)));
}

// How far an earlier clip takes a later pickup's room on its track: its end, but only
// up to its own section's end when it overhangs (ends past it by more than the float
// noise the beat rounding allows) — a tail never takes a pickup's room: the pickup wins.
// The layout's head cuts and pickupLeftLimit (timelinePlacement.ts) both use this, so
// they can't disagree. With no tails nothing overhangs and this is just `clipEnd`.
export function pickupRoomEnd(clipEnd: number, sectionEnd: number, bpm: number | null): number {
  return clipEnd > sectionEnd + BEAT_EPSILON * secondsPerBeat(bpm) ? sectionEnd : clipEnd;
}

export function effectiveLength(clip: Pick<LayoutClipInput, 'duration' | 'trimStart' | 'trimEnd'>): number {
  return (clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0);
}

// Whole beats needed to hold `seconds`; 0 for zero or negative input. A value that is
// a whole number of beats plus float noise does not gain a beat.
function beatsToHold(seconds: number, spb: number): number {
  if (!(seconds > 0)) return 0;
  return Math.max(0, Math.ceil(seconds / spb - BEAT_EPSILON));
}

// Seconds each section's clips need, by section name, across every track: the furthest
// clip end (sectionOffset + trimmed length − tail) of its sectioned clips. A section is
// on the timeline exactly when it has an entry here (at least one non-full-take clip
// with a section name). A pickup's part before the section start (a negative
// sectionOffset) counts toward no section's length: pickups never move a section; the
// layout cuts them instead.
export function sectionContentNeeds(
  clips: Pick<LayoutClipInput, 'sectionName' | 'sectionOffset' | 'duration' | 'trimStart' | 'trimEnd' | 'isFullTake' | 'tailSeconds'>[],
): Map<string, number> {
  const needs = new Map<string, number>();
  for (const clip of clips) {
    if (clip.isFullTake || !clip.sectionName) continue;
    const end = (clip.sectionOffset ?? 0) + effectiveLength(clip) - storedTailSeconds(clip);
    needs.set(clip.sectionName, Math.max(needs.get(clip.sectionName) ?? 0, end));
  }
  return needs;
}

// The fewest whole beats a section on the timeline can be: its content need (seconds,
// sectionContentNeeds) rounded up to the next beat, and at least one beat — even for a
// section whose clips all end at or before its start (only pickups). The layout and the
// server's base-length clamp both use this, so they can't disagree.
export function contentNeedBeats(needSeconds: number, bpm: number | null): number {
  return Math.max(1, beatsToHold(needSeconds, secondsPerBeat(bpm)));
}

// A stored base length (whole beats) as the layout reads it: 0 (fit to content) for
// null or anything that isn't a positive finite number; a stray fraction is rounded up,
// so every section still starts on a beat.
function storedBaseBeats(baseLength: number | null): number {
  if (baseLength === null || !Number.isFinite(baseLength) || baseLength <= 0) return 0;
  return Math.ceil(baseLength - BEAT_EPSILON);
}

export function roundUpToBeat(seconds: number, spb: number): number {
  return beatsToHold(seconds, spb) * spb;
}

// The section whose range contains `time` (start inclusive, end exclusive), or null.
// At an exact boundary this is the later section.
export function sectionAt<S extends Pick<LayoutSection, 'start' | 'end'>>(time: number, sections: S[]): S | null {
  for (const s of sections) {
    if (time >= s.start && time < s.end) return s;
  }
  return null;
}

function isSectioned(clip: LayoutClipInput): clip is LayoutClipInput & { sectionName: string } {
  return !clip.isFullTake && !!clip.sectionName;
}

function compareNames(a: string, b: string): number {
  // Code-point order, so the result never depends on the runtime's locale.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function layoutTimeline({ sections, clips, bpm, timeSignature }: TimelineLayoutInput): TimelineLayout {
  const spb = secondsPerBeat(bpm); // null / invalid bpm → DEFAULT_BPM (120)
  const { beatsPerBar } = parseTimeSignature(timeSignature);

  // Content need per section, across every track.
  const contentNeed = sectionContentNeeds(clips);

  // Display order: rows by sort_order (name breaks ties), then orphans by name.
  const rowsByName = new Map(sections.map((s) => [s.name, s]));
  const orderedRows = [...sections]
    .filter((s) => contentNeed.has(s.name))
    .sort((a, b) => a.sortOrder - b.sortOrder || compareNames(a.name, b.name));
  const orphans = Array.from(contentNeed.keys())
    .filter((name) => !rowsByName.has(name))
    .sort(compareNames);

  const layoutSections: LayoutSection[] = [];
  let startBeat = 0;
  const place = (name: string, baseLength: number | null) => {
    const need = contentNeed.get(name) ?? 0;
    // At least the content need (rounded up to a beat, at least one beat); a base length
    // (whole beats) adds empty space at the end, and one below the need is ignored.
    const lengthBeats = Math.max(contentNeedBeats(need, bpm), storedBaseBeats(baseLength));
    layoutSections.push({
      name,
      start: startBeat * spb,
      end: (startBeat + lengthBeats) * spb,
      length: lengthBeats * spb,
      lengthBeats,
      startBeat,
      startBar: Math.floor(startBeat / beatsPerBar) + 1,
      contentNeed: need,
      baseLength,
    });
    startBeat += lengthBeats;
  };
  for (const row of orderedRows) place(row.name, row.baseLength);
  for (const name of orphans) place(name, null);

  const clipStarts = new Map<string | number, number>();
  const clipEnds = new Map<string | number, number>();
  const clipHeadCuts = new Map<string | number, number>();
  const clipTailCuts = new Map<string | number, number>();

  // Legacy full takes and unsectioned clips: their stored start, never cut.
  for (const clip of clips) {
    if (isSectioned(clip)) continue;
    clipStarts.set(clip.id, clip.start);
    clipEnds.set(clip.id, clip.start + effectiveLength(clip));
    clipHeadCuts.set(clip.id, 0);
    clipTailCuts.set(clip.id, 0);
  }

  // Sectioned clips, section by section in arrangement order. furthestEnd: per track,
  // the furthest end of the clips placed on it in earlier sections, each counted only
  // up to its own section's end (a tail hanging past it never takes a later pickup's
  // room: the pickup wins) — the room a pickup in a later section has, with song time 0.
  const clipsBySection = new Map<string, (LayoutClipInput & { sectionName: string })[]>();
  for (const clip of clips) {
    if (!isSectioned(clip)) continue;
    const list = clipsBySection.get(clip.sectionName);
    if (list) list.push(clip);
    else clipsBySection.set(clip.sectionName, [clip]);
  }
  const furthestEnd = new Map<string | number, number>();
  // A clip "overhangs" only when it ends past its section's end by more than the float
  // noise the beat rounding allows (sectionContentNeeds → beatsToHold); a clip ending a
  // hair past its section today is not a tail.
  const overhangEpsilon = BEAT_EPSILON * spb;
  for (const section of layoutSections) {
    const sectionClips = clipsBySection.get(section.name) ?? [];
    for (const clip of sectionClips) {
      const offset = clip.sectionOffset ?? 0;
      const length = effectiveLength(clip);
      const uncutStart = section.start + offset;
      let headCut = 0;
      if (offset < 0) {
        const earliest = Math.max(0, furthestEnd.get(clip.trackId) ?? 0);
        const wanted = earliest - uncutStart;
        // Capped at the whole trimmed length: a pickup with no room at all has zero
        // length here (start = end), and is never drawn or played.
        if (wanted > HEAD_CUT_EPSILON) headCut = Math.min(Math.max(0, length), wanted);
      }
      clipStarts.set(clip.id, uncutStart + headCut);
      clipEnds.set(clip.id, uncutStart + length);
      clipHeadCuts.set(clip.id, headCut);
    }
    // Only after the whole section: clips in the same section never limit each other.
    for (const clip of sectionClips) {
      const end = pickupRoomEnd(clipEnds.get(clip.id)!, section.end, bpm);
      furthestEnd.set(clip.trackId, Math.max(furthestEnd.get(clip.trackId) ?? -Infinity, end));
    }
  }

  // Tail cuts, once every drawn start is known. A clip drawn past its section's end is
  // cut where the first clip after it on its track is drawn — a clip in any later
  // section, normal clip or pickup (at its cut start); clips drawn at zero length don't
  // count. No later clip on the track: no cut, the tail rings past the last section.
  const sectionIndex = new Map(layoutSections.map((s, i) => [s.name, i]));
  const sectionedByTrack = new Map<string | number, (LayoutClipInput & { sectionName: string })[]>();
  for (const clip of clips) {
    if (!isSectioned(clip) || !sectionIndex.has(clip.sectionName)) continue;
    const list = sectionedByTrack.get(clip.trackId);
    if (list) list.push(clip);
    else sectionedByTrack.set(clip.trackId, [clip]);
  }
  // The furthest drawn end of an overhanging clip (every other sectioned clip ends
  // inside its section, so the last section's end covers it).
  let furthestDrawnEnd = 0;
  for (const trackClips of Array.from(sectionedByTrack.values())) {
    for (const clip of trackClips) {
      const index = sectionIndex.get(clip.sectionName)!;
      const sectionEnd = layoutSections[index].end;
      const start = clipStarts.get(clip.id)!;
      const end = clipEnds.get(clip.id)!;
      let tailCut = 0;
      const overhangs = end > sectionEnd + overhangEpsilon;
      if (overhangs) {
        let nextStart = Infinity;
        for (const other of trackClips) {
          if (sectionIndex.get(other.sectionName)! <= index) continue;
          const otherStart = clipStarts.get(other.id)!;
          if (clipEnds.get(other.id)! - otherStart <= HEAD_CUT_EPSILON) continue; // not drawn
          nextStart = Math.min(nextStart, otherStart);
        }
        const wanted = end - nextStart;
        // Never more than the drawn length (start → end).
        if (wanted > HEAD_CUT_EPSILON) tailCut = Math.min(wanted, Math.max(0, end - start));
      }
      clipTailCuts.set(clip.id, tailCut);
      if (overhangs && end - start > HEAD_CUT_EPSILON) furthestDrawnEnd = Math.max(furthestDrawnEnd, end - tailCut);
    }
  }
  for (const clip of clips) {
    if (!clipTailCuts.has(clip.id)) clipTailCuts.set(clip.id, 0);
  }

  const last = layoutSections[layoutSections.length - 1];
  return {
    sections: layoutSections,
    clipStarts,
    clipEnds,
    clipHeadCuts,
    clipTailCuts,
    timelineEnd: last ? Math.max(last.end, furthestDrawnEnd) : 0,
    orphans,
  };
}
