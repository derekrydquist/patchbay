// The section-end handle's write (setSongSectionBaseLength) and the base-length reset
// when a section gets its first timeline clip again, through the real storage
// functions. Runs against a throwaway SQLite file with patchbay.db's schema only (no
// data; patchbay.db is opened read-only). Skipped when there is no local patchbay.db.
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SOURCE = path.resolve(import.meta.dirname, '..', 'patchbay.db');

describe.skipIf(!fs.existsSync(SOURCE))('section base length — server', () => {
  let tmpDir: string;
  let store: typeof import('./storage');
  let raw: Database.Database;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchbay-baselength-'));
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

    // 120 bpm 4/4: a beat is 0.5 s. Intro: drums 0–3 s (6 beats), bass 0–2.2 s → needs
    // 6 beats. Verse: one clip. Bridge: a row with no timeline clips.
    const now = new Date().toISOString();
    raw.prepare("INSERT INTO songs (id, name, bpm, sections, type, created_at, updated_at, time_signature) VALUES ('s1', 'Test', 120, '[]', 'song', ?, ?, '4/4')").run(now, now);
    for (const [id, name, order] of [['drums', 'Drums', 0], ['bass', 'Bass', 1]] as const) {
      raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order) VALUES (?, 's1', ?, 'instrument', ?)").run(id, name, order);
    }
    for (const [name, order] of [['Intro', 0], ['Verse', 1], ['Bridge', 2]] as const) {
      raw.prepare('INSERT INTO song_sections (id, song_id, section_name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(`sec-${name}`, 's1', name, order, now);
    }
    const addClip = (id: string, track: string, section: string, offset: number, duration: number, fullTake = 0) =>
      raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, duration, section_name, section_offset, is_full_take) VALUES (?, ?, ?, 'audio', 'x', ?, ?, ?, ?)")
        .run(id, track, id, duration, section, offset, fullTake);
    addClip('d1', 'drums', 'Intro', 0, 3);
    addClip('b1', 'bass', 'Intro', 0, 2.2);
    addClip('v1', 'drums', 'Verse', 0, 2);
    // A full take labelled Bridge doesn't put Bridge on the timeline.
    addClip('ft', 'bass', 'Bridge', 0, 4, 1);
  });

  afterAll(() => {
    raw?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const stored = (section: string) =>
    (raw.prepare("SELECT base_length AS b FROM song_sections WHERE song_id = 's1' AND section_name = ?").get(section) as { b: number | null }).b;
  const layoutOf = (section: string) => store.computeSongLayout('s1').sections.find((s) => s.name === section)!;

  it('stores a value above the content need, and the layout uses it', () => {
    expect(store.setSongSectionBaseLength('s1', 'Intro', 14)).toBe(14);
    expect(stored('Intro')).toBe(14);
    expect(layoutOf('Intro').lengthBeats).toBe(14);
    expect(layoutOf('Verse').startBeat).toBe(14);
  });

  it('stores NULL for a value equal to or below the need, or null', () => {
    store.setSongSectionBaseLength('s1', 'Intro', 14);
    expect(store.setSongSectionBaseLength('s1', 'Intro', 6)).toBeNull(); // equal to the need
    expect(stored('Intro')).toBeNull();
    store.setSongSectionBaseLength('s1', 'Intro', 14);
    expect(store.setSongSectionBaseLength('s1', 'Intro', 2)).toBeNull(); // below
    expect(stored('Intro')).toBeNull();
    store.setSongSectionBaseLength('s1', 'Intro', 14);
    expect(store.setSongSectionBaseLength('s1', 'Intro', null)).toBeNull();
    expect(stored('Intro')).toBeNull();
    expect(layoutOf('Intro').lengthBeats).toBe(6);
  });

  it('one beat above the need is stored', () => {
    expect(store.setSongSectionBaseLength('s1', 'Intro', 7)).toBe(7);
    store.setSongSectionBaseLength('s1', 'Intro', null);
  });

  it('refuses invalid values and a non-existent section (400 type), writing nothing', () => {
    store.setSongSectionBaseLength('s1', 'Intro', 10);
    for (const bad of [0, -4, 1.5, 4097, NaN, Infinity]) {
      expect(() => store.setSongSectionBaseLength('s1', 'Intro', bad)).toThrow(store.SectionBaseLengthError);
    }
    expect(() => store.setSongSectionBaseLength('s1', 'Nope', 10)).toThrow(store.SectionBaseLengthError);
    expect(() => store.setSongSectionBaseLength('other-song', 'Intro', 10)).toThrow(store.SectionBaseLengthError);
    expect(stored('Intro')).toBe(10);
    store.setSongSectionBaseLength('s1', 'Intro', null);
  });

  it('refuses a section with no timeline clips (409 type)', () => {
    expect(() => store.setSongSectionBaseLength('s1', 'Bridge', 8)).toThrow(store.SectionBaseLengthNotOnTimelineError);
    expect(stored('Bridge')).toBeNull();
  });

  it('a clip on a hidden track does not count', () => {
    raw.prepare("INSERT INTO instrument_tracks (id, song_id, name, type, sort_order, active) VALUES ('keys', 's1', 'Keys', 'instrument', 2, 0)").run();
    raw.prepare("INSERT INTO timeline_clips (id, track_id, name, type, color, duration, section_name, section_offset) VALUES ('k1', 'keys', 'k1', 'audio', 'x', 2, 'Bridge', 0)").run();
    expect(() => store.setSongSectionBaseLength('s1', 'Bridge', 8)).toThrow(store.SectionBaseLengthNotOnTimelineError);
    raw.prepare("DELETE FROM timeline_clips WHERE id = 'k1'").run();
  });

  it('a section that loses its last clip and gets one again comes back with no base length', () => {
    expect(store.setSongSectionBaseLength('s1', 'Verse', 16)).toBe(16);
    raw.prepare("DELETE FROM timeline_clips WHERE id = 'v1'").run();
    expect(stored('Verse')).toBe(16); // kept while off the timeline (ignored by the layout)
    store.insertTimelineClipPlaced('s1', {
      id: 'v2', trackId: 'bass', name: 'v2', type: 'audio', color: 'x', start: 0, duration: 2,
      sectionName: 'Verse', isFinal: false, trimStart: 0, trimEnd: null, isFullTake: false, sectionOffset: 0,
    });
    expect(stored('Verse')).toBeNull();
    expect(layoutOf('Verse').lengthBeats).toBe(4);
  });

  it('a later clip in a section already on the timeline keeps its base length', () => {
    expect(store.setSongSectionBaseLength('s1', 'Verse', 16)).toBe(16);
    store.insertTimelineClipPlaced('s1', {
      id: 'v3', trackId: 'drums', name: 'v3', type: 'audio', color: 'x', start: 0, duration: 1,
      sectionName: 'Verse', isFinal: false, trimStart: 0, trimEnd: null, isFullTake: false, sectionOffset: 0,
    });
    expect(stored('Verse')).toBe(16);
  });

  it('the clamp uses the same need as the layout', () => {
    // Verse now: bass 0–2 s, drums 0–1 s → 4 beats.
    expect(layoutOf('Verse').lengthBeats).toBe(16);
    expect(store.setSongSectionBaseLength('s1', 'Verse', 4)).toBeNull();
    expect(layoutOf('Verse').lengthBeats).toBe(4);
    expect(store.setSongSectionBaseLength('s1', 'Verse', 5)).toBe(5);
  });
});
