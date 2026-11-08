// POST /api/tracks/:trackId/clips with `pushed` (a gap drop saving the new clip and the
// clips it pushes in one transaction), through the real route over HTTP with a stub
// session. Runs against a throwaway SQLite file with patchbay.db's schema only (no
// data; patchbay.db is opened read-only), as timelinePickups.test.ts does. Skipped when
// there is no local patchbay.db to copy the schema from.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createServer, type Server } from 'http';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SOURCE = path.resolve(import.meta.dirname, '..', 'patchbay.db');

describe.skipIf(!fs.existsSync(SOURCE))('POST timeline clip with pushed clips', () => {
  let tmpDir: string;
  let store: typeof import('./storage');
  let raw: Database.Database;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbay-pushes-'));
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
    store = await import('./storage');
    raw = (await import('./db')).sqlite;
    const { registerRoutes } = await import('./routes');

    const now = new Date().toISOString();
    raw.prepare("INSERT INTO bands (id, name, created_at) VALUES ('b1', 'Band', ?), ('b2', 'Other', ?)").run(now, now);
    raw.prepare("INSERT INTO users (id, username, password, band_id) VALUES ('u1', 'tester', 'x', 'b1')").run();
    // s1 at 120 bpm 4/4 (a bar is 2 s); s2 belongs to the same band, for a clip on
    // another song.
    for (const id of ['s1', 's2']) {
      raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, band_id, time_signature) VALUES (?, ?, 120, '[]', 'song', ?, ?, 'b1', '4/4')").run(id, id, now, now);
    }
    for (const [id, song, name, order] of [['drums', 's1', 'Drums', 0], ['bass', 's1', 'Bass', 1], ['other', 's2', 'Other', 0]] as const) {
      raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES (?, ?, ?, 'instrument', ?)").run(id, song, name, order);
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
  // Intro is 8 s. Verse at 8: drums v 0–1 and a pickup pk at −1. A drums full take ft.
  // Chorus has a song_sections row and no clips. s2's track holds o.
  beforeEach(() => {
    const now = new Date().toISOString();
    raw.exec('DELETE FROM timeline_clips; DELETE FROM activity_log; DELETE FROM song_sections;');
    for (const [name, order] of [['Intro', 0], ['Verse', 1], ['Chorus', 2]] as const) {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`sec-${name}`, 's1', name, order, now);
    }
    const add = (id: string, track: string, section: string | null, offset: number | null, duration: number, start = 0, fullTake = 0) =>
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, start, duration, section_name, section_offset, is_full_take) VALUES (?, ?, ?, 'audio', 'x', ?, ?, ?, ?, ?)")
        .run(id, track, id, start, duration, section, offset, fullTake);
    add('a', 'drums', 'Intro', 0, 1);
    add('b', 'drums', 'Intro', 1, 1, 99);
    add('c', 'drums', 'Intro', 3, 1, 99);
    add('x', 'bass', 'Intro', 0, 8);
    add('v', 'drums', 'Verse', 0, 1, 8);
    add('pk', 'drums', 'Verse', -1, 0.5, 7);
    add('ft', 'drums', 'Intro', null, 20, 0, 1);
    add('o', 'other', 'Intro', 0, 1);
  });

  const post = async (body: Record<string, unknown>, trackId = 'drums') => {
    const res = await fetch(`${base}/api/tracks/${trackId}/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const newClip = (id: string, sectionName: string, sectionOffset: number | undefined, duration: number) => ({
    id, name: id, type: 'audio', color: 'x', duration, start: 99, sectionName,
    ...(sectionOffset === undefined ? {} : { sectionOffset }),
  });
  const row = (id: string) =>
    raw.prepare('SELECT section_offset AS offset, start FROM timeline_clips WHERE id = ?').get(id) as { offset: number; start: number } | undefined;
  const feedRows = async () => {
    await new Promise((r) => setTimeout(r, 20)); // logActivity isn't awaited by the route
    return raw.prepare('SELECT type FROM activity_log').all() as { type: string }[];
  };
  const unchanged = () => {
    expect(row('b')).toEqual({ offset: 1, start: 99 });
    expect(row('c')).toEqual({ offset: 3, start: 99 });
  };

  it('saves the new clip and the clips it pushes, refreshes their start caches, one feed row', async () => {
    // n (1.5 s) at 1: b 1 → 2.5, c 3 → 4.5.
    const res = await post({ ...newClip('n', 'Intro', 1, 1.5), pushed: [{ id: 'b', sectionOffset: 2.5 }, { id: 'c', sectionOffset: 4.5 }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'n', sectionOffset: 1, start: 1 });
    expect(row('n')).toEqual({ offset: 1, start: 1 });
    expect(row('b')).toEqual({ offset: 2.5, start: 2.5 });
    expect(row('c')).toEqual({ offset: 4.5, start: 4.5 });
    expect(await feedRows()).toEqual([{ type: 'clip-added-to-timeline' }]);
  });

  it('pushes into a later section get start caches from that section', async () => {
    const res = await post({ ...newClip('n', 'Verse', 0, 1), pushed: [{ id: 'v', sectionOffset: 1 }] });
    expect(res.status).toBe(201);
    expect(row('n')).toEqual({ offset: 0, start: 8 });
    expect(row('v')).toEqual({ offset: 1, start: 9 });
  });

  it('refuses an overlap with 409 and writes nothing', async () => {
    // b pushed only to 2: n (1–2.5) still runs over it.
    const res = await post({ ...newClip('n', 'Intro', 1, 1.5), pushed: [{ id: 'b', sectionOffset: 2 }, { id: 'c', sectionOffset: 4.5 }] });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Clips would overlap on Drums › Intro.');
    expect(row('n')).toBeUndefined();
    unchanged();
    expect(await feedRows()).toEqual([]);
  });

  it('400 for a malformed pushed list or new clip offset', async () => {
    const cases: Record<string, unknown>[] = [
      { ...newClip('n', 'Intro', 5, 1), pushed: [{ id: 'b', sectionOffset: 0.5 }] },                                   // moves earlier
      { ...newClip('n', 'Intro', 5, 1), pushed: [{ id: 'c', sectionOffset: 6 }, { id: 'c', sectionOffset: 7 }] },      // duplicate id
      { ...newClip('n', 'Intro', 5, 1), pushed: [{ id: 'c', sectionOffset: null }] },                                  // NaN/Infinity arrive as null
      { ...newClip('n', 'Intro', 5, 1), pushed: [{ id: 'c', sectionOffset: '6' }] },
      { ...newClip('n', 'Intro', 5, 1), pushed: [{ sectionOffset: 6 }] },                                              // no id
      { ...newClip('n', 'Intro', 5, 1), pushed: { id: 'c', sectionOffset: 6 } },                                       // not an array
      { ...newClip('n', 'Intro', undefined, 1), pushed: [] },                                                          // no new-clip offset
      { ...newClip('n', 'Intro', -0.5, 1), pushed: [] },                                                               // new clip a pickup
      { ...newClip('n', 'Verse', 2, 1), pushed: [{ id: 'pk', sectionOffset: 3 }] },                                    // pushes a pickup
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(row('n')).toBeUndefined();
    unchanged();
    expect(row('pk')).toEqual({ offset: -1, start: 7 });
  });

  it('refuses pushed clips that are not on this track in this section', async () => {
    const cases: [string, number][] = [
      ['x', 400],       // another track
      ['v', 400],       // this track, another section
      ['ft', 400],      // a legacy full take
      ['nope', 404],    // unknown id
      ['o', 404],       // a clip on another song
    ];
    for (const [id, status] of cases) {
      const res = await post({ ...newClip('n', 'Intro', 5, 1), pushed: [{ id, sectionOffset: 10 }] });
      expect(res.status, id).toBe(status);
    }
    expect(row('n')).toBeUndefined();
    expect(row('x')!.offset).toBe(0);
    expect(row('v')!.offset).toBe(0);
    expect(row('o')!.offset).toBe(0);
  });

  it('an empty pushed list into a free spot saves the clip', async () => {
    const res = await post({ ...newClip('n', 'Intro', 2, 1), pushed: [] });
    expect(res.status).toBe(201);
    expect(row('n')).toEqual({ offset: 2, start: 2 });
    unchanged();
    expect(await feedRows()).toEqual([{ type: 'clip-added-to-timeline' }]);
  });

  it('an empty pushed list that would overlap is refused with 409', async () => {
    const res = await post({ ...newClip('n', 'Intro', 1.5, 1), pushed: [] });
    expect(res.status).toBe(409);
    expect(row('n')).toBeUndefined();
  });

  it('without pushed, nothing is checked for overlap (the current gap-zone path)', async () => {
    const res = await post(newClip('n', 'Intro', 1.5, 1));
    expect(res.status).toBe(201);
    expect(res.body.start).toBe(99); // a sent offset keeps the sent start, as before
    expect(row('n')).toEqual({ offset: 1.5, start: 99 });
    unchanged();
    expect(await feedRows()).toEqual([{ type: 'clip-added-to-timeline' }]);
  });

  it("a section's first clip with pushed: [] places the section by the hint", async () => {
    const res = await post({ ...newClip('n', 'Chorus', 0, 1), pushed: [], placement: { before: 'Verse', after: 'Intro' } });
    expect(res.status).toBe(201);
    const order = raw.prepare("SELECT section_name AS name FROM song_sections WHERE song_id = 's1' ORDER BY sort_order").all();
    expect(order).toEqual([{ name: 'Intro' }, { name: 'Chorus' }, { name: 'Verse' }]);
    expect(row('n')).toEqual({ offset: 0, start: 8 });
    expect(row('v')!.start).toBe(8); // its cache is only refreshed when it's pushed
  });

  it('setTimelineClipOffsets still rolls the whole batch back on an overlap', () => {
    expect(() => store.setTimelineClipOffsets('s1', [{ id: 'c', sectionOffset: 6 }, { id: 'b', sectionOffset: 0.5 }]))
      .toThrow(store.TimelineOverlapError);
    unchanged();
    store.setTimelineClipOffsets('s1', [{ id: 'c', sectionOffset: 6 }]);
    expect(row('c')!.offset).toBe(6);
  });
});
