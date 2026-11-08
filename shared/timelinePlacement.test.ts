import { describe, expect, it } from 'vitest';
import { placeInGap, findOverlap, toPlacementClip, appendOffset, trimEndBeforeNext, trimNeighbours, clampTrim, MIN_TRIM_LENGTH, minTrimLength, pickupLeftLimit, pickupOffsetError, nextPickupStop, clipDragMinOffset, placementChanged, startPickupDrag, pickupAllowed, afterPickupPlacement, PLACEMENT_EPSILON, type PlacementClip, type TrimClip, type TrimNeighbours, type TrimResult } from './timelinePlacement';
import { layoutTimeline, type LayoutClipInput, type TimelineLayoutInput } from './timelineLayout';

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
  it('clamps the offset at 0 by default (no pickup)', () => {
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

describe('trimNeighbours', () => {
  it('finds the end of the clip before and the start of the clip after', () => {
    expect(trimNeighbours({ offset: 4 }, [clip('a', 0, 2), clip('b', 9, 1), clip('c', 7, 1)]))
      .toEqual({ prevEnd: 2, nextStart: 7 });
  });
  it('no clip before → 0; no clip after → Infinity (the last clip)', () => {
    expect(trimNeighbours({ offset: 0 }, [])).toEqual({ prevEnd: 0, nextStart: Infinity });
  });
});

describe('clampTrim', () => {
  // A: offset 4, 10 s file, trimmed 2–8 (6 s long, spans 4–10). Neighbours end at 3 and
  // start at 12.
  const A = { offset: 4, duration: 10, trimStart: 2, trimEnd: 8 };
  const nb = { prevEnd: 3, nextStart: 12 };
  const end = (r: { offset: number; trimStart: number; trimEnd: number | null }, duration = 10) =>
    r.offset + (r.trimEnd ?? duration) - r.trimStart;

  it('left trim in: the offset moves by the trimStart change; the end stays', () => {
    const r = clampTrim(A, { trimStart: 3.5, trimEnd: 8 }, nb)!;
    expect(r).toMatchObject({ trimStart: 3.5, trimEnd: 8, offset: 5.5, clamped: false });
    expect(end(r)).toBeCloseTo(10);
  });

  it('left untrim stops at the previous clip', () => {
    // Asking for trimStart 0 would put the start at 2, inside the clip ending at 3.
    const r = clampTrim(A, { trimStart: 0, trimEnd: 8 }, nb)!;
    expect(r).toMatchObject({ trimStart: 1, offset: 3, clamped: true });
    expect(end(r)).toBeCloseTo(10);
  });

  it('left untrim stops at offset 0 when there is no previous clip (no pickups)', () => {
    const r = clampTrim({ offset: 1, duration: 10, trimStart: 3, trimEnd: null }, { trimStart: 0, trimEnd: null }, { prevEnd: 0, nextStart: Infinity })!;
    expect(r).toMatchObject({ trimStart: 2, offset: 0, clamped: true });
  });

  it('left untrim stops at trimStart 0', () => {
    const r = clampTrim({ offset: 5, duration: 10, trimStart: 1, trimEnd: null }, { trimStart: -3, trimEnd: null }, { prevEnd: 0, nextStart: Infinity })!;
    expect(r).toMatchObject({ trimStart: 0, offset: 4 });
  });

  it('left trim keeps the minimum length and never moves the right edge', () => {
    const r = clampTrim(A, { trimStart: 9, trimEnd: 8 }, nb)!;
    expect(r.trimStart).toBeCloseTo(8 - MIN_TRIM_LENGTH);
    expect(r.trimEnd).toBe(8);
    expect(end(r)).toBeCloseTo(10);
  });

  it('right edge stops at the next clip', () => {
    const r = clampTrim({ ...A, trimEnd: 6 }, { trimStart: 2, trimEnd: 20 }, { prevEnd: 3, nextStart: 9 })!;
    // Start 4, next clip at 9 → 5 s of room → trimEnd 7.
    expect(r).toMatchObject({ trimStart: 2, trimEnd: 7, offset: 4, clamped: true });
  });

  it('right edge of the last clip goes to the end of the audio (no neighbour limit)', () => {
    const r = clampTrim(A, { trimStart: 2, trimEnd: 50 }, { prevEnd: 3, nextStart: Infinity })!;
    expect(r).toMatchObject({ trimStart: 2, trimEnd: null, offset: 4 });
  });

  it('right edge shortens to the minimum length, never moving the left edge', () => {
    const r = clampTrim(A, { trimStart: 2, trimEnd: 0 }, nb)!;
    expect(r).toMatchObject({ trimStart: 2, offset: 4 });
    expect(r.trimEnd).toBeCloseTo(2 + MIN_TRIM_LENGTH);
  });

  it('a whole-trim change (reset) is clamped on both edges', () => {
    // Reset 2–8 → 0–null: the start would be 2 (prev ends at 3) → trimStart 1, offset 3;
    // the file end then lands exactly at 12, the next clip.
    const r = clampTrim(A, { trimStart: 0, trimEnd: null }, nb)!;
    expect(r).toMatchObject({ trimStart: 1, offset: 3, trimEnd: null, clamped: true });
    expect(end(r)).toBeCloseTo(12);
  });

  it('no neighbours (full take): only the file limits apply and the offset stays', () => {
    expect(clampTrim(A, { trimStart: 0, trimEnd: null }, null)).toMatchObject({ trimStart: 0, trimEnd: null, offset: 4, clamped: false });
  });

  it('apply to instances: each instance is clamped at its own neighbours', () => {
    const wanted = { trimStart: 1, trimEnd: 9 };
    // Same 10 s file in three spots: lots of room, a tight previous clip, a tight next clip.
    const free = clampTrim({ offset: 10, duration: 10, trimStart: 0, trimEnd: null }, wanted, { prevEnd: 0, nextStart: Infinity })!;
    const tightPrev = clampTrim({ offset: 0, duration: 10, trimStart: 0, trimEnd: null }, wanted, { prevEnd: 0, nextStart: Infinity })!;
    const tightNext = clampTrim({ offset: 2, duration: 10, trimStart: 2, trimEnd: 6 }, wanted, { prevEnd: 0, nextStart: 8 })!;
    expect(free).toMatchObject({ trimStart: 1, trimEnd: 9, offset: 11, clamped: false });
    // At offset 0 already: trimming in to 1 moves the start right to 1, which is allowed.
    expect(tightPrev).toMatchObject({ trimStart: 1, trimEnd: 9, offset: 1, clamped: false });
    // Offset 2 → 1 (trimStart 2 → 1), end must stay ≤ 8: trimEnd 1 + 7 = 8.
    expect(tightNext).toMatchObject({ trimStart: 1, offset: 1, trimEnd: 8, clamped: true });
    expect(end(tightNext)).toBeCloseTo(8);
  });

  it('no room at all → null', () => {
    expect(clampTrim({ offset: 2, duration: 10, trimStart: 0, trimEnd: 4 }, { trimStart: 0, trimEnd: 4 }, { prevEnd: 6, nextStart: 2 })).toBeNull();
  });
});

describe('minimum clip length (minTrimLength)', () => {
  it('is 0.5 s, or the whole file when the file is shorter', () => {
    expect(MIN_TRIM_LENGTH).toBe(0.5);
    expect(minTrimLength(10)).toBe(0.5);
    expect(minTrimLength(0.3)).toBeCloseTo(0.3);
    expect(minTrimLength(0)).toBe(0);
  });

  it('a file shorter than 0.5 s stays trimmable: it keeps its full length', () => {
    const short = { offset: 2, duration: 0.3, trimStart: 0, trimEnd: null };
    // Trimming it in from either side can't shorten it below its own length.
    expect(clampTrim(short, { trimStart: 0.2, trimEnd: null }, { prevEnd: 0, nextStart: Infinity }))
      .toMatchObject({ trimStart: 0, trimEnd: null, offset: 2 });
    expect(clampTrim(short, { trimStart: 0, trimEnd: 0.1 }, { prevEnd: 0, nextStart: Infinity }))
      .toMatchObject({ trimStart: 0, trimEnd: null, offset: 2 });
  });

  it('an instance with less room than the minimum between its neighbours → null (skipped)', () => {
    // The instance sits at offset 4 with its previous clip ending at 4 and the next one
    // starting at 4.3: trimming it to 1–9 can only leave 0.3 s, under the minimum.
    expect(clampTrim({ offset: 4, duration: 10, trimStart: 0, trimEnd: 0.3 }, { trimStart: 1, trimEnd: 9 }, { prevEnd: 4, nextStart: 4.3 }))
      .toBeNull();
  });

  it('an instance with exactly the minimum room is clamped to it, not skipped', () => {
    const r = clampTrim({ offset: 4, duration: 10, trimStart: 0, trimEnd: 0.5 }, { trimStart: 0, trimEnd: 9 }, { prevEnd: 4, nextStart: 4.5 })!;
    expect(r).toMatchObject({ trimStart: 0, offset: 4, clamped: true });
    expect(r.trimEnd).toBeCloseTo(0.5);
  });
});

// ── Pickups ──────────────────────────────────────────────────────────────────

// A sectioned layout clip: `length` seconds of a file that long, untrimmed.
const lc = (id: string, trackId: string, sectionName: string, sectionOffset: number, length: number): LayoutClipInput => ({
  id, trackId, sectionName, sectionOffset, duration: length, trimStart: 0, trimEnd: null, isFullTake: false, start: 0,
});
const limitFor = (input: TimelineLayoutInput, trackId: string, sectionName: string) =>
  pickupLeftLimit(input, layoutTimeline(input), trackId, sectionName);
const rows = (...names: string[]) => names.map((name, i) => ({ name, sortOrder: i, baseLength: null }));

describe('pickupLeftLimit', () => {
  // 120 bpm, 4/4: a beat is 0.5 s, a bar 2 s.
  it('one bar before the section start, when the previous clip ends well before that', () => {
    // Intro 0–8 (drums 0–1 only; bass fills it), Verse starts at 8; drums' previous clip
    // ends at 1, so the bar (6) wins: L = −2.
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('d1', 'drums', 'Intro', 0, 1), lc('b1', 'bass', 'Intro', 0, 8), lc('d2', 'drums', 'Verse', 0, 4)],
      bpm: 120, timeSignature: '4/4',
    };
    expect(limitFor(input, 'drums', 'Verse')).toBeCloseTo(-2);
  });

  it('song start: 0 in the first section on the timeline', () => {
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('d1', 'drums', 'Intro', 0, 4), lc('d2', 'drums', 'Verse', 0, 4)],
      bpm: 120, timeSignature: '4/4',
    };
    expect(limitFor(input, 'drums', 'Intro')).toBe(0);
    // A section starting less than a bar in: song time 0 wins over the bar.
    const short: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('b1', 'bass', 'Intro', 0, 1), lc('d2', 'drums', 'Verse', 0, 4)],
      bpm: 120, timeSignature: '4/4',
    };
    expect(limitFor(short, 'drums', 'Verse')).toBeCloseTo(-1);
  });

  it("the previous clip's end on the same track", () => {
    // Intro 0–8, drums there end at 7.5; Verse starts at 8 → L = −0.5 (the bar would be −2).
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('d1', 'drums', 'Intro', 0, 7.5), lc('b1', 'bass', 'Intro', 0, 8), lc('d2', 'drums', 'Verse', 0, 4)],
      bpm: 120, timeSignature: '4/4',
    };
    expect(limitFor(input, 'drums', 'Verse')).toBeCloseTo(-0.5);
    // Other tracks' clips never limit it.
    // Bass's previous clip ends at 8, the section start → 0.
    expect(limitFor(input, 'bass', 'Verse')).toBe(0);
  });

  it('the previous clip in an earlier, non-adjacent section', () => {
    // Intro (drums 0–7.75), Verse (bass only, 8–16), Chorus at 16: drums' previous clip is
    // in the Intro and ends at 7.75, far back → the bar wins (−2).
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse', 'Chorus'),
      clips: [lc('d1', 'drums', 'Intro', 0, 7.75), lc('b1', 'bass', 'Verse', 0, 8), lc('d3', 'drums', 'Chorus', 0, 4)],
      bpm: 120, timeSignature: '4/4',
    };
    const layout = layoutTimeline(input);
    const chorus = layout.sections.find((s) => s.name === 'Chorus')!;
    expect(chorus.start).toBeCloseTo(16);
    expect(pickupLeftLimit(input, layout, 'drums', 'Chorus')).toBeCloseTo(-2);
    // Now the Verse is short (bass 0–1): Intro 0–8, Verse 8–9, Chorus at 9. The Intro
    // drums clip ends at 7.75, inside the bar before 9 → L = 7.75 − 9 = −1.25.
    const tight = { ...input, clips: [lc('d1', 'drums', 'Intro', 0, 7.75), lc('b1', 'bass', 'Verse', 0, 1), lc('d3', 'drums', 'Chorus', 0, 4)] };
    expect(limitFor(tight, 'drums', 'Chorus')).toBeCloseTo(-1.25);
  });

  it('6/8: a bar is six beats', () => {
    // 120 bpm, 6/8 → bar = 3 s. Intro 0–8, Verse at 8 → L = −3.
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('b1', 'bass', 'Intro', 0, 8), lc('d2', 'drums', 'Verse', 0, 4)],
      bpm: 120, timeSignature: '6/8',
    };
    expect(limitFor(input, 'drums', 'Verse')).toBeCloseTo(-3);
  });

  it('a fast tempo: the bar wins over a previous clip further back', () => {
    // 240 bpm, 4/4 → bar = 1 s. Intro 0–8 (drums end at 6), Verse at 8 → bar (7) wins: −1.
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('d1', 'drums', 'Intro', 0, 6), lc('b1', 'bass', 'Intro', 0, 8), lc('d2', 'drums', 'Verse', 0, 4)],
      bpm: 240, timeSignature: '4/4',
    };
    expect(limitFor(input, 'drums', 'Verse')).toBeCloseTo(-1);
  });

  it("doesn't depend on the clips in its own section (the moved clip can stay in)", () => {
    const base = [lc('d1', 'drums', 'Intro', 0, 6), lc('b1', 'bass', 'Intro', 0, 8)];
    const a: TimelineLayoutInput = { sections: rows('Intro', 'Verse'), clips: [...base, lc('d2', 'drums', 'Verse', 0, 4)], bpm: 120, timeSignature: '4/4' };
    const b: TimelineLayoutInput = { ...a, clips: [...base, lc('d2', 'drums', 'Verse', -1.5, 30)] };
    expect(limitFor(a, 'drums', 'Verse')).toBeCloseTo(limitFor(b, 'drums', 'Verse'));
  });

  it('ignores legacy full takes, and a section not on the timeline gives 0', () => {
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [
        lc('b1', 'bass', 'Intro', 0, 8),
        { ...lc('ft', 'drums', 'Full Takes', 0, 7.9), isFullTake: true, start: 0 },
        lc('d2', 'drums', 'Verse', 0, 4),
      ],
      bpm: 120, timeSignature: '4/4',
    };
    expect(limitFor(input, 'drums', 'Verse')).toBeCloseTo(-2);
    expect(limitFor(input, 'drums', 'Bridge')).toBe(0);
  });
});

