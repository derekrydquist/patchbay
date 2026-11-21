// Step 4h2b: overhangs (timeline_clips.tail_seconds) through trims, Apply / Reset Trim
// to all instances, and Replace. Every write derives the written clip's tail from the
// layout BEFORE the write and never leaves it cut: an overhanging clip keeps hanging
// over, any other clip gets 0 (unless the trim route was sent allowOverhang), and the
// hard checks refuse a tail as long as the clip or a tail cut that grows. Runs the real
// routes over HTTP with a stub session against a throwaway SQLite file with
// patchbay.db's schema only (no data; patchbay.db is opened read-only), as
// timelineTailSeconds.test.ts does. Tails are seeded by direct writes. Skipped when
// there is no local patchbay.db to copy the schema from.
//
// Song: 120 bpm, 4/4 (a beat is 0.5 s). Sections in arrangement order: Intro, Verse,
// Chorus. The spec's worked example: Intro is 8 s long; clip X sits at offset 5 with 5 s
// of trimmed audio (file 10 s, trim 2–7) and a 2 s tail, so it ends at 10 and hangs 2 s
// past Intro's end; the next clip on its track (N, in Verse at offset 3) is drawn at 11.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createServer, type Server } from 'http';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clampTrim, trimNeighbours, pickupLeftLimit, nextPickupStop, nextClipStop, overhangTrimState,
  overhangTrimNeighbours, trimAllowsOverhang, trimPreviewTail, PLACEMENT_EPSILON,
} from '../shared/timelinePlacement';
import { layoutTimeline } from '../shared/timelineLayout';

const SOURCE = path.resolve(import.meta.dirname, '..', 'patchbay.db');

