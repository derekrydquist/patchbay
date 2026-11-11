// PUT /api/songs/:songId/sections/base-length's body rules (parseSectionBaseLengthBody).
import { describe, expect, it } from 'vitest';
import { MAX_SECTION_BASE_BEATS, isValidBaseLength, parseSectionBaseLengthBody } from './sectionBaseLength';

describe('parseSectionBaseLengthBody', () => {
  it('accepts null and whole beats from 1 to 4096', () => {
    expect(MAX_SECTION_BASE_BEATS).toBe(4096);
    for (const baseLength of [null, 1, 16, 4096]) {
      expect(parseSectionBaseLengthBody({ section: 'Verse', baseLength })).toEqual({ ok: true, value: { section: 'Verse', baseLength } });
    }
  });

  it.each([0, -1, -16, 1.5, 4097, NaN, Infinity, -Infinity, '8', true, {}, undefined])('rejects baseLength %s', (baseLength) => {
    expect(parseSectionBaseLengthBody({ section: 'Verse', baseLength }).ok).toBe(false);
    if (baseLength !== undefined) expect(isValidBaseLength(baseLength)).toBe(false);
  });

  it.each([undefined, '', 7, null])('rejects a missing or bad section name (%s)', (section) => {
    expect(parseSectionBaseLengthBody({ section, baseLength: 8 }).ok).toBe(false);
  });

  it('rejects a missing body', () => {
    expect(parseSectionBaseLengthBody(undefined).ok).toBe(false);
    expect(parseSectionBaseLengthBody(null).ok).toBe(false);
  });
});
