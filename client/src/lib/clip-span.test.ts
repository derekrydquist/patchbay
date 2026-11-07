import { describe, expect, it } from 'vitest';
import { playedSpan, hasPlayedLength } from './clip-span';

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
