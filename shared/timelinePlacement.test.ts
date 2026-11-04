import { describe, expect, it } from 'vitest';
import { placeInGap, findOverlap, toPlacementClip, appendOffset, trimEndBeforeNext, type PlacementClip } from './timelinePlacement';

const clip = (id: string, offset: number, length: number): PlacementClip => ({ id, offset, length });

// A placement result as the clips' new offsets (others + the dragged one, id 'A').
const apply = (others: PlacementClip[], length: number, r: ReturnType<typeof placeInGap>) => {
  const moved = new Map(r.moved.map((m) => [m.id, m.offset]));
  return [...others.map((c) => ({ ...c, offset: moved.get(c.id) ?? c.offset })), clip('A', r.offset, length)];
};
const furthestEnd = (clips: PlacementClip[]) => Math.max(...clips.map((c) => c.offset + c.length));

describe('placeInGap — A fits in the gap', () => {
  it('lands exactly where aimed; nothing moves', () => {
    expect(placeInGap([clip('a', 0, 2), clip('b', 6, 2)], 2, 3)).toEqual({ offset: 3, moved: [] });
  });

  it('fits in the gap but not at S: clamped within the gap', () => {
    // Gap 2–6; A (3 s) at 4 would run to 7, so it lands at 3 (the latest start that fits).
    expect(placeInGap([clip('a', 0, 2), clip('b', 6, 2)], 3, 4)).toEqual({ offset: 3, moved: [] });
    // A perfect fit: the gap is exactly A's length.
    expect(placeInGap([clip('a', 0, 2), clip('b', 5, 2)], 3, 4)).toEqual({ offset: 2, moved: [] });
  });

  it("aiming at a clip's first half lands snug before it when the gap before fits", () => {
    // Gap 2–6 before b; aiming inside b's first half (6.5) → snug against b, at 6 − 2 = 4.
    expect(placeInGap([clip('a', 0, 2), clip('b', 6, 2), clip('c', 12, 2)], 2, 6.5)).toEqual({ offset: 4, moved: [] });
  });

  it("aiming at a clip's second half lands snug after it when the gap after fits", () => {
    // b's second half (7.5) → the gap 8–12 after b; S is clamped up to its start, 8.
    expect(placeInGap([clip('a', 0, 2), clip('b', 6, 2), clip('c', 12, 2)], 2, 7.5)).toEqual({ offset: 8, moved: [] });
  });

  it('the gap after the last clip always fits, with no limit', () => {
    expect(placeInGap([clip('a', 0, 2), clip('b', 2, 2)], 50, 9)).toEqual({ offset: 9, moved: [] });
    // The last clip's second half → snug at its end.
    expect(placeInGap([clip('a', 0, 2), clip('b', 2, 2)], 50, 3.5)).toEqual({ offset: 4, moved: [] });
  });

  it("treats the dragged clip's own old spot as free space", () => {
    // A sat at 2–4 between a and c (it's not among `others`); anywhere in it, it stays at 2.
    for (const s of [2, 2.4, 3, 3.9]) {
      expect(placeInGap([clip('a', 0, 2), clip('c', 4, 2)], 2, s)).toEqual({ offset: 2, moved: [] });
    }
  });

  it('treats edges touching within float noise as touching', () => {
    // a ends at 0.30000000000000004; S = 0.3 is in the gap after it, which fits 0.7 s exactly.
    const r = placeInGap([clip('a', 0, 0.1 + 0.2), clip('b', 1, 1)], 0.7, 0.3);
    expect(r.moved).toEqual([]);
    expect(r.offset).toBeCloseTo(0.3, 9);
  });
});

