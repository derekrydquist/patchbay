// Cases that already work, pinned so later parts of the placement rebuild can't
// break them silently.
import { describe, expect, it } from 'vitest';
import { layoutTimeline, sectionContentNeeds, contentNeedBeats, storedTailSeconds, type LayoutClipInput } from './timelineLayout';

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

  it('a section holding only pickups that end before its downbeat gets one beat; they add nothing to its need', () => {
    // Two short pickups in B, at −1.5 (0.5 s) and −0.75 (0.25 s): both end before B's start.
    const p1 = clip({ id: 'b1', sectionName: 'B', sectionOffset: -1.5, duration: 0.5 });
    const p2 = clip({ id: 'b2', sectionName: 'B', sectionOffset: -0.75, duration: 0.25 });
    const l = lay([clip({ id: 'a1', sectionName: 'A', duration: 2 }), aFill, p1, p2]);
    expect(l.sections[1]).toMatchObject({ name: 'B', start: 4, lengthBeats: 1, length: 0.5 });
    expect(l.clipStarts.get('b1')).toBe(2.5);
    expect(l.clipEnds.get('b1')).toBe(3);
    expect(l.clipHeadCuts.get('b1')).toBe(0);
    expect(l.clipStarts.get('b2')).toBe(3.25);
    expect(l.timelineEnd).toBe(4.5);
  });

  it('a pickup ending before the downbeat is hidden whole once the previous clip ends after it', () => {
    // a1 runs to 3.5; the pickup sits at 2.5–3 (−1.5 for 0.5 s): no room at all.
    const p = clip({ id: 'b1', sectionName: 'B', sectionOffset: -1.5, duration: 0.5 });
    const l = lay([clip({ id: 'a1', sectionName: 'A', duration: 3.5 }), aFill, p]);
    expect(l.clipHeadCuts.get('b1')).toBe(0.5); // its whole trimmed length
    expect(l.clipStarts.get('b1')).toBe(l.clipEnds.get('b1'));
    // When room returns (a1 shorter again), it comes back whole.
    const back = lay([clip({ id: 'a1', sectionName: 'A', duration: 2 }), aFill, p]);
    expect(back.clipHeadCuts.get('b1')).toBe(0);
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

// song_sections.base_length is whole beats (step 4g1): the section-end handle adds empty
// space at the end of a section, and every later section slides on every track.
describe('layoutTimeline — base length in whole beats', () => {
  const twoTracks = [
    clip({ id: 'a-drums', trackId: 'drums', sectionName: 'A', duration: 1.6 }), // 4 beats at 150 bpm
    clip({ id: 'a-bass', trackId: 'bass', sectionName: 'A', duration: 1 }),
    clip({ id: 'b-drums', trackId: 'drums', sectionName: 'B', duration: 0.4 }),
    clip({ id: 'b-bass', trackId: 'bass', sectionName: 'B', sectionOffset: 0.4, duration: 0.4 }),
  ];
  const at = (baseA: number | null, bpm = 150) => layoutTimeline({
    sections: [
      { name: 'A', sortOrder: 0, baseLength: baseA },
      { name: 'B', sortOrder: 1, baseLength: null },
    ],
    clips: twoTracks,
    bpm,
    timeSignature: '4/4',
  });

  it('ends a section at start + base length beats, and the next section starts right after it on every track', () => {
    // 150 bpm: a beat is 0.4 s. A needs 4 beats; a base length of 12 adds 8 empty beats.
    const layout = at(12);
    const [a, b] = layout.sections;
    expect(a.lengthBeats).toBe(12);
    expect(a.end).toBeCloseTo(12 * 0.4, 12);
    expect(a.baseLength).toBe(12);
    expect(b.startBeat).toBe(12);
    expect(b.start).toBeCloseTo(4.8, 12);
    expect(layout.clipStarts.get('b-drums')).toBeCloseTo(4.8, 12);
    expect(layout.clipStarts.get('b-bass')).toBeCloseTo(5.2, 12);
    // A's own clips don't move.
    expect(layout.clipStarts.get('a-drums')).toBe(0);
    expect(layout.clipStarts.get('a-bass')).toBe(0);
  });

  it('ignores a stored base length below what the content needs', () => {
    const fit = at(null);
    for (const tooSmall of [1, 3, 4]) {
      const layout = at(tooSmall);
      expect(layout.sections[0].lengthBeats).toBe(4);
      expect(layout.sections[1].start).toBeCloseTo(fit.sections[1].start, 12);
    }
  });

  it('keeps the same number of beats at a different tempo (different seconds)', () => {
    const at120 = at(12, 120);
    const at100 = at(12, 100);
    expect(at120.sections[0].lengthBeats).toBe(12);
    expect(at100.sections[0].lengthBeats).toBe(12);
    expect(at120.sections[0].length).toBeCloseTo(6, 12);   // 12 × 0.5 s
    expect(at100.sections[0].length).toBeCloseTo(7.2, 12); // 12 × 0.6 s
    expect(at100.sections[1].startBeat).toBe(12);
  });

  it('rounds a stray fractional stored value up, so the next section still starts on a beat', () => {
    expect(at(10.5).sections[1].startBeat).toBe(11);
  });

  it('a section with only pickups still gets one beat, and a base length can add to it', () => {
    const layout = layoutTimeline({
      sections: [
        { name: 'A', sortOrder: 0, baseLength: null },
        { name: 'B', sortOrder: 1, baseLength: 3 },
      ],
      clips: [
        clip({ id: 'a', sectionName: 'A', duration: 2 }),
        clip({ id: 'p', sectionName: 'B', sectionOffset: -0.5, duration: 0.5 }),
      ],
      bpm: 120,
      timeSignature: '4/4',
    });
    expect(layout.sections[1].lengthBeats).toBe(3);
    expect(contentNeedBeats(sectionContentNeeds([clip({ id: 'p', sectionName: 'B', sectionOffset: -0.5, duration: 0.5 })]).get('B')!, 120)).toBe(1);
  });
});

describe('contentNeedBeats / sectionContentNeeds — the layout\'s own rule', () => {
  const cases: { bpm: number | null; clips: LayoutClipInput[] }[] = [
    { bpm: 120, clips: [clip({ id: 'x', sectionName: 'A', duration: 3 })] },                                   // exactly 6 beats
    { bpm: 100, clips: [clip({ id: 'x', sectionName: 'A', duration: 1 })] },                                   // 1.67 → 2
    { bpm: 140, clips: [clip({ id: 'x', sectionName: 'A', sectionOffset: 2, duration: 10, trimStart: 1, trimEnd: 4 })] },
    { bpm: null, clips: [clip({ id: 'x', sectionName: 'A', sectionOffset: -1, duration: 0.5 })] },             // only a pickup → 1
    { bpm: 90, clips: [
      clip({ id: 'x', trackId: 't1', sectionName: 'A', duration: 2 }),
      clip({ id: 'y', trackId: 't2', sectionName: 'A', sectionOffset: 1.5, duration: 2.2 }),
      clip({ id: 'z', trackId: 't2', sectionName: 'A', isFullTake: true, start: 0, duration: 99 }),         // ignored
    ] },
  ];
  it.each(cases)('matches the layout\'s section length (bpm $bpm)', ({ bpm, clips }) => {
    const layout = layoutTimeline({ sections: [{ name: 'A', sortOrder: 0, baseLength: null }], clips, bpm, timeSignature: '4/4' });
    const need = sectionContentNeeds(clips).get('A')!;
    expect(need).toBeCloseTo(layout.sections[0].contentNeed, 12);
    expect(contentNeedBeats(need, bpm)).toBe(layout.sections[0].lengthBeats);
  });

  it('has no entry for a section with only full takes or no clips (not on the timeline)', () => {
    const needs = sectionContentNeeds([clip({ id: 'z', sectionName: 'A', isFullTake: true })]);
    expect(needs.has('A')).toBe(false);
  });
});

// Tails (step 4h1): the last tailSeconds of a clip may hang past its section's end
// without growing it; the layout cuts the drawn tail where the next clip on its track is
// drawn. 120 bpm 4/4: a beat is 0.5 s, a bar 2 s.
describe('layoutTimeline — tails', () => {
  const sections = (...names: string[]) => names.map((name, i) => ({ name, sortOrder: i, baseLength: null }));
  const lay = (clips: LayoutClipInput[], secs = sections('A', 'B')) =>
    layoutTimeline({ sections: secs, clips, bpm: 120, timeSignature: '4/4' });
  const geometry = (l: ReturnType<typeof lay>) =>
    l.sections.map((s) => ({ name: s.name, start: s.start, length: s.length, lengthBeats: s.lengthBeats }));

  it('every clip has a tail cut of 0 when every tail is 0', () => {
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 2 }),
      clip({ id: 'b1', sectionName: 'B', sectionOffset: -1, duration: 2 }),
      clip({ id: 'f', sectionName: null, isFullTake: true, start: 9, duration: 3 }),
    ]);
    expect(Array.from(l.clipTailCuts.entries()).sort()).toEqual([['a1', 0], ['b1', 0], ['f', 0]]);
  });

  it('a tail is cut by a normal clip in the next section; its stored end and the sections stay put', () => {
    // a1 is 4 s with a 2 s tail: A needs 2 s (0–2), a1 is drawn to 4. b1 starts at B + 1 = 3.
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 4, tailSeconds: 2 }),
      clip({ id: 'b1', sectionName: 'B', sectionOffset: 1, duration: 1 }),
    ]);
    expect(geometry(l)).toEqual([
      { name: 'A', start: 0, length: 2, lengthBeats: 4 },
      { name: 'B', start: 2, length: 2, lengthBeats: 4 },
    ]);
    expect(l.clipEnds.get('a1')).toBe(4); // uncut end
    expect(l.clipTailCuts.get('a1')).toBe(1); // drawn to 3, where b1 starts
    expect(l.clipStarts.get('b1')).toBe(3);
    expect(l.clipTailCuts.get('b1')).toBe(0);
    expect(l.timelineEnd).toBe(4); // B's end; a1's drawn end (3) is inside it
  });

  it("a tail is cut by a later section's pickup on its track, and the pickup is not cut", () => {
    // A 0–1 (a1: 3 s, tail 2, drawn to 3). B 1–3, filled by t2; nothing of t1 in B.
    // C 3–4: t1's pickup c1 at −1 hangs into B (drawn from 2), uncut.
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 3, tailSeconds: 2 }),
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 2 }),
      clip({ id: 'c1', sectionName: 'C', sectionOffset: -1, duration: 2 }),
    ], sections('A', 'B', 'C'));
    expect(l.sections.map((s) => [s.start, s.end])).toEqual([[0, 1], [1, 3], [3, 4]]);
    expect(l.clipHeadCuts.get('c1')).toBe(0);
    expect(l.clipStarts.get('c1')).toBe(2);
    expect(l.clipTailCuts.get('a1')).toBe(1); // 3 → cut at 2
  });

  it("a pickup in the very next section is cut by the tail clip's own in-section part, and the tail meets it at the downbeat", () => {
    // A 0–1 (a1 3 s, tail 2: it fills A to its end). B 1–1.5: pickup b1 at −0.5 has no
    // room in A, so its head is cut to the downbeat; a1's tail is cut there too.
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 3, tailSeconds: 2 }),
      clip({ id: 'b1', sectionName: 'B', sectionOffset: -0.5, duration: 1 }),
    ]);
    expect(l.sections.map((s) => [s.start, s.end])).toEqual([[0, 1], [1, 1.5]]);
    expect(l.clipHeadCuts.get('b1')).toBe(0.5);
    expect(l.clipStarts.get('b1')).toBe(1);
    expect(l.clipTailCuts.get('a1')).toBe(2); // drawn end = A's end
  });

  it('a tail crosses several short sections with nothing on its track, and is cut at the first clip after them', () => {
    // A 0–1 (a1 5 s, tail 4), B 1–1.5 and C 1.5–2 hold only t2, D 2–3.5: t1's d1 at +0.5.
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 5, tailSeconds: 4 }),
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 0.5 }),
      clip({ id: 'c2', sectionName: 'C', trackId: 't2', duration: 0.5 }),
      clip({ id: 'd1', sectionName: 'D', sectionOffset: 0.5, duration: 1 }),
    ], sections('A', 'B', 'C', 'D'));
    expect(l.sections.map((s) => [s.start, s.end])).toEqual([[0, 1], [1, 1.5], [1.5, 2], [2, 3.5]]);
    expect(l.clipStarts.get('d1')).toBe(2.5);
    expect(l.clipTailCuts.get('a1')).toBe(2.5); // 5 → 2.5
    expect(l.clipEnds.get('a1')).toBe(5);
    expect(l.timelineEnd).toBe(3.5);
  });

  it("another track's clips never cut a tail", () => {
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 4, tailSeconds: 2 }),
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 1 }),
    ]);
    expect(l.clipTailCuts.get('a1')).toBe(0);
  });

  it('with no next clip on its track the tail rings past the last section, and timelineEnd covers it', () => {
    // A 0–1 (a1 4 s, tail 3), B 1–2 (t2 only). a1 rings to 4.
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 4, tailSeconds: 3 }),
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 1 }),
    ]);
    expect(l.sections[l.sections.length - 1].end).toBe(2);
    expect(l.clipTailCuts.get('a1')).toBe(0);
    expect(l.timelineEnd).toBe(4);
  });

  it('timelineEnd follows the cut end, not the stored end, for a tail past the last section', () => {
    // A 0–1: a1 would ring to 8, far past B (1–3); t1's own b1 starts at 1.5 and cuts
    // it there, so the timeline ends with B at 3, not at 8.
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 8, tailSeconds: 7 }),
      clip({ id: 'b1', sectionName: 'B', sectionOffset: 0.5, duration: 1.5 }),
    ]);
    expect(l.clipTailCuts.get('a1')).toBe(6.5);
    expect(l.timelineEnd).toBe(3);
  });

  it('a hidden tail (its section is long enough anyway) is not cut and changes nothing', () => {
    // A has a base length of 8 beats (4 s); a1 ends at 3, inside it.
    const secs = [{ name: 'A', sortOrder: 0, baseLength: 8 }, { name: 'B', sortOrder: 1, baseLength: null }];
    const withTail = [clip({ id: 'a1', sectionName: 'A', duration: 3, tailSeconds: 2 }), clip({ id: 'b1', sectionName: 'B', duration: 1 })];
    const noTail = [clip({ id: 'a1', sectionName: 'A', duration: 3 }), clip({ id: 'b1', sectionName: 'B', duration: 1 })];
    const l = lay(withTail, secs);
    const plain = lay(noTail, secs);
    expect(l.clipTailCuts.get('a1')).toBe(0);
    expect(geometry(l)).toEqual(geometry(plain));
    expect(Array.from(l.clipStarts)).toEqual(Array.from(plain.clipStarts));
    expect(l.timelineEnd).toBe(plain.timelineEnd);
    // Another track making the section longer hides it the same way.
    const byOtherTrack = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 3, tailSeconds: 2 }),
      clip({ id: 'a2', sectionName: 'A', trackId: 't2', duration: 4 }),
      clip({ id: 'b1', sectionName: 'B', duration: 1 }),
    ]);
    expect(byOtherTrack.sections[0].end).toBe(4);
    expect(byOtherTrack.clipTailCuts.get('a1')).toBe(0);
  });

  it('a tail longer than the trimmed clip is capped at it', () => {
    expect(storedTailSeconds({ duration: 2, trimStart: 0, trimEnd: null, tailSeconds: 10 })).toBe(2);
    expect(storedTailSeconds({ duration: 9, trimStart: 0.5, trimEnd: 1.5, tailSeconds: 5 })).toBe(1);
    const capped = lay([clip({ id: 'a1', sectionName: 'A', duration: 2, tailSeconds: 10 }), clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 1 })]);
    const exact = lay([clip({ id: 'a1', sectionName: 'A', duration: 2, tailSeconds: 2 }), clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 1 })]);
    expect(geometry(capped)).toEqual(geometry(exact));
    expect(capped.sections[0].lengthBeats).toBe(1); // the one-beat floor
    expect(capped.timelineEnd).toBe(exact.timelineEnd);
  });

  it('a bad stored tail (negative, NaN, infinite) is treated as 0', () => {
    const base = [clip({ id: 'a1', sectionName: 'A', duration: 3 }), clip({ id: 'b1', sectionName: 'B', duration: 1 })];
    const plain = lay(base);
    for (const bad of [-1, NaN, Infinity, -Infinity]) {
      expect(storedTailSeconds({ duration: 3, trimStart: 0, trimEnd: null, tailSeconds: bad })).toBe(0);
      const l = lay([{ ...base[0], tailSeconds: bad }, base[1]]);
      expect(geometry(l)).toEqual(geometry(plain));
      expect(l.clipTailCuts.get('a1')).toBe(0);
      expect(l.timelineEnd).toBe(plain.timelineEnd);
    }
  });

  it('legacy full takes: their tail is ignored, and they never cut a tail', () => {
    const l = lay([
      clip({ id: 'a1', sectionName: 'A', duration: 4, tailSeconds: 3 }), // A 0–1, rings to 4
      clip({ id: 'b2', sectionName: 'B', trackId: 't2', duration: 1 }),
      clip({ id: 'f', sectionName: 'Full', isFullTake: true, start: 2, duration: 5, tailSeconds: 4 }),
    ]);
    expect(l.clipStarts.get('f')).toBe(2);
    expect(l.clipEnds.get('f')).toBe(7);
    expect(l.clipTailCuts.get('f')).toBe(0);
    expect(l.clipTailCuts.get('a1')).toBe(0);
    expect(l.sections.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('content need subtracts the tail, as before', () => {
    const clips = [clip({ id: 'x', sectionName: 'A', sectionOffset: 1, duration: 3, tailSeconds: 1 })];
    expect(sectionContentNeeds(clips).get('A')).toBe(3);
    expect(lay(clips, sections('A')).sections[0].contentNeed).toBe(3);
  });
});
