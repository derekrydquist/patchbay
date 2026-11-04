// Cases that already work, pinned so later parts of the placement rebuild can't
// break them silently.
import { describe, expect, it } from 'vitest';
import { layoutTimeline, type LayoutClipInput } from './timelineLayout';

const clip = (over: Partial<LayoutClipInput> & Pick<LayoutClipInput, 'id' | 'sectionName'>): LayoutClipInput => ({
  trackId: 't1',
  sectionOffset: 0,
  duration: 1,
  trimStart: 0,
  trimEnd: null,
  isFullTake: false,
  start: 0,
  ...over,
});

describe('layoutTimeline', () => {
  it('grows a section to hold a clip that runs past its base length', () => {
    const layout = layoutTimeline({
      sections: [
        { name: 'Verse', sortOrder: 0, baseLength: 4 },
        { name: 'Chorus', sortOrder: 1, baseLength: null },
      ],
      clips: [
        clip({ id: 'v1', sectionName: 'Verse', sectionOffset: 3, duration: 3 }),
        clip({ id: 'c1', sectionName: 'Chorus', sectionOffset: 0.5, duration: 1 }),
      ],
      bpm: 120,
      timeSignature: '4/4',
    });
    const [verse, chorus] = layout.sections;
    expect(verse.length).toBe(6);
    expect(chorus.start).toBe(6);
    expect(layout.clipStarts.get('v1')).toBe(3);
    expect(layout.clipStarts.get('c1')).toBe(6.5);
  });

  it('rounds each section up to a whole beat, so every section starts on a beat', () => {
    // 100 bpm: a beat is 0.6 s. 1 s of content needs 2 beats = 1.2 s.
    const layout = layoutTimeline({
      sections: [
        { name: 'A', sortOrder: 0, baseLength: null },
        { name: 'B', sortOrder: 1, baseLength: null },
      ],
      clips: [
        clip({ id: 'a', sectionName: 'A', duration: 1 }),
        clip({ id: 'b', sectionName: 'B', duration: 0.5 }),
      ],
      bpm: 100,
      timeSignature: '4/4',
    });
    expect(layout.sections[0].lengthBeats).toBe(2);
    expect(layout.sections[1].startBeat).toBe(2);
    expect(layout.sections[1].start).toBeCloseTo(1.2, 12);
    expect(layout.timelineEnd).toBeCloseTo(1.8, 12);
  });

  it('does not add a beat for float noise on a whole number of beats', () => {
    const layout = layoutTimeline({
      sections: [{ name: 'A', sortOrder: 0, baseLength: null }],
      clips: [clip({ id: 'a', sectionName: 'A', duration: 0.1 + 0.2 + 1.2 })], // 1.5000000000000002
      bpm: 120,
      timeSignature: '4/4',
    });
    expect(layout.sections[0].lengthBeats).toBe(3);
  });

  it('uses trimmed lengths and the furthest clip end across tracks', () => {
    const layout = layoutTimeline({
      sections: [{ name: 'A', sortOrder: 0, baseLength: null }],
      clips: [
        clip({ id: 'a', trackId: 't1', sectionName: 'A', duration: 10, trimStart: 1, trimEnd: 3 }),
        clip({ id: 'b', trackId: 't2', sectionName: 'A', sectionOffset: 1, duration: 2.2 }),
      ],
      bpm: 120,
      timeSignature: '4/4',
    });
    expect(layout.sections[0].contentNeed).toBeCloseTo(3.2, 12);
    expect(layout.sections[0].length).toBe(3.5);
    expect(layout.clipEnds.get('a')).toBe(2);
  });

  it('orders sections by sort order and lays orphans out last; full takes keep their start', () => {
    const layout = layoutTimeline({
      sections: [
        { name: 'Chorus', sortOrder: 1, baseLength: null },
        { name: 'Intro', sortOrder: 0, baseLength: null },
        { name: 'Unused', sortOrder: 2, baseLength: 8 },
      ],
      clips: [
        clip({ id: 'c', sectionName: 'Chorus', duration: 2 }),
        clip({ id: 'i', sectionName: 'Intro', duration: 1 }),
        clip({ id: 'o', sectionName: 'Zebra', duration: 1 }),
        clip({ id: 'f', sectionName: 'Full Takes', isFullTake: true, start: 42, duration: 3 }),
      ],
      bpm: 120,
      timeSignature: '4/4',
    });
    expect(layout.sections.map((s) => s.name)).toEqual(['Intro', 'Chorus', 'Zebra']);
    expect(layout.orphans).toEqual(['Zebra']);
    expect(layout.clipStarts.get('f')).toBe(42);
    expect(layout.timelineEnd).toBe(4);
  });
});
