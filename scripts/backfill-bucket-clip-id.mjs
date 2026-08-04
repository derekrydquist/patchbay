/**
 * One-off backfill: populate timeline_clips.bucket_clip_id using the same
 * matching logic ClipInfoWindow uses client-side:
 *   trackId + sectionName + clip name  →  clips.id via ideas join
 *
 * Run from the project root:
 *   node scripts/backfill-bucket-clip-id.mjs
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '..', 'patchbay.db');

const db = new Database(dbPath);

// Fetch all timeline_clips rows
const timelineClips = db.prepare(`
  SELECT id, track_id, name, section_name
  FROM timeline_clips
`).all();

// For each unique (trackId, sectionName, name) combo, find the matching bucket clip:
//   clips → ideas (on idea_id) → instrument_tracks (on track_id)
// Must match on track_id + section_name (via ideas) + name (via clips)
// and be active.  If more than one row matches, leave NULL (ambiguous).
const lookupStmt = db.prepare(`
  SELECT c.id
  FROM clips c
  JOIN ideas i ON c.idea_id = i.id
  WHERE i.track_id = ?
    AND i.section_name = ?
    AND c.name = ?
    AND c.active = 1
`);

const updateStmt = db.prepare(`
  UPDATE timeline_clips SET bucket_clip_id = ? WHERE id = ?
`);

let total = 0;
let resolved = 0;
let unresolved = 0;
const unresolvedRows = [];

for (const tc of timelineClips) {
  total++;

  if (!tc.section_name) {
    // Can't resolve without a sectionName — log as unresolved
    unresolved++;
    unresolvedRows.push({ id: tc.id, trackId: tc.track_id, sectionName: tc.section_name, name: tc.name, reason: 'no section_name' });
    continue;
  }

  const matches = lookupStmt.all(tc.track_id, tc.section_name, tc.name);

  if (matches.length === 1) {
    updateStmt.run(matches[0].id, tc.id);
    console.log(`RESOLVED   tc=${tc.id}  →  clip=${matches[0].id}  (${tc.name})`);
    resolved++;
  } else if (matches.length === 0) {
    console.log(`UNRESOLVED tc=${tc.id}  trackId=${tc.track_id}  section=${tc.section_name}  name=${tc.name}  reason=no_match`);
    unresolved++;
    unresolvedRows.push({ id: tc.id, trackId: tc.track_id, sectionName: tc.section_name, name: tc.name, reason: 'no_match' });
  } else {
    // Multiple matches — ambiguous, leave NULL
    console.log(`AMBIGUOUS  tc=${tc.id}  trackId=${tc.track_id}  section=${tc.section_name}  name=${tc.name}  matches=${matches.map(m => m.id).join(',')}`);
    unresolved++;
    unresolvedRows.push({ id: tc.id, trackId: tc.track_id, sectionName: tc.section_name, name: tc.name, reason: 'ambiguous', matchIds: matches.map(m => m.id) });
  }
}

db.close();

console.log('\n──────────────────────────────────────');
console.log(`Total timeline_clips rows : ${total}`);
console.log(`Resolved cleanly          : ${resolved}`);
console.log(`Unresolved / NULL         : ${unresolved}`);

if (unresolvedRows.length > 0) {
  console.log('\nUnresolved detail:');
  for (const r of unresolvedRows) {
    console.log(`  id=${r.id}  trackId=${r.trackId}  sectionName=${r.sectionName}  name=${r.name}  reason=${r.reason}${r.matchIds ? '  matchIds=' + r.matchIds.join(',') : ''}`);
  }
}
