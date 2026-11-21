// Where a press on a timeline clip starts a trim instead of a move. Each edge has a
// trim zone inside the clip's box; the rest of the clip is the move area. The zones
// shrink on narrow clips so a middle strip always stays grabbable, vanish on clips too
// narrow to trim by hand, and are dropped on an edge that can't move at all. The press
// test and the resize cursor in TimelineClip both read this, so they always agree.

import { minTrimLength } from '@shared/timelinePlacement';

// The widest a trim zone gets, in px.
export const TRIM_ZONE_MAX_PX = 8;
// A trim zone is at most this share of the clip's drawn width.
export const TRIM_ZONE_MAX_SHARE = 0.25;
// A clip drawn narrower than this (px) has no trim zones: the whole clip moves.
export const TRIM_ZONES_MIN_CLIP_PX = 16;
// How far (px) the pointer must move before a trim starts changing the clip.
export const TRIM_START_THRESHOLD_PX = 3;

const EPS = 1e-3;

export interface TrimZoneClip {
  duration: number;
  trimStart: number;
  trimEnd: number | null;
}

export interface TrimZones {
  left: number;  // px from the clip's left edge
  right: number; // px from the clip's right edge
}

// Whether each edge can move by a trim at all. An edge is stuck only when the clip is
// at its minimum length (so it can't get shorter) and no hidden audio lies beyond that
// edge (so it can't get longer). A neighbouring clip blocking the edge doesn't count.
export function trimEdgesMovable(clip: TrimZoneClip): { left: boolean; right: boolean } {
  const end = clip.trimEnd ?? clip.duration;
  const atMinimum = end - clip.trimStart <= minTrimLength(clip.duration) + EPS;
  return {
    left: !atMinimum || clip.trimStart > EPS,
    right: !atMinimum || end < clip.duration - EPS,
  };
}

// Each trim zone's width, in px, for a clip drawn `width` px wide.
export function trimZoneWidths(width: number, clip: TrimZoneClip): TrimZones {
  if (!(width >= TRIM_ZONES_MIN_CLIP_PX)) return { left: 0, right: 0 };
  const zone = Math.min(TRIM_ZONE_MAX_PX, width * TRIM_ZONE_MAX_SHARE);
  const movable = trimEdgesMovable(clip);
  return { left: movable.left ? zone : 0, right: movable.right ? zone : 0 };
}

// Which trim edge a press `x` px from the clip's left edge falls on, or null to move.
export function trimEdgeAt(x: number, width: number, zones: TrimZones): 'left' | 'right' | null {
  if (zones.left > 0 && x <= zones.left) return 'left';
  if (zones.right > 0 && x >= width - zones.right) return 'right';
  return null;
}