describe('pickupOffsetError', () => {
  it('accepts offsets within the limit', () => {
    expect(pickupOffsetError(-1, 0, -2)).toBeNull();
    expect(pickupOffsetError(-2, 0, -2)).toBeNull();
    expect(pickupOffsetError(3, 0, -2)).toBeNull();  // not a pickup
  });
  it('accepts a pickup ending before the downbeat (a 0.5 s clip at −1.5)', () => {
    expect(pickupOffsetError(-1.5, 0, -2)).toBeNull();
  });
  it('refuses past the limit', () => {
    expect(pickupOffsetError(-2.5, 0, -2)).toMatch(/one bar/);
    expect(pickupOffsetError(-0.5, null, 0)).toMatch(/one bar/); // a new clip, no room
  });
  it('leniency: a clip already below its limit can stay or move right, never further left', () => {
    expect(pickupOffsetError(-3, -3, -2)).toBeNull();
    expect(pickupOffsetError(-2.5, -3, -2)).toBeNull();
    expect(pickupOffsetError(-3.5, -3, -2)).toMatch(/one bar/);
  });
});

describe('trimNeighbours — pickups', () => {
  it("a pickup's left edge stops at its limit when nothing is before it", () => {
    expect(trimNeighbours({ offset: -1 }, [clip('a', 2, 1)], -2)).toEqual({ prevEnd: -2, nextStart: 2 });
  });
  it('a pickup already below its limit stops at its own offset', () => {
    expect(trimNeighbours({ offset: -3 }, [], -2).prevEnd).toBe(-3);
  });
  it('the limit is ignored for a clip that is not a pickup', () => {
    expect(trimNeighbours({ offset: 1 }, [], -2)).toEqual({ prevEnd: 0, nextStart: Infinity });
  });
});