describe.skipIf(!fs.existsSync(SOURCE))('overhangs through trims, apply-to-instances and Replace', () => {
  let tmpDir: string;
  let raw: Database.Database;
  let server: Server;
  let base: string;
  let store: typeof import('./storage');

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbay-trim-overhang-'));
    const file = path.join(tmpDir, 'test.db');
    const src = new Database(SOURCE, { readonly: true, fileMustExist: true });
    const objects = src.prepare(
      "SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
    ).all() as { type: string; sql: string }[];
    src.close();
    const dst = new Database(file);
    for (const o of objects) dst.exec(o.sql);
    dst.close();
    process.env.DATABASE_URL = file;
    raw = (await import('./db')).sqlite;
    const { registerRoutes } = await import('./routes');
    store = await import('./storage');

    const now = new Date().toISOString();
    raw.prepare("INSERT INTO bands (id, name, created_at) VALUES ('b1', 'Band', ?)").run(now);
    raw.prepare("INSERT INTO users (id, username, password, band_id) VALUES ('u1', 'tester', 'x', 'b1')").run();
    raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, band_id, time_signature) VALUES ('s1', 's1', 120, '[]', 'song', ?, ?, 'b1', '4/4')").run(now, now);
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('drums', 's1', 'Drums', 'instrument', 0)").run();
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('bass', 's1', 'Bass', 'instrument', 1)").run();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: 'u1', bandId: 'b1' } as unknown as typeof req.session;
      next();
    });
    server = createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    raw?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const now = new Date().toISOString();
    raw.exec('DELETE FROM timeline_clips; DELETE FROM activity_log; DELETE FROM song_sections;');
    for (const [name, order] of [['Intro', 0], ['Verse', 1], ['Chorus', 2]] as const) {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`sec-${name}`, 's1', name, order, now);
    }
  });

  type Seed = {
    track?: string; name?: string; section: string; offset: number; duration: number;
    trimStart?: number; trimEnd?: number | null; tail?: number;
  };
  const add = (id: string, c: Seed) =>
    raw.prepare(`INSERT INTO timeline_clips (id, track_id, name, type, color, start, duration, section_name, section_offset, is_full_take, trim_start, trim_end, tail_seconds)
      VALUES (?, ?, ?, 'audio', 'x', 0, ?, ?, ?, 0, ?, ?, ?)`)
      .run(id, c.track ?? 'drums', c.name ?? id, c.duration, c.section, c.offset, c.trimStart ?? 0, c.trimEnd ?? null, c.tail ?? 0);

  // The worked example: X overhangs Intro by 2 s; N is drawn at 11 (Verse starts at 8).
  const seedExample = () => {
    add('x', { section: 'Intro', offset: 5, duration: 10, trimStart: 2, trimEnd: 7, tail: 2 });
    add('n', { section: 'Verse', offset: 3, duration: 1 });
  };

  const send = async (method: string, url: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const trim = (id: string, body: Record<string, unknown>) => send('PATCH', `/api/timeline-clips/${id}/trim`, body);
  const replace = (id: string, duration: number) => send('PATCH', `/api/timeline-clips/${id}`, {
    name: `${id}-v2`, src: `/uploads/${id}-v2.wav`, duration, trimStart: 0, trimEnd: null,
  });
  const applyToInstances = (name: string, trimStart: number, trimEnd: number | null) =>
    send('POST', '/api/timeline-clips/apply-trim-to-instances', { trackId: 'drums', name, trimStart, trimEnd });
  const row = (id: string) => raw.prepare(
    'SELECT section_offset AS offset, trim_start AS trimStart, trim_end AS trimEnd, duration, tail_seconds AS tail FROM timeline_clips WHERE id = ?',
  ).get(id) as { offset: number; trimStart: number; trimEnd: number | null; duration: number; tail: number };
  const layout = () => store.computeSongLayout('s1');
  const sectionLength = (name: string) => layout().sections.find((s) => s.name === name)!.length;
  const drawnStart = (id: string) => layout().clipStarts.get(id)!;
  const tailCut = (id: string) => layout().clipTailCuts.get(id) ?? 0;

  it('the seeded example lays out as the spec says: Intro 8 s, X ends at 10, N drawn at 11, no cut', () => {
    seedExample();
    expect(sectionLength('Intro')).toBeCloseTo(8);
    expect(layout().clipEnds.get('x')).toBeCloseTo(10);
    expect(drawnStart('n')).toBeCloseTo(11);
    expect(tailCut('x')).toBe(0);
  });

  describe('trims on an overhanging clip (worked example)', () => {
    it('right trim 1.5 s shorter: ends 8.5, tail 0.5, Intro stays 8 s', async () => {
      seedExample();
      const res = await trim('x', { trimStart: 2, trimEnd: 5.5 });
      expect(res.status).toBe(200);
      expect(res.body.tailSeconds).toBeCloseTo(0.5);
      expect(row('x').tail).toBeCloseTo(0.5);
      expect(layout().clipEnds.get('x')).toBeCloseTo(8.5);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('right trim 3 s shorter: ends 7, tail 0, Intro shrinks to 7 s', async () => {
      seedExample();
      const res = await trim('x', { trimStart: 2, trimEnd: 4 });
      expect(res.status).toBe(200);
      expect(row('x').tail).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(7);
      expect(drawnStart('n')).toBeCloseTo(10); // Verse moved up with Intro's end
    });

    it('right trim 0.5 s longer: ends 10.5, tail 2.5, Intro stays 8 s', async () => {
      seedExample();
      const res = await trim('x', { trimStart: 2, trimEnd: 7.5 });
      expect(res.status).toBe(200);
      expect(row('x').tail).toBeCloseTo(2.5);
      expect(sectionLength('Intro')).toBeCloseTo(8);
      expect(tailCut('x')).toBe(0);
    });

    it('right trim 1.5 s longer: would end 11.5 past N at 11 — refused (400), nothing written', async () => {
      seedExample();
      const res = await trim('x', { trimStart: 2, trimEnd: 8.5 });
      expect(res.status).toBe(400);
      expect(row('x')).toMatchObject({ trimStart: 2, trimEnd: 7, tail: 2, offset: 5 });
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('left trim 2 s: offset 7, length 3, tail 2, end still 10, Intro stays 8 s', async () => {
      seedExample();
      const res = await trim('x', { trimStart: 4, trimEnd: 7 });
      expect(res.status).toBe(200);
      expect(row('x')).toMatchObject({ trimStart: 4, trimEnd: 7 });
      expect(row('x').offset).toBeCloseTo(7);
      expect(row('x').tail).toBeCloseTo(2);
      expect(layout().clipEnds.get('x')).toBeCloseTo(10);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it("left trim 3 s: the start would land on Intro's end — refused (400), nothing written", async () => {
      seedExample();
      const res = await trim('x', { trimStart: 5, trimEnd: 7 });
      expect(res.status).toBe(400);
      expect(row('x')).toMatchObject({ trimStart: 2, trimEnd: 7, tail: 2, offset: 5 });
    });

    it('Reset Trim (plain route, no flag) follows the rule: tail = new end − S', async () => {
      // No next clip on the track, so the full file may ring past the last section.
      add('x', { section: 'Intro', offset: 5, duration: 10, trimStart: 2, trimEnd: 7, tail: 2 });
      const res = await trim('x', { trimStart: 0, trimEnd: null });
      expect(res.status).toBe(200);
      expect(row('x').offset).toBeCloseTo(3);
      expect(row('x').trimEnd).toBeNull();
      expect(row('x').tail).toBeCloseTo(5); // ends 13, S 8
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('a Detect-Trim-style trim (plain route, both edges in) follows the rule too', async () => {
      seedExample();
      const res = await trim('x', { trimStart: 2.5, trimEnd: 6.5 });
      expect(res.status).toBe(200);
      expect(row('x').offset).toBeCloseTo(5.5);
      expect(row('x').tail).toBeCloseTo(1.5); // ends 9.5
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });
  });

  describe('trims on a clip that is not overhanging', () => {
    // A normal last clip at offset 4, length 4: ends 8 = Intro's end; next clip at 9.
    const seedNormal = () => {
      add('y', { section: 'Intro', offset: 4, duration: 10, trimStart: 0, trimEnd: 4 });
      add('n', { section: 'Verse', offset: 1, duration: 1 });
    };

    it('extend by 1 with allowOverhang: tail 1, Intro stays 8 s, the next clip stays at 9', async () => {
      seedNormal();
      expect(sectionLength('Intro')).toBeCloseTo(8);
      const res = await trim('y', { trimStart: 0, trimEnd: 5, allowOverhang: true });
      expect(res.status).toBe(200);
      expect(row('y').tail).toBeCloseTo(1);
      expect(sectionLength('Intro')).toBeCloseTo(8);
      expect(drawnStart('n')).toBeCloseTo(9);
    });

    it('the same extend without the flag: tail 0, Intro grows to 9 s', async () => {
      seedNormal();
      const res = await trim('y', { trimStart: 0, trimEnd: 5 });
      expect(res.status).toBe(200);
      expect(row('y').tail).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(9);
      expect(drawnStart('n')).toBeCloseTo(10);
    });

    it('a trim on a clip with a hidden tail saves 0', async () => {
      // h ends at 2 with a stored 1 s tail; bass fills Intro to 8 s, so the tail is hidden.
      add('h', { section: 'Intro', offset: 0, duration: 2, tail: 1 });
      add('fill', { track: 'bass', section: 'Intro', offset: 0, duration: 8 });
      expect(sectionLength('Intro')).toBeCloseTo(8);
      const res = await trim('h', { trimStart: 0, trimEnd: 1.5 });
      expect(res.status).toBe(200);
      expect(row('h').tail).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('allowOverhang on a clip that is not the last in its section → 400', async () => {
      add('p', { section: 'Intro', offset: 0, duration: 4, trimEnd: 1 });
      add('q', { section: 'Intro', offset: 2, duration: 1 });
      const res = await trim('p', { trimStart: 0, trimEnd: 1.5, allowOverhang: true });
      expect(res.status).toBe(400);
      expect(row('p').trimEnd).toBe(1);
    });

    it('a non-boolean allowOverhang → 400', async () => {
      seedNormal();
      for (const bad of ['yes', 1, null]) {
        const res = await trim('y', { trimStart: 0, trimEnd: 5, allowOverhang: bad });
        expect(res.status).toBe(400);
      }
      expect(row('y').trimEnd).toBe(4);
    });

    it('allowOverhang: false is the same as leaving it out', async () => {
      seedNormal();
      const res = await trim('y', { trimStart: 0, trimEnd: 5, allowOverhang: false });
      expect(res.status).toBe(200);
      expect(row('y').tail).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(9);
    });
  });

  describe('Apply / Reset Trim to all instances', () => {
    // "loop" in Intro overhangs (as X in the example; N in Verse is drawn at 11) and in
    // Chorus is a normal clip. Verse: 8–12; Chorus starts at 12.
    const seedInstances = () => {
      add('i1', { name: 'loop', section: 'Intro', offset: 5, duration: 10, trimStart: 2, trimEnd: 7, tail: 2 });
      add('n', { section: 'Verse', offset: 3, duration: 1 });
      add('i2', { name: 'loop', section: 'Chorus', offset: 0, duration: 10, trimStart: 2, trimEnd: 7 });
    };

    it('mixed instances: the overhanging one stops at the next clip, the normal one at its downbeat', async () => {
      seedInstances();
      const res = await applyToInstances('loop', 1, 9);
      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(0);
      // Intro: left edge to offset 4; right edge stops where N is drawn (11): trimEnd 8.
      expect(row('i1').offset).toBeCloseTo(4);
      expect(row('i1').trimStart).toBeCloseTo(1);
      expect(row('i1').trimEnd).toBeCloseTo(8);
      expect(row('i1').tail).toBeCloseTo(3); // ends 11, S 8
      expect(tailCut('i1')).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(8);
      // Chorus: a normal clip never becomes a pickup: trimStart stays 2; extends to 9.
      expect(row('i2')).toMatchObject({ trimStart: 2, trimEnd: 9, tail: 0 });
      expect(row('i2').offset).toBeCloseTo(0);
      const instances = res.body.instances as { id: string; clamped: boolean; skipped: boolean }[];
      expect(instances.find((i) => i.id === 'i1')).toMatchObject({ clamped: true, skipped: false });
      expect(instances.find((i) => i.id === 'i2')).toMatchObject({ clamped: true, skipped: false });
    });

    it("a left trim on the overhanging instance stops before its section's end", async () => {
      seedInstances();
      const res = await applyToInstances('loop', 6.5, 7);
      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(0);
      const i1 = row('i1');
      expect(i1.offset).toBeLessThan(8);
      expect(i1.offset).toBeCloseTo(8, 4);
      expect(i1.tail).toBeCloseTo(2);
      expect(i1.tail).toBeLessThan((i1.trimEnd ?? i1.duration) - i1.trimStart);
      expect(sectionLength('Intro')).toBeCloseTo(8);
      // The normal instance takes the trim as asked.
      expect(row('i2')).toMatchObject({ trimStart: 6.5, trimEnd: 7, tail: 0 });
      expect(row('i2').offset).toBeCloseTo(4.5);
    });

    it('Reset on all instances: the overhanging one is cut back to the next clip, no 500', async () => {
      seedInstances();
      const res = await applyToInstances('loop', 0, null);
      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(0);
      // Intro: offset 3, end clamped at 11 → trimEnd 8, tail 3.
      expect(row('i1').offset).toBeCloseTo(3);
      expect(row('i1').trimEnd).toBeCloseTo(8);
      expect(row('i1').tail).toBeCloseTo(3);
      expect(tailCut('i1')).toBe(0);
      // Chorus: left edge stays at the downbeat (trimStart 2), right edge to the file's end.
      expect(row('i2')).toMatchObject({ trimStart: 2, trimEnd: null, tail: 0 });
    });

    // "loop" in Intro already cut: it ends at 10 but the next clip (Verse offset 1) is
    // drawn at 9, so 1 s of its overhang is cut — as a bandmate's push can leave it.
    const seedCut = () => {
      add('i1', { name: 'loop', section: 'Intro', offset: 5, duration: 10, trimStart: 2, trimEnd: 7, tail: 2 });
      add('n', { section: 'Verse', offset: 1, duration: 1 });
    };

    it('an already-cut instance keeps its right edge (the cut stays, the stored overhang is kept)', async () => {
      seedCut();
      expect(tailCut('i1')).toBeCloseTo(1);
      const res = await applyToInstances('loop', 3, 7); // left edge only
      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(0);
      expect(row('i1')).toMatchObject({ trimStart: 3, trimEnd: 7 });
      expect(row('i1').offset).toBeCloseTo(6);
      expect(row('i1').tail).toBeCloseTo(2);
      expect(tailCut('i1')).toBeCloseTo(1);
    });

    it('an already-cut instance: an extension is clamped where it ends now, never growing the cut', async () => {
      seedCut();
      const res = await applyToInstances('loop', 2, 9);
      expect(res.status).toBe(200);
      expect(res.body.skipped).toBe(0);
      expect(row('i1').trimEnd).toBeCloseTo(7);
      expect(tailCut('i1')).toBeCloseTo(1);
      expect((res.body.instances as { id: string; clamped: boolean }[])[0]).toMatchObject({ id: 'i1', clamped: true });
    });

    it('an already-cut instance: a shorter right edge shrinks the cut', async () => {
      seedCut();
      const res = await applyToInstances('loop', 2, 6.5);
      expect(res.status).toBe(200);
      expect(row('i1').tail).toBeCloseTo(1.5); // ends 9.5, S 8
      expect(tailCut('i1')).toBeCloseTo(0.5);
    });

    it('a normal instance with a hidden tail is reset to 0', async () => {
      add('h', { name: 'hit', section: 'Intro', offset: 0, duration: 2, tail: 1 });
      add('fill', { track: 'bass', section: 'Intro', offset: 0, duration: 8 });
      const res = await applyToInstances('hit', 0.25, 1.75);
      expect(res.status).toBe(200);
      expect(row('h').tail).toBe(0);
    });
  });

  describe('Replace', () => {
    it('longer file: the overhang grows (tail = N − P), Intro stays 8 s', async () => {
      seedExample(); // P = 8 − 5 = 3
      const res = await replace('x', 5.5);
      expect(res.status).toBe(200);
      expect(row('x')).toMatchObject({ offset: 5, trimStart: 0, trimEnd: null });
      expect(row('x').tail).toBeCloseTo(2.5);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('shorter file, still longer than P: tail 1, Intro stays 8 s', async () => {
      seedExample();
      const res = await replace('x', 4);
      expect(res.status).toBe(200);
      expect(row('x').tail).toBeCloseTo(1);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('file shorter than P: tail 0, Intro shrinks to 7 s', async () => {
      seedExample();
      const res = await replace('x', 2);
      expect(res.status).toBe(200);
      expect(row('x').tail).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(7);
    });

    it('a file that would run past the next clip is cut with trimEnd to end exactly there', async () => {
      seedExample();
      const res = await replace('x', 8); // would end at 13; N is drawn at 11
      expect(res.status).toBe(200);
      expect(row('x').trimEnd).toBeCloseTo(6);
      expect(row('x').tail).toBeCloseTo(3);
      expect(layout().clipEnds.get('x')).toBeCloseTo(11);
      expect(tailCut('x')).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('no room for the minimum length before the next clip → 409, nothing written', async () => {
      // z sits at 7.8 with 0.2 s inside Intro; the next clip starts at Verse's downbeat.
      add('z', { section: 'Intro', offset: 7.8, duration: 1, tail: 0.8 });
      add('n', { section: 'Verse', offset: 0, duration: 1 });
      expect(sectionLength('Intro')).toBeCloseTo(8);
      const res = await replace('z', 5);
      expect(res.status).toBe(409);
      expect(row('z')).toMatchObject({ duration: 1, tail: 0.8 });
    });

    it('a hidden tail on a clip that is not overhanging is reset to 0 (today\'s rules otherwise)', async () => {
      add('h', { section: 'Intro', offset: 0, duration: 2, tail: 1 });
      add('fill', { track: 'bass', section: 'Intro', offset: 0, duration: 8 });
      const res = await replace('h', 1.5);
      expect(res.status).toBe(200);
      expect(row('h')).toMatchObject({ duration: 1.5, tail: 0 });
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('a normal last clip still grows its section and never gets a tail', async () => {
      add('y', { section: 'Intro', offset: 4, duration: 4 });
      add('n', { section: 'Verse', offset: 1, duration: 1 });
      const res = await replace('y', 6);
      expect(res.status).toBe(200);
      expect(row('y').tail).toBe(0);
      expect(sectionLength('Intro')).toBeCloseTo(10);
    });
  });

  // Step 4h4a: what the client now sends for a trim, worked out exactly as TimelineClip
  // does (Track.tsx's neighbours, Timeline's stops, overhangTrimNeighbours, clampTrim),
  // from the layout as the server holds it. Every value must be accepted (never a 400),
  // and the server must store the tail the preview showed (trimPreviewTail).
  describe('client trims (4h4a) are always accepted', () => {
    const clientTrim = (id: string, edge: 'left' | 'right', wanted: { trimStart: number; trimEnd: number | null }, option = false) => {
      const c = raw.prepare('SELECT track_id AS trackId, section_name AS sectionName, section_offset AS offset, duration, trim_start AS trimStart, trim_end AS trimEnd FROM timeline_clips WHERE id = ?')
        .get(id) as { trackId: string; sectionName: string; offset: number; duration: number; trimStart: number; trimEnd: number | null };
      const input = store.songLayoutInput('s1');
      const l = layoutTimeline(input);
      const others = store.sectionPlacementClips(c.trackId, c.sectionName).filter((o) => o.id !== id);
      const nb = trimNeighbours({ offset: c.offset }, others, pickupLeftLimit(input, l, c.trackId, c.sectionName), {
        allowPickup: false, nextPickupStop: nextPickupStop(input, l, c.trackId, c.sectionName),
      });
      const clip = { offset: c.offset, duration: c.duration, trimStart: c.trimStart, trimEnd: c.trimEnd };
      const st = overhangTrimState({
        sectionLength: l.sections.find((x) => x.name === c.sectionName)!.length,
        stop: nextClipStop(input, l, c.trackId, c.sectionName),
        clip,
        isLast: !others.some((o) => o.offset > c.offset + PLACEMENT_EPSILON),
        bpm: input.bpm,
      });
      const r = clampTrim(clip, wanted, overhangTrimNeighbours(nb, st, edge === 'right' && option))!;
      const allow = trimAllowsOverhang(st, edge, option);
      return {
        body: { trimStart: r.trimStart, trimEnd: r.trimEnd, ...(allow ? { allowOverhang: true } : {}) },
        previewTail: trimPreviewTail(st, r, allow),
      };
    };
    const expectAccepted = async (id: string, t: ReturnType<typeof clientTrim>) => {
      const res = await trim(id, t.body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(row(id).tail).toBeCloseTo(t.previewTail, 9);
      expect(tailCut(id)).toBeCloseTo(0, 9);
    };

    it('overhanging, right edge out far past the next clip: stops at it, Intro stays 8 s', async () => {
      seedExample();
      const t = clientTrim('x', 'right', { trimStart: 2, trimEnd: 10 });
      expect(t.body.trimEnd).toBeCloseTo(8);
      await expectAccepted('x', t);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('overhanging, right edge in (with and without Option)', async () => {
      seedExample();
      await expectAccepted('x', clientTrim('x', 'right', { trimStart: 2, trimEnd: 5.5 }, true));
      expect(sectionLength('Intro')).toBeCloseTo(8);
      await expectAccepted('x', clientTrim('x', 'right', { trimStart: 2, trimEnd: 3 }));
    });

    it('overhanging, left edge far in: keeps 0.5 s inside', async () => {
      seedExample();
      const t = clientTrim('x', 'left', { trimStart: 6.9, trimEnd: 7 });
      await expectAccepted('x', t);
      expect(row('x').offset).toBeCloseTo(7.5);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('an already cut clip: extending is held at its current end, left trims and shortening pass', async () => {
      add('x', { section: 'Intro', offset: 5, duration: 10, trimStart: 2, trimEnd: 7, tail: 2 });
      add('n', { section: 'Verse', offset: 1, duration: 1 }); // drawn at 9: X is cut by 1 s
      expect(tailCut('x')).toBeCloseTo(1);
      const out = clientTrim('x', 'right', { trimStart: 2, trimEnd: 9 });
      expect(out.body.trimEnd).toBeCloseTo(7);
      expect((await trim('x', out.body)).status).toBe(200);
      expect((await trim('x', clientTrim('x', 'left', { trimStart: 3, trimEnd: 7 }).body)).status).toBe(200);
      expect((await trim('x', clientTrim('x', 'right', { trimStart: 3, trimEnd: 6 }).body)).status).toBe(200);
      expect(tailCut('x')).toBeCloseTo(0);
    });

    it('Option on a normal last clip with room: hangs over up to the next clip, Intro stays 8 s', async () => {
      add('y', { section: 'Intro', offset: 2, duration: 10, trimStart: 0, trimEnd: 6 });
      add('n', { section: 'Verse', offset: 3, duration: 1 });
      const t = clientTrim('y', 'right', { trimStart: 0, trimEnd: null }, true);
      expect(t.body).toMatchObject({ allowOverhang: true });
      expect(t.body.trimEnd).toBeCloseTo(9);
      await expectAccepted('y', t);
      expect(row('y').tail).toBeCloseTo(3);
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('Option with no room: the wall, tail 0, accepted', async () => {
      add('y', { section: 'Intro', offset: 2, duration: 10, trimStart: 0, trimEnd: 6 });
      add('n', { section: 'Verse', offset: 0, duration: 1 }); // on the downbeat
      const t = clientTrim('y', 'right', { trimStart: 0, trimEnd: null }, true);
      expect(t.body.trimEnd).toBeCloseTo(6);
      await expectAccepted('y', t);
      expect(row('y').tail).toBe(0);
    });

    it('Option on a clip that is not last sends no flag and is accepted', async () => {
      add('a', { section: 'Intro', offset: 0, duration: 10, trimStart: 0, trimEnd: 2 });
      add('b', { section: 'Intro', offset: 4, duration: 4 });
      const t = clientTrim('a', 'right', { trimStart: 0, trimEnd: 8 }, true);
      expect(t.body).not.toHaveProperty('allowOverhang');
      expect(t.body.trimEnd).toBeCloseTo(4);
      await expectAccepted('a', t);
    });

    it('Reset Trim and Detect Trim → Apply on an overhanging clip (no flag)', async () => {
      seedExample();
      await expectAccepted('x', clientTrim('x', 'right', { trimStart: 0, trimEnd: null }));
      expect(sectionLength('Intro')).toBeCloseTo(8);
      raw.exec('DELETE FROM timeline_clips;');
      seedExample();
      await expectAccepted('x', clientTrim('x', 'left', { trimStart: 5.5, trimEnd: 6.8 }));
      expect(sectionLength('Intro')).toBeCloseTo(8);
    });

    it('Reset Trim on a cut clip', async () => {
      add('x', { section: 'Intro', offset: 5, duration: 10, trimStart: 2, trimEnd: 7, tail: 2 });
      add('n', { section: 'Verse', offset: 1, duration: 1 });
      expect((await trim('x', clientTrim('x', 'right', { trimStart: 0, trimEnd: null }).body)).status).toBe(200);
    });

    it('a normal clip with a hidden tail: previewed and stored as 0', async () => {
      add('y', { section: 'Intro', offset: 0, duration: 10, trimStart: 0, trimEnd: 4, tail: 1 });
      add('z', { track: 'bass', section: 'Intro', offset: 0, duration: 8 }); // Intro 8 s
      await expectAccepted('y', clientTrim('y', 'right', { trimStart: 0, trimEnd: 6 }));
      expect(row('y').tail).toBe(0);
    });
  });
});
