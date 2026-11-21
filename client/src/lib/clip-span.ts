// The part of a timeline clip that is drawn and played. A clip's trim (trimStart,
// trimEnd), for a pickup with no room the layout's head cut, and for a tail that runs
// into the next clip on its track the layout's tail cut (shared layoutTimeline,
// clipHeadCuts / clipTailCuts) all take audio off it; every reader of a clip's
// in-point or length on the timeline goes through here, never through its own formula.
// clip.start is already the cut start (positionTracks), so the span runs from
// clip.start for `length` seconds, playing the file from `inPoint`.

import type { Clip } from './daw-data';

// A clip shorter than this (seconds) after its head cut isn't drawn or played.
export const PLAYED_LENGTH_EPSILON = 1e-6;

export interface PlayedSpan {
  inPoint: number; // seconds into the file where playback starts: trimStart + head cut
  outPoint: number; // seconds into the file where it stops: (trimEnd ?? duration) − tail cut
  length: number;  // outPoint − inPoint, never negative
}

type SpanFields = 'duration' | 'trimStart' | 'trimEnd' | 'headCut' | 'tailCut';

export function playedSpan(clip: Pick<Clip, SpanFields>): PlayedSpan {
  const inPoint = (clip.trimStart ?? 0) + (clip.headCut ?? 0);
  const outPoint = (clip.trimEnd ?? clip.duration) - (clip.tailCut ?? 0);
  return { inPoint, outPoint, length: Math.max(0, outPoint - inPoint) };
}

// False for a clip whose head and tail cuts leave nothing: it isn't drawn or played
// until room returns.
export function hasPlayedLength(clip: Pick<Clip, SpanFields>): boolean {
  return playedSpan(clip).length > PLAYED_LENGTH_EPSILON;
}

// Where a pickup's own section starts, in seconds from the clip's drawn start (its cut
// start). Null unless the clip is a sectioned clip whose drawn span starts before its
// section's start (sectionOffset + head cut < 0) and is drawn at all. Larger than the
// drawn length when the pickup ends before its section starts.
export function sectionStartInClip(
  clip: Pick<Clip, SpanFields | 'sectionOffset' | 'isFullTake'>,
): number | null {
  if (clip.isFullTake || clip.sectionOffset === null || clip.sectionOffset === undefined) return null;
  if (!hasPlayedLength(clip)) return null;
  const drawnOffset = clip.sectionOffset + (clip.headCut ?? 0);
  return drawnOffset < -PLAYED_LENGTH_EPSILON ? -drawnOffset : null;
}

// The mirror for an overhang: where its own section ends, in seconds from the clip's
// drawn start (its cut start), when the section's end falls inside the clip's drawn span
// — the part after it hangs past the end. `sectionLength` is the section's length as
// laid out (seconds); a clip doesn't know it, so the row passes it. Null unless the clip
// is a sectioned clip drawn past its section's end (its drawn end, after any tail cut,
// is later than the section's end). Never below 0: a clip drawn wholly past the end
// (which the 0.5 s-inside rule shouldn't allow) dims from its start.
export function sectionEndInClip(
  clip: Pick<Clip, SpanFields | 'sectionOffset' | 'isFullTake'>,
  sectionLength: number,
): number | null {
  if (clip.isFullTake || clip.sectionOffset === null || clip.sectionOffset === undefined) return null;
  if (!Number.isFinite(sectionLength) || !hasPlayedLength(clip)) return null;
  const drawnOffset = clip.sectionOffset + (clip.headCut ?? 0);
  const at = sectionLength - drawnOffset;
  return at < playedSpan(clip).length - PLAYED_LENGTH_EPSILON ? Math.max(0, at) : null;
}