describe('clampTrim — pickups', () => {
  // P: offset −1.5, 10 s file trimmed 2–6 (4 s, spans −1.5 to 2.5). Limit −2, next clip at 4.
  const P = { offset: -1.5, duration: 10, trimStart: 2, trimEnd: 6 };
  const nb = trimNeighbours({ offset: P.offset }, [clip('n', 4, 1)], -2);
  const end = (r: { offset: number; trimStart: number; trimEnd: number | null }, duration = 10) =>
    r.offset + (r.trimEnd ?? duration) - r.trimStart;

  it('a right trim never touches the left edge (no edge at 0)', () => {
    const r = clampTrim(P, { trimStart: 2, trimEnd: 5 }, nb)!;
    expect(r).toMatchObject({ trimStart: 2, trimEnd: 5, offset: -1.5, clamped: false });
  });

  it('a right trim can pull the end before the downbeat, down to the minimum length', () => {
    // P runs −1.5…2.5. Trimmed to 1 s it ends at −0.5, before the downbeat.
    const r = clampTrim(P, { trimStart: 2, trimEnd: 3 }, nb)!;
    expect(r).toMatchObject({ trimStart: 2, trimEnd: 3, offset: -1.5, clamped: false });
    expect(end(r)).toBeCloseTo(-0.5);
    // Asked for shorter than 0.5 s: held at the minimum, the left edge untouched.
    const min = clampTrim(P, { trimStart: 2, trimEnd: 2.1 }, nb)!;
    expect(min).toMatchObject({ trimStart: 2, offset: -1.5, clamped: true });
    expect(min.trimEnd).toBeCloseTo(2 + MIN_TRIM_LENGTH);
    expect(end(min)).toBeCloseTo(-1);
  });

  it('a right trim still stops at the next clip', () => {
    const r = clampTrim(P, { trimStart: 2, trimEnd: 20 }, nb)!;
    expect(end(r)).toBeCloseTo(4);
  });

  it('a left untrim stops at the left limit', () => {
    const r = clampTrim(P, { trimStart: 0, trimEnd: 6 }, nb)!;
    expect(r).toMatchObject({ trimStart: 1.5, offset: -2, trimEnd: 6, clamped: true });
  });

  it("a left untrim stops at the clip's own audio (trimStart 0)", () => {
    const r = clampTrim({ ...P, trimStart: 0.2, trimEnd: 4.2 }, { trimStart: 0, trimEnd: 4.2 }, nb)!;
    expect(r).toMatchObject({ trimStart: 0, trimEnd: 4.2, clamped: false });
    expect(r.offset).toBeCloseTo(-1.7);
  });

  it('a left trim in moves the start right, across the downbeat if asked', () => {
    const r = clampTrim(P, { trimStart: 4, trimEnd: 6 }, nb)!;
    expect(r).toMatchObject({ trimStart: 4, offset: 0.5, trimEnd: 6, clamped: false });
  });

  it('keeps the minimum length', () => {
    const r = clampTrim(P, { trimStart: 7, trimEnd: 6 }, nb)!;
    expect(r.trimStart).toBeCloseTo(6 - MIN_TRIM_LENGTH);
    expect(r.trimEnd).toBe(6);
  });

  it('leniency: a pickup below its limit can be right-trimmed and left-trimmed in, never further left', () => {
    const low = { offset: -3, duration: 10, trimStart: 2, trimEnd: 7 };
    const lnb = trimNeighbours({ offset: -3 }, [], -2);
    expect(clampTrim(low, { trimStart: 2, trimEnd: 6 }, lnb)).toMatchObject({ trimStart: 2, trimEnd: 6, offset: -3, clamped: false });
    expect(clampTrim(low, { trimStart: 2.5, trimEnd: 7 }, lnb)).toMatchObject({ trimStart: 2.5, offset: -2.5, clamped: false });
    expect(clampTrim(low, { trimStart: 1, trimEnd: 7 }, lnb)).toMatchObject({ trimStart: 2, offset: -3, clamped: true });
  });

  it('a normal clip still stops at the downbeat on a left untrim, whatever the limit', () => {
    const r = clampTrim({ offset: 1, duration: 10, trimStart: 3, trimEnd: null }, { trimStart: 0, trimEnd: null }, trimNeighbours({ offset: 1 }, [], -2))!;
    expect(r).toMatchObject({ trimStart: 2, offset: 0, clamped: true });
  });
});

