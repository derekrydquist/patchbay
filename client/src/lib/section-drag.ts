// Section header drag (timeline reorder): where the dragged section would go for a
// pointer position. Pure — no React, no DOM — so the line and the drop share it.

export interface DrawnSection { name: string; start: number; end: number }

export interface HeaderDropTarget {
  // What PUT /api/songs/:songId/sections/order sends.
  section: string;
  before: string | null;
  after: string | null;
  // Where the gold header line is drawn (same unit as the section positions).
  lineAt: number;
}

// `sections`: the sections on the timeline that have a song_sections row, in drawn
// order, at their drawn positions. `x`: the pointer, in the same unit. "Others" are
// those sections minus the dragged one, where they're drawn now; the target k is the
// number of others whose midpoint is left of the pointer, so crossing a section's
// midpoint moves the target past it, in either direction. Null when there's no move:
// k is the dragged section's current spot, or it isn't in `sections`.
export function headerDropTarget(sections: readonly DrawnSection[], dragged: string, x: number): HeaderDropTarget | null {
  const ownIndex = sections.findIndex((s) => s.name === dragged);
  if (ownIndex === -1) return null;
  const others = sections.filter((s) => s.name !== dragged);
  if (others.length === 0) return null;
  const k = others.filter((s) => (s.start + s.end) / 2 < x).length;
  // ownIndex = the number of others drawn before the dragged section.
  if (k === ownIndex) return null;
  // others[k − 1] and others[k] are drawn side by side whenever k isn't the dragged
  // section's own spot, so the boundary between them is one point.
  const lineAt = k < others.length ? others[k].start : others[k - 1].end;
  return { section: dragged, before: others[k]?.name ?? null, after: others[k - 1]?.name ?? null, lineAt };
}
