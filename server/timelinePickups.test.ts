// Pickups ending before the downbeat, through the real storage write paths (batch
// offsets, trim, Replace). Runs against a throwaway SQLite file with patchbay.db's
// schema only (no data; patchbay.db is opened read-only). Skipped when there is no
// local patchbay.db to copy the schema from.
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SOURCE = path.resolve(import.meta.dirname, '..', 'patchbay.db');

describe.skipIf(!fs.existsSync(SOURCE))('timeline pickups — server', () => {
  let tmpDir: string;
  let store: typeof import('./storage');
  let raw: Database.Database;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbay-pickups-'));
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

    // 120 bpm 4/4: a beat is 0.5 s, a bar 2 s. Intro 0–8 (bass fills it; drums 0–1),
    // Verse at 8. Drums' pickup limit in Verse is the bar: −2.
    const now = new Date().toISOString();
    raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, time_signature) VALUES ('s1', 'Test', 120, '[]', 'song', ?, ?, '4/4')").run(now, now);
    for (const [id, name, order] of [['drums', 'Drums', 0], ['bass', 'Bass', 1]] as const) {
      raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES (?, 's1', ?, 'instrument', ?)").run(id, name, order);
    }
    for (const [name, order] of [['Intro', 0], ['Verse', 1]] as const) {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`sec-${name}`, 's1', name, order, now);
    }
    const addClip = (id: string, track: string, section: string, offset: number, duration: number) =>
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, duration, section_name, section_offset) VALUES (?, ?, ?, 'audio', 'x', ?, ?, ?)")
        .run(id, track, id, duration, section, offset);
    addClip('d1', 'drums', 'Intro', 0, 1);
    addClip('b1', 'bass', 'Intro', 0, 8);
    addClip('click', 'drums', 'Verse', 0, 0.5); // one beat
    addClip('fill', 'drums', 'Verse', 1, 4);
    // Keys, for pickup trims: two instances of "Keys" (Intro 0–5 of a 10 s file; Verse
    // at 0.5, trimmed from 3) and a 1 s Verse pickup at −1.5 (drawn 6.5–7.5).
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('keys', 's1', 'Keys', 'instrument', 2)").run();
    const addKeys = (id: string, name: string, section: string, offset: number, duration: number, trimStart: number, trimEnd: number | null) =>
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, duration, section_name, section_offset, trim_start, trim_end) VALUES (?, 'keys', ?, 'audio', 'x', ?, ?, ?, ?, ?)")
        .run(id, name, duration, section, offset, trimStart, trimEnd);
    addKeys('ki', 'Keys', 'Intro', 0, 10, 0, 5);
    addKeys('kv', 'Keys', 'Verse', 0.5, 10, 3, null);
    addKeys('kp', 'Keys pickup', 'Verse', -1.5, 1, 0, null);
  });

  afterAll(() => {
    raw?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const offsetOf = (id: string) =>
    (raw.prepare('SELECT section_offset AS o FROM timeline_clips WHERE id = ?').get(id) as { o: number }).o;

  it('the batch route accepts a pickup ending before the downbeat', () => {
    // The one-beat click at −1.5 (beat 2 of the bar before): ends at −1.
    store.setTimelineClipOffsets('s1', [{ id: 'click', sectionOffset: -1.5 }]);
    expect(offsetOf('click')).toBeCloseTo(-1.5);
    // The very start of the bar before.
    store.setTimelineClipOffsets('s1', [{ id: 'click', sectionOffset: -2 }]);
    expect(offsetOf('click')).toBeCloseTo(-2);
    // Past the limit is still refused, and nothing is written.
    expect(() => store.setTimelineClipOffsets('s1', [{ id: 'click', sectionOffset: -2.5 }])).toThrow(/one bar/);
    expect(offsetOf('click')).toBeCloseTo(-2);
  });

  it('a right trim on a pickup can pull its end before the downbeat, down to 0.5 s', () => {
    // The fill becomes a pickup at −1.5 (4 s, ends at 2.5).
    store.setTimelineClipOffsets('s1', [{ id: 'click', sectionOffset: -2 }, { id: 'fill', sectionOffset: -1.5 }]);
    const trimmed = store.writeTimelineClipTrim('fill', 0, 1)!; // 1 s: ends at −0.5
    expect(trimmed.sectionOffset).toBeCloseTo(-1.5);
    expect(trimmed.trimEnd).toBeCloseTo(1);
    const min = store.writeTimelineClipTrim('fill', 0, 0.5)!; // the minimum: ends at −1
    expect(min.trimEnd).toBeCloseTo(0.5);
    expect(() => store.writeTimelineClipTrim('fill', 0, 0.4)).toThrow(/shorter than 0.5/);
  });

  it('apply trim to all instances never creates a pickup and stops at the next pickup', () => {
    const result = store.applyTrimToInstances('keys', 'Keys', 0, null);
    const ki = result.find((r) => r.id === 'ki')!;
    const kv = result.find((r) => r.id === 'kv')!;
    // Intro instance: its right edge stops where the Verse pickup is drawn, 6.5.
    expect(ki).toMatchObject({ trimStart: 0, clamped: true, skipped: false });
    expect(ki.trimEnd).toBeCloseTo(6.5);
    // Verse instance: its left edge stops at the downbeat (trimStart 2.5, offset 0).
    expect(kv.sectionOffset).toBeCloseTo(0);
    expect(kv.trimStart).toBeCloseTo(2.5);
    expect(kv.clamped).toBe(true);
  });

  it('a trim may make a normal clip a pickup (Option is a client rule), down to its left limit', () => {
    // kv at 0 (trimStart 2.5) → trimStart 2.2 moves its start to −0.3: a pickup.
    expect(store.writeTimelineClipTrim('kv', 2.2, null)!.sectionOffset).toBeCloseTo(-0.3);
    raw.prepare("DELETE FROM timeline_clips WHERE id = 'kp'").run();
    // The left limit is the end of the Intro keys clip (6.5, after the apply above),
    // −1.5 — later than the bar: −1.6 is refused, −1.5 is fine.
    expect(() => store.writeTimelineClipTrim('kv', 0.9, null)).toThrow(/one bar/);
    expect(offsetOf('kv')).toBeCloseTo(-0.3);
    expect(store.writeTimelineClipTrim('kv', 1, null)!.sectionOffset).toBeCloseTo(-1.5);
  });

  it('Replace with a short file on a pickup keeps its offset', () => {
    // fill at −1.5; replaced by a 0.6 s file, untrimmed: ends at −0.9, before the downbeat.
    const replaced = store.updateTimelineClipKeepingSpot('fill', { name: 'Short', src: '/uploads/short.wav', duration: 0.6, trimStart: 0, trimEnd: null })!;
    expect(replaced.sectionOffset).toBeCloseTo(-1.5);
    expect(replaced.duration).toBeCloseTo(0.6);
    expect(replaced.trimEnd).toBeNull();
  });

  // Tails and pickups (step 4h2a), on a song of their own (s2, 120 bpm 4/4) with
  // tails seeded straight into the database (no route creates one yet).
  const seedTailSong = (clips: [string, string, string, number, number, number][]) => {
    const now = new Date().toISOString();
    raw.exec("DELETE FROM timeline_clips WHERE track_id IN ('t2a', 't2b'); DELETE FROM song_sections WHERE song_id = 's2';");
    if (!raw.prepare("SELECT id FROM songs WHERE id = 's2'").get()) {
      raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, time_signature) VALUES ('s2', 'Tails', 120, '[]', 'song', ?, ?, '4/4')").run(now, now);
      raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('t2a', 's2', 'Drums', 'instrument', 0)").run();
      raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES ('t2b', 's2', 'Bass', 'instrument', 1)").run();
    }
    ['A', 'B', 'C'].forEach((name, i) => {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`s2-${name}`, 's2', name, i, now);
    });
    for (const [id, track, section, offset, duration, tail] of clips) {
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, duration, section_name, section_offset, tail_seconds) VALUES (?, ?, ?, 'audio', 'x', ?, ?, ?, ?)")
        .run(id, track, id, duration, section, offset, tail);
    }
  };

  it('a tail never cuts a pickup; the overhang is cut at the pickup\'s drawn start', () => {
    // A: x at 0, 6 s with a 5 s tail (A needs 1 s: 0–1). B: only Bass, 4 s (1–5).
    // C at 5: a Drums pickup at −1, 2 s, wants to start at 4. x's tail reaches 6 but
    // the pickup keeps its full head (drawn at 4); x is cut there, by 2.
    seedTailSong([
      ['x', 't2a', 'A', 0, 6, 5],
      ['y', 't2b', 'B', 0, 4, 0],
      ['p', 't2a', 'C', -1, 2, 0],
    ]);
    const layout = store.computeSongLayout('s2');
    expect(layout.sections.map((s) => [s.name, s.start])).toEqual([['A', 0], ['B', 1], ['C', 5]]);
    expect(layout.clipHeadCuts.get('p')).toBe(0);
    expect(layout.clipStarts.get('p')).toBeCloseTo(4);
    expect(layout.clipTailCuts.get('x')).toBeCloseTo(2);
    expect(layout.clipEnds.get('x')! - layout.clipTailCuts.get('x')!).toBeCloseTo(4);
  });

  it('an overhang next to a pickup in the very next section is cut at the pickup\'s drawn (cut) start', () => {
    // A: x at 0, 4 s with a 2 s tail (A 0–2). B: a pickup at −1, 2 s. x fills A to its
    // end, so the pickup is cut to B's downbeat (2) by that in-section part — never by
    // the tail — and x's tail is cut at 2.
    seedTailSong([
      ['x', 't2a', 'A', 0, 4, 2],
      ['p', 't2a', 'B', -1, 2, 0],
    ]);
    const layout = store.computeSongLayout('s2');
    expect(layout.sections[1].start).toBeCloseTo(2);
    expect(layout.clipHeadCuts.get('p')).toBeCloseTo(1);
    expect(layout.clipStarts.get('p')).toBeCloseTo(2);
    expect(layout.clipTailCuts.get('x')).toBeCloseTo(2);
    // Moving the pickup within its section through the batch path is unaffected by
    // x's tail cut (only written clips' cuts are checked).
    store.setTimelineClipOffsets('s2', [{ id: 'p', sectionOffset: -0.5 }]);
    expect(store.computeSongLayout('s2').clipTailCuts.get('x')).toBeCloseTo(2);
  });

  it('a pickup may move left into the space an overhang crosses, and the server accepts it', () => {
    // Same song as above: x's tail (A 0–1, ends at 6) crosses B (1–5); C at 5. x counts
    // only up to A's end, so the pickup's limit is the bar before C: −2 (drawn at 3).
    seedTailSong([
      ['x', 't2a', 'A', 0, 6, 5],
      ['y', 't2b', 'B', 0, 4, 0],
      ['p', 't2a', 'C', -1, 2, 0],
    ]);
    expect(store.songPickupLeftLimit('s2', 't2a', 'C')).toBeCloseTo(-2);
    store.setTimelineClipOffsets('s2', [{ id: 'p', sectionOffset: -2 }]);
    expect(offsetOf('p')).toBeCloseTo(-2);
    const layout = store.computeSongLayout('s2');
    expect(layout.clipHeadCuts.get('p')).toBe(0);
    expect(layout.clipStarts.get('p')).toBeCloseTo(3);
    expect(layout.clipTailCuts.get('x')).toBeCloseTo(3); // the overhang is cut at the pickup
    // Past the bar is still refused.
    expect(() => store.setTimelineClipOffsets('s2', [{ id: 'p', sectionOffset: -2.5 }])).toThrow(/one bar/);
    // A left trim may take it there too.
    raw.prepare("UPDATE timeline_clips SET section_offset = -1, trim_start = 1, duration = 3 WHERE id = 'p'").run();
    expect(store.writeTimelineClipTrim('p', 0, null)!.sectionOffset).toBeCloseTo(-2);
  });
});
