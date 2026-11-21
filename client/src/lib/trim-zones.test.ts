import { describe, expect, it } from 'vitest';
import { trimEdgeAt, trimEdgesMovable, trimZoneWidths } from './trim-zones';

const long = { duration: 10, trimStart: 0, trimEnd: null };

describe('trimZoneWidths', () => {
  it('gives wide clips 8 px zones', () => {
    expect(trimZoneWidths(200, long)).toEqual({ left: 8, right: 8 });
    expect(trimZoneWidths(32, long)).toEqual({ left: 8, right: 8 });
  });

  it('caps each zone at a quarter of the width on narrow clips', () => {
    expect(trimZoneWidths(24, long)).toEqual({ left: 6, right: 6 });
    expect(trimZoneWidths(16, long)).toEqual({ left: 4, right: 4 });
  });

  it('has no zones below 16 px', () => {
    expect(trimZoneWidths(15.9, long)).toEqual({ left: 0, right: 0 });
    expect(trimZoneWidths(3, long)).toEqual({ left: 0, right: 0 });
    expect(trimZoneWidths(0, long)).toEqual({ left: 0, right: 0 });
    expect(trimZoneWidths(NaN, long)).toEqual({ left: 0, right: 0 });
  });

  it('always leaves at least half the clip for moving', () => {
    for (let w = 0; w <= 400; w += 0.5) {
      const z = trimZoneWidths(w, long);
      expect(w - z.left - z.right).toBeGreaterThanOrEqual(w / 2);
    }
  });

  it('drops both zones on a whole file at or under the minimum length', () => {
    // A 0.3 s file, untrimmed: can't get shorter, and there's no audio to extend into.
    expect(trimZoneWidths(100, { duration: 0.3, trimStart: 0, trimEnd: null })).toEqual({ left: 0, right: 0 });
    expect(trimZoneWidths(100, { duration: 0.5, trimStart: 0, trimEnd: null })).toEqual({ left: 0, right: 0 });
  });

  it('keeps the zone on an edge with hidden audio behind it', () => {
    // Trimmed to 0.5 s from the middle of a file: both edges can grow.
    expect(trimZoneWidths(100, { duration: 10, trimStart: 2, trimEnd: 2.5 })).toEqual({ left: 8, right: 8 });
    // Trimmed only on the right: the left edge is the file's start and can't move.
    expect(trimZoneWidths(100, { duration: 10, trimStart: 0, trimEnd: 0.5 })).toEqual({ left: 0, right: 8 });
    // Trimmed only on the left: the right edge is the file's end.
    expect(trimZoneWidths(100, { duration: 10, trimStart: 9.5, trimEnd: null })).toEqual({ left: 8, right: 0 });
  });
});

describe('trimEdgesMovable', () => {
  it('lets both edges move on a clip above its minimum length', () => {
    expect(trimEdgesMovable({ duration: 0.8, trimStart: 0, trimEnd: null })).toEqual({ left: true, right: true });
  });

  it('treats a right trim at the very end of the file as no hidden audio', () => {
    expect(trimEdgesMovable({ duration: 10, trimStart: 9.5, trimEnd: 10 })).toEqual({ left: true, right: false });
  });
});

describe('trimEdgeAt', () => {
  it('picks the edge zones and the middle', () => {
    const zones = { left: 6, right: 6 };
    expect(trimEdgeAt(0, 24, zones)).toBe('left');
    expect(trimEdgeAt(6, 24, zones)).toBe('left');
    expect(trimEdgeAt(7, 24, zones)).toBeNull();
    expect(trimEdgeAt(17, 24, zones)).toBeNull();
    expect(trimEdgeAt(18, 24, zones)).toBe('right');
    expect(trimEdgeAt(24, 24, zones)).toBe('right');
  });

  it('never trims an edge with no zone', () => {
    expect(trimEdgeAt(0, 10, { left: 0, right: 0 })).toBeNull();
    expect(trimEdgeAt(100, 100, { left: 8, right: 0 })).toBeNull();
    expect(trimEdgeAt(0, 100, { left: 0, right: 8 })).toBeNull();
  });
});
