// PUT /api/songs/:songId/sections/base-length's body rules (parseSectionBaseLengthBody).
import { describe, expect, it } from 'vitest';
import {
  MAX_SECTION_BASE_BEATS, isValidBaseLength, parseSectionBaseLengthBody,
  sectionEndRange, nearestSectionEndStop, baseLengthForEnd, formatBarsAndBeats, sectionEndReadout, sectionEndRelease,
  addsVisibleSpace, canFitToContent, shouldSendBaseLength,
} from './sectionBaseLength';

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

// The section-end handle's steps (nearestSectionEndStop). 4/4 unless stated.
describe('nearestSectionEndStop', () => {
  it('a section on a downbeat, Bar steps: minEnd, then every bar line', () => {
    // Bar 3 (beat 8), content needs 6 beats → minEnd 14 (bar 4 beat 3).
    const range = sectionEndRange(8, 6);
    expect(range).toEqual({ startBeat: 8, minEndBeat: 14, maxEndBeat: 8 + 4096 });
    expect(nearestSectionEndStop(range, 10, true, 4)).toBe(14); // below the minimum
    expect(nearestSectionEndStop(range, 14.9, true, 4)).toBe(14);
    expect(nearestSectionEndStop(range, 15.1, true, 4)).toBe(16); // halfway is 15; 15.1 → bar line 16
    expect(nearestSectionEndStop(range, 15, true, 4)).toBe(16); // exactly halfway → the later stop
    expect(nearestSectionEndStop(range, 17.9, true, 4)).toBe(16);
    expect(nearestSectionEndStop(range, 18.1, true, 4)).toBe(20);
    expect(nearestSectionEndStop(range, 41, true, 4)).toBe(40);
  });

  it('a section on a downbeat, beat steps: every whole beat from minEnd', () => {
    const range = sectionEndRange(8, 6);
    expect(nearestSectionEndStop(range, 13, false, 4)).toBe(14);
    expect(nearestSectionEndStop(range, 14.4, false, 4)).toBe(14);
    expect(nearestSectionEndStop(range, 14.6, false, 4)).toBe(15);
    expect(nearestSectionEndStop(range, 17.2, false, 4)).toBe(17);
  });

  it('a section starting mid-bar (beat 4 of a bar), Bar steps: minEnd first, then bar lines', () => {
    // Starts on beat 4 of bar 2 (beat index 7), content needs 4 beats → minEnd 11
    // (beat 4 of bar 3). The next stops are the bar lines 12, 16, 20…, so the next
    // section lands on beat 1.
    const range = sectionEndRange(7, 4);
    expect(range.minEndBeat).toBe(11);
    expect(nearestSectionEndStop(range, 11.4, true, 4)).toBe(11);
    expect(nearestSectionEndStop(range, 11.6, true, 4)).toBe(12);
    expect(nearestSectionEndStop(range, 13.9, true, 4)).toBe(12);
    expect(nearestSectionEndStop(range, 14.1, true, 4)).toBe(16);
    // Every stop past minEnd is a bar line.
    for (let p = 11.6; p < 60; p += 0.37) expect(nearestSectionEndStop(range, p, true, 4) % 4).toBe(0);
  });

  it('a mid-bar start in 3/4 still lands on bar lines', () => {
    const range = sectionEndRange(5, 2); // minEnd 7; bar lines 9, 12, 15…
    expect(nearestSectionEndStop(range, 7.9, true, 3)).toBe(7);
    expect(nearestSectionEndStop(range, 8.1, true, 3)).toBe(9);
    expect(nearestSectionEndStop(range, 12.4, true, 3)).toBe(12);
  });

  it('clamps to the minimum and the 4096-beat maximum', () => {
    const range = sectionEndRange(8, 6);
    expect(nearestSectionEndStop(range, -50, true, 4)).toBe(14);
    expect(nearestSectionEndStop(range, -50, false, 4)).toBe(14);
    expect(nearestSectionEndStop(range, NaN, false, 4)).toBe(14);
    expect(nearestSectionEndStop(range, 1e9, false, 4)).toBe(8 + 4096);
    expect(nearestSectionEndStop(range, 1e9, true, 4)).toBe(8 + 4096); // 4104 is a bar line
    // A mid-bar start: the maximum isn't a bar line, so Bar steps stop at the last bar
    // line at or before it.
    const mid = sectionEndRange(7, 4);
    expect(mid.maxEndBeat).toBe(7 + 4096);
    expect(nearestSectionEndStop(mid, 1e9, true, 4)).toBe(4100);
    expect(nearestSectionEndStop(mid, 1e9, false, 4)).toBe(4103);
  });

  it('content longer than the maximum: the only stop is minEnd', () => {
    const range = sectionEndRange(0, 5000);
    expect(range.maxEndBeat).toBe(5000);
    expect(nearestSectionEndStop(range, 6000, true, 4)).toBe(5000);
    expect(nearestSectionEndStop(range, 6000, false, 4)).toBe(5000);
  });

  it('Shift (beat steps) reaches beats Bar steps skip', () => {
    const range = sectionEndRange(8, 6);
    expect(nearestSectionEndStop(range, 17, true, 4)).toBe(16);  // Bar
    expect(nearestSectionEndStop(range, 17, false, 4)).toBe(17); // Shift held → beats
  });
});

