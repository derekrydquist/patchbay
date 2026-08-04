/**
 * Dump all timeline_clips rows with resolved bucketClipId name.
 * Run from project root: node scripts/dump-timeline-clips.mjs
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, '..', 'patchbay.db'));

const rows = db.prepare(`
  SELECT
    tc.id,
    tc.track_id        AS trackId,
    tc.section_name    AS sectionName,
    tc.name,
    tc.bucket_clip_id  AS bucketClipId,
    tc.start,
    c.name             AS resolved_clip_name
  FROM timeline_clips tc
  LEFT JOIN clips c ON tc.bucket_clip_id = c.id
  ORDER BY tc.track_id, tc.section_name, tc.start
`).all();

console.log(`${rows.length} rows\n`);
for (const r of rows) {
  const match = r.name === r.resolved_clip_name ? '✓' : r.resolved_clip_name === null ? 'NULL' : '✗ MISMATCH';
  console.log(`id             : ${r.id}`);
  console.log(`trackId        : ${r.trackId}`);
  console.log(`sectionName    : ${r.sectionName}`);
  console.log(`name           : ${r.name}`);
  console.log(`bucketClipId   : ${r.bucketClipId}`);
  console.log(`start          : ${r.start}`);
  console.log(`resolved_name  : ${r.resolved_clip_name}  [${match}]`);
  console.log('---');
}

db.close();