describe('placeInGap — a too-small gap stays', () => {
  it('a 1 s gap with a 6 s clip: A at the gap start, the next clip +6 s, the 1 s gap now after A', () => {
    // a 0–2, gap 2–3, b 3–5. A (6 s) aimed into the gap → A 2–8, b 9–11.
    const r = placeInGap([clip('a', 0, 2), clip('b', 3, 2)], 6, 2.5);
    expect(r).toEqual({ offset: 2, moved: [{ id: 'b', offset: 9 }] });
    expect(r.moved[0].offset - (r.offset + 6)).toBe(1); // the original gap, between A's end and b
  });

  it('A goes to the gap start wherever in the gap it was aimed', () => {
    const others = [clip('a', 0, 2), clip('b', 3, 2), clip('c', 8, 2)];
    const expected = { offset: 2, moved: [{ id: 'b', offset: 9 }, { id: 'c', offset: 14 }] };
    for (const s of [2, 2.01, 2.5, 2.99]) expect(placeInGap(others, 6, s), `S = ${s}`).toEqual(expected);
    // Via a's second half (gap after a) or b's first half (gap before b): the same gap.
    expect(placeInGap(others, 6, 1.5)).toEqual(expected);
    expect(placeInGap(others, 6, 3.5)).toEqual(expected);
  });

  it("pushed clips all move by A's length; the gaps between them are unchanged", () => {
    // Gap 2–3 can't hold 2 s: A at 2, b and c +2; the 3 s between b and c stays 3 s.
    const r = placeInGap([clip('a', 0, 2), clip('b', 3, 2), clip('c', 8, 2)], 2, 2.5);
    expect(r).toEqual({ offset: 2, moved: [{ id: 'b', offset: 5 }, { id: 'c', offset: 10 }] });
    expect(r.moved[1].offset - (r.moved[0].offset + 2)).toBe(3);
  });

  it("aiming at a clip's first half with no room before it pushes that clip and the rest", () => {
    // b and c packed after a: b's first half → the zero gap at 2; A (1 s) at 2, b and c +1.
    const r = placeInGap([clip('a', 0, 2), clip('b', 2, 2), clip('c', 4, 2)], 1, 2.5);
    expect(r).toEqual({ offset: 2, moved: [{ id: 'b', offset: 3 }, { id: 'c', offset: 5 }] });
  });

  it("aiming at a clip's second half with no room after it pushes the clips after it, not it", () => {
    const r = placeInGap([clip('a', 0, 2), clip('b', 2, 2), clip('c', 4, 2)], 1, 3.5);
    expect(r).toEqual({ offset: 4, moved: [{ id: 'c', offset: 5 }] });
  });

  it('pushes clips past the section end (the section grows on drop)', () => {
    const r = placeInGap([clip('a', 0, 2), clip('b', 3, 4)], 2, 2);
    expect(r).toEqual({ offset: 2, moved: [{ id: 'b', offset: 5 }] });
  });

  it('never moves clips before the gap', () => {
    const r = placeInGap([clip('a', 0, 2), clip('b', 2.5, 1), clip('c', 4, 1)], 2, 3.8);
    // b's second half (3.8 ≥ 3) → gap 3.5–4, too small: A at 3.5, c +2; a and b don't move.
    expect(r).toEqual({ offset: 3.5, moved: [{ id: 'c', offset: 6 }] });
  });

  it('does not round the push to the grid', () => {
    const r = placeInGap([clip('a', 0, 1.1), clip('b', 1.3, 1)], 0.737, 1.2);
    expect(r.offset).toBeCloseTo(1.1, 12);
    expect(r.moved[0].offset).toBeCloseTo(1.3 + 0.737, 12);
  });
});

