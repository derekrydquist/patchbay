// The part of a timeline clip that is drawn and played. A clip's trim (trimStart,
// trimEnd) and, for a pickup with no room, the layout's head cut (shared
// layoutTimeline, clipHeadCuts) both take audio off it; every reader of a clip's
// in-point or length on the timeline goes through here, never through its own formula.
// clip.start is already the cut start (positionTracks), so the span runs from
// clip.start for `length` seconds, playing the file from `inPoint`.

import type { Clip } from './daw-data';

// A clip shorter than this (seconds) after its head cut isn't drawn or played.
export const PLAYED_LENGTH_EPSILON = 1e-6;

export interface PlayedSpan {
  inPoint: number; // seconds into the file where playback starts: trimStart + head cut
  outPoint: number; // seconds into the file where it stops: trimEnd ?? duration
  length: number;  // outPoint − inPoint, never negative
}

export function playedSpan(clip: Pick<Clip, 'duration' | 'trimStart' | 'trimEnd' | 'headCut'>): PlayedSpan {
  const inPoint = (clip.trimStart ?? 0) + (clip.headCut ?? 0);
  const outPoint = clip.trimEnd ?? clip.duration;
  return { inPoint, outPoint, length: Math.max(0, outPoint - inPoint) };
}

// False for a pickup whose head cut leaves nothing: it isn't drawn or played until
// room returns.
export function hasPlayedLength(clip: Pick<Clip, 'duration' | 'trimStart' | 'trimEnd' | 'headCut'>): boolean {
  return playedSpan(clip).length > PLAYED_LENGTH_EPSILON;
}

// Where a pickup's own section starts, in seconds from the clip's drawn start (its cut
// start). Null unless the clip is a sectioned clip whose drawn span starts before its
// section's start (sectionOffset + head cut < 0) and is drawn at all. Larger than the
// drawn length when the pickup ends before its section starts.
export function sectionStartInClip(
  clip: Pick<Clip, 'duration' | 'trimStart' | 'trimEnd' | 'headCut' | 'sectionOffset' | 'isFullTake'>,
): number | null {
  if (clip.isFullTake || clip.sectionOffset === null || clip.sectionOffset === undefined) return null;
  if (!hasPlayedLength(clip)) return null;
  const drawnOffset = clip.sectionOffset + (clip.headCut ?? 0);
  return drawnOffset < -PLAYED_LENGTH_EPSILON ? -drawnOffset : null;
}
