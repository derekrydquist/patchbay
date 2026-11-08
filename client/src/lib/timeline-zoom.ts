// Timeline zoom range, in pixels per second. Shared by every zoom control (the
// DawScrollbar handles, pinch / Ctrl+scroll) and by the localStorage restore, so a
// zoom the controls can reach is always one the restore accepts.

export const MIN_ZOOM = 10;
export const MAX_ZOOM = 300;
export const DEFAULT_ZOOM = 80;

// A saved `patchbay-zoom-${songId}` value → a usable zoom, or null when there is none.
// Number('') is 0, so empty strings are rejected before parsing.
export function parseSavedZoom(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const z = Number(raw);
  if (!Number.isFinite(z)) return null;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}
