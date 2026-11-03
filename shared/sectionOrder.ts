// Arrangement order (song_sections.sort_order) — the section order of the timeline,
// Export and the server layout only. The filing order (ideas.sortOrder) used by the
// Media Bucket, Production Tracker and section pickers is separate and never changed
// here. Pure TypeScript, imported by both the client and the server.

export class SectionMoveError extends Error {}

// A timeline section header drag: `section` moves to sit directly in front of
// `before`, or, when `before` is null, directly behind `after`. Every other name keeps
// its relative order, including sections the timeline doesn't show (no clips, or
// hidden on every track). `names` is the song's full section list in its current
// order. Throws SectionMoveError when a name isn't in the list, when before or after
// is the moved section itself, or when both are null.
export function moveSection(
  names: readonly string[],
  section: string,
  before: string | null,
  after: string | null,
): string[] {
  if (before === null && after === null) throw new SectionMoveError("before or after is required");
  for (const name of [section, before, after]) {
    if (name !== null && !names.includes(name)) throw new SectionMoveError(`No section named "${name}" in this song`);
  }
  if (before === section || after === section) throw new SectionMoveError("A section can't be placed next to itself");
  const rest = names.filter((n) => n !== section);
  const at = before !== null ? rest.indexOf(before) : rest.indexOf(after!) + 1;
  return [...rest.slice(0, at), section, ...rest.slice(at)];
}

// Where a section's first timeline clip was dropped: the sections on the timeline it
// landed between. before = the one it now sits in front of, after = the one it now
// sits behind. Both null (or no hint at all) = no drop position.
export interface SectionPlacementHint { before?: string | null; after?: string | null }

// A section with no non-full-take timeline clips has no position on the timeline; its
// first clip places it. `names` is the song's song_sections rows in arrangement order
// (the section is appended first if it has no row yet); `onTimeline` is every OTHER
// section that currently has non-full-take timeline clips and a row. A hint whose
// names are all on the timeline puts the section directly before `before` (or behind
// `after`). Otherwise — no hint, or a hint naming a section that isn't on the timeline
// — the end rule: directly after the last section on the timeline, or first when
// nothing is on it. Returns the full new order; the caller renumbers it 0…n−1.
export function placeFirstClipSection(
  names: readonly string[],
  onTimeline: ReadonlySet<string>,
  section: string,
  hint?: SectionPlacementHint | null,
): string[] {
  const list = names.includes(section) ? [...names] : [...names, section];
  const before = hint?.before ?? null;
  const after = hint?.after ?? null;
  const usable = (name: string | null) => name === null || (name !== section && onTimeline.has(name) && list.includes(name));
  if ((before !== null || after !== null) && usable(before) && usable(after)) {
    return moveSection(list, section, before, after);
  }
  const last = list.filter((n) => n !== section && onTimeline.has(n)).pop();
  if (last !== undefined) return moveSection(list, section, null, last);
  const first = list.find((n) => n !== section);
  return first === undefined ? list : moveSection(list, section, first, null);
}