describe('placeInGap — minimum offset and exact edges', () => {
  it('clamps the offset at 0 (no pickups yet)', () => {
    expect(placeInGap([], 2, -1.5)).toEqual({ offset: 0, moved: [] });
    // Gap 0–4 before b fits 3 s: −1 → 0.
    expect(placeInGap([clip('b', 4, 2)], 3, -1)).toEqual({ offset: 0, moved: [] });
    // Gap 0–2 can't hold 3 s: A at 0, b pushed by 3 — the 2 s gap now after A.
    expect(placeInGap([clip('b', 2, 2)], 3, 0.5)).toEqual({ offset: 0, moved: [{ id: 'b', offset: 5 }] });
    // A clip at 0, aimed at its first half: the zero gap 0–0; it moves later by A's length.
    expect(placeInGap([clip('a', 0, 2)], 1.5, 0.2)).toEqual({ offset: 0, moved: [{ id: 'a', offset: 1.5 }] });
  });

  it("a start exactly at a clip's start counts as its first half", () => {
    // Exactly at b's start (4): the gap before b, 2–4, fits 2 s → snug, at 2.
    expect(placeInGap([clip('a', 0, 2), clip('b', 4, 2)], 2, 4)).toEqual({ offset: 2, moved: [] });
    // Within float noise of it, the same.
    expect(placeInGap([clip('a', 0, 2), clip('b', 4, 2)], 2, 4 - 1e-9)).toEqual({ offset: 2, moved: [] });
    // Too small before b (2–4 for 3 s): A at 2, b pushed by 3.
    expect(placeInGap([clip('a', 0, 2), clip('b', 4, 2)], 3, 4)).toEqual({ offset: 2, moved: [{ id: 'b', offset: 7 }] });
  });

  it("a start exactly at a clip's end is free space after it", () => {
    expect(placeInGap([clip('a', 0, 2), clip('b', 6, 2)], 2, 2)).toEqual({ offset: 2, moved: [] });
  });
});

describe("placeInGap — Derek's layout: [A][B] gap [C]", () => {
  // A 0–6.336, B 6.336–12.672, a 6.336 s gap, C 19.008–24.725.
  const A = clip('A', 0, 6.336);
  const B = clip('B', 6.336, 6.336);
  const C = clip('C', 19.008, 5.717333);

  it('A into the gap fits: lands where aimed (clamped to the gap); B and C stay', () => {
    // The gap is exactly A's length, so the only start that fits is B's end.
    expect(placeInGap([B, C], A.length, 14)).toEqual({ offset: 12.672, moved: [] });
    expect(placeInGap([B, C], A.length, 12.672)).toEqual({ offset: 12.672, moved: [] });
  });

  it("A onto B's first half: its own old spot (0–6.336) fits — A stays", () => {
    expect(placeInGap([B, C], A.length, 7.5)).toEqual({ offset: 0, moved: [] });
  });

  it("A onto B's second half: the gap after B fits — snug at B's end", () => {
    expect(placeInGap([B, C], A.length, 11)).toEqual({ offset: 12.672, moved: [] });
  });

  it("A onto C's second half: after the last clip — snug at C's end; nothing moves", () => {
    const r = placeInGap([B, C], A.length, 23);
    expect(r.moved).toEqual([]);
    expect(r.offset).toBeCloseTo(24.725333, 6);
  });

  it("C onto B's second half: the gap after B fits — C lands there; A and B stay", () => {
    expect(placeInGap([A, B], C.length, 11)).toEqual({ offset: 12.672, moved: [] });
  });

  it("C onto B's first half: no room between A and B — B moves later by C's length", () => {
    const r = placeInGap([A, B], C.length, 8);
    expect(r.offset).toBe(6.336);
    expect(r.moved).toHaveLength(1);
    expect(r.moved[0].id).toBe('B');
    expect(r.moved[0].offset).toBeCloseTo(12.053333, 6);
  });

  describe('with a too-small gap (B 6.336–12.672, gap 2 s, C, D after)', () => {
    const C2 = clip('C', 14.672, 5.717333);
    const D = clip('D', 22, 3);
    const others = [B, C2, D];

    it("A near the start of the gap: A at B's end; C and D move later by A's length", () => {
      const r = placeInGap(others, A.length, 12.8);
      expect(r.offset).toBe(12.672);
      expect(r.moved.map((m) => m.id)).toEqual(['C', 'D']);
      expect(r.moved[0].offset).toBeCloseTo(14.672 + A.length, 9);
      expect(r.moved[1].offset).toBeCloseTo(22 + A.length, 9);
      // The 2 s gap is now between A's end and C; the gap between C and D is unchanged.
      expect(r.moved[0].offset - (r.offset + A.length)).toBeCloseTo(2, 9);
      expect(r.moved[1].offset - (r.moved[0].offset + C2.length)).toBeCloseTo(22 - (14.672 + C2.length), 9);
    });

    it('A partway into the gap lands at the gap start too', () => {
      expect(placeInGap(others, A.length, 13.9)).toEqual(placeInGap(others, A.length, 12.8));
    });

    it("A onto C's first half picks the same gap and the same push", () => {
      expect(placeInGap(others, A.length, 15)).toEqual(placeInGap(others, A.length, 13));
    });
  });
});

