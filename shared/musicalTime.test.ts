import { describe, expect, it } from 'vitest';
import { snapTime, snapGridSeconds, secondsPerBeat } from './musicalTime';

describe('snapTime', () => {
  // 120 bpm: a beat is 0.5 s.
  it('snaps to the nearest beat at 1/4', () => {
    expect(snapTime(0.74, '1/4', 120, '4/4')).toBe(0.5);
    expect(snapTime(0.76, '1/4', 120, '4/4')).toBe(1);
    expect(snapTime(0, '1/4', 120, '4/4')).toBe(0);
  });

  it('snaps to half and quarter beats at 1/8 and 1/16', () => {
    expect(snapTime(0.12, '1/8', 120, '4/4')).toBe(0);
    expect(snapTime(0.13, '1/8', 120, '4/4')).toBe(0.25);
    expect(snapTime(0.06, '1/16', 120, '4/4')).toBe(0);
    expect(snapTime(0.07, '1/16', 120, '4/4')).toBe(0.125);
  });

  it('snaps to bar lines counted from song time 0', () => {
    // 4/4 at 120: a bar is 2 s, bar lines at 0, 2, 4, 6…
    expect(snapTime(2.99, 'bar', 120, '4/4')).toBe(2);
    expect(snapTime(3.01, 'bar', 120, '4/4')).toBe(4);
    // A time just after a mid-bar section start (5 s) still snaps to a ruler bar line.
    expect(snapTime(5.2, 'bar', 120, '4/4')).toBe(6);
  });

  it('treats 6/8 as six quarter-note beats per bar, like the ruler', () => {
    expect(snapGridSeconds('bar', 120, '6/8')).toBe(3);
    expect(snapTime(1.49, 'bar', 120, '6/8')).toBe(0);
    expect(snapTime(1.51, 'bar', 120, '6/8')).toBe(3);
    expect(snapTime(0.76, '1/4', 120, '6/8')).toBe(1);
    expect(snapTime(0.13, '1/8', 120, '6/8')).toBe(0.25);
  });

  it('works when a beat is not a round number of seconds', () => {
    const spb = secondsPerBeat(97); // 0.6185…
    expect(snapTime(spb * 3.4, '1/4', 97, '4/4')).toBeCloseTo(spb * 3, 12);
    expect(snapTime(spb * 3.6, '1/4', 97, '4/4')).toBeCloseTo(spb * 4, 12);
    expect(snapTime(spb * 4 * 2.6, 'bar', 97, '4/4')).toBeCloseTo(spb * 4 * 3, 12);
    expect(snapTime(spb * 1.3, '1/16', 97, '4/4')).toBeCloseTo(spb * 1.25, 12);
    // 100 bpm: a beat is 0.6 s.
    expect(snapTime(0.29, '1/4', 100, '4/4')).toBe(0);
    expect(snapTime(0.31, '1/4', 100, '4/4')).toBeCloseTo(0.6, 12);
  });

  it('rounds values just either side of a grid line or a midpoint correctly', () => {
    expect(snapTime(1 - 1e-9, '1/4', 120, '4/4')).toBe(1);
    expect(snapTime(1 + 1e-9, '1/4', 120, '4/4')).toBe(1);
    expect(snapTime(0.75 - 1e-9, '1/4', 120, '4/4')).toBe(0.5);
    expect(snapTime(0.75 + 1e-9, '1/4', 120, '4/4')).toBe(1);
  });

  it('falls back to 120 bpm and 4/4 like the rest of the grid', () => {
    expect(snapTime(0.76, '1/4', null, null)).toBe(1);
    expect(snapTime(3.01, 'bar', undefined, '')).toBe(4);
  });
});
