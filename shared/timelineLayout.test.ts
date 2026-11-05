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

// A timeline clip drag's preview layout: the same layoutTimeline, run on the stored clips
// with the preview's offsets swapped in (Timeline's clipDragLayout).
describe('drag preview layouts', () => {
  // 120 bpm, 4/4: one beat = 0.5 s. Verse (middle) holds v1 0–2 and v2 2–4 on t1;
  // Intro before it and Chorus after it hold clips on two tracks.
  const sections = [
    { name: 'Intro', sortOrder: 0, baseLength: null },
    { name: 'Verse', sortOrder: 1, baseLength: null },
    { name: 'Chorus', sortOrder: 2, baseLength: null },
  ];
  const stored = [
    clip({ id: 'i1', sectionName: 'Intro', duration: 2 }),
    clip({ id: 'v1', sectionName: 'Verse', sectionOffset: 0, duration: 2 }),
    clip({ id: 'v2', sectionName: 'Verse', sectionOffset: 2, duration: 2 }),
    clip({ id: 'c1', trackId: 't1', sectionName: 'Chorus', sectionOffset: 0, duration: 2 }),
    clip({ id: 'c2', trackId: 't2', sectionName: 'Chorus', sectionOffset: 1, duration: 2 }),
  ];
  const run = (offsets: Record<string, number>) => layoutTimeline({
    sections,
    clips: stored.map((c) => (c.id in offsets ? { ...c, sectionOffset: offsets[c.id] } : c)),
    bpm: 120,
    timeSignature: '4/4',
  });
  const base = run({});
  const verse = (l: ReturnType<typeof run>) => l.sections.find((s) => s.name === 'Verse')!;

  it('a clip dragged past its section end grows the section', () => {
    expect(verse(base).length).toBeCloseTo(4);
    const grown = run({ v2: 5.2 }); // ends at 7.2 → rounded up to 7.5
    expect(verse(grown).length).toBeCloseTo(7.5);
    expect(verse(grown).start).toBeCloseTo(verse(base).start); // earlier sections never move
  });

  it("the section's last clip dragged earlier shrinks it", () => {
    // The preview layout just takes the offsets it's given (overlap is placeInGap's
    // job): v2 at 0.5 → the section needs only max(0 + 2, 0.5 + 2) = 2.5 s, not 4.
    const shrunk = run({ v2: 0.5 });
    expect(verse(shrunk).length).toBeCloseTo(2.5);
  });

  it('later sections move by the same amount on every track', () => {
    const grown = run({ v2: 5.2 });
    const shift = verse(grown).length - verse(base).length;
    expect(shift).toBeCloseTo(3.5);
    for (const id of ['c1', 'c2']) {
      expect(grown.clipStarts.get(id)! - base.clipStarts.get(id)!).toBeCloseTo(shift);
    }
    expect(grown.clipStarts.get('i1')).toBeCloseTo(base.clipStarts.get('i1')!);
    expect(grown.timelineEnd - base.timelineEnd).toBeCloseTo(shift);
  });
});

