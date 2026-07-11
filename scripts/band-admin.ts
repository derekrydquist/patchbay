#!/usr/bin/env tsx
/**
 * scripts/band-admin.ts — Band administration CLI
 * Usage: tsx scripts/band-admin.ts <command> [args...]
 *
 * Commands:
 *   create-band <name>
 *       Create a new band with the given name.
 *
 *   create-user <username> <password> <bandName>
 *       Create a new user associated with the named band.
 *       Password is bcrypt-hashed at cost 10, consistent with server seeding.
 *       Username is stored lowercase (same normalization as login).
 *
 *   wipe-band-content <bandName>
 *       Delete all songs, albums, and activity log entries for the band.
 *       Cascade-deletes all children (tracks → ideas → clips, timeline clips,
 *       tasks, reviews, comments, etc.) via SQLite FK cascades.
 *       Band record and user accounts are PRESERVED.
 *       REFUSED for "The Zenith Passage" (safety rail).
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const SAFETY_BAND = 'The Zenith Passage';
const BCRYPT_COST = 10;

const db = new Database('./patchbay.db');
db.pragma('foreign_keys = ON');  // required for cascade deletes

const [, , cmd, ...args] = process.argv;

async function createBand(name: string) {
  if (!name?.trim()) {
    console.error('Usage: create-band <name>');
    process.exit(1);
  }
  const existing = db.prepare('SELECT id FROM bands WHERE name = ?').get(name);
  if (existing) {
    console.error(`Band "${name}" already exists.`);
    process.exit(1);
  }
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO bands (id, name, created_at) VALUES (?, ?, ?)').run(id, name, createdAt);
  console.log(`Created band "${name}" (${id})`);
}

async function createUser(username: string, password: string, bandName: string) {
  if (!username || !password || !bandName) {
    console.error('Usage: create-user <username> <password> <bandName>');
    process.exit(1);
  }
  const band = db.prepare('SELECT id FROM bands WHERE name = ?').get(bandName) as { id: string } | undefined;
  if (!band) {
    console.error(`Band "${bandName}" not found. Run create-band first.`);
    process.exit(1);
  }
  const normalized = username.toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(normalized);
  if (existing) {
    console.error(`User "${normalized}" already exists.`);
    process.exit(1);
  }
  const hashed = await bcrypt.hash(password, BCRYPT_COST);
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password, band_id) VALUES (?, ?, ?, ?)')
    .run(id, normalized, hashed, band.id);
  console.log(`Created user "${normalized}" in band "${bandName}" (userId: ${id})`);
}

async function wipeBandContent(bandName: string) {
  if (!bandName) {
    console.error('Usage: wipe-band-content <bandName>');
    process.exit(1);
  }
  if (bandName === SAFETY_BAND) {
    console.error(`Refusing to wipe "${SAFETY_BAND}" — safety rail. Use a different band.`);
    process.exit(1);
  }
  const band = db.prepare('SELECT id, name FROM bands WHERE name = ?').get(bandName) as
    { id: string; name: string } | undefined;
  if (!band) {
    console.error(`Band "${bandName}" not found.`);
    process.exit(1);
  }

  db.transaction(() => {
    const songs  = db.prepare('DELETE FROM songs WHERE band_id = ?').run(band.id);
    const albums = db.prepare('DELETE FROM albums WHERE band_id = ?').run(band.id);
    const log    = db.prepare('DELETE FROM activity_log WHERE band_id = ?').run(band.id);
    console.log(`Wiped: ${songs.changes} song(s), ${albums.changes} album(s), ${log.changes} activity_log row(s)`);
  })();

  const userCount = (db.prepare('SELECT COUNT(*) as n FROM users WHERE band_id = ?').get(band.id) as { n: number }).n;
  console.log(`Band "${bandName}" content wiped. Band record and ${userCount} user(s) preserved.`);
}

(async () => {
  switch (cmd) {
    case 'create-band':        await createBand(args[0]); break;
    case 'create-user':        await createUser(args[0], args[1], args[2]); break;
    case 'wipe-band-content':  await wipeBandContent(args[0]); break;
    default:
      console.log(`
PatchBay band admin CLI
Usage: tsx scripts/band-admin.ts <command> [args]

Commands:
  create-band <name>
      Create a new band.

  create-user <username> <password> <bandName>
      Create a user (bcrypt cost 10) associated with the named band.

  wipe-band-content <bandName>
      Delete all songs, albums, and activity for the band.
      Band record and users are kept. Refused for "${SAFETY_BAND}".
`.trim());
      process.exit(1);
  }
})();