describe('baseLengthForEnd / readout', () => {
  it('null at the minimum, whole beats from the section start above it', () => {
    const range = sectionEndRange(8, 6);
    expect(baseLengthForEnd(range, 14)).toBeNull();
    expect(baseLengthForEnd(range, 16)).toBe(8);
    expect(baseLengthForEnd(range, 8 + 4096)).toBe(4096);
  });

  it('formats bars and beats', () => {
    expect(formatBarsAndBeats(40, 4)).toBe('10 bars');
    expect(formatBarsAndBeats(35, 4)).toBe('8 bars 3 beats');
    expect(formatBarsAndBeats(5, 4)).toBe('1 bar 1 beat');
    expect(formatBarsAndBeats(3, 4)).toBe('3 beats');
    expect(formatBarsAndBeats(1, 4)).toBe('1 beat');
    expect(formatBarsAndBeats(7, 6)).toBe('1 bar 1 beat');
  });

  it('reads "fit" at the minimum, else length and empty space', () => {
    const range = sectionEndRange(8, 6);
    expect(sectionEndReadout('Chorus 1', range, 14, 4)).toBe('Chorus 1 · fit');
    expect(sectionEndReadout('Chorus 1', range, 16, 4)).toBe('Chorus 1 · 2 bars (+2 beats empty)');
    expect(sectionEndReadout('Chorus 1', range, 48, 4)).toBe('Chorus 1 · 10 bars (+8 bars 2 beats empty)');
  });
});

describe('sectionEndRelease (fit always clears)', () => {
  const range = sectionEndRange(8, 6); // minEnd 14

  it('a different end sends its base length (null at the minimum)', () => {
    expect(sectionEndRelease(range, 20, 12, 24)).toEqual({ baseLength: 16 });
    expect(sectionEndRelease(range, 20, 12, 14)).toEqual({ baseLength: null });
    expect(sectionEndRelease(range, 14, null, 16)).toEqual({ baseLength: 8 });
  });

  it('fit with a stored base length hidden under the content sends null, even with no drawn change', () => {
    // Stored 4 beats, but the content needs 6: drawn at the minimum end either way.
    expect(sectionEndRelease(range, 14, 4, 14)).toEqual({ baseLength: null });
  });

  it('no change with nothing stored sends nothing', () => {
    expect(sectionEndRelease(range, 14, null, 14)).toBeNull();
  });

  it('no change above the minimum sends nothing', () => {
    expect(sectionEndRelease(range, 20, 12, 20)).toBeNull();
  });
});

describe('addsVisibleSpace', () => {
  it('only when the length is more than the content need', () => {
    expect(addsVisibleSpace(12, 8)).toBe(true);
    expect(addsVisibleSpace(8, 8)).toBe(false);
    expect(addsVisibleSpace(6, 8)).toBe(false);
  });
});

describe('canFitToContent', () => {
  it('needs a stored base length that adds visible space, and interactive handles', () => {
    expect(canFitToContent(12, 12, 8, true)).toBe(true);
    expect(canFitToContent(12, 12, 8, false)).toBe(false);
    expect(canFitToContent(null, 8, 8, true)).toBe(false);
  });

  it('is off for a stored value hidden under the content', () => {
    // Stored 4 beats, content needs 8: drawn at 8, no visible space.
    expect(canFitToContent(4, 8, 8, true)).toBe(false);
    // Equal to the content need: still nothing visible.
    expect(canFitToContent(8, 8, 8, true)).toBe(false);
  });

  it('is off for an orphan (no song_sections row)', () => {
    expect(canFitToContent(undefined, 12, 8, true)).toBe(false);
  });
});

describe('shouldSendBaseLength', () => {
  it('never sends null over a stored null or a missing row', () => {
    expect(shouldSendBaseLength(null, null)).toBe(false);
    expect(shouldSendBaseLength(undefined, null)).toBe(false);
  });

  it('sends null over a stored value, and any number', () => {
    expect(shouldSendBaseLength(12, null)).toBe(true);
    expect(shouldSendBaseLength(null, 8)).toBe(true);
    expect(shouldSendBaseLength(12, 16)).toBe(true);
  });
});
