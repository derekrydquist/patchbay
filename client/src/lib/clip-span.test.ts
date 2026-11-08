import { describe, expect, it } from 'vitest';
import { playedSpan, hasPlayedLength, sectionStartInClip } from './clip-span';

describe('playedSpan', () => {
  it('is the trimmed part of the file when there is no head cut', () => {
    expect(playedSpan({ duration: 10, trimStart: 1, trimEnd: 8 })).toEqual({ inPoint: 1, outPoint: 8, length: 7 });
    expect(playedSpan({ duration: 10 })).toEqual({ inPoint: 0, outPoint: 10, length: 10 });
  });
  it('a head cut moves the in-point and shortens the length; the out-point stays', () => {
    expect(playedSpan({ duration: 10, trimStart: 1, trimEnd: 8, headCut: 2 })).toEqual({ inPoint: 3, outPoint: 8, length: 5 });
  });
  it('a pickup cut to nothing has zero length and is not drawn or played', () => {
    const c = { duration: 4, trimStart: 0, trimEnd: null, headCut: 4 };
    expect(playedSpan(c).length).toBe(0);
    expect(hasPlayedLength(c)).toBe(false);
    expect(hasPlayedLength({ duration: 4, headCut: 3.5 })).toBe(true);
  });
});

describe('sectionStartInClip', () => {
  it('is null for a clip that starts at or after its section start, or a full take', () => {
    expect(sectionStartInClip({ duration: 4, sectionOffset: 0 })).toBeNull();
    expect(sectionStartInClip({ duration: 4, sectionOffset: 2 })).toBeNull();
    expect(sectionStartInClip({ duration: 4, sectionOffset: null })).toBeNull();
    expect(sectionStartInClip({ duration: 4, sectionOffset: -1, isFullTake: true })).toBeNull();
  });
  it('is the distance from the drawn start to the section start for a pickup', () => {
    expect(sectionStartInClip({ duration: 4, sectionOffset: -1.5 })).toBe(1.5);
  });
  it('counts the head cut: the drawn start moves right by it', () => {
    expect(sectionStartInClip({ duration: 4, sectionOffset: -2, headCut: 0.5 })).toBe(1.5);
    expect(sectionStartInClip({ duration: 4, sectionOffset: -2, headCut: 2 })).toBeNull();
  });
  it('is past the drawn length when the pickup ends before its section starts', () => {
    expect(sectionStartInClip({ duration: 4, trimEnd: 1, sectionOffset: -3 })).toBe(3);
  });
  it('is null for a pickup cut to nothing', () => {
    expect(sectionStartInClip({ duration: 4, sectionOffset: -4, headCut: 4 })).toBeNull();
  });
});
