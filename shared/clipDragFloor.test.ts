import { describe, expect, it } from 'vitest';
import { clipDragPreviewSections } from './clipDragFloor';
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

// 120 bpm, 4/4: one beat = 0.5 s. Verse holds v1 0–2 and v2 2–4 on t1 (S0 = 8 beats =
// 4 s); Intro before it, Chorus after it with clips on two tracks.
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
const layoutWith = (rows: typeof sections, offsets: Record<string, number>, tails: Record<string, number> = {}) => layoutTimeline({
  sections: rows,
  clips: stored.map((c) => ({
    ...c,
    ...(c.id in offsets ? { sectionOffset: offsets[c.id] } : {}),
    ...(c.id in tails ? { tailSeconds: tails[c.id] } : {}),
  })),
  bpm: 120,
  timeSignature: '4/4',
});
const storedLayout = layoutWith(sections, {});
// The preview layout for a timeline clip drag of a Verse clip, as Timeline builds it.
const clipDrag = (offsets: Record<string, number>, tails: Record<string, number> = {}) =>
  layoutWith(clipDragPreviewSections(sections, storedLayout, { kind: 'clip', homeSection: 'Verse' }), offsets, tails);
const find = (l: ReturnType<typeof layoutWith>, name: string) => l.sections.find((s) => s.name === name)!;

describe('clipDragPreviewSections (no live shrinking during clip drags)', () => {
  it('keeps the home section at S0 while its last clip moves earlier', () => {
    expect(find(storedLayout, 'Verse').length).toBeCloseTo(4);
    // Without the floor, moving v2 earlier shrinks Verse (the preview layout takes the
    // offsets it's given; overlap is placeInGap's job, not the layout's).
    expect(find(layoutWith(sections, { v1: 0, v2: 0.5 }), 'Verse').length).toBeLessThan(4);
    for (const offset of [1.5, 1, 0.5]) {
      expect(find(clipDrag({ v1: 0, v2: offset }), 'Verse').length).toBeCloseTo(4);
    }
  });

  it('later sections do not move while the clip moves earlier', () => {
    const chorusStart = find(storedLayout, 'Chorus').start;
    for (const offset of [1.5, 1, 0.5]) {
      const preview = clipDrag({ v2: offset });
      expect(find(preview, 'Chorus').start).toBeCloseTo(chorusStart);
      expect(preview.clipStarts.get('c1')).toBeCloseTo(storedLayout.clipStarts.get('c1')!);
      expect(preview.clipStarts.get('c2')).toBeCloseTo(storedLayout.clipStarts.get('c2')!);
    }
  });

  it('still grows live when the clip moves later, and comes back down to S0', () => {
    expect(find(clipDrag({ v2: 5.2 }), 'Verse').length).toBeCloseTo(7.5); // ends at 7.2 → 7.5
    expect(find(clipDrag({ v2: 3 }), 'Verse').length).toBeCloseTo(5);
    expect(find(clipDrag({ v2: 2 }), 'Verse').length).toBeCloseTo(4); // back at S0
    expect(find(clipDrag({ v2: 1 }), 'Verse').length).toBeCloseTo(4); // never below
  });

  it("Option's freeze still holds the section at S0", () => {
    // Overhanging by 1 s with its computed tail fed in: the section's end stays at S0.
    expect(find(clipDrag({ v2: 3 }, { v2: 1 }), 'Verse').length).toBeCloseTo(4);
    // Snapped back to end exactly at the wall (S0): S0, the floor, no conflict.
    expect(find(clipDrag({ v2: 2 }, { v2: 0 }), 'Verse').length).toBeCloseTo(4);
  });

  it('keeps a larger stored base length, and raises a smaller one to S0', () => {
    const withBase = sections.map((s) => (s.name === 'Verse' ? { ...s, baseLength: 12 } : s));
    const baseLayout = layoutWith(withBase, {});
    expect(clipDragPreviewSections(withBase, baseLayout, { kind: 'clip', homeSection: 'Verse' })).toBe(withBase);
    const small = sections.map((s) => (s.name === 'Verse' ? { ...s, baseLength: 3 } : s));
    const raised = clipDragPreviewSections(small, layoutWith(small, {}), { kind: 'clip', homeSection: 'Verse' });
    expect(raised.find((s) => s.name === 'Verse')!.baseLength).toBe(8);
    expect(small.find((s) => s.name === 'Verse')!.baseLength).toBe(3); // input untouched
  });

  it('leaves other drag kinds unaffected', () => {
    expect(clipDragPreviewSections(sections, storedLayout, { kind: 'file', homeSection: 'Verse' })).toBe(sections);
    const filePreview = layoutWith(
      clipDragPreviewSections(sections, storedLayout, { kind: 'file', homeSection: 'Verse' }),
      { v1: 0, v2: 0.5 },
    );
    expect(find(filePreview, 'Verse').length).toBeLessThan(4);
  });

  it('leaves the rows alone with no home section, or one that is not on the timeline', () => {
    expect(clipDragPreviewSections(sections, storedLayout, { kind: 'clip', homeSection: null })).toBe(sections);
    expect(clipDragPreviewSections(sections, storedLayout, { kind: 'clip', homeSection: 'Bridge' })).toBe(sections);
  });

  it('only touches the home section', () => {
    const rows = clipDragPreviewSections(sections, storedLayout, { kind: 'clip', homeSection: 'Verse' });
    expect(rows[0]).toBe(sections[0]);
    expect(rows[2]).toBe(sections[2]);
  });
});
