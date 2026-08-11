# PatchBay — server internals

Loaded automatically when working with files under `server/`. See the project root `CLAUDE.md`
for universal context, including the Bands tenancy rule itself (kept there since it's
safety-critical — "never scope a query from a bandId in the request body or URL").

### Schema

- `bands` table: `id text pk, name text not-null, createdAt text not-null`
- `users.bandId` — nullable text, no FK (user belongs to one band; null = pre-backfill)
- `songs.bandId` — nullable text, FK → `bands.id`
- `albums.bandId` — nullable text, FK → `bands.id`
- `activityLog.bandId` — nullable text, no FK (songId is already a bare text column here)

All `bandId` columns are **currently nullable** — Phase 2 (query scoping) and Phase 3 (UI) will
harden them. Do not add `NOT NULL` constraints until Phase 3 data validation is complete.

### Startup backfill (`storage.backfillBands()`)

Called at startup after `seedUsers()`. Idempotent: first run creates the default band and stamps
all null `bandId` rows; every subsequent run logs a no-op message and exits immediately.

The default band name is **"The Zenith Passage"** (hard-coded in `backfillBands()`).

### Session plumbing (`server/routes.ts`)

- **`enrichSessionBand` middleware** — registered globally before all routes. If `req.session.userId`
  is set but `req.session.bandId` is not (pre-existing sessions), resolves `bandId` from the
  `users` table and caches it in the session. Never rejects — silently skips if not logged in.
- **Login** (`POST /api/auth/login`) — stores `req.session.bandId = user.bandId` alongside
  `req.session.userId` when the user has a `bandId`. A one-time verification log line is emitted;
  remove it once Phase 2 is shipped.
- **`requireBand` middleware** (exported from `routes.ts`) — applied to every API route. Reads
  `req.session.bandId`, attaches it to `req.bandId`, returns 403 if absent.

### Storage additions

`IStorage` + `SQLiteStorage` gained three methods:
- `getBands(): Promise<Band[]>` — list all bands
- `createBand(name: string): Promise<Band>` — create a new band
- `getUsersByBand(bandId: string): Promise<User[]>` — list members of a band

### Phase 2 — Query scoping (complete)

All ~50 API routes are band-scoped using `requireBand` middleware and ownership assertion helpers:

- **`assertSongOwned(req, res, songId)`** — looks up `songs.bandId` and verifies it matches
  `req.bandId`; sends 404 + returns `false` on mismatch. Accepts `string | string[]` (normalizes
  with `Array.isArray`).
- **`assertAlbumOwned(req, res, albumId)`** — same pattern for albums.
- **Chain-walk helpers** — resolve the parent `songId` from a child-resource ID via a single SQL
  join, used in routes whose URL param is a non-song entity:
  `trackSongId`, `ideaSongId`, `clipSongId`, `timelineClipSongId`, `taskSongId`,
  `taskCommentSongId`, `clipCommentSongId`, `reviewSongId`, `reviewCommentSongId`.

Every route extracts URL params as `const id = req.params.id as string` before passing them to
helpers or Drizzle — required because adding middleware to the handler chain widens `req.params`
values to `string | string[]` in TypeScript.

Settings are now per-band, keyed by `bandId` (previously `'global'`). `backfillBands()` migrates
the old `'global'` row to the zenith band ID on first run.

### Route ownership rules

**Partial updates — never spread request bodies over current rows**

Drizzle 0.45.2 skips `undefined`-valued keys in `.set()` for UPDATEs, but that protection is
useless if a JS spread clobbers values first. `{ ...current, ...data }` overwrites real values
with `undefined` before Drizzle ever sees the object — this nulled NOT NULL columns in
`updateSettings` via its conflict upsert.

Rule: when merging a partial payload (request body, `Partial<T>`) into an existing row for
`.values()` or `.set()`, build a filtered object containing only defined keys first. Plain
`.set(partialUpdates)` with no spread-merge is safe for UPDATEs (verified empirically against
Drizzle 0.45.2). See `updateSettings` in `storage.ts` for the canonical pattern using a `safe`
local object.

**Two-ID routes — assert ownership on every independent entity ID**

Any route or body carrying two independent entity IDs (e.g. `POST /api/albums/:id/songs` with
body `songId`, or `relatedClipId` on task PATCH) must validate ownership/scope on BOTH IDs.
Chain-walk helpers like `trackSongId → assertSongOwned` only cover the ID they start from.

This was the only real security hole found in the Phase 2 audit: album routes validated the album
but not the incoming `songId`, allowing cross-band song injection. When adding a route that
references a second entity, resolve its song/band and assert it matches — mismatch or nonexistent
→ 404, consistent with other ownership failures.

**Comment `parentId` — same entity, not just top-level**

The `parentId` guard on comment creation routes must verify three things, in order:

1. The parent comment exists in the DB
2. `parent.parentId` is null (it is itself top-level; no grandchild replies allowed)
3. `parent.clipId / taskId / reviewId` matches the URL's entity ID — a top-level comment from a
   *different* entity is not a valid parent

Omitting check 3 silently attaches a reply to the wrong entity's comment thread. All three comment
routes (`POST /api/clips/:clipId/comments`, `POST /api/production-tasks/:id/comments`,
`POST /api/reviews/:reviewId/comments`) enforce all three. Use 400 for `parentId` violations
(malformed-parent case, not an ownership violation — 404 is reserved for missing entities).

### What is NOT done yet (Phase 3)

- **Phase 3 — UI:** no band-switcher, no invite flow, no per-band settings screen.

## Band administration & first-login
- scripts/band-admin.ts (tsx): create-band <name> · create-user <username> <password> <bandName> · wipe-band-content <bandName> (refuses The Zenith Passage). Demo tooling until a real invite flow exists; Band B / zed is the standing demo fixture.
- Home onboarding card renders when the session band has zero songs AND zero activity; ghost panels are suppressed entirely in that state. Empty states follow doors-not-signs (gold primary = the action that fills the void).
- AUTH RULE: queryClient.clear() runs on BOTH login and logout in AuthContext — any future auth change must preserve this or the previous user's cached queries paint into the next session (cache bleed found in manual testing 2026-07-11). Login response must include bandName (parity with /api/auth/me) so the header is correct on first paint.
- BPM: no server-side validation exists (filed); input caps set to 999 in both settings and creation modals.

