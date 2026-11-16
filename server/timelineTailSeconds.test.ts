// timeline_clips.tail_seconds (step 4h1): the column exists with default 0, and no
// write path takes a tail from the client — POST /api/tracks/:trackId/clips (append,
// at an offset, with pushes, a legacy full take) and POST /api/loose-files/:id/place-
// on-timeline (append and at a position) all store 0 even when the body sends one, and
// PATCH /api/timeline-clips/:id ignores it. Runs the real routes over HTTP with a stub
// session against a throwaway SQLite file with patchbay.db's schema only (no data;
// patchbay.db is opened read-only), as loosePlacement.test.ts does. Skipped when there
// is no local patchbay.db to copy the schema from.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createServer, type Server } from 'http';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SOURCE = path.resolve(import.meta.dirname, '..', 'patchbay.db');

describe.skipIf(!fs.existsSync(SOURCE))('timeline_clips.tail_seconds is always 0 on write', () => {
  let tmpDir: string;
  let raw: Database.Database;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbay-tail-seconds-'));
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
    raw = (await import('./db')).sqlite; // runs the guarded ALTER if the schema lacks the column
    const { registerRoutes } = await import('./routes');

    const now = new Date().toISOString();
    raw.prepare("INSERT INTO bands (id, name, created_at) VALUES ('b1', 'Band', ?)").run(now);
    raw.prepare("INSERT INTO users (id, username, password, band_id) VALUES ('u1', 'tester', 'x', 'b1')").run();
    raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, band_id, time_signature) VALUES ('s1', 's1', 120, '[]', 'song', ?, ?, 'b1', '4/4')").run(now, now);
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('drums', 's1', 'Drums', 'instrument', 0)").run();
    ['Intro', 'Verse'].forEach((section, i) => {
      raw.prepare('INSERT INTO ideas (id, track_id, name, section_name, sort_order) VALUES (?, ?, ?, ?, ?)').run(`idea-drums-${section}`, 'drums', section, section, i);
    });

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

  // Intro: drums a 0–1 and b 2–3. Verse has a row and no clips. Loose file lf (1 s).
  beforeEach(() => {
    const now = new Date().toISOString();
    raw.exec('DELETE FROM timeline_clips; DELETE FROM clips; DELETE FROM loose_files; DELETE FROM activity_log; DELETE FROM song_sections;');
    for (const [name, order] of [['Intro', 0], ['Verse', 1]] as const) {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`sec-${name}`, 's1', name, order, now);
    }
    const add = (id: string, offset: number) =>
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, start, duration, section_name, section_offset, is_full_take) VALUES (?, 'drums', ?, 'audio', 'x', 0, 1, 'Intro', ?, 0)")
        .run(id, id, offset);
    add('a', 0);
    add('b', 2);
    raw.prepare("INSERT INTO loose_files (id, song_id, name, type, color, duration, src, created_at) VALUES ('lf', 's1', 'kick.wav', 'audio', 'x', 1, '/uploads/kick.wav', ?)").run(now);
  });

  const send = async (method: string, url: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const tail = (id: string) =>
    (raw.prepare('SELECT tail_seconds AS t FROM timeline_clips WHERE id = ?').get(id) as { t: number } | undefined)?.t;
  const newClip = (id: string, extra: Record<string, unknown>) => ({
    id, name: id, type: 'audio', color: 'x', duration: 1, start: 0, tailSeconds: 0.75, ...extra,
  });

  it('the column is REAL NOT NULL DEFAULT 0, and an insert without it reads 0', () => {
    const col = (raw.prepare("SELECT type, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('timeline_clips') WHERE name = 'tail_seconds'").get()) as { type: string; nn: number; dflt: string };
    expect(col).toEqual({ type: 'REAL', nn: 1, dflt: '0' });
    expect(tail('a')).toBe(0);
  });

  it('POST clips appending (no sectionOffset) stores 0', async () => {
    const res = await send('POST', '/api/tracks/drums/clips', newClip('n1', { sectionName: 'Intro' }));
    expect(res.status).toBe(201);
    expect(tail('n1')).toBe(0);
    expect(res.body.tailSeconds).toBe(0);
  });

  it('POST clips at an offset stores 0', async () => {
    const res = await send('POST', '/api/tracks/drums/clips', newClip('n2', { sectionName: 'Intro', sectionOffset: 4 }));
    expect(res.status).toBe(201);
    expect(tail('n2')).toBe(0);
  });

  it('POST clips with pushes stores 0', async () => {
    const res = await send('POST', '/api/tracks/drums/clips', {
      ...newClip('n3', { sectionName: 'Intro', sectionOffset: 1 }),
      pushed: [{ id: 'b', sectionOffset: 2 }],
    });
    expect(res.status).toBe(201);
    expect(tail('n3')).toBe(0);
  });

  it("POST clips for a section's first clip (with a placement hint) stores 0", async () => {
    const res = await send('POST', '/api/tracks/drums/clips', {
      ...newClip('n4', { sectionName: 'Verse', sectionOffset: 0 }),
      pushed: [],
      placement: { before: null, after: 'Intro' },
    });
    expect(res.status).toBe(201);
    expect(tail('n4')).toBe(0);
  });

  it('POST clips for a legacy full take stores 0', async () => {
    const res = await send('POST', '/api/tracks/drums/clips', newClip('n5', { sectionName: 'Full Take', isFullTake: true, start: 10 }));
    expect(res.status).toBe(201);
    expect(tail('n5')).toBe(0);
  });

  it('place-on-timeline appending stores 0', async () => {
    const res = await send('POST', '/api/loose-files/lf/place-on-timeline', { trackId: 'drums', sectionName: 'Intro', tailSeconds: 0.5 });
    expect(res.status).toBe(201);
    expect(res.body.timelineClip.tailSeconds).toBe(0);
    expect(tail(res.body.timelineClip.id)).toBe(0);
  });

  it('place-on-timeline at a position stores 0', async () => {
    const res = await send('POST', '/api/loose-files/lf/place-on-timeline', {
      trackId: 'drums', sectionName: 'Intro', id: 'p1', sectionOffset: 4, pushed: [], tailSeconds: 0.5,
    });
    expect(res.status).toBe(201);
    expect(tail('p1')).toBe(0);
  });

  it('PATCH timeline-clips ignores tailSeconds (not in the whitelist)', async () => {
    const res = await send('PATCH', '/api/timeline-clips/a', { tailSeconds: 0.5, name: 'renamed' });
    expect(res.status).toBe(200);
    expect(tail('a')).toBe(0);
    expect((raw.prepare("SELECT name FROM timeline_clips WHERE id = 'a'").get() as { name: string }).name).toBe('renamed');
  });
});
