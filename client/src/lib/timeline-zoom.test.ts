import { describe, expect, it } from 'vitest';
import { parseSavedZoom } from './timeline-zoom';

describe('parseSavedZoom', () => {
  it('is null when nothing usable was saved', () => {
    expect(parseSavedZoom(null)).toBeNull();
    expect(parseSavedZoom('')).toBeNull();
    expect(parseSavedZoom('abc')).toBeNull();
    expect(parseSavedZoom('NaN')).toBeNull();
    expect(parseSavedZoom('Infinity')).toBeNull();
  });
  it('keeps any zoom the controls can reach, including below 20', () => {
    expect(parseSavedZoom('15')).toBe(15);
    expect(parseSavedZoom('10')).toBe(10);
    expect(parseSavedZoom('300')).toBe(300);
    expect(parseSavedZoom('14.73')).toBe(14.73);
  });
  it('clamps values outside the controls range', () => {
    expect(parseSavedZoom('5')).toBe(10);
    expect(parseSavedZoom('350')).toBe(300);
  });
});
