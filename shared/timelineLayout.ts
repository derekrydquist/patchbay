// The timeline's section layout: where each section starts, how long it is, and where
// every clip lands. One algorithm meant for the Workspace timeline, Export and the
// server (timeline placement rebuild). Pure TypeScript — no React, DOM or Node APIs —
// so the client and the server bundle can both import it.
//
// Rules:
//   - Section order comes only from song_sections.sort_order. Sections with clips but
//     no row ("orphans") follow all the rows, alphabetically by name.
//   - Only sections holding at least one non-full-take clip take space.
//   - Section length = max(baseLength ?? 0, content need), rounded up to a whole beat.
//     Every section starts on a beat; bar 1 is song time 0.
//   - A sectioned clip sits at its section's start + sectionOffset. Its stored start
//     is ignored.
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
  baseLength: number | null; // seconds; null = fit to content
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
  tailSeconds?: number;         // ring-over that may hang into the next section; 0 for now
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
  baseLength: number | null;
}

export interface TimelineLayoutInput {
  sections: LayoutSectionInput[];
  clips: LayoutClipInput[];
  bpm: number | null;
  timeSignature: string | null;
}

export interface TimelineLayout {
  sections: LayoutSection[]; // display order
  clipStarts: Map<string | number, number>;
  clipEnds: Map<string | number, number>;
  timelineEnd: number;       // end of the last section; 0 with no sections
  orphans: string[];         // section names that had clips but no song_sections row
}

// Float noise allowed when rounding up to a beat, in beats.
const BEAT_EPSILON = 1e-6;

export function effectiveLength(clip: Pick<LayoutClipInput, 'duration' | 'trimStart' | 'trimEnd'>): number {
  return (clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0);
}

// Whole beats needed to hold `seconds`; 0 for zero or negative input. A value that is
// a whole number of beats plus float noise does not gain a beat.
function beatsToHold(seconds: number, spb: number): number {
  if (!(seconds > 0)) return 0;
  return Math.max(0, Math.ceil(seconds / spb - BEAT_EPSILON));
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
  const contentNeed = new Map<string, number>();
  for (const clip of clips) {
    if (!isSectioned(clip)) continue;
    const end = (clip.sectionOffset ?? 0) + effectiveLength(clip) - (clip.tailSeconds ?? 0);
    // Step 4 (pickups): a negative sectionOffset hangs into the previous section; the
    // room it needs there will be added to that section's content need here.
    contentNeed.set(clip.sectionName, Math.max(contentNeed.get(clip.sectionName) ?? 0, end));
  }

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
    let lengthBeats = Math.max(beatsToHold(baseLength ?? 0, spb), beatsToHold(need, spb));
    if (need > 0) lengthBeats = Math.max(1, lengthBeats);
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

  const sectionStart = new Map(layoutSections.map((s) => [s.name, s.start]));
  const clipStarts = new Map<string | number, number>();
  const clipEnds = new Map<string | number, number>();
  for (const clip of clips) {
    // Offsets may be negative (pickups, step 4); nothing here assumes ≥ 0.
    const start = isSectioned(clip)
      ? sectionStart.get(clip.sectionName)! + (clip.sectionOffset ?? 0)
      : clip.start;
    clipStarts.set(clip.id, start);
    clipEnds.set(clip.id, start + effectiveLength(clip));
  }

  const last = layoutSections[layoutSections.length - 1];
  return {
    sections: layoutSections,
    clipStarts,
    clipEnds,
    timelineEnd: last ? last.end : 0,
    orphans,
  };
}
