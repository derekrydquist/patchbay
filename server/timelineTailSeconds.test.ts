// timeline_clips.tail_seconds. Step 4h1: the column exists with default 0, and no
// create path takes a tail from the client — POST /api/tracks/:trackId/clips (append,
// at an offset, with pushes, a legacy full take) and POST /api/loose-files/:id/place-
// on-timeline (append and at a position) all store 0 even when the body sends one, and
// PATCH /api/timeline-clips/:id ignores it. Step 4h2a: PUT /api/songs/:songId/
// timeline-clips/offsets saves a sent tail and checks it (decisions 2–3), the single
// PATCH and pushes keep the stored tail and can't grow a tail cut. Runs the real routes over HTTP with a stub
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

describe.skipIf(!fs.existsSync(SOURCE))('timeline_clips.tail_seconds', () => {
  let tmpDir: string;
  let raw: Database.Database;
  let server: Server;
  let base: string;
  let store: typeof import('./storage');

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
    store = await import('./storage');

    const now = new Date().toISOString();
    raw.prepare("INSERT INTO bands (id, name, created_at) VALUES ('b1', 'Band', ?)").run(now);
    raw.prepare("INSERT INTO users (id, username, password, band_id) VALUES ('u1', 'tester', 'x', 'b1')").run();
    raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, band_id, time_signature) VALUES ('s1', 's1', 120, '[]', 'song', ?, ?, 'b1', '4/4')").run(now, now);
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('drums', 's1', 'Drums', 'instrument', 0)").run();
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('bass', 's1', 'Bass', 'instrument', 1)").run();
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
    for (const [name, order] of [['Intro', 0], ['Verse', 1], ['Chorus', 2]] as const) {
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

  // ── 4h2a: the batch route saves and checks tails ────────────────────────────
  // 120 bpm 4/4: a beat is 0.5 s. Each case replaces every timeline clip with its own.
  type Seed = { id: string; track?: string; section: string; offset: number; duration: number; tail?: number; fullTake?: boolean };
  const seed = (rows: Seed[]) => {
    raw.exec('DELETE FROM timeline_clips;');
    for (const r of rows) {
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, start, duration, section_name, section_offset, is_full_take, tail_seconds) VALUES (?, ?, ?, 'audio', 'x', 0, ?, ?, ?, ?, ?)")
        .run(r.id, r.track ?? 'drums', r.id, r.duration, r.section, r.offset, r.fullTake ? 1 : 0, r.tail ?? 0);
    }
  };
  const offsetOf = (id: string) =>
    (raw.prepare('SELECT section_offset AS o FROM timeline_clips WHERE id = ?').get(id) as { o: number }).o;
  const cutOf = (id: string) => store.computeSongLayout('s1').clipTailCuts.get(id) ?? 0;
  const putOffsets = (clips: Record<string, unknown>[]) => send('PUT', '/api/songs/s1/timeline-clips/offsets', { clips });

  it('a sent tail is saved; an omitted tail keeps the stored one', async () => {
    // a 0–1, b 2–3; b is last on Drums in Intro.
    const saved = await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 0.5 }]);
    expect(saved.status).toBe(200);
    expect(saved.body[0].tailSeconds).toBe(0.5);
    expect(tail('b')).toBe(0.5);
    // Intro now needs 2.5 s; b hangs 0.5 s past its end with nothing after it: no cut.
    const layout = store.computeSongLayout('s1');
    expect(layout.sections[0].end).toBeCloseTo(2.5);
    expect(layout.clipTailCuts.get('b')).toBe(0);
    const kept = await putOffsets([{ id: 'b', sectionOffset: 2.5 }]);
    expect(kept.status).toBe(200);
    expect(tail('b')).toBe(0.5);
    expect(offsetOf('b')).toBe(2.5);
    // Sending 0 clears it.
    expect((await putOffsets([{ id: 'b', sectionOffset: 2.5, tailSeconds: 0 }])).status).toBe(200);
    expect(tail('b')).toBe(0);
  });

  it('refuses (400) a sent tail that is not a finite number, or is negative', async () => {
    for (const bad of [null, 'x', -0.5, {}]) {
      const res = await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: bad }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/tailSeconds/);
    }
    expect(tail('b')).toBe(0);
  });

  it('refuses (400) a sent tail at or past the trimmed length', async () => {
    expect((await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 1 }])).status).toBe(400);
    expect((await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 2 }])).status).toBe(400);
    // Trimmed: b plays 0.2–0.8 (0.6 s), so 0.6 is refused and 0.5 is fine.
    raw.prepare("UPDATE timeline_clips SET trim_start = 0.2, trim_end = 0.8 WHERE id = 'b'").run();
    const res = await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 0.6 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/shorter than the clip/);
    expect((await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 0.5 }])).status).toBe(200);
    expect(tail('b')).toBe(0.5);
  });

  it('refuses (400) a sent tail > 0 on a clip that is not the last on its track in its section', async () => {
    const res = await putOffsets([{ id: 'a', sectionOffset: 0, tailSeconds: 0.5 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/last clip/);
    expect(tail('a')).toBe(0);
    // 0 is fine on any clip.
    expect((await putOffsets([{ id: 'a', sectionOffset: 0, tailSeconds: 0 }])).status).toBe(200);
  });

  it('"last" is judged after the batch: a clip pushed past the old last one may get a tail', async () => {
    // a moves to 4 (after b at 2) and takes a tail in the same request.
    const res = await putOffsets([{ id: 'a', sectionOffset: 4, tailSeconds: 0.5 }]);
    expect(res.status).toBe(200);
    expect(tail('a')).toBe(0.5);
  });

  it('a non-last clip keeps a hidden stored tail it does not send', async () => {
    seed([
      { id: 'a', section: 'Intro', offset: 0, duration: 1, tail: 0.5 },
      { id: 'b', section: 'Intro', offset: 2, duration: 1 },
    ]);
    const res = await putOffsets([{ id: 'a', sectionOffset: 0.5 }]);
    expect(res.status).toBe(200);
    expect(tail('a')).toBe(0.5);
  });

  it('refuses (400) any sent tail on a legacy full take', async () => {
    seed([
      { id: 'a', section: 'Intro', offset: 0, duration: 1 },
      { id: 'ft', section: 'Full Take', offset: 0, duration: 4, fullTake: true },
    ]);
    const res = await putOffsets([{ id: 'ft', sectionOffset: 0, tailSeconds: 0.5 }]);
    expect(res.status).toBe(400);
    expect(tail('ft')).toBe(0);
    // Storage refuses it too, should a caller skip the route's check.
    expect(() => store.setTimelineClipOffsets('s1', [{ id: 'ft', sectionOffset: 0, tailSeconds: 0.5 }])).toThrow(/in a section/);
    expect(tail('ft')).toBe(0);
  });

  it("refuses a tail that would run past the next clip on its track; allows one ending exactly at it", async () => {
    // Intro: b 2–3. Verse: v at 0.5. With a 0.5 s tail Intro ends at 2.5, v is drawn at
    // 3.0 and b ends at 3.0 — exactly at it: no cut.
    seed([
      { id: 'b', section: 'Intro', offset: 2, duration: 1 },
      { id: 'v', section: 'Verse', offset: 0.5, duration: 1 },
    ]);
    expect((await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 0.5 }])).status).toBe(200);
    expect(cutOf('b')).toBe(0);
    // v at 0 instead: drawn at 2.5, so the same tail would be cut by 0.5 — refused.
    raw.prepare("UPDATE timeline_clips SET tail_seconds = 0 WHERE id = 'b'").run();
    raw.prepare("UPDATE timeline_clips SET section_offset = 0 WHERE id = 'v'").run();
    const res = await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 0.5 }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/next clip/);
    expect(tail('b')).toBe(0);
  });

  it("allows a tail ending exactly at a next-section pickup's drawn start; refuses one past it", async () => {
    // Intro: b at 2, 4 s (ends at 6). Verse holds only Bass, 4 s. Chorus: a Drums pickup
    // at −1. With a 3 s tail Intro needs 3 s: Verse 3–7, Chorus at 7, the pickup drawn
    // at 6 (the tail never cuts it), and b ends exactly there.
    seed([
      { id: 'b', section: 'Intro', offset: 2, duration: 4 },
      { id: 'bv', track: 'bass', section: 'Verse', offset: 0, duration: 4 },
      { id: 'p', section: 'Chorus', offset: -1, duration: 2 },
    ]);
    expect((await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 3 }])).status).toBe(200);
    const layout = store.computeSongLayout('s1');
    expect(layout.clipStarts.get('p')).toBeCloseTo(6);
    expect(layout.clipHeadCuts.get('p')).toBe(0);
    expect(layout.clipTailCuts.get('b')).toBe(0);
    // 3.5 s: Intro ends at 2.5, the pickup is drawn at 5.5, b would be cut by 0.5.
    const res = await putOffsets([{ id: 'b', sectionOffset: 2, tailSeconds: 3.5 }]);
    expect(res.status).toBe(400);
    expect(tail('b')).toBe(3);
  });

  // Leniency. Bass fills Intro to 4. Drums: b at 1, 4 s with a stored 2 s tail (ends
  // at 5), v at Verse 0 (drawn at 4): b is already cut by 1.
  const seedCut = () => seed([
    { id: 'bi', track: 'bass', section: 'Intro', offset: 0, duration: 4 },
    { id: 'b', section: 'Intro', offset: 1, duration: 4, tail: 2 },
    { id: 'v', section: 'Verse', offset: 0, duration: 1 },
  ]);

  it('leniency: an already-cut clip sending its tail can stay or move left, but not move right', async () => {
    seedCut();
    expect(cutOf('b')).toBeCloseTo(1);
    expect((await putOffsets([{ id: 'b', sectionOffset: 1, tailSeconds: 2 }])).status).toBe(200);
    expect((await putOffsets([{ id: 'b', sectionOffset: 0.5, tailSeconds: 2 }])).status).toBe(200);
    expect(cutOf('b')).toBeCloseTo(0.5);
    // Back to 1 from 0.5 grows the cut again (0.5 → 1): refused.
    const res = await putOffsets([{ id: 'b', sectionOffset: 1, tailSeconds: 2 }]);
    expect(res.status).toBe(400);
    expect(offsetOf('b')).toBe(0.5);
    expect(tail('b')).toBe(2);
  });

  it('a write that cuts ANOTHER clip is not refused for it', async () => {
    seedCut();
    // Moving v later shrinks b's cut; moving it back grows b's cut again. Only v is
    // written, so neither is refused.
    expect((await putOffsets([{ id: 'v', sectionOffset: 0.5 }])).status).toBe(200);
    expect(cutOf('b')).toBeCloseTo(0.5);
    // Back to 0 cuts b by 1 again — b isn't written, so that's allowed.
    expect((await putOffsets([{ id: 'v', sectionOffset: 0 }])).status).toBe(200);
    expect(cutOf('b')).toBeCloseTo(1);
  });

  it('a tail refusal rolls back the whole batch, other items included', async () => {
    seedCut();
    const res = await putOffsets([
      { id: 'v', sectionOffset: 0.25 },        // fine on its own
      { id: 'bi', sectionOffset: 0 },
      { id: 'b', sectionOffset: 1.5, tailSeconds: 2 }, // grows b's cut: refused
    ]);
    expect(res.status).toBe(400);
    expect(offsetOf('v')).toBe(0);
    expect(offsetOf('b')).toBe(1);
    // A bad sent tail on one item refuses every item, too.
    // (bi is 4 s long, so a 4 s tail is refused.)
    const res2 = await putOffsets([{ id: 'v', sectionOffset: 0.25 }, { id: 'bi', sectionOffset: 0, tailSeconds: 4 }]);
    expect(res2.status).toBe(400);
    expect(offsetOf('v')).toBe(0);
    expect(tail('bi')).toBe(0);
  });

  it('the single PATCH keeps the stored tail and cannot grow a cut', async () => {
    seedCut();
    const right = await send('PATCH', '/api/timeline-clips/b', { sectionOffset: 1.5 });
    expect(right.status).toBe(400);
    expect(right.body.message).toMatch(/next clip/);
    expect(offsetOf('b')).toBe(1);
    const left = await send('PATCH', '/api/timeline-clips/b', { sectionOffset: 0.5, tailSeconds: 0 });
    expect(left.status).toBe(200);
    expect(offsetOf('b')).toBe(0.5);
    expect(tail('b')).toBe(2); // tailSeconds isn't on the whitelist
    expect(cutOf('b')).toBeCloseTo(0.5);
  });

  it('a pushed overhanging clip (POST clips with pushed) keeps its tail and its cut does not grow', async () => {
    // No bass: b (at 1, 4 s, 2 s tail) sets Intro's end at 3; v drawn at 3; b cut by 2.
    seed([
      { id: 'b', section: 'Intro', offset: 1, duration: 4, tail: 2 },
      { id: 'v', section: 'Verse', offset: 0, duration: 1 },
    ]);
    expect(cutOf('b')).toBeCloseTo(2);
    // A 1.5 s clip at 0 pushes b to 1.5; Intro grows with it, so the cut stays 2. A
    // tailSeconds inside a pushed item is ignored.
    const res = await send('POST', '/api/tracks/drums/clips', {
      ...newClip('n', { sectionName: 'Intro', sectionOffset: 0, duration: 1.5 }),
      pushed: [{ id: 'b', sectionOffset: 1.5, tailSeconds: 0 }],
    });
    expect(res.status).toBe(201);
    expect(offsetOf('b')).toBe(1.5);
    expect(tail('b')).toBe(2);
    expect(tail('n')).toBe(0);
    expect(cutOf('b')).toBeCloseTo(2);
  });

  it('a push that grows an overhanging clip’s cut is allowed: the stored tail is kept and the layout cuts it', async () => {
    // Bass holds Intro at 4, so pushing b later runs it further into v ("cut, don't push").
    seedCut();
    const res = await send('POST', '/api/tracks/drums/clips', {
      ...newClip('n', { sectionName: 'Intro', sectionOffset: 0, duration: 1.5 }),
      pushed: [{ id: 'b', sectionOffset: 1.5 }],
    });
    expect(res.status).toBe(201);
    expect(offsetOf('b')).toBe(1.5);
    expect(tail('b')).toBe(2);
    expect(cutOf('b')).toBeCloseTo(1.5);
  });

  it('place-on-timeline pushing an overhanging clip further into the next clip is allowed too', async () => {
    seedCut();
    const res = await send('POST', '/api/loose-files/lf/place-on-timeline', {
      trackId: 'drums', sectionName: 'Intro', id: 'p1', sectionOffset: 0, pushed: [{ id: 'b', sectionOffset: 1.5 }],
    });
    expect(res.status).toBe(201);
    expect(offsetOf('b')).toBe(1.5);
    expect(tail('b')).toBe(2);
    expect(cutOf('b')).toBeCloseTo(1.5);
  });

  it('an offsets-PUT item without tailSeconds is not cut-checked: its tail is kept and the layout cuts it', async () => {
    seedCut();
    const res = await putOffsets([{ id: 'b', sectionOffset: 1.5 }]);
    expect(res.status).toBe(200);
    expect(offsetOf('b')).toBe(1.5);
    expect(tail('b')).toBe(2);
    expect(cutOf('b')).toBeCloseTo(1.5);
    // The same move sending its tail is refused (the cut would grow).
    seedCut();
    const sent = await putOffsets([{ id: 'b', sectionOffset: 1.5, tailSeconds: 2 }]);
    expect(sent.status).toBe(400);
    expect(offsetOf('b')).toBe(1);
  });
});