// clampTrim and trimNeighbours as they were before pickups (4e1), for the "no pickups →
// identical results" sweep.
function oldTrimNeighbours(c: { offset: number }, others: PlacementClip[]): TrimNeighbours {
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const o of others) {
    if (o.offset < c.offset - PLACEMENT_EPSILON) prevEnd = Math.max(prevEnd, o.offset + o.length);
    else nextStart = Math.min(nextStart, o.offset);
  }
  return { prevEnd, nextStart };
}
function oldClampTrim(c: TrimClip, wanted: { trimStart: number; trimEnd: number | null }, nb: TrimNeighbours | null): TrimResult | null {
  const wantedEnd = wanted.trimEnd ?? c.duration;
  const wantedStart = Number.isFinite(wanted.trimStart) ? wanted.trimStart : c.trimStart;
  const minLength = minTrimLength(c.duration);
  const lowStart = nb ? Math.max(0, c.trimStart + (Math.max(0, nb.prevEnd) - c.offset)) : 0;
  const leftMoves = Math.abs(wantedStart - c.trimStart) > PLACEMENT_EPSILON;
  const highStart = leftMoves ? Math.min(wantedEnd, c.duration) - minLength : Infinity;
  const trimStart = Math.max(lowStart, Math.min(wantedStart, highStart));
  const offset = nb ? c.offset + (trimStart - c.trimStart) : c.offset;
  const highEnd = nb ? Math.min(c.duration, trimStart + (nb.nextStart - offset)) : c.duration;
  const lowEnd = trimStart + minLength;
  let trimEnd = Math.min(highEnd, Math.max(lowEnd, Number.isFinite(wantedEnd) ? wantedEnd : c.duration));
  if (trimEnd <= trimStart + PLACEMENT_EPSILON) return null;
  if (trimEnd - trimStart < minLength - PLACEMENT_EPSILON) return null;
  const storedEnd = trimEnd >= c.duration - PLACEMENT_EPSILON ? null : trimEnd;
  if (storedEnd === null) trimEnd = c.duration;
  const clamped = Math.abs(trimStart - wanted.trimStart) > PLACEMENT_EPSILON || Math.abs(trimEnd - wantedEnd) > PLACEMENT_EPSILON;
  return { trimStart, trimEnd: storedEnd, offset, clamped };
}