describe('placeInGap — sweeps', () => {
  const layouts: { name: string; others: PlacementClip[]; len: number }[] = [
    { name: "Derek's Guitar 1 / Verse 1 (A dragged)", others: [clip('B', 6.336, 6.336), clip('C', 19.008, 5.717333)], len: 6.336 },
    { name: "Derek's Guitar 1 / Verse 1 (C dragged)", others: [clip('A', 0, 6.336), clip('B', 6.336, 6.336)], len: 5.717333 },
    { name: 'clips with gaps', others: [clip('a', 0, 2), clip('b', 3, 1), clip('c', 7, 3), clip('d', 12, 1)], len: 1.5 },
    { name: 'packed', others: [clip('a', 0, 2), clip('b', 2, 2), clip('c', 4, 2)], len: 2 },
    { name: 'starts late, small gaps', others: [clip('a', 1, 1), clip('b', 2.5, 1), clip('c', 4, 2), clip('d', 6.2, 0.5)], len: 1.2 },
  ];
  for (const { name, others, len } of layouts) {
    it(`${name}: no overlaps, offsets ≥ 0, nothing moves earlier, pushed gaps keep their size`, () => {
      const before = new Map(others.map((c) => [c.id, c.offset]));
      for (let s = -1; s <= furthestEnd(others) + len + 1; s += 0.01) {
        const r = placeInGap(others, len, s);
        const after = apply(others, len, r);
        // What the server's batch save checks: no overlap, no offset below 0.
        expect(findOverlap(after), `S = ${s}`).toBeNull();
        expect(Math.min(...after.map((c) => c.offset)), `S = ${s}`).toBeGreaterThanOrEqual(0);
        // Clips only ever move later, and all pushed clips by the same amount.
        const shifts = r.moved.map((m) => m.offset - before.get(m.id)!);
        for (const d of shifts) expect(d, `S = ${s}`).toBeGreaterThan(0);
        for (const d of shifts) expect(d, `S = ${s}`).toBeCloseTo(shifts[0], 9);
        // Pushed clips are exactly the clips from some point on (a suffix in order),
        // so the gaps between them keep their size.
        const sorted = [...others].sort((p, q) => p.offset - q.offset);
        const movedIds = new Set(r.moved.map((m) => m.id));
        const firstMoved = sorted.findIndex((c) => movedIds.has(c.id));
        if (firstMoved !== -1) expect(sorted.slice(firstMoved).every((c) => movedIds.has(c.id)), `S = ${s}`).toBe(true);
        // A pushes only when it lands at the start of the gap (the end of the clip before
        // it, or 0); the push is exactly A's length, and the original gap now sits between
        // A's end and the first pushed clip.
        if (r.moved.length > 0) {
          const prevEnd = sorted.slice(0, firstMoved).reduce((m, c) => Math.max(m, c.offset + c.length), 0);
          const originalGap = sorted[firstMoved].offset - prevEnd;
          expect(originalGap, `S = ${s}`).toBeLessThan(len);
          expect(r.offset, `S = ${s}`).toBeCloseTo(prevEnd, 9);
          expect(shifts[0], `S = ${s}`).toBeCloseTo(len, 9);
          const firstPushed = r.moved.find((m) => m.id === sorted[firstMoved].id)!;
          expect(firstPushed.offset - (r.offset + len), `S = ${s}`).toBeCloseTo(originalGap, 9);
        }
      }
    });
  }
});

