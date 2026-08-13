---
name: deploy
description: How to deploy PatchBay to Railway — required environment variables, why drizzle-kit push is banned from production, session persistence, the __dirname production-bundle gotcha, and build/start commands. Use when deploying the app, debugging a production deploy issue, or changing shared/schema.ts.
---

## Deployment (Railway)

### Required env vars

| Var | Dev default | Production requirement |
|---|---|---|
| `SESSION_SECRET` | — | **Required** — server throws at startup if missing. Generate: `openssl rand -hex 32` |
| `DATABASE_URL` | `./patchbay.db` | Must point at a Railway persistent volume (e.g. `/data/patchbay.db`). Omitting it prints a loud warning and data is lost on redeploy. |
| `UPLOADS_DIR` | `./uploads` | Must point at the same persistent volume (e.g. `/data/uploads`). Omitting it prints a loud warning and audio files are lost on redeploy. |
| `PORT` | `3001` | Provided automatically by Railway — do not set manually. |

Both `DATABASE_URL` and `UPLOADS_DIR` should resolve to paths on the same mounted volume so the database file and audio files survive deploys together.

### Schema changes — drizzle-kit push is banned from production

`npm start` no longer runs `drizzle-kit push` at all. `prestart` (which ran
`drizzle-kit push --force` on every boot) was removed from `package.json`
on 2026-08-11 after it crash-looped production — do not re-add it.

**The only path for schema changes reaching production is the idempotent,
`pragma_table_info`-guarded `ALTER TABLE` pattern in `server/db.ts`** — see
the existing blocks (`pan`, `is_full_take`, `track_id`,
`bucket_folder_views`) for the pattern. `drizzle-kit push` (`npm run
db:push`) remains available as a manual **local-dev-only** command — never
automatic, never touching production.

**Why it's banned outright, not just made non-automatic:** `--force` skips
Drizzle's confirmation for destructive changes (dropped columns, lossy
types) — the known risk. But the actual incident was broader: **any schema
change to a table with incoming foreign keys is unsafe via `drizzle-kit
push`, regardless of default value.** SQLite forces drizzle-kit into a
"recreate table" strategy for FK-referenced tables (create new → copy rows
→ drop old → rename), and its `PRAGMA foreign_keys=OFF` toggle is a
documented no-op when run inside an already-open transaction — so the
`DROP TABLE` step can trip a live FK violation from child tables. This is
exactly what happened adding `instrument_tracks.pan` (a plain, non-
destructive, defaulted column, safe by the `--force` rule alone) — crashed
every boot with `SqliteError: FOREIGN KEY constraint failed` until
`prestart` was removed. Production data was confirmed intact afterward
(zero FK violations, clean rollback, no leftover tables).

**Rule going forward:** before adding a column to any table referenced by
`.references()` elsewhere in `shared/schema.ts`, assume `drizzle-kit push`
is unsafe for it — even locally, a clean `db:push` doesn't prove
production-safety for FK-referenced tables. Use the `server/db.ts` pattern
regardless.

`git push` to `main` auto-deploys and remains excluded from Claude Code's
`auto` permission mode via `~/.claude/settings.json` — see "Doc Sync &
Permissions" in root `CLAUDE.md`. Do not remove that rule.

### Session persistence

Sessions are stored in the `sessions` table of the same SQLite file as the rest of the app data (managed by `server/session-store.ts`, a zero-dependency `BetterSqlite3Store`). Sessions survive server restarts as long as `DATABASE_URL` points at the persistent volume. Expired rows are pruned every 15 minutes.

### `__dirname` in the production bundle

The esbuild build outputs a single CJS bundle at `dist/index.cjs`. In a Node.js CJS module, `__dirname` is **injected at runtime** by Node as the absolute directory of the bundle file (`dist/`). This means `path.resolve(__dirname, "public")` correctly resolves to `dist/public` regardless of CWD — it is not undefined and does not need an esbuild `define` shim. Do not re-flag this as a blocker.

### Build and start

```bash
npm run build   # Vite client → dist/public/, esbuild server → dist/index.cjs
npm start       # no prestart — runs node dist/index.cjs directly
```

---

