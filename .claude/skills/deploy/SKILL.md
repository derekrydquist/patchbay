---
name: deploy
description: How to deploy PatchBay to Railway — required environment variables, schema bootstrap, session persistence, the __dirname production-bundle gotcha, and build/start commands. Use when deploying the app or debugging a production deploy issue.
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

### Schema bootstrap — real risk, not just idempotent boilerplate

`npm start` runs a `prestart` hook (`drizzle-kit push --force`) before starting the server. This means a fresh database is fully provisioned on every boot with no manual steps, and rerunning with **no schema changes** is a safe no-op.

**But `--force` is not just a convenience flag — it skips Drizzle's interactive confirmation for destructive changes** (dropped columns, lossy type changes, etc.). Without `--force`, Drizzle would pause and ask before applying something that could lose data; with it, that confirmation never happens. Any schema change that would normally trigger that prompt ships automatically and silently the moment this hook runs.

Railway auto-deploys on push to `main`, so the real trigger chain is: **`git push` to `main` → Railway deploy → this hook runs → any destructive schema change applies with no human in the loop**, unless something upstream catches it. That's why `git push` is deliberately excluded from Claude Code's `auto` permission mode via an `ask` rule in `~/.claude/settings.json` — see "Doc Sync & Permissions" in the root `CLAUDE.md` for why. Do not remove that `ask` rule, and do not treat this hook as low-risk just because reruns without changes are safe.

### Session persistence

Sessions are stored in the `sessions` table of the same SQLite file as the rest of the app data (managed by `server/session-store.ts`, a zero-dependency `BetterSqlite3Store`). Sessions survive server restarts as long as `DATABASE_URL` points at the persistent volume. Expired rows are pruned every 15 minutes.

### `__dirname` in the production bundle

The esbuild build outputs a single CJS bundle at `dist/index.cjs`. In a Node.js CJS module, `__dirname` is **injected at runtime** by Node as the absolute directory of the bundle file (`dist/`). This means `path.resolve(__dirname, "public")` correctly resolves to `dist/public` regardless of CWD — it is not undefined and does not need an esbuild `define` shim. Do not re-flag this as a blocker.

### Build and start

```bash
npm run build   # Vite client → dist/public/, esbuild server → dist/index.cjs
npm start       # prestart: drizzle-kit push --force, then: node dist/index.cjs
```

---