describe('no pickups → identical trim results', () => {
  it('trimNeighbours and clampTrim match the pre-pickup versions for every clip at offset ≥ 0', () => {
    const others = [clip('a', 0, 1.5), clip('b', 6, 2), clip('c', 9.25, 0.75)];
    let checked = 0;
    for (const offset of [0, 1.5, 2, 3.25, 8, 10]) {
      for (const [trimStart, trimEnd] of [[0, null], [1, 4], [0.5, 9], [2, 2.6]] as [number, number | null][]) {
        const c = { offset, duration: 10, trimStart, trimEnd };
        const mine = others.filter((o) => Math.abs(o.offset - offset) > 1e-9);
        for (const limit of [0, -2]) {
          const nbNew = trimNeighbours({ offset }, mine, limit);
          const nbOld = oldTrimNeighbours({ offset }, mine);
          expect(nbNew).toEqual(nbOld);
          for (const ws of [-1, 0, 0.3, 1, 3, 9.9]) {
            for (const we of [null, 0, 2, 5, 9, 20]) {
              expect(clampTrim(c, { trimStart: ws, trimEnd: we }, nbNew)).toEqual(oldClampTrim(c, { trimStart: ws, trimEnd: we }, nbOld));
              expect(clampTrim(c, { trimStart: trimStart, trimEnd: we }, nbNew)).toEqual(oldClampTrim(c, { trimStart, trimEnd: we }, nbOld));
              checked++;
            }
          }
        }
        expect(clampTrim(c, { trimStart: 0, trimEnd: null }, null)).toEqual(oldClampTrim(c, { trimStart: 0, trimEnd: null }, null));
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('clipDragMinOffset', () => {
  it('is 0 when no pickup is allowed, whatever the limit', () => {
    expect(clipDragMinOffset(false, -2)).toBe(0);
  });
  it('is the left limit, whatever the clip length', () => {
    expect(clipDragMinOffset(true, -2)).toBe(-2);
    expect(clipDragMinOffset(true, 0)).toBe(0);
  });
});

describe('pickup drag state', () => {
  it('only Option allows a pickup for a clip that was not one', () => {
    const st = startPickupDrag(0);
    expect(pickupAllowed(st, false)).toBe(false);
    expect(pickupAllowed(st, true)).toBe(true);
    expect(startPickupDrag(null).wasPickup).toBe(false);
  });
  it('an existing pickup is allowed without Option until it lands on or after the downbeat', () => {
    let st = startPickupDrag(-1);
    expect(pickupAllowed(st, false)).toBe(true);
    st = afterPickupPlacement(st, -0.5);
    expect(pickupAllowed(st, false)).toBe(true);
    st = afterPickupPlacement(st, 0); // on the downbeat counts
    expect(pickupAllowed(st, false)).toBe(false);
    expect(pickupAllowed(st, true)).toBe(true);
    // It stays a normal clip for the rest of the drag, even after landing back before it.
    expect(pickupAllowed(afterPickupPlacement(st, -1), false)).toBe(false);
  });
});

// One timeline clip drag as Timeline runs it: per pointer step, whether a pickup is
// allowed (Option, or a pickup at drag start not yet on/after the downbeat), the minimum
// offset, the placement, then the state update. Returns each step's landing offset.
function drag(
  input: TimelineLayoutInput,
  trackId: string,
  sectionName: string,
  stored: number,
  length: number,
  others: PlacementClip[],
  steps: { wanted: number; option?: boolean }[],
): number[] {
  let state = startPickupDrag(stored);
  return steps.map(({ wanted, option = false }) => {
    const allow = pickupAllowed(state, option);
    const min = clipDragMinOffset(allow, allow ? limitFor(input, trackId, sectionName) : 0);
    const r = placeInGap(others, length, wanted, min);
    state = afterPickupPlacement(state, r.offset);
    return r.offset;
  });
}

describe('timeline clip drag — minimum offset (pickups)', () => {
  // 120 bpm, 4/4: a bar is 2 s. Intro 0–8 (bass fills it; drums 0–1), Verse at 8.
  // Drums' Verse clip A (4 s) is dragged; its left limit is the bar, −2.
  const input: TimelineLayoutInput = {
    sections: rows('Intro', 'Verse'),
    clips: [lc('d1', 'drums', 'Intro', 0, 1), lc('b1', 'bass', 'Intro', 0, 8), lc('A', 'drums', 'Verse', 0, 4)],
    bpm: 120, timeSignature: '4/4',
  };

  it('no Option: stops at the downbeat, however far it overshoots', () => {
    expect(drag(input, 'drums', 'Verse', 0, 4, [], [{ wanted: -1.5 }, { wanted: -100 }, { wanted: 1 }])).toEqual([0, 0, 1]);
  });

  it('Option: lands before the downbeat where aimed, down to the left limit', () => {
    expect(drag(input, 'drums', 'Verse', 0, 4, [], [{ wanted: -1.5, option: true }, { wanted: -5, option: true }])).toEqual([-1.5, -2]);
  });

  it('Option pressed and released mid-drag', () => {
    expect(drag(input, 'drums', 'Verse', 0, 4, [], [
      { wanted: -1 }, { wanted: -1, option: true }, { wanted: -1 },
    ])).toEqual([0, -1, 0]);
  });

  it('an existing pickup moves within the pickup area without Option', () => {
    expect(drag(input, 'drums', 'Verse', -1, 4, [], [{ wanted: -1.5 }, { wanted: -0.25 }, { wanted: -3 }])).toEqual([-1.5, -0.25, -2]);
  });

  it('an existing pickup dragged past the downbeat is a normal clip; back needs Option', () => {
    expect(drag(input, 'drums', 'Verse', -1, 4, [], [
      { wanted: -1 }, { wanted: 0.5 }, { wanted: -1 }, { wanted: -1, option: true },
    ])).toEqual([-1, 0.5, 0, -1]);
    // Exactly on the downbeat counts as crossing it.
    expect(drag(input, 'drums', 'Verse', -1, 4, [], [{ wanted: 0 }, { wanted: -1 }])).toEqual([0, 0]);
  });

  it('the first section on the timeline: no room before song time 0', () => {
    const first: TimelineLayoutInput = { ...input, clips: [lc('A', 'drums', 'Intro', 0, 4)] };
    expect(drag(first, 'drums', 'Intro', 0, 4, [], [{ wanted: -1, option: true }])).toEqual([0]);
  });

  it("the previous clip's end on the track is the limit", () => {
    // Drums' Intro clip ends at 7.5: the limit is −0.5, not the bar.
    const prev: TimelineLayoutInput = {
      ...input,
      clips: [lc('d1', 'drums', 'Intro', 0, 7.5), lc('b1', 'bass', 'Intro', 0, 8), lc('A', 'drums', 'Verse', 0, 4)],
    };
    expect(drag(prev, 'drums', 'Verse', 0, 4, [], [{ wanted: -1.5, option: true }])).toEqual([-0.5]);
  });

  it('a one-beat clip Option-dragged to the very start of the bar before lands one bar early, ending before the downbeat', () => {
    // 0.5 s (one beat at 120 bpm), aimed at and past the bar line: lands at −2, ends at −1.5.
    expect(drag(input, 'drums', 'Verse', 0, 0.5, [], [{ wanted: -2, option: true }])).toEqual([-2]);
    expect(drag(input, 'drums', 'Verse', 0, 0.5, [], [{ wanted: -3, option: true }])).toEqual([-2]);
    // Anywhere in the bar: beat 2 of the bar before (−1.5).
    expect(drag(input, 'drums', 'Verse', 0, 0.5, [], [{ wanted: -1.5, option: true }])).toEqual([-1.5]);
  });

  it('Option with a too-small first gap: A at the limit, the clips after it move later by its length', () => {
    // b at 0.5–2.5; the first gap is −2…0.5 (2.5 s), too small for A (3 s).
    const others = [clip('b', 0.5, 2), clip('c', 4, 1)];
    const r = placeInGap(others, 3, -1.5, clipDragMinOffset(true, -2));
    expect(r).toEqual({ offset: -2, moved: [{ id: 'b', offset: 3.5 }, { id: 'c', offset: 7 }] });
    expect(findOverlap(apply(others, 3, r))).toBeNull();
  });

  it('Option with a first gap that fits: lands where aimed, held within the gap', () => {
    // b at 1; the first gap −2…1 fits A (2 s) — aimed at −0.5, it would run to 1.5, so it lands at −1.
    expect(placeInGap([clip('b', 1, 2)], 2, -0.5, clipDragMinOffset(true, -2))).toEqual({ offset: -1, moved: [] });
  });

  it("a normal clip next to another track clip's pickup never moves it: it goes after its end", () => {
    // p is a pickup (−1…1) among the others; A without Option aimed at −0.5 / 0.2.
    const others = [clip('p', -1, 2), clip('b', 4, 1)];
    expect(placeInGap(others, 2, -0.5)).toEqual({ offset: 1, moved: [] });
    expect(placeInGap(others, 2, 0.2)).toEqual({ offset: 1, moved: [] });
    // Too big for the gap 1–4: A at 1, b moves later; p never moves.
    expect(placeInGap(others, 4, 0.2)).toEqual({ offset: 1, moved: [{ id: 'b', offset: 8 }] });
  });
});

describe('placementChanged — released back on its own spot', () => {
  it('a normal clip: no push and landing on its offset is a no-op', () => {
    expect(placementChanged({ offset: 2, moved: [] }, 2)).toBe(false);
    expect(placementChanged({ offset: 2 + 1e-9, moved: [] }, 2)).toBe(false);
    expect(placementChanged({ offset: 2.5, moved: [] }, 2)).toBe(true);
    expect(placementChanged({ offset: 2, moved: [{ id: 'b', offset: 5 }] }, 2)).toBe(true);
  });

  it('a cut pickup released on its drawn (cut) start saves nothing, though it differs from the stored offset', () => {
    // 120 bpm 4/4. Drums in Intro run to 7.5; Verse starts at 8. Drums' Verse pickup is
    // stored at −1.5 (left over from before the Intro clip grew), so the layout cuts
    // 1 s of its head: it is drawn from −0.5, and its limit is −0.5 too.
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [lc('d1', 'drums', 'Intro', 0, 7.5), lc('b1', 'bass', 'Intro', 0, 8), lc('P', 'drums', 'Verse', -1.5, 4)],
      bpm: 120, timeSignature: '4/4',
    };
    const layout = layoutTimeline(input);
    const stored = -1.5;
    const drawn = stored + layout.clipHeadCuts.get('P')!;
    expect(drawn).toBeCloseTo(-0.5);
    // A drag aimed back where it was drawn (or further left) lands at the limit, −0.5.
    const steps = drag(input, 'drums', 'Verse', stored, 4, [], [{ wanted: -0.5 }, { wanted: -3 }]);
    expect(steps[0]).toBeCloseTo(-0.5);
    expect(steps[1]).toBeCloseTo(-0.5);
    for (const offset of steps) expect(placementChanged({ offset, moved: [] }, drawn)).toBe(false);
    // Measured against the stored offset it would have looked like a move (the old rule).
    expect(placementChanged({ offset: steps[0], moved: [] }, stored)).toBe(true);
    // A real move is still saved.
    expect(placementChanged({ offset: 0.5, moved: [] }, drawn)).toBe(true);
  });
});

// ── Pickup trims (4e4) ───────────────────────────────────────────────────────

// One trim drag as TimelineClip runs it: the neighbours both ways (with and without a
// pickup allowed) fixed at trim start; per step, Option, the wanted edge, clampTrim
// with the matching neighbours, then the pickup state update. Returns each step's result.
function trimDrag(
  start: TrimClip,
  others: PlacementClip[],
  pickupLimit: number,
  pickupStop: number,
  edge: 'left' | 'right',
  steps: { delta: number; option?: boolean }[],
): TrimResult[] {
  const nb = trimNeighbours({ offset: start.offset }, others, pickupLimit, { allowPickup: false, nextPickupStop: pickupStop });
  const pickupNb = trimNeighbours({ offset: start.offset }, others, pickupLimit, { allowPickup: true, nextPickupStop: pickupStop });
  let state = startPickupDrag(start.offset);
  return steps.map(({ delta, option = false }) => {
    const wanted = edge === 'left'
      ? { trimStart: start.trimStart + delta, trimEnd: start.trimEnd }
      : { trimStart: start.trimStart, trimEnd: (start.trimEnd ?? start.duration) + delta };
    const allowPickup = pickupAllowed(state, option);
    const r = clampTrim(start, wanted, allowPickup ? pickupNb : nb, { allowPickup })!;
    state = afterPickupPlacement(state, r.offset);
    return r;
  });
}

describe('pickup trims — left edge', () => {
  // 120 bpm, 4/4: a bar is 2 s. Intro 0–8 (bass fills it; drums 0–1), Verse at 8. Drums'
  // Verse left limit is the bar, −2.
  const input: TimelineLayoutInput = {
    sections: rows('Intro', 'Verse'),
    clips: [lc('d1', 'drums', 'Intro', 0, 1), lc('b1', 'bass', 'Intro', 0, 8), lc('A', 'drums', 'Verse', 0.5, 4)],
    bpm: 120, timeSignature: '4/4',
  };
  const limit = limitFor(input, 'drums', 'Verse');
  // A: offset 0.5, a 10 s file trimmed 3–7.
  const A: TrimClip = { offset: 0.5, duration: 10, trimStart: 3, trimEnd: 7 };

  it('the limit is one bar', () => {
    expect(limit).toBeCloseTo(-2);
  });

  it('a normal clip without Option stops at its section\'s start', () => {
    const [r] = trimDrag(A, [], limit, Infinity, 'left', [{ delta: -3 }]);
    expect(r).toMatchObject({ trimStart: 2.5, trimEnd: 7, clamped: true });
    expect(r.offset).toBeCloseTo(0);
  });

  it('with Option it goes on to the pickup left limit, the audio staying put', () => {
    const [r] = trimDrag(A, [], limit, Infinity, 'left', [{ delta: -3, option: true }]);
    expect(r.offset).toBeCloseTo(-2);
    expect(r.trimStart).toBeCloseTo(0.5);
    expect(r.trimEnd).toBe(7);
    // The end didn't move: 0.5 + (7 − 3) = 4.5.
    expect(r.offset + (r.trimEnd! - r.trimStart)).toBeCloseTo(4.5);
  });

  it('pressing or releasing Option mid-trim re-places the edge', () => {
    const steps = trimDrag(A, [], limit, Infinity, 'left', [
      { delta: -2, option: true }, { delta: -2 }, { delta: -2, option: true },
    ]);
    expect(steps.map((r) => r.offset)).toEqual([
      expect.closeTo(-1.5), expect.closeTo(0), expect.closeTo(-1.5),
    ]);
  });

  it('trimStart never goes below 0, Option or not', () => {
    const [r] = trimDrag({ ...A, trimStart: 1 }, [], limit, Infinity, 'left', [{ delta: -5, option: true }]);
    expect(r.trimStart).toBe(0);
    expect(r.offset).toBeCloseTo(-0.5);
  });

  it('with Option it still stops at an earlier clip in its section', () => {
    // A clip before A in the Verse, 0–0.25: Option can't take A past its end.
    const [r] = trimDrag(A, [clip('x', 0, 0.25)], limit, Infinity, 'left', [{ delta: -3, option: true }]);
    expect(r.offset).toBeCloseTo(0.25);
  });

  it('an existing pickup moves within its limits without Option', () => {
    const P: TrimClip = { offset: -1, duration: 10, trimStart: 2, trimEnd: 6 };
    const steps = trimDrag(P, [], limit, Infinity, 'left', [{ delta: -3 }, { delta: 0.5 }]);
    expect(steps[0].offset).toBeCloseTo(-2);
    expect(steps[0].trimStart).toBeCloseTo(1);
    expect(steps[1].offset).toBeCloseTo(-0.5);
  });

  it('a pickup pulled to its section\'s start is a normal clip for the rest of the trim: back needs Option', () => {
    const P: TrimClip = { offset: -1, duration: 10, trimStart: 2, trimEnd: 6 };
    const steps = trimDrag(P, [], limit, Infinity, 'left', [
      { delta: 1 },                 // left edge on the downbeat
      { delta: -0.5 },              // back without Option: held at the downbeat
      { delta: -0.5, option: true }, // with Option: a pickup again
    ]);
    expect(steps.map((r) => r.offset)).toEqual([expect.closeTo(0), expect.closeTo(0), expect.closeTo(-1.5)]);
  });

  it('a right trim of a pickup never moves its left edge', () => {
    const P: TrimClip = { offset: -1, duration: 10, trimStart: 2, trimEnd: 6 };
    const [r] = trimDrag(P, [], limit, Infinity, 'right', [{ delta: 2 }]);
    expect(r).toMatchObject({ trimStart: 2, trimEnd: 8, offset: -1 });
  });
});

describe('pickup trims — right edge stops at the next section\'s pickup (nextPickupStop)', () => {
  // 120 bpm, 4/4. Bass fills Intro 0–8; Verse starts at 8. Drums' Intro clip d1 is a
  // 10 s file trimmed to `end`; drums' Verse holds `verse`.
  const setup = (end: number, verse: LayoutClipInput[]) => {
    const input: TimelineLayoutInput = {
      sections: rows('Intro', 'Verse'),
      clips: [
        { ...lc('d1', 'drums', 'Intro', 0, 10), trimEnd: end },
        lc('b1', 'bass', 'Intro', 0, 8),
        ...verse,
      ],
      bpm: 120, timeSignature: '4/4',
    };
    const layout = layoutTimeline(input);
    return { input, layout, stop: nextPickupStop(input, layout, 'drums', 'Intro') };
  };
  const d1 = (end: number): TrimClip => ({ offset: 0, duration: 10, trimStart: 0, trimEnd: end });

  it('stops where the pickup starts', () => {
    // Pickup P at −1.5 in the Verse → drawn from 6.5.
    const { stop } = setup(5, [lc('P', 'drums', 'Verse', -1.5, 4)]);
    expect(stop).toBeCloseTo(6.5);
    const [r] = trimDrag(d1(5), [], 0, stop, 'right', [{ delta: 4 }]);
    expect(r.trimEnd).toBeCloseTo(6.5);
    expect(r.clamped).toBe(true);
  });

  it('a cut pickup: stops where it is drawn, so the edge can\'t extend', () => {
    // d1 ends at 7; P at −1.5 would start at 6.5, so its head is cut to 7.
    const { layout, stop } = setup(7, [lc('P', 'drums', 'Verse', -1.5, 4)]);
    expect(layout.clipHeadCuts.get('P')).toBeCloseTo(0.5);
    expect(stop).toBeCloseTo(7);
    const [r] = trimDrag(d1(7), [], 0, stop, 'right', [{ delta: 2 }]);
    expect(r.trimEnd).toBeCloseTo(7);
    // Shortening still works.
    const [s] = trimDrag(d1(7), [], 0, stop, 'right', [{ delta: -1 }]);
    expect(s.trimEnd).toBeCloseTo(6);
  });

  it('a clip in the next section that is not a pickup sets no limit (it moves with the section)', () => {
    const { stop } = setup(5, [lc('V', 'drums', 'Verse', 0, 4)]);
    expect(stop).toBe(Infinity);
    const [r] = trimDrag(d1(5), [], 0, stop, 'right', [{ delta: 4 }]);
    expect(r.trimEnd).toBeCloseTo(9);
  });

  it('another track\'s pickup sets no limit', () => {
    const { stop } = setup(5, [lc('P', 'bass', 'Verse', -1.5, 4)]);
    expect(stop).toBe(Infinity);
  });

  it('a pickup cut to nothing (not drawn) sets no limit', () => {
    // d1 ends at 7.95; P (0.4 s at −0.5) would sit 7.5–7.9: all of it is cut.
    const { layout, stop } = setup(7.95, [lc('P', 'drums', 'Verse', -0.5, 0.4)]);
    expect(layout.clipStarts.get('P')).toBeCloseTo(layout.clipEnds.get('P')!);
    expect(stop).toBe(Infinity);
  });

  it('the earliest of several pickups wins', () => {
    const { stop } = setup(5, [lc('P', 'drums', 'Verse', -1.5, 0.5), lc('Q', 'drums', 'Verse', -0.5, 1)]);
    expect(stop).toBeCloseTo(6.5);
  });

  it('only the last clip there is affected: an earlier one stops at the next clip in its section', () => {
    const { stop } = setup(5, [lc('P', 'drums', 'Verse', -1.5, 4)]);
    const nb = trimNeighbours({ offset: 0 }, [clip('n', 3, 1)], 0, { nextPickupStop: stop });
    expect(nb.nextStart).toBe(3);
  });

  it('a section not on the timeline → no limit', () => {
    const { input, layout } = setup(5, []);
    expect(nextPickupStop(input, layout, 'drums', 'Nope')).toBe(Infinity);
  });
});

// As the server's applyTrimToInstances runs each instance: default trimNeighbours (a
// pickup only for a pickup instance) and default clampTrim, plus the pickup stop.
const instanceTrim = (c: TrimClip, wanted: { trimStart: number; trimEnd: number | null }, others: PlacementClip[], pickupLimit: number, pickupStop = Infinity) =>
  clampTrim(c, wanted, trimNeighbours({ offset: c.offset }, others, c.offset < 0 ? pickupLimit : 0, { nextPickupStop: pickupStop }));

describe('apply trim to all instances — never creates a pickup', () => {
  it("a normal instance's left edge clamps at its section's start", () => {
    const r = instanceTrim({ offset: 0.5, duration: 10, trimStart: 3, trimEnd: 7 }, { trimStart: 0, trimEnd: 7 }, [], -2)!;
    expect(r.offset).toBeCloseTo(0);
    expect(r).toMatchObject({ trimStart: 2.5, clamped: true });
  });

  it('even with a limit passed, a normal instance never goes below 0', () => {
    const c = { offset: 0.5, duration: 10, trimStart: 3, trimEnd: 7 };
    const r = clampTrim(c, { trimStart: 0, trimEnd: 7 }, trimNeighbours({ offset: 0.5 }, [], -2))!;
    expect(r.offset).toBeCloseTo(0);
  });

  it('a pickup instance clamps at its own left limit', () => {
    const r = instanceTrim({ offset: -1, duration: 10, trimStart: 2, trimEnd: 6 }, { trimStart: 0, trimEnd: 6 }, [], -2)!;
    expect(r.offset).toBeCloseTo(-2);
    expect(r).toMatchObject({ trimStart: 1, clamped: true });
  });

  it("every instance's right edge clamps at the next section's pickup", () => {
    const r = instanceTrim({ offset: 0, duration: 10, trimStart: 0, trimEnd: 5 }, { trimStart: 0, trimEnd: null }, [], 0, 6.5)!;
    expect(r.trimEnd).toBeCloseTo(6.5);
    expect(r.clamped).toBe(true);
  });
});
