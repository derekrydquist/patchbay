// POST /api/loose-files/:id/place-on-timeline with a drop position (sectionOffset,
// pushed, a client id) and without one (append), through the real route over HTTP with
// a stub session. Runs against a throwaway SQLite file with patchbay.db's schema only
// (no data; patchbay.db is opened read-only), as timelineClipPushes.test.ts does.
// Skipped when there is no local patchbay.db to copy the schema from.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createServer, type Server } from 'http';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SOURCE = path.resolve(import.meta.dirname, '..', 'patchbay.db');

describe.skipIf(!fs.existsSync(SOURCE))('place a loose file on the timeline at a position', () => {
  let tmpDir: string;
  let raw: Database.Database;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbay-loose-place-'));
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

    const now = new Date().toISOString();
    raw.prepare("INSERT INTO bands (id, name, created_at) VALUES ('b1', 'Band', ?)").run(now);
    raw.prepare("INSERT INTO users (id, username, password, band_id) VALUES ('u1', 'tester', 'x', 'b1')").run();
    // s1 at 120 bpm 4/4 (a bar is 2 s); s2 belongs to the same band, for a clip on
    // another song.
    for (const id of ['s1', 's2']) {
      raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, band_id, time_signature) VALUES (?, ?, 120, '[]', 'song', ?, ?, 'b1', '4/4')").run(id, id, now, now);
    }
    for (const [id, song, name, order] of [['drums', 's1', 'Drums', 0], ['bass', 's1', 'Bass', 1], ['other', 's2', 'Other', 0]] as const) {
      raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES (?, ?, ?, 'instrument', ?)").run(id, song, name, order);
    }
    for (const track of ['drums', 'bass']) {
      ['Intro', 'Verse', 'Chorus'].forEach((section, i) => {
        raw.prepare('INSERT INTO ideas (id, track_id, name, section_name, sort_order) VALUES (?, ?, ?, ?, ?)').run(`idea-${track}-${section}`, track, section, section, i);
      });
    }

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

  // Intro: drums a 0–1, b 1–2, c 3–4 (b and c with a stale start cache); bass x 0–8, so
  // Intro is 8 s. Verse at 8: drums v 0–1 and a pickup pk at −1. Chorus has a
  // song_sections row and no clips. s2's track holds o. Loose file lf (1 s) on s1.
  beforeEach(() => {
    const now = new Date().toISOString();
    raw.exec('DELETE FROM timeline_clips; DELETE FROM clips; DELETE FROM loose_files; DELETE FROM activity_log; DELETE FROM song_sections;');
    for (const [name, order] of [['Intro', 0], ['Verse', 1], ['Chorus', 2]] as const) {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`sec-${name}`, 's1', name, order, now);
    }
    const add = (id: string, track: string, section: string, offset: number, duration: number, start = 0) =>
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, start, duration, section_name, section_offset, is_full_take) VALUES (?, ?, ?, 'audio', 'x', ?, ?, ?, ?, 0)")
        .run(id, track, id, start, duration, section, offset);
    add('a', 'drums', 'Intro', 0, 1);
    add('b', 'drums', 'Intro', 1, 1, 99);
    add('c', 'drums', 'Intro', 3, 1, 99);
    add('x', 'bass', 'Intro', 0, 8);
    add('v', 'drums', 'Verse', 0, 1, 8);
    add('pk', 'drums', 'Verse', -1, 0.5, 7);
    add('o', 'other', 'Intro', 0, 1);
    raw.prepare("INSERT INTO loose_files (id, song_id, name, type, color, duration, src, created_at) VALUES ('lf', 's1', 'kick.wav', 'audio', 'x', 1, '/uploads/kick.wav', ?)").run(now);
  });

  const place = async (body: Record<string, unknown>) => {
    const res = await fetch(`${base}/api/loose-files/lf/place-on-timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: 'drums', ...body }),
    });
    return { status: res.status, body: await res.json() };
  };
  const row = (id: string) =>
    raw.prepare('SELECT section_offset AS offset, start FROM timeline_clips WHERE id = ?').get(id) as { offset: number; start: number } | undefined;
  const placed = () =>
    raw.prepare("SELECT id, section_offset AS offset, start FROM timeline_clips WHERE bucket_clip_id = 'lf'").all() as { id: string; offset: number; start: number }[];
  const feedRows = async () => {
    await new Promise((r) => setTimeout(r, 20)); // logActivity isn't awaited by the route
    return raw.prepare('SELECT type FROM activity_log').all() as { type: string }[];
  };
  // Nothing written: the file is still loose, no version, no timeline clip, no feed
  // row, b and c where they were, the arrangement unchanged.
  const nothingWritten = async () => {
    expect(raw.prepare("SELECT id FROM loose_files WHERE id = 'lf'").get()).toEqual({ id: 'lf' });
    expect(raw.prepare("SELECT id FROM clips WHERE id = 'lf'").get()).toBeUndefined();
    expect(placed()).toEqual([]);
    expect(row('b')).toEqual({ offset: 1, start: 99 });
    expect(row('c')).toEqual({ offset: 3, start: 99 });
    expect(row('pk')).toEqual({ offset: -1, start: 7 });
    const order = raw.prepare("SELECT section_name AS name FROM song_sections WHERE song_id = 's1' ORDER BY sort_order").all();
    expect(order).toEqual([{ name: 'Intro' }, { name: 'Verse' }, { name: 'Chorus' }]);
    expect(await feedRows()).toEqual([]);
  };
  const landed = async () => {
    expect(raw.prepare("SELECT id FROM loose_files WHERE id = 'lf'").get()).toBeUndefined();
    expect(raw.prepare("SELECT name, idea_id AS ideaId FROM clips WHERE id = 'lf'").get())
      .toEqual({ name: 'Drums Intro V1', ideaId: 'idea-drums-Intro' });
    expect(await feedRows()).toEqual([{ type: 'loose-file-placed' }]);
  };

  it('with no sectionOffset, appends after the furthest clip end, as before', async () => {
    const res = await place({ sectionName: 'Intro' });
    expect(res.status).toBe(201);
    expect(res.body.timelineClip).toMatchObject({ sectionOffset: 4, start: 4, bucketClipId: 'lf' });
    expect(placed()).toEqual([{ id: res.body.timelineClip.id, offset: 4, start: 4 }]);
    await landed();
  });

  it('a sectionOffset into a free spot lands there, its start cache from the layout', async () => {
    const res = await place({ sectionName: 'Intro', sectionOffset: 2 });
    expect(res.status).toBe(201);
    expect(res.body.timelineClip).toMatchObject({ sectionOffset: 2, start: 2 });
    expect(placed()).toEqual([{ id: res.body.timelineClip.id, offset: 2, start: 2 }]);
    expect(row('b')).toEqual({ offset: 1, start: 99 });
    await landed();
  });

  it('a sectionOffset with pushes saves the clip and the pushes, refreshing their start caches', async () => {
    // lf (1 s) at 1: b 1 → 2, c 3 → 4.
    const res = await place({ sectionName: 'Intro', sectionOffset: 1, pushed: [{ id: 'b', sectionOffset: 2 }, { id: 'c', sectionOffset: 4 }] });
    expect(res.status).toBe(201);
    expect(placed()).toEqual([{ id: res.body.timelineClip.id, offset: 1, start: 1 }]);
    expect(row('b')).toEqual({ offset: 2, start: 2 });
    expect(row('c')).toEqual({ offset: 4, start: 4 });
    await landed(); // one feed row: the pushes add none
  });

  it('an overlap is refused with 409, rolled back: the file is still loose', async () => {
    const res = await place({ sectionName: 'Intro', sectionOffset: 1.5 });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Clips would overlap on Drums › Intro.');
    await nothingWritten();
    // With pushes that don't make room (b pushed only to 2.2): the same.
    const pushedRes = await place({ sectionName: 'Intro', sectionOffset: 1.5, pushed: [{ id: 'b', sectionOffset: 2.2 }] });
    expect(pushedRes.status).toBe(409);
    await nothingWritten();
  });

  it('a sectionOffset in a section not on the timeline is refused with 409', async () => {
    const res = await place({ sectionName: 'Chorus', sectionOffset: 0 });
    expect(res.status).toBe(409);
    await nothingWritten();
  });

  it('400 for pushed without a sectionOffset, a negative or non-numeric offset, a pickup pushed, a push moving earlier, a bad id', async () => {
    const cases: Record<string, unknown>[] = [
      { sectionName: 'Intro', pushed: [] },
      { sectionName: 'Intro', pushed: [{ id: 'c', sectionOffset: 5 }] },
      { sectionName: 'Intro', sectionOffset: -0.5 },
      { sectionName: 'Intro', sectionOffset: '2' },
      { sectionName: 'Intro', sectionOffset: null },                                   // NaN/Infinity arrive as null
      { sectionName: 'Verse', sectionOffset: 2, pushed: [{ id: 'pk', sectionOffset: 3 }] },
      { sectionName: 'Intro', sectionOffset: 5, pushed: [{ id: 'b', sectionOffset: 0.5 }] },
      { sectionName: 'Intro', sectionOffset: 5, pushed: [{ id: 'c', sectionOffset: 6 }, { id: 'c', sectionOffset: 7 }] },
      { sectionName: 'Intro', sectionOffset: 5, pushed: [{ id: 'x', sectionOffset: 10 }] }, // another track
      { sectionName: 'Intro', sectionOffset: 2, id: '' },
    ];
    for (const body of cases) {
      const res = await place(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    await nothingWritten();
  });

  it("404 for another song's clip or an unknown id in pushed", async () => {
    for (const id of ['o', 'nope']) {
      const res = await place({ sectionName: 'Intro', sectionOffset: 5, pushed: [{ id, sectionOffset: 10 }] });
      expect(res.status, id).toBe(404);
    }
    expect(row('o')!.offset).toBe(0);
    await nothingWritten();
  });

  it('uses a client-supplied id for the new timeline clip', async () => {
    const res = await place({ sectionName: 'Intro', sectionOffset: 2, id: 'preview-1' });
    expect(res.status).toBe(201);
    expect(res.body.timelineClip.id).toBe('preview-1');
    expect(row('preview-1')).toEqual({ offset: 2, start: 2 });
  });
});
