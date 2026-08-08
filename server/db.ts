import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

const dbPath = process.env.DATABASE_URL ?? "./patchbay.db";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "[PatchBay] WARNING: production is using the default ./patchbay.db on local disk — " +
      "data will NOT survive redeploys. Set DATABASE_URL to a persistent volume path.",
  );
}

// Export the raw connection so the session store can share the same file.
export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Partial unique index: only one active track per (song, name).
// Hidden tracks (active=0) are excluded so the same name can be reused after hiding.
sqlite.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_song_track_name_active
  ON instrument_tracks(song_id, name)
  WHERE active = 1
`);

// Add track_id FK to production_tasks and backfill existing rows.
// Uses three passes to handle all cases without guessing:
//   Pass 1 — unambiguous: exactly one track (any active status) shares (song, name).
//   Pass 2a — ambiguous + prefixed ID: task ID encodes the trackId as `task-{uuid}-{n}`;
//             extract it directly rather than matching by name.
//   Pass 2b — ambiguous + plain UUID: prefer the single active track (the new22 case
//             for user-added sections whose task IDs carry no embedded trackId).
const hasTaskTrackId = (sqlite.prepare(
  "SELECT COUNT(*) as c FROM pragma_table_info('production_tasks') WHERE name='track_id'"
).get() as { c: number }).c;
if (!hasTaskTrackId) {
  sqlite.exec("ALTER TABLE production_tasks ADD COLUMN track_id TEXT REFERENCES instrument_tracks(id)");

  // Pass 1: unambiguous by name — exactly one instrument_tracks row matches.
  sqlite.exec(`
    UPDATE production_tasks
    SET track_id = (
      SELECT it.id FROM instrument_tracks it
      WHERE it.song_id = production_tasks.song_id
        AND it.name    = production_tasks.instrument
      LIMIT 1
    )
    WHERE track_id IS NULL
      AND (
        SELECT COUNT(*) FROM instrument_tracks it
        WHERE it.song_id = production_tasks.song_id
          AND it.name    = production_tasks.instrument
      ) = 1
  `);

  // Pass 2a: ambiguous + prefixed ID — extract the embedded UUID from task-{uuid}-{n}.
  // SUBSTR(id, 6, 36) skips the leading 'task-' (5 chars) and reads the 36-char UUID.
  sqlite.exec(`
    UPDATE production_tasks
    SET track_id = (
      SELECT it.id FROM instrument_tracks it
      WHERE it.id = SUBSTR(production_tasks.id, 6, 36)
      LIMIT 1
    )
    WHERE track_id IS NULL
      AND production_tasks.id LIKE 'task-%'
      AND (
        SELECT it.id FROM instrument_tracks it
        WHERE it.id = SUBSTR(production_tasks.id, 6, 36)
      ) IS NOT NULL
  `);

  // Pass 2b: ambiguous + plain UUID — prefer the sole active track if exactly one exists.
  sqlite.exec(`
    UPDATE production_tasks
    SET track_id = (
      SELECT it.id FROM instrument_tracks it
      WHERE it.song_id = production_tasks.song_id
        AND it.name    = production_tasks.instrument
        AND it.active  = 1
      LIMIT 1
    )
    WHERE track_id IS NULL
      AND (
        SELECT COUNT(*) FROM instrument_tracks it
        WHERE it.song_id = production_tasks.song_id
          AND it.name    = production_tasks.instrument
          AND it.active  = 1
      ) = 1
  `);

  const stillNull = (sqlite.prepare(
    "SELECT COUNT(*) as c FROM production_tasks WHERE track_id IS NULL"
  ).get() as { c: number }).c;
  if (stillNull > 0) {
    console.warn(`[PatchBay] ${stillNull} production_tasks row(s) could not be resolved to a track — trackId left NULL. Manual review needed.`);
  } else {
    console.log("[PatchBay] production_tasks.track_id backfill complete — all rows resolved.");
  }
}

// Add is_full_take to ideas table if missing.
const hasIdeasIsFullTake = (sqlite.prepare(
  "SELECT COUNT(*) as c FROM pragma_table_info('ideas') WHERE name='is_full_take'"
).get() as { c: number }).c;
if (!hasIdeasIsFullTake) {
  sqlite.exec("ALTER TABLE ideas ADD COLUMN is_full_take INTEGER NOT NULL DEFAULT 0");
  console.log("[PatchBay] Added is_full_take column to ideas table.");
}

// Add is_full_take to timeline_clips table if missing.
const hasTimelineClipsIsFullTake = (sqlite.prepare(
  "SELECT COUNT(*) as c FROM pragma_table_info('timeline_clips') WHERE name='is_full_take'"
).get() as { c: number }).c;
if (!hasTimelineClipsIsFullTake) {
  sqlite.exec("ALTER TABLE timeline_clips ADD COLUMN is_full_take INTEGER NOT NULL DEFAULT 0");
  console.log("[PatchBay] Added is_full_take column to timeline_clips table.");
}