describe('findOverlap', () => {
  it('ignores touching edges', () => {
    expect(findOverlap([clip('a', 0, 2), clip('b', 2, 2)])).toBeNull();
    expect(findOverlap([clip('a', 0, 0.1 + 0.2), clip('b', 0.3, 1)])).toBeNull();
  });

  it('reports overlapping clips', () => {
    const a = clip('a', 0, 2);
    const b = clip('b', 1.5, 1);
    expect(findOverlap([b, a])).toEqual([a, b]);
  });

  it('catches a clip hidden inside a long one, not just neighbours', () => {
    const a = clip('a', 0, 10);
    const b = clip('b', 11, 1);
    const c = clip('c', 3, 1);
    expect(findOverlap([a, b, c])).toEqual([a, c]);
  });

  it('is fine with nothing or one clip', () => {
    expect(findOverlap([])).toBeNull();
    expect(findOverlap([clip('a', 0, 1)])).toBeNull();
  });
});

describe('toPlacementClip', () => {
  it('uses the trimmed length and counts a null offset as 0', () => {
    expect(toPlacementClip({ id: 'a', sectionOffset: null, duration: 10, trimStart: 2, trimEnd: 7 }))
      .toEqual({ id: 'a', offset: 0, length: 5 });
    expect(toPlacementClip({ id: 'b', sectionOffset: 3, duration: 4, trimStart: 1, trimEnd: null }))
      .toEqual({ id: 'b', offset: 3, length: 3 });
  });
});

describe('appendOffset', () => {
  it('is 0 with no clips', () => {
    expect(appendOffset([])).toBe(0);
  });
  it('is the furthest clip end, not the sum of lengths, so gaps stay', () => {
    // 0–2 and 6–8: the sum of lengths would be 4 (inside b); the end is 8.
    expect(appendOffset([clip('a', 0, 2), clip('b', 6, 2)])).toBe(8);
  });
  it('ignores array order', () => {
    expect(appendOffset([clip('b', 6, 2), clip('a', 0, 2)])).toBe(8);
  });
});

describe('trimEndBeforeNext (Replace cut-short)', () => {
  const at = (offset: number, duration: number, trimStart = 0, trimEnd: number | null = null) =>
    ({ offset, duration, trimStart, trimEnd });

  it('the last clip in the section is never cut', () => {
    expect(trimEndBeforeNext(at(4, 10), [clip('a', 0, 2)])).toBeNull();
  });
  it('a clip that fits before the next one is not cut', () => {
    expect(trimEndBeforeNext(at(2, 3), [clip('a', 0, 2), clip('b', 6, 2)])).toBeNull();
    // Touching the next clip exactly is a fit.
    expect(trimEndBeforeNext(at(2, 4), [clip('a', 0, 2), clip('b', 6, 2)])).toBeNull();
  });
  it('a longer clip is cut to end exactly at the next clip', () => {
    // At 2, next clip at 6: room 4, so trimEnd = 0 + 4.
    const trimEnd = trimEndBeforeNext(at(2, 10), [clip('a', 0, 2), clip('b', 6, 2)]);
    expect(trimEnd).toBe(4);
    // The result passes the overlap check.
    expect(findOverlap([clip('a', 0, 2), clip('b', 6, 2), clip('A', 2, trimEnd! - 0)])).toBeNull();
  });
  it('keeps trimStart: the cut is measured from it', () => {
    expect(trimEndBeforeNext(at(2, 10, 1), [clip('b', 6, 2)])).toBe(5);
  });
  it('an existing trimEnd that runs too far is cut further', () => {
    expect(trimEndBeforeNext(at(0, 10, 0, 8), [clip('b', 3, 2)])).toBe(3);
  });
  it('clips before it never count as the next clip', () => {
    expect(trimEndBeforeNext(at(5, 10), [clip('a', 0, 2)])).toBeNull();
  });
});
