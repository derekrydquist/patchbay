// The section-end handle's write: song_sections.base_length, in whole beats (null =
// fit to content). PUT /api/songs/:songId/sections/base-length validates its body here,
// and the client's handle uses the same limit. Pure — no React, DOM or Node APIs.

// The longest base length the handle may set, in beats (1024 bars of 4/4).
export const MAX_SECTION_BASE_BEATS = 4096;

// Whether `value` is a base length the route accepts: null, or a whole number of beats
// from 1 to MAX_SECTION_BASE_BEATS. Rejects fractions, NaN, Infinity, 0, negatives,
// strings and anything above the maximum.
export function isValidBaseLength(value: unknown): value is number | null {
  return value === null
    || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SECTION_BASE_BEATS);
}

export type SectionBaseLengthBody = { section: string; baseLength: number | null };

// The route's body, or the 400 message for it. `section` must be a non-empty string;
// `baseLength` must be present (null to fit to content) and valid (isValidBaseLength).
export function parseSectionBaseLengthBody(body: unknown): { ok: true; value: SectionBaseLengthBody } | { ok: false; message: string } {
  const { section, baseLength } = (body ?? {}) as { section?: unknown; baseLength?: unknown };
  if (typeof section !== 'string' || section.length === 0) {
    return { ok: false, message: 'section must be a section name' };
  }
  if (baseLength === undefined || !isValidBaseLength(baseLength)) {
    return { ok: false, message: `baseLength must be null or a whole number of beats from 1 to ${MAX_SECTION_BASE_BEATS}` };
  }
  return { ok: true, value: { section, baseLength } };
}
