// No live shrinking during a timeline clip drag (4h4b).
//
// While a timeline clip is dragged, the timeline is drawn from a preview layout (the
// shared layoutTimeline with the preview's offsets swapped in). Without a floor, moving
// a section's last clip earlier shrinks the section live and every later section slides
// back and forth with each move. So during a timeline clip drag the home section's
// preview length never goes below its stored length at drag start (S0): the home
// section gets a preview base length of max(stored base length, S0 in whole beats) —
// the same trick the section-end handle's preview uses, so there is no second layout.
// The section still grows live past S0 and comes back down to S0, never below.
//
// Timeline clip drags only: version and loose-file drags can't shrink a section, and
// trims and the section-end handle aren't drags of this kind. On release the stored
// layout takes over and the section settles to its real length.

import type { LayoutSectionInput, TimelineLayout } from './timelineLayout';

export type PreviewDragKind = 'clip' | 'file';

// The base length (whole beats) a section row is laid out with: a stored base length
// counts in whole beats (rounded up, as the layout does); null / invalid = 0.
function baseBeats(baseLength: number | null): number {
  if (baseLength === null || !Number.isFinite(baseLength) || baseLength <= 0) return 0;
  return Math.ceil(baseLength - 1e-6);
}

// The section rows a drag's preview layout uses. For a timeline clip drag ('clip'), the
// home section's row gets baseLength = max(stored, S0) where S0 is that section's
// lengthBeats in the stored layout (the layout at drag start: polls are held during
// the drag). Returns the same array when nothing changes: any other drag kind, no home
// section (a full take), a home section not on the stored layout, an orphan section
// (no row to give a base length), or a stored base length already at or above S0.
export function clipDragPreviewSections<S extends LayoutSectionInput>(
  sections: S[],
  storedLayout: Pick<TimelineLayout, 'sections'>,
  drag: { kind: PreviewDragKind; homeSection: string | null | undefined },
): S[] {
  if (drag.kind !== 'clip' || !drag.homeSection) return sections;
  const home = storedLayout.sections.find((s) => s.name === drag.homeSection);
  if (!home) return sections;
  const floorBeats = home.lengthBeats;
  const index = sections.findIndex((s) => s.name === drag.homeSection);
  if (index < 0) return sections;
  const row = sections[index];
  if (baseBeats(row.baseLength) >= floorBeats) return sections;
  const next = sections.slice();
  next[index] = { ...row, baseLength: floorBeats };
  return next;
}