// Pickups (a negative sectionOffset), step 4e1 — "cut, don't push": a pickup never moves
// a section; without room its head is cut. 120 bpm 4/4: a beat is 0.5 s, a bar 2 s.
describe('layoutTimeline — pickups', () => {
  const AB = [
    { name: 'A', sortOrder: 0, baseLength: null },
    { name: 'B', sortOrder: 1, baseLength: null },
  ];
  const lay = (clips: LayoutClipInput[], sections = AB) =>
    layoutTimeline({ sections, clips, bpm: 120, timeSignature: '4/4' });
  const geometry = (l: ReturnType<typeof lay>) =>
    l.sections.map((s) => ({ name: s.name, start: s.start, length: s.length, lengthBeats: s.lengthBeats }));
  // Section A is 0–4 s on every test that uses it: t2 fills it.
  const aFill = clip({ id: 'a2', sectionName: 'A', trackId: 't2', duration: 4 });

  it('every clip has a head cut of 0 when there are no pickups', () => {
    const l = lay([clip({ id: 'a1', sectionName: 'A', duration: 2 }), aFill, clip({ id: 'b1', sectionName: 'B', duration: 1 })]);
    expect(Array.from(l.clipHeadCuts.values())).toEqual([0, 0, 0]);
  });

  it('section starts and lengths are the same with and without a pickup', () => {
    const others = [clip({ id: 'a1', sectionName: 'A', duration: 4 }), aFill, clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 4 })];
    const plain = lay([...others, clip({ id: 'b1', sectionName: 'B', sectionOffset: 0, duration: 2 })]);
    const pickup = lay([...others, clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 2 })]);
    expect(geometry(pickup)).toEqual(geometry(plain));
    expect(pickup.timelineEnd).toBe(plain.timelineEnd);
    for (const id of ['a1', 'a2', 'b2']) expect(pickup.clipStarts.get(id)).toBe(plain.clipStarts.get(id));
  });

  it('a pickup with room starts before its section, uncut', () => {
    const l = lay([clip({ id: 'a1', sectionName: 'A', duration: 2 }), aFill, clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 3 })]);
    expect(l.sections[1].start).toBe(4);
    expect(l.clipHeadCuts.get('b1')).toBe(0);
    expect(l.clipStarts.get('b1')).toBe(3);
    expect(l.clipEnds.get('b1')).toBe(6);
  });

  it("a pickup whose track's previous clip ends at the section end is cut to the downbeat", () => {
    const l = lay([clip({ id: 'a1', sectionName: 'A', duration: 4 }), aFill, clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 3 })]);
    expect(l.clipHeadCuts.get('b1')).toBeCloseTo(1, 12);
    expect(l.clipStarts.get('b1')).toBeCloseTo(l.sections[1].start, 12);
    expect(l.clipEnds.get('b1')).toBe(6); // the end never moves
  });

  it('partial room: the previous clip ends half a beat before the downbeat', () => {
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 3.75 }), aFill,
      clip({ id: 'b1', sectionName: 'B', sectionOffset: -0.5, duration: 2 }), // wants one beat
    ]);
    expect(l.clipHeadCuts.get('b1')).toBeCloseTo(0.25, 12);
    expect(l.clipStarts.get('b1')).toBeCloseTo(3.75, 12);
  });

  it("the track's previous clip in an earlier section (none in the section before): no cut", () => {
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 2 }), aFill,
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 4 }), // B 4–8, nothing on t1
      clip({ id: 'c1', sectionName: 'C', sectionOffset: -1, duration: 2 }),
    ], [...AB, { name: 'C', sortOrder: 2, baseLength: null }]);
    expect(l.sections[2].start).toBe(8);
    expect(l.clipHeadCuts.get('c1')).toBe(0);
    expect(l.clipStarts.get('c1')).toBe(7);
  });

  it('a pickup in the first section is cut at song time 0, and is whole again when the section moves later', () => {
    const clips = [
      clip({ id: 'a1', sectionName: 'A', sectionOffset: -1, duration: 3 }),
      clip({ id: 'b1', sectionName: 'B', duration: 2 }),
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 4 }),
    ];
    const first = lay(clips);
    expect(first.sections[0].name).toBe('A');
    expect(first.clipHeadCuts.get('a1')).toBe(1);
    expect(first.clipStarts.get('a1')).toBe(0);
    const later = lay(clips, [
      { name: 'A', sortOrder: 1, baseLength: null },
      { name: 'B', sortOrder: 0, baseLength: null },
    ]);
    expect(later.sections.map((s) => s.name)).toEqual(['B', 'A']);
    expect(later.clipHeadCuts.get('a1')).toBe(0);
    expect(later.clipStarts.get('a1')).toBe(3); // A starts at 4; t1 is free from 2
  });

  it("one track's pickup or cut never affects another track", () => {
    const others = [clip({ id: 'a1', sectionName: 'A', duration: 4 }), aFill, clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 2 })];
    const cut = lay([...others, clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 3 })]);
    const none = lay([...others, clip({ id: 'b1', sectionName: 'B', sectionOffset: 0, duration: 2 })]);
    expect(cut.clipHeadCuts.get('b1')).toBeGreaterThan(0);
    for (const id of ['a1', 'a2', 'b2']) {
      expect(cut.clipStarts.get(id)).toBe(none.clipStarts.get(id));
      expect(cut.clipEnds.get(id)).toBe(none.clipEnds.get(id));
      expect(cut.clipHeadCuts.get(id)).toBe(0);
    }
  });

  it('a section holding only a pickup that ends on its downbeat is one beat long; with no room the clip has zero length', () => {
    const pickup = clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 1 });
    const room = lay([clip({ id: 'a1', sectionName: 'A', duration: 2 }), aFill, pickup]);
    expect(room.sections[1].lengthBeats).toBe(1);
    expect(room.sections[1].length).toBe(0.5);
    expect(room.clipHeadCuts.get('b1')).toBe(0);
    expect(room.clipStarts.get('b1')).toBe(3);
    const noRoom = lay([clip({ id: 'a1', sectionName: 'A', duration: 4 }), aFill, pickup]);
    expect(noRoom.sections[1].lengthBeats).toBe(1);
    expect(noRoom.clipHeadCuts.get('b1')).toBe(1); // the whole trimmed length
    expect(noRoom.clipStarts.get('b1')).toBe(noRoom.clipEnds.get('b1'));
  });

  it('a pickup longer than one bar (as after a tempo change) is not clamped', () => {
    const l = lay([clip({ id: 'a1', sectionName: 'A', duration: 0.5 }), aFill, clip({ id: 'b1', sectionName: 'B', sectionOffset: -3, duration: 4 })]);
    expect(l.clipHeadCuts.get('b1')).toBe(0);
    expect(l.clipStarts.get('b1')).toBe(1);
  });

  it("legacy full takes don't count toward a track's furthest end", () => {
    const l = lay([
      clip({ id: 'ft', sectionName: 'Full Takes', isFullTake: true, start: 0, duration: 4 }),
      clip({ id: 'a1', sectionName: 'A', duration: 1 }), aFill,
      clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 2 }),
    ]);
    expect(l.clipHeadCuts.get('ft')).toBe(0);
    expect(l.clipStarts.get('ft')).toBe(0);
    expect(l.clipHeadCuts.get('b1')).toBe(0);
    expect(l.clipStarts.get('b1')).toBe(3);
  });
});
