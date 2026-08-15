# CLAUDE.md — PatchBay

This file is the instruction manual for Claude Code when working on this project.
Read it fully before making any changes.

---

## What Is PatchBay?

PatchBay is a collaborative songwriting platform for bands. It lets band members in different
locations upload recorded ideas for each instrument, assemble those ideas into a demo on a
shared timeline, and track production progress — all without a studio engineer in the middle.

**The one-liner:** PatchBay is a shared space for a band to track song progress by organizing
recorded ideas and assembling them into fully realized demos.

**What it is NOT:** A recording tool, a mixer, or a mastering suite. PatchBay is arrangement
and collaboration only.

---

## Project History

This project was originally scaffolded by Replit and used as a design prototype. It was
previously called "Song-Weaver-Suite" and "Studio Lux" in some parts of the code. All
references should be renamed to **PatchBay** going forward.

The frontend UI is largely designed and functional. The backend is fully built out — real API
routes, database persistence, file uploads, and audio playback all work end-to-end. The primary
remaining work is:

1. Auth roles and permissions — basic session auth (login/logout, route guard, seeded users) is built; role-based access control (Band Leader / Band Member / Engineer) is not yet enforced
2. Real-time collaboration — WebSockets (`ws`) are installed but not used yet
3. Deployment infrastructure (file storage, hosting)

---

## Navigation

### Global nav — AppHeader

`AppHeader` renders on every surface. Its left side always contains the logo, then the **Home** and **Library** nav links.

- **Logo** — always routes to `/` via an internal `setLocation('/')` call. The `onLogoClick` prop has been removed; do not reintroduce it.
- **Home** (`/?tab=dashboard`) — the activity dashboard. Nav link highlighted when `activeNav === 'home'`.
- **Library** (`/?tab=files`) — the global file browser. Nav link highlighted when `activeNav === 'library'`.
- Song-level surfaces (`SongHome`, `Workspace`) pass no `activeNav` prop — both links render dimmed; neither is highlighted.

### Tab persistence and bare-URL resolution

`Dashboard.tsx` derives `activeTab` reactively from `useSearch()` (wouter) on every render. When no `?tab=` param is present, it reads `localStorage.getItem('patchbay-last-home-tab')` as a fallback. An explicit `?tab=` param always wins — deep links are never overridden. The Home nav link always navigates to `/?tab=dashboard` (explicit param) so it reliably overrides the memory.

**Do not reintroduce a mount-only redirect `useEffect`** for tab memory — the reactive `useSearch()` derivation already handles every SPA navigation case, including navigating back to `/` from a song page.

### Song-level breadcrumb

A `/ {song name}` element is passed via `postLogoSlot`:
- **SongHome** — static `<span>` (you are already on the song's page)
- **Workspace** — `<button>` that navigates to `/songs/:songId` (Song Home)

### Workspace mode tabs

The **Arrangement | Production** tabs live in `Workspace.tsx`'s `preActionSlot` (right side of header, before the gear icon). They are **not** in `postLogoSlot`. Do not move them into the logo/breadcrumb area.

### Naming conventions

| Label | Surface | Destination |
|---|---|---|
| **Home** | Global nav link | `/?tab=dashboard` — activity dashboard |
| **Library** | Global nav link | `/?tab=files` — global file browser |
| **Song Files** | SongHome tab label | `?tab=files` — song-scoped file browser |

Never label anything just **"Files"** — it is ambiguous between Library and Song Files.

### Header type spec — do not invent new variants

Nav links and mode tabs share one font/tracking/case spec: `text-[10px] font-bold uppercase tracking-[0.2em]`

**Nav link full className** (from `AppHeader.tsx`):
```
text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 transition-colors cursor-pointer
```
Active: `text-primary` · Inactive: `text-white/40 hover:text-white/70`

**Mode tab full className** (from `Workspace.tsx` `TabsTrigger`):
```
data-[state=active]:bg-white/5 data-[state=active]:text-primary rounded-none border-b-2 border-transparent data-[state=active]:border-primary px-4 h-14 text-[10px] uppercase tracking-[0.2em] font-bold transition-all cursor-pointer
```

**Song breadcrumb base** (from `SongHome.tsx`):
```
text-sm font-semibold text-white/70 truncate max-w-[200px]
```
Workspace adds hover affordance only: `hover:text-white/90 transition-colors cursor-pointer`

All interactive header elements carry `cursor-pointer`. New header elements must reuse one of these two type specs — do not introduce a third.

### Home and Library page headers — sibling pair

The Home tab (`activeTab === 'dashboard'`) and Library tab (`activeTab === 'files'`) both open with an identical type block and spacing: a `mb-4` wrapper, an `<h1>` (`text-2xl font-heading font-black tracking-tight text-white`), and a `<p>` subline (`text-sm mt-1 text-white/70`).

- **Home** renders the personalized greeting + status/flavor line
- **Library** renders `"Library"` + live counts (`N Songs · N Ideas · N Albums`)

They are a matched pair. Restyling one requires restyling the other — change them together.

---

## Database

**We use SQLite** (not PostgreSQL). This requires no server, no cloud account, and no
environment setup. Data is stored in a single file: `patchbay.db` in the project root.

### Why not PostgreSQL?
The original Replit scaffold configured PostgreSQL, but that requires a running database
server. SQLite is a file-based database that works anywhere Node.js runs. Drizzle ORM
supports both; switching to PostgreSQL later (for deployment) is straightforward.

### Setup
Install the SQLite adapter:
```bash
npm install better-sqlite3 @types/better-sqlite3
```

### Drizzle config for SQLite
`drizzle.config.ts` should use:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: "./patchbay.db" },
});
```

### Running migrations
```bash
npm run db:push
```

This has already been run — `patchbay.db` exists in the project root with all tables created.

### Server database module

`server/db.ts` initializes the connection and exports the Drizzle `db` instance. Import it in
any server file that needs direct DB access. The storage layer (`server/storage.ts`) wraps all
queries in an `IStorage` interface — prefer using `storage` from there rather than `db` directly
in route handlers.

### Schema source of truth

`shared/schema.ts` defines all tables and exports both `Insert*` and `Select` types for each.
`ClipMetadata` is defined there (not in `daw-data.ts`) so it can be shared by server and client.

### Tables

| Table | Purpose |
|---|---|
| `users` | Auth — username/password accounts |
| `songs` | Top-level song container (name, bpm, sections JSON) |
| `instrument_tracks` | One row per instrument per song (Drums, Bass, etc.); has `active` boolean — false = hidden; `volume` integer (default 100, range 0–100) — persisted via `PATCH /api/tracks/:trackId`, debounced 500ms on slider drag; read back on initial load and every live-sync poll; `pan` integer (default 0/center, range -100 full left to 100 full right) — persisted via the same `PATCH /api/tracks/:trackId` route. The L/C/R button UI only ever writes `-65`, `0`, or `65`; the column allows the full range for forward compatibility, but nothing currently sets anything outside those three values. See "Track panning" in `client/src/components/daw/CLAUDE.md` for the audio-graph side. |
| `ideas` | A section slot per instrument (e.g. "Drums — Verse 1"); has `active` boolean — false = hidden |
| `deleted_sections` | Tracks intentionally deleted default sections (songId + sectionName) so bootstrap doesn't re-add them |
| `clips` | Versions uploaded to a bucket idea (linked to `ideas`); `isFinal` marks the chosen version |
| `timeline_clips` | Clips placed on the arrangement timeline (linked to `instrument_tracks`); `isFinal` mirrors the corresponding bucket clip's final state; `trimStart` (real, default 0) and `trimEnd` (real, nullable) store non-destructive trim points in seconds |
| `clip_comments` | Timestamped comments on bucket clips; `parentId` (nullable self-reference, no FK) supports one level of replies — same pattern as `song_review_comments`. Also backs the clip comment indicator badge (see Planned Features) via `GET /api/songs/:songId/clip-comment-summary`, which aggregates `MAX(timestamp)` per `clipId` across both top-level comments and replies. |
| `production_tasks` | Kanban tasks linked to a song |
| `task_subtasks` | Checklist items on a task |
| `task_comments` | Comments on a task; `parentId` (nullable self-reference, no FK) supports one level of replies |
| `song_reviews` | Exported mix files shared for review (linked to `songs`); stores src URL, format, duration, createdBy |
| `song_review_comments` | Timestamped comments on a review; `parentId` (nullable self-reference) supports one level of replies; `resolved` boolean; `editedAt` nullable ISO timestamp |
| `activity_log` | Dedicated log store for song-scoped events. No FK dependencies — `songId` is a plain text column so events survive even if associated rows are deleted. `type` and `description` are stored verbatim; `getActivity()` passes them through without text parsing. `author` is a nullable text column (retrofitted — pre-existing rows have `author=null`); populated at every `logActivity()` call site by resolving `req.session.userId → storage.getUser()?.username`. `author` is the key input to `getSongsWithLastActive`, which sorts the Dashboard "Your Songs" list by `MAX(activity_log.timestamp WHERE author = session username)` per song, falling back to `createdAt`. Optional `review_id` and `comment_id` columns support deep-link routing for review-comment and review-reply events. |
| `global_settings` | Single-row config table (PK = `'global'`). Stores `defaultInstruments` (JSON string[]), `defaultSections` (JSON string[]), and `defaultBpm` (integer). `getSettings()` auto-inserts the factory row on first read so the row always exists. Used by the New Project modal to pre-populate instruments/sections/BPM. |

**`timeline_clips` vs `clips`:** These are intentionally separate tables. `clips` holds the uploaded source material (versions inside bucket ideas). `timeline_clips` holds the arranged instances placed on the timeline with a `start` time. Dragging from the bucket to the timeline creates a new `timeline_clips` row — it does not move the source clip.

### Default song bootstrap

`server/storage.ts` exports `DEFAULT_SONG_ID = "patchbay-default"`. The first call to `GET /api/songs/:id/timeline` auto-creates this song and its five default instrument tracks if they don't exist yet (using `INSERT OR IGNORE`). The default track IDs are stable strings: `track-drums`, `track-bass`, `track-guitar-1`, `track-guitar-2`, `track-vocals`.

`storage.ts` also exports `DEFAULT_SECTIONS = ["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Outro"]`. The bootstrap inserts 35 idea rows (5 tracks × 7 sections) using stable IDs like `idea-track-drums-0`, and 35 production task rows using stable IDs like `task-track-drums-0`. Both ideas and tasks use `onConflictDoNothing()` — existing rows (including hidden ones) are preserved. Default tracks check for existence first: if a track exists with `active = false`, the bootstrap skips it entirely (does not re-show it). All mechanisms ensure hide/restore persists across server restarts.

### Track IDs must be stable

`INITIAL_TRACKS` in `daw-data.ts` uses the same stable string IDs (`track-drums`, etc.) — **not** `nanoid()`. This is required because the timeline's live sync matches local `Track` objects to `ApiTrack` objects by `id`, and `timelineClips.trackId` is a DB foreign key that must match. If IDs diverge, the live sync silently mismatches tracks and DB relationships break. Do not change `INITIAL_TRACKS` to use generated IDs.

---

## Environment Variables

Create a `.env` file in the project root. It is already in `.gitignore`.

```
# Required for SQLite — path to the database file
DATABASE_URL=./patchbay.db

# Required for sessions — generate a random string
SESSION_SECRET=replace-this-with-a-long-random-string

# Set automatically by npm scripts — do not set manually
# NODE_ENV=development
```

---

## Running the App

```bash
# Install dependencies (first time only)
npm install

# Start the development server (runs both Express backend + Vite frontend)
npm run dev
```

The app runs at: **http://localhost:3001**

Both the API (`/api/...` routes) and the frontend are served from port 3001.
Vite proxies API requests in development automatically via `server/vite.ts`.

Port 5000 is used by macOS AirPlay Receiver and cannot be used.

---

## Data Model (Types)

All core TypeScript types are defined in `client/src/lib/daw-data.ts`. This is the
single source of truth for the data model until each entity gets a proper Drizzle schema.

The key entities are:

### Song
The top-level container. Has a name, BPM, an ordered list of sections (e.g. "Intro",
"Verse 1", "Chorus"), and a list of InstrumentFolders.

### InstrumentFolder
One instrument's contribution to a song (e.g. "Drums", "Bass", "Vocals"). Contains
a list of Ideas, one per song section.

### Idea
A song section from a specific instrument (e.g. "Drums — Verse 1"). Contains multiple
Versions (takes/recordings the user has uploaded).

### Clip (Version)
A single uploaded audio file. Has:
- `src` — URL to the audio file
- `duration` — full length of the audio file in seconds (never modified by trim)
- `sectionName` — which section of the song it belongs to
- `isFinal` — whether this version has been marked as complete
- `trimStart` — seconds to skip from the beginning (0 = no left trim); only on `timeline_clips`
- `trimEnd` — cutoff point in seconds (null = no right trim, plays to end); only on `timeline_clips`
- `metadata` — BPM, key, time signature, format, uploaded-by, etc.
- `comments` — timestamped comments left by band members

### ProductionTask
A task in the production tracker. Has status (`todo`, `in-progress`, `complete`, `will-not-play`),
priority, assignee, due date, `instrument`, `sectionName`, and optional comments. One task is
bootstrapped per instrument × section combination using deterministic IDs `task-{trackId}-{sectionIndex}`.

---

## User Roles

PatchBay has three roles:

| Role | Permissions |
|---|---|
| **Band Leader** (admin) | Full read/write on all tracks. Can manage members, assign instruments, set due dates, change any status. |
| **Band Member** (power user) | Full edit rights on their own assigned instrument only. Read-only on others. Can create a personal version of a project. |
| **Engineer/Producer** (viewer) | Read-only. Can comment and @mention. Cannot upload or edit clips. |

When implementing auth or any permission checks, always consult this table.

---

## API Conventions

All API routes live under `/api/`. Define them in `server/routes.ts`.

Always return JSON. Use standard HTTP status codes. Wrap errors as:
```json
{ "message": "Human-readable error description" }
```

## File Uploads

The upload pipeline is fully implemented. Here's how it works end-to-end:

1. **Client** (`UploadModal` in `client/src/components/daw/UploadModal.tsx`) — `POST /api/upload` as multipart with fields: `file`, `instrument`, `section`, `ideaId`. On success, immediately fires `POST /api/ideas/:ideaId/clips` to persist the clip record to the DB.
2. **Server** (`server/routes.ts`) — multer uses memory storage (50MB limit, audio/* filter). The handler:
   - Counts existing clips for the idea to assign the next version number
   - Writes the buffer to `uploads/{instrument}_{section}_v{n}.{ext}`
   - Extracts duration via `music-metadata`'s `parseBuffer` — first attempt with mimetype, second without (auto-detect). Falls back to `duration = 5` if result is `< 1`
   - Returns `{ url: '/uploads/...', duration, format, originalFileName }`
3. **Static serving** — `server/index.ts` serves `/uploads` via `express.static` so `<audio src="/uploads/...">` works directly in the browser.

Files are stored in `uploads/` in the project root (git-ignored). Physical file naming convention: `{instrument}_{section}_v{n}.{ext}` where instrument and section are lowercased and spaces replaced with hyphens.

**Clip naming convention** differs by context:
- **Songs** (`songType === 'song'`): clip name = `${trackName} ${sectionName} V${n}` (PatchBay naming convention)
- **Ideas** (`songType === 'idea'`): clip name = original filename as uploaded (no renaming)

Video stripping (ffmpeg) is not yet implemented — audio-only uploads only for now.

---

## UploadModal Architecture

`UploadModal` lives in `client/src/components/daw/UploadModal.tsx` — the single upload dialog used everywhere in the app. It is imported by both `MediaBucket.tsx` and `Dashboard.tsx`.

```tsx
interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: string;
  defaultIdeaId?: string;         // pre-selects destination; user can still change
  defaultInstrumentName?: string; // used for physical filename when pre-filled
  defaultSectionName?: string;    // used for physical filename when pre-filled
  initialFiles?: File[];          // pre-populate pending file list on open
  songType?: 'song' | 'idea';     // controls clip naming convention (default: 'song')
  onUploadSuccess?: (result: { destTrackId: string; destIdeaId: string }) => void;
}
```

**Destination dropdown** — always shown at the top of the modal in a consistent position, visible before any files are added. Options format: `"{Instrument} → {Section}"` (e.g. `"Guitar 2 → Chorus 2"`). The selected value also displays in this format. When `defaultIdeaId` is provided, the dropdown pre-selects the matching option but the user can change it. When `defaultIdeaId` is not provided, it shows "Select Destination" placeholder.

**Instrument/section for physical filename** — `instrumentForUpload` and `sectionForUpload` use `defaultInstrumentName`/`defaultSectionName` props when the user hasn't changed the destination away from `defaultIdeaId`; otherwise fall back to `destTrack.name` / `destIdea.sectionName` from the DB. This matters for Ideas mode where the Dashboard passes `defaultSectionName = selectedFile.name` (the idea's display name) rather than the DB `sectionName`.

**Scrollable pending list** — `max-h-48 overflow-y-auto` with a thin custom scrollbar; scrolls when more than ~4 files are queued.

**Used in:**
- `MediaBucket.tsx` — opened by the header Upload button and by drag-drop onto the versions column or section rows
- `Dashboard.tsx` — opened by the FILES column Upload button and by drag-drop onto the FILES column; `defaultIdeaId` / `defaultInstrumentName` / `defaultSectionName` / `songType` pre-filled from current column selection

---

## Auth Architecture

Session-based auth using `express-session` (server-side sessions, cookie transport) and `bcrypt` (password hashing, cost 10).

### Server setup (`server/index.ts`)

```ts
declare module "express-session" { interface SessionData { userId: string; } }
app.use(session({
  secret: "patchbay-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
```

`storage.seedUsers()` is called at startup. It inserts the six core users (jordan, alex, jamie, sam, taylor, riley — all lowercase, all with password "password") using `INSERT OR IGNORE` semantics — safe to call on every boot. `storage.backfillBands()`, which runs immediately after, also seeds "Band B" and its demo user "zed" (password "password") using the same existence-check pattern — no manual `band-admin.ts` step required.

### Auth routes (`server/routes.ts`)

- **`POST /api/auth/login`** — normalizes `username` to lowercase, looks up via `storage.getUserByUsername`, compares password with `bcrypt.compare`, sets `req.session.userId`, returns user without password field.
- **`POST /api/auth/logout`** — calls `req.session.destroy()`, returns `{ ok: true }`.
- **`GET /api/auth/me`** — reads `req.session.userId`, fetches user from DB, returns without password; 401 if not logged in.
- **`GET /api/users`** — returns all users as `[{ id, username }]` (no passwords); used by assignee dropdowns and @ mention autocomplete.

### Username normalization

Usernames are stored and queried **lowercase** (seeded in lowercase; incoming login normalized with `.toLowerCase()`). The display layer capitalizes with `capitalize(s)` from `client/src/lib/utils.ts` — a pure helper that uppercases the first character only. **Never capitalize stored values; only the display layer capitalizes.**

`capitalize()` is applied at every username render site: assignee dropdowns, mention autocomplete, comment author labels, avatar initials, and activity feed descriptions (which embed usernames at the start of the string).

### Client auth context (`client/src/contexts/AuthContext.tsx`)

```ts
interface AuthUser { id: string; username: string; }
```

`AuthProvider` checks `GET /api/auth/me` on mount to restore session state. Exposes:
- `user: AuthUser | null` — null while loading or logged out
- `isLoading: boolean` — true during the initial /api/auth/me fetch
- `login(username, password): Promise<void>` — POSTs to /api/auth/login, sets user on success, throws with server message on failure
- `logout(): Promise<void>` — POSTs to /api/auth/logout, clears user

`useAuth()` hook throws if called outside `AuthProvider`.

### Route guard (`client/src/App.tsx`)

`RequireAuth` component: returns `null` while `isLoading`, renders `<Redirect to="/login" />` if `!user`, otherwise renders children. All non-login routes are wrapped in it. The `/login` route itself redirects to `/` if the user is already authenticated (`!isLoading && user`).

### AppHeader dropdowns (`client/src/components/AppHeader.tsx`)

The header right side has two separate dropdowns — no combined settings menu:

- **Gear icon** → workspace dropdown: Project Settings, Manage Access. No section label.
- **Avatar button** (shows user initials) → user dropdown: Notification Settings, Profile Settings, then a divider and Sign Out. Sign Out calls `logout()` from `useAuth()` then `setLocation('/login')` via wouter. No section label.

This split keeps workspace-level actions (shared settings, collaborator access) separate from per-user actions (personal preferences, session management).

**Project Settings modal** — opened via the gear dropdown's "Project Settings" item. Reads current values from `useQuery(['settings'])` and seeds draft state via `openProjectSettings()`. Contains three editable fields: Default BPM (number input), Default Instruments (inline tag editor), and Default Sections (inline tag editor). Tag editors render existing values as removable pills; an inline text input appears when the `+` Add button is clicked (autoFocus, confirmed on Enter or blur, dismissed on Escape). Footer has "Restore Defaults" on the left (resets draft to `FACTORY_INSTRUMENTS` / `FACTORY_SECTIONS` / `FACTORY_BPM` — does not save automatically) and Cancel / Save Changes on the right. Save calls `PATCH /api/settings` via `useMutation`; on success invalidates `['settings']` and closes the modal. `FACTORY_INSTRUMENTS`, `FACTORY_SECTIONS`, and `FACTORY_BPM` are module-level constants in `AppHeader.tsx` (not imported from Dashboard).

**New Project modal pre-population** — `Dashboard.tsx` fetches settings via `useQuery(['settings'])`. Opening the New Project modal calls `openProjectModal()` which seeds `newBpm`, `newSections`, and `newInstruments` from the live settings cache before setting `isNewProjectOpen = true`. `closeModal()` is separate and only closes + clears the name field — it no longer resets form state, so `openProjectModal()` is the single source of truth for initial values. `createSong.mutationFn` falls back to `settings?.defaultSections` / `settings?.defaultInstruments` when the user hasn't modified those fields.

### Seeded users

**The Zenith Passage** (default band — seeded by `seedUsers()` + `backfillBands()`):

| Username | Password |
|---|---|
| jordan | password |
| alex | password |
| jamie | password |
| sam | password |
| taylor | password |
| riley | password |

**Band B** (demo fixture — seeded by `backfillBands()`):

| Username | Password |
|---|---|
| zed | password |

Both bands and all seven users are seeded automatically on every server boot — no manual `band-admin.ts` step required. All usernames are lowercase. Passwords are bcrypt-hashed at cost 10 and are never returned by any API route.

### Author fields throughout the app

- **Client** — all components read `user?.username ?? 'Unknown'` from `useAuth()` and send it as `author` in POST/PATCH bodies (clip comments, task comments, review comments, mark-final actions).
- **Server** — `uploadedBy` (file upload) and `createdBy` (review upload) are resolved server-side via `req.session.userId → storage.getUser()`, falling back to `'Unknown'`. Never trust `author` from the request body for these two fields.
- **System comments** (status changes, clip-final events) use `author: 'System'` — never the request body author.

### Dynamic user list

`GET /api/users` is fetched via `useQuery(['users'])` in any component that needs a member list (assignee dropdowns in ProductionTracker, @ mention autocomplete in ClipInfoWindow and ReviewPlayer). TanStack Query deduplicates the request — all components share one network call per query key.

The `avatarColor(name)` helper in ProductionTracker and Clip.tsx uses a djb2-style hash of the username string to deterministically pick a color from a fixed palette — works for any username, not just members of a hardcoded array:
```ts
let h = 0;
for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
```

---

## Naming & Branding

- The app is called **PatchBay** — always, everywhere
- Old names ("Song-Weaver-Suite", "Studio Lux", "GoldTrack Studio", "rest-express") have all been replaced. No further renaming needed.
- The wordmark renders as `Patch` (white) + `Bay` (gold) using a `<span className="text-primary">` split. See `Workspace.tsx` line ~53 and `Dashboard.tsx` line ~51.
- The logo icon is a music note (`Music2` from lucide-react) in a gold gradient square
- Primary brand color: `#D4AF37` (gold) — referenced as `text-primary` / `bg-primary` in Tailwind
- Dark background: `#09090b` (near-black)
- Secondary surface: `#181C26` (dark blue-gray)

---

## What To Avoid

- **Do not edit files in `client/src/components/ui/`** — these are auto-generated shadcn components. If a UI component needs customization, wrap it rather than editing it directly.
- **Do not use `any` TypeScript types** — use the interfaces defined in `daw-data.ts` or `shared/schema.ts`.
- **Do not hardcode data in components** — mock data lives in `daw-data.ts`. Real data comes from API calls via TanStack Query. Never hardcode a username or author — always read from `useAuth()` on the client or `req.session.userId` → `storage.getUser()` on the server.
- **Do not break the existing UI** — the visual design is intentional and represents significant work. Backend changes should not require redesigning pages.
- **Do not add a PostgreSQL dependency** — we are using SQLite. Do not add `pg`, `postgres`, or `neon` packages.
- **Do not reintroduce free clip positioning** — clips on the timeline have no independent position. `clip.start` is always derived by `recalcAllStarts`, never set from a cursor pixel offset or stored as an arbitrary value. This is intentional.
- **Do not add overlap capability to the timeline** — PatchBay is plug-and-play, not a freeform DAW. Clips on the same track cannot overlap under any circumstances. The only valid drop targets are append-to-end or insert-between within a section column.
- **Do not remove Replit-specific vite plugins without updating `vite.config.ts`** — they are conditionally loaded only when `REPL_ID` is set, so they do no harm locally.
- **Do not set `isFinal` on clips or `timeline_clips` outside the established three-entry-point sync** — `PATCH /api/clips/:clipId`, `PATCH /api/timeline-clips/:id`, and `PATCH /api/production-tasks/:id` all cascade `isFinal` changes across bucket clips, timeline clips, and production task status using the same-name rule. A one-off `isFinal` write (direct DB update, ad-hoc route, or storage method call) will silently desync the three tables, leave stale checkmarks on same-name clip instances, and create inconsistent "Complete" task states. Always go through one of the three established entry points. See the "Same-name rule" section under isFinal ↔ task status bidirectional sync.
- **Do not set `trimStart`/`trimEnd` anywhere except `PATCH /api/timeline-clips/:id/trim`** — trim values on `timeline_clips` must only be written via this dedicated route. Setting them inline in `PATCH /api/timeline-clips/:id` or through ad-hoc DB writes bypasses the query-invalidation path that keeps `Timeline.tsx`'s local state in sync (the live-sync effect re-runs `recalcAllStarts` only when trimmed durations arrive via the normal API poll). Also: `clip.duration` must never be modified by trim — it always stores the full file length.
- **Query keys: always use `bucketKeys` from `client/src/lib/bucket-api.ts`** — never raw `['bucket', ...]` literals. This prevents drift when the key shape changes.
- **Bucket mutations live in `client/src/hooks/use-bucket-mutations.ts`** — surface-specific post-success behavior (auto-select, navigation, pending refs) goes in `onCreated` callbacks at the call site, not inside the hooks themselves.
- **Never force-remount a component via a `key` bump to refresh data** — invalidate the right query key instead. A `key` bump destroys all local state and races against any async callbacks that fire after the unmount.
- **Shared creation modals live in `client/src/components/daw/modals/`** — `AddInstrumentModal` and `AddSectionModal` are controlled presentational components; error state and mutation pending state come from the parent. Both accept `onClearError?: () => void` — the modal calls it on every input keystroke so the parent can clear a stale error message. Always pass this prop at call sites that set an error state.
- **Section "remove" is per-instrument soft-hide (`useHideIdea`)** — right-clicking a section in the bucket hides that idea for one instrument only (sets `active = false` on the `ideas` row) and is fully restorable. A song-wide section-delete endpoint (`DELETE /api/songs/:songId/sections/:sectionName`) exists and `useDeleteSection` was removed from the hook file as unused; do not re-add it without a product decision on whether full section deletion belongs in the UI.
- **Do not add heuristic fallbacks to `onAddToTimeline` or `handleDragEnd`** — track resolution must use the `trackId` carried in drag data / passed by `BucketClip`. Section resolution must read `clip.sectionName` directly. Previous versions used substring track-name matching with a silent `tracks[0]` fallback and derived sectionName by parsing the clip's filename — both silently misplaced clips, especially for idea-sourced uploads whose names are raw filenames. If `trackId` or `sectionName` is missing, warn loudly and bail.
- **Never omit `requireBand` from an API route** — every route under `/api/` must include `requireBand` as middleware. Routes without it bypass band scoping entirely and expose all bands' data. See the Route ownership rules section under Bands (multi-tenancy).
- **Never spread a partial/request-body object into Drizzle `.values()` or an ON CONFLICT `set:`** — build a filtered object with only the defined keys first. See the "Partial updates" rule under Bands (multi-tenancy). Drizzle safely skips `undefined` in plain `.set()` UPDATEs, but JS spread in `.values()` + conflict upsert will overwrite NOT NULL columns with `undefined` before Drizzle sees the data.
- **When adding a route that touches two independent entity IDs, assert ownership on both** — `assertSongOwned` / `assertAlbumOwned` only cover the single ID passed in; they say nothing about any other ID in the same request body or URL. See the "Two-ID routes" rule under Bands (multi-tenancy).
- **`instrument_tracks.pan` writes only go through `PATCH /api/tracks/:trackId`** — same single write path as `volume`; there is no separate pan-specific route. Do not add one.

---

## Development Tips for Non-Developers

- **When the terminal says "port already in use":** run `pkill -f tsx` then try `npm run dev` again.
- **When TypeScript shows red underlines in VS Code:** this is usually a type error. Ask Claude Code to fix it before running.
- **The app auto-reloads** when you save a file — you don't need to restart `npm run dev` after most changes.
- **Server changes** (anything in `server/`) require the dev server to restart. Stop it with `Ctrl+C` and run `npm run dev` again.
- **If the page shows a blank screen**, open the browser console (right-click → Inspect → Console tab) and copy the red error text for Claude Code.
- **If the Vite cache gets stale** (e.g. after adding a new npm dependency to a component for the first time): stop the server, run `rm -rf node_modules/.vite`, then `npm run dev` again.
- **The dev server must be running** for the app to work. If you close the terminal it stops. Run `npm run dev` to restart it.

## If the App Goes Down

The app at `http://localhost:3001` can go offline after certain changes. Here's how to diagnose and fix it quickly.

### Step 1 — Check the terminal
Look at the VS Code terminal where `npm run dev` is running. The cause is almost always visible there as a red error message. Common ones:

- **`SyntaxError` or `TypeError`** — a code change introduced a bug that crashed the server. Share the red error text with Claude Code and ask it to fix it.
- **`EADDRINUSE: address already in use`** — a previous server process didn't shut down cleanly. Run `pkill -f tsx` then `npm run dev` again.
- **`Cannot find module`** — a new file or function was referenced before being created. Share the error with Claude Code.

### Step 2 — Restart the server
If the terminal looks frozen or shows no output, stop it with `Ctrl+C` and run:
```bash
npm run dev
```

### Step 3 — Hard refresh the browser
If the server is running but the browser shows a blank page or stale content, try `Cmd+Shift+R` in Safari to force a full reload bypassing the cache.

### When to ask Claude Code to verify
Claude Code should confirm the app is running after any change to:
- `server/index.ts` or `server/routes.ts`
- `vite.config.ts`
- `package.json` (adding or removing packages)
- `shared/schema.ts` (database schema changes)

For frontend-only changes (components, styles, pages), a server restart is not needed — Vite hot-reloads these automatically.

---

## Deep-Dive Architecture Notes — Where They Live

To keep this file loadable in every session without bloating context, subsystem-specific
implementation notes have moved to files that load only when relevant. The safety-critical
"never do X" rules from these areas are already restated in "What To Avoid" above — nothing
load-bearing depends on these loading at the right moment.

| Topic | Location | Loads when |
|---|---|---|
| Timeline drag-and-drop internals (section columns, droppable zones, `recalcAllStarts`, stale-closure rules), audio playback system, track panning (Web Audio graph, `panNodesRef`/`ensurePanNode`), Safari playback-start failure (parked investigation), non-destructive trim + AI trim detection, apply/reset trim to instances, Media Bucket internals (add section, hidden-tracks invalidation, empty state, session persistence, new-content indicator), Timeline Selection, clip session notes / More Info panel, Musical Intelligence & Meta Tags, timeline clip waveform, Timeline background/clip right-click menus, placement feedback, keyboard shortcuts, pinch-to-zoom, AlertDialog focus management, Sticky Panel & Scroll Guards, Timeline playhead & occlusion, Production Tracker scroll container architecture, clip trim visual redesign, free-position (reverted) notes, shared CornerBadge component (final/comment badge styling, used by both TimelineClip and WaveformPlayerCard) | `client/src/components/daw/CLAUDE.md` | Editing a file under `client/src/components/daw/` |
| Bands (multi-tenancy) schema, startup backfill, session plumbing, storage additions, Phase 2 query scoping, route ownership rules, band admin & first-login | `server/CLAUDE.md` | Editing a file under `server/` |
| isFinal ↔ task-status bidirectional sync, Complete status guard, clip addition → task in-progress, Replace flow isFinal handling | `.claude/skills/isfinal-sync/SKILL.md` | Working on final-clip / task-status logic |
| Review tab architecture (waveform player, comments, @mentions, avatar markers) | `.claude/skills/review-tab/SKILL.md` | Working on the Review tab |
| Activity feed architecture, Promote to Song | `.claude/skills/activity-feed/SKILL.md` | Working on the activity feed or Dashboard |
| Full API endpoint reference | `.claude/skills/api-reference/SKILL.md` | Adding or modifying an API route |
| Feature-by-feature build status ("Core Features & Status") | `.claude/skills/feature-status/SKILL.md` | Checking whether a feature is built |
| Deployment (Railway) steps, schema migration safety (why `drizzle-kit push` is banned from production) | `.claude/skills/deploy/SKILL.md` | Deploying the app, or making any change to `shared/schema.ts` |

## Doc Sync & Permissions

**Master vs. codebase copy:** This document (`CLAUDE.md`) is authored and maintained as a master
copy in a Claude.ai Project. The codebase's root `CLAUDE.md` is a derived, trimmed copy — never
the source of truth. If the two ever disagree, the Claude.ai master wins.

**Sync workflow:**
1. Edit the master in the Claude.ai Project.
2. Paste the full updated master over the codebase's root `CLAUDE.md`.
3. Run `/sync-claudemd` to route subsystem-specific sections back out to their split files
   (`client/src/components/daw/CLAUDE.md`, `server/CLAUDE.md`, and the task-specific
   `.claude/skills/*/` folders — see the "Deep-Dive Architecture Notes" table above), trimming
   root back down.
4. Expect root `CLAUDE.md` to look noticeably shorter than the master at all times — that's
   intentional, not drift.

**Known gaps in this process (no automated enforcement yet):**
- Sync is manual — if a master edit isn't pasted + synced, the codebase silently runs on a stale
  copy indefinitely. Treat "sync after every master edit" as a required last step, not optional.
- If a split file is edited directly mid-session (e.g. patching `isfinal-sync/SKILL.md` while
  debugging a real bug), that change does NOT automatically flow back into the master. Fold any
  such edits back into the Claude.ai master by hand, or the two will silently diverge.

**Permission mode:** Claude Code's global default is `auto` (routine actions approved by a
safety classifier rather than prompting every time). Auto mode auto-approves plain `git push`,
including to `main`, by default — it only holds back force-push, remote branch/tag deletion,
history rewrites, and pushes to deploy-named branches (`production`, `release`, `gh-pages`).
**PatchBay's Railway deployment auto-builds and deploys on every push to `main`.** Until
2026-08-11, `npm start`'s `prestart` hook ran `drizzle-kit push --force` on every boot, which
skipped Drizzle's normal confirmation for destructive schema changes and caused a full
production crash loop that day (see "Schema changes — drizzle-kit push is banned from
production" in `.claude/skills/deploy/SKILL.md` for the incident and fix). That specific hook
has since been removed — `npm start` now runs `node dist/index.cjs` directly, with no
drizzle-kit involved at boot. The underlying exposure remains, just narrower: a plain `git push`
to `main` still applies whatever is on the branch straight to production with no review gate, so
any other breaking change (code or schema) ships the same way. An explicit override is set in
`~/.claude/settings.json` (user scope — applies to all projects, not just PatchBay):
`"permissions": { "ask": ["Bash(git push *)"] }`. This forces every `git push` to prompt for
confirmation regardless of what the classifier would otherwise decide. **Do not remove this
rule** — it wasn't what caught the 2026-08-11 incident (that fix was reviewed before pushing),
but it remains the only gate standing between any future unreviewed change and production.

## CLAUDE.md Maintenance

**2026-08-11 — ran Claude Code's `/doctor` health check on the PatchBay codebase.** Installation,
extensions, hooks, and version all came back healthy. The one real finding: the codebase's copy
of this document was 258,533 characters and loaded in full into every Claude Code session
regardless of task — about 6.5x the size where Claude Code normally warns about an oversized
context file.

**Decision — split the codebase copy only** into a small root file plus subsystem-specific files
that load only when relevant. No content was deleted, just relocated. See "Doc Sync &
Permissions" above for the ongoing workflow this created.

**Also changed — set Claude Code's permission mode to `auto` globally.** Surfaced the deploy
risk described above; added an explicit `ask` override for `git push` (see "Doc Sync &
Permissions" above) as the compensating control.

## Version Control

Git is initialized. The first commit ("Working file upload pipeline — bucket → timeline drag and drop") was made on 2026-05-01 and captures the full working state: timeline, drag-and-drop, Media Bucket with real uploads, all API endpoints.

Commit after every meaningful working milestone:
```bash
git add .
git commit -m "Brief description of what was built"
```

If something breaks badly, `git stash` or `git checkout .` can revert all uncommitted changes instantly.

`.gitignore` includes: `node_modules/`, `dist/`, `.env`, `patchbay.db`, `patchbay.db-shm`, `patchbay.db-wal`, `uploads/`, `.local/`.

---

## Open Questions / Decisions To Make

These are things that need a decision before being built:

1. **File storage for deployment:** Where do uploaded audio files live when PatchBay is on
   the internet? Options: local disk (simple, free, not scalable), AWS S3, Cloudflare R2.
   Start with local disk; plan to abstract behind a storage interface.

2. ~~**Authentication provider:**~~ **Resolved.** Basic session auth is implemented using `express-session` + `bcrypt`. Seven seeded users exist across two bands: six on The Zenith Passage (jordan/alex/jamie/sam/taylor/riley) and zed on Band B. Role-based permissions (Band Leader / Band Member / Engineer) are the next auth milestone — they are defined in the data model but not yet enforced.

3. **Real-time vs async:** The spec calls for async collaboration to start. WebSockets (`ws`)
   is installed. Leave real-time for a future milestone.

4. ~~**Song sections as user-defined vs enum:**~~ **Resolved.** Sections are stored as a JSON
   array of strings (`text` column with `mode: "json"`) on the `songs` table. Fully flexible.

---

## Known Issues

- **Playback stutter / fails to start on first press (Safari) — parked, unresolved** — the original minor stutter on pressing play is still unexplained on its own (unrelated to the session-state persistence work). This session confirmed a related but more severe symptom via manual testing in real Safari.app: playback fails to start on first press more than 50% of the time. Root cause not yet isolated — a code-level race in `Timeline.tsx`'s rAF playback loop (`audio.play()` firing before `ensurePanNode()`'s Web Audio graph wiring completes, no gate between them) is a lead, not a confirmed cause. Could not be reproduced via headless WebKit (Playwright) as a Safari proxy — real Safari.app is required for any future investigation. Full investigation notes and the headless-repro gotcha: see "Safari playback-start failure" in `client/src/components/daw/CLAUDE.md`.
- **Deleting the currently-looped section correctly disables looping** — the generalized disable-on-reposition watcher catches the transition from a real section to `null` (no section) the same way it catches any other section change, so `isLooping` is set to `false` and `loop-force-disabled` is dispatched cleanly. No lingering state issue.
- **`activity_log.author` is nullable; pre-existing rows have `author=null`** — the column was retrofitted after initial `activity_log` usage. Rows written before the retrofit have no author and will not contribute to any user's personalized "Your Songs" sort. This is acceptable — those events are old and the sort degrades gracefully to `createdAt` for songs with no user-attributed activity.
- **Playhead visual position vs. scroll-state desync — suspected, unconfirmed** — during manual testing of the edge-scroll rebuild, two screenshots appeared to show the rendered playhead position and the actual scroll state disagreeing. Investigated via headless Playwright automation with frame-by-frame position sampling through a full held-drag-and-release cycle; no discontinuity exceeding normal per-frame movement was found in that environment. Per this project's own precedent with the Safari playback-start-failure investigation (never reproducible in headless WebKit despite being real on real hardware), a clean headless result is not proof the desync doesn't exist on real hardware — treat as open, not resolved, pending a deliberate real-browser reproduction attempt.
- **Playhead release snap — suspected, unconfirmed** — a visible snap was reported at the moment of releasing the pointer during active edge-scroll. The fix believed responsible for this class of bug (deferring time-value updates to the rAF loop instead of firing on every pointermove event during active edge-scroll, to prevent render-scheduling contention) was confirmed still intact in the code after the later redesign, but the snap itself was not reproducible via headless Playwright automation (no main-thread stalls or frame gaps found near release across multiple targeted repro attempts). Same caveat as the visual-desync item above — treat as open pending real-browser confirmation.
- **Timeline content pop-in on page load (parked, low priority)** — `tracks` starts as an empty array on mount; the entire track/clip grid (headers, section bands, clips, waveforms) appears in a single commit when `GET /api/songs/:id/timeline` resolves (~130–140ms locally; could be worse in production). No loading skeleton exists. Confirmed via real-browser testing to be pre-existing and independent of the scroll-persistence work (see "Timeline — session persistence" in `client/src/components/daw/CLAUDE.md`). A secondary, related effect: individual clip waveforms decode and render asynchronously per-clip after the grid appears, with no ordering guarantee tied to track position — decode time appears to scale with clip duration/file size rather than screen position, so a top-of-list track can render its waveform after a lower one. Proper fix (loading skeleton or suspense boundary) is a bigger scope decision, not a quick patch — not scheduled.

---

## Albums
- Albums are non-exclusive ordered containers. They are NOT lifecycle status — never use membership
  to mean "in demo phase"; that's a future songs.status field.
- No type field on albums by design: hardcore bands ship EPs named "demo 2026" — the name carries meaning.
- **Schema:** `albums` (id, name, createdAt — no type, no status). `album_songs` join (albumId, songId,
  sortOrder). Cascade: deleting an album deletes its `album_songs` rows but NEVER deletes songs.
  The `songs` table is untouched by album operations.
- **Endpoints:**
  `GET/POST /api/albums` · `PATCH/DELETE /api/albums/:id` · `GET/POST /api/albums/:id/songs` ·
  `DELETE /api/albums/:id/songs/:songId` · `PATCH /api/albums/:id/songs/:songId/move` (body: `{ direction: 'up' | 'down' }`) ·
  `GET /api/album-memberships` (flat rows; client builds `songId → albumNames[]` map).
- **Query keys:** `['albums']` (list) · `['album-songs', albumId]` (tracklist) · `['album-memberships']`
  (membership map). All three are invalidated by every membership mutation (add, remove, move).
- **Ordering:** server assigns `sortOrder = max(existing) + 1` on add (append); Move Up/Down swaps
  the two adjacent rows' `sortOrder` values. Song picker appends in songs-list order. Future:
  drag-reorder replaces Move Up/Down.
- **Duplicate album names:** rejected client-side case-insensitively in `handleCreateAlbum` /
  `handleRenameAlbum`; the API itself allows them (consistent with sections/instruments convention).
- **UI surface** (all in `Dashboard.tsx`): Library filter pill (`filter=albums`), two-column browser
  (albums column + numbered tracklist), Add Album modal (shared-modal conventions), song picker
  (header `+` / empty-state button — see picker bullet below), Add to Album context submenu on song
  rows in the Songs browser. Tracklist rows click → Song Home. Song rows show a Disc icon + tooltip
  membership indicator only; full membership editing is in the album browser, not the song row.
- shadcn TooltipContent gotcha: overriding bg without setting text color leaves text-primary-foreground
  (near-black in this theme) — always set text color when restyling tooltips dark.
- Album membership has two doors by design: song-side right-click (encounter intent, single) and
  album-side picker via tracklist `+` / empty state (curation intent, batch). The picker adds only —
  ordering stays in the tracklist.
- Album song picker: `isAlbumSongPickerOpen` state; opened by Tracklist column header `+` (hover-reveal,
  enabled only when album is selected) and by the empty-tracklist "+ Add songs" button. Shows all
  `type === 'song'` entries; already-in-album rows are checked + disabled + "already added" label.
  POSTs each selected song sequentially in list order (append semantics), then invalidates the three
  query keys once and shows a gold toast.
- Album selection is URL-state (`albumId` param), same pattern as `songId` in the Songs browser —
  refresh and deep links restore selection. Uses a separate `appliedAlbumSearchRef` (not the shared
  `appliedSearchRef`) so it isn't pre-empted by the `[songs, search]` effect. Any future Library
  browser must join this convention. Deselection is natural: navigating to any other filter drops the
  `albumId` param from the URL.

## Creation chooser pattern

- Header creation button is **"+ Create New"** (not "New Project") — opens the chooser dialog titled
  **"Create new…"** with Song / Idea / Album cards. Button + dialog title form a sentence.
- New creatable types get a card in this chooser — do not add a separate button to the header.
- **Deliberate-choice pattern is intentional (taxonomy protection):** do not replace the chooser with
  a default-action split button. The three entity types (Song / Idea / Album) are distinct enough
  that defaulting to one would train users to misfile content.
- Album card: closes the chooser and opens the existing `isAddAlbumOpen` / Add Album modal.
  `createAlbumMutation.onSuccess` navigates to `/?tab=files&filter=albums` and sets `selectedAlbum`
  so the new album is highlighted in the Albums browser immediately on arrival.

## Bands (multi-tenancy)

PatchBay is multi-tenant: each band sees only its own songs, albums, and ideas. The tenancy model
is intentionally server-side and session-bound — the `bandId` a user sees is the one stored in
the `users` table, resolved at login and cached in the session. It is never read from client input
or URL parameters.

### Tenancy rule — same class as `isFinal`

> **The band a session belongs to is always resolved server-side from `req.session.bandId` (set
> at login) or from `users.bandId` (lazy-populated by `enrichSessionBand` for pre-existing
> sessions). Never use a bandId from the request body or URL params for scoping queries.**

Violating this rule lets a user scope queries to a band they don't belong to, exactly as setting
`isFinal` outside the three established entry points silently desyncs the bucket/timeline/tasks.

## Recently fixed bugs

- **Production task duplication** — `insertProductionTaskForSection`'s `onConflictDoNothing()` guard was decorative (only catches identical generated IDs, which independent `randomUUID()` calls never produce). Fixed structurally by the `trackId` FK below; 21 pre-existing duplicate rows repaired.
- **Task-to-track association was name-based, not ID-based** — `getProductionTasks` matched on `(songId, instrument name, active)`, which misattributed tasks when two tracks shared a name (e.g. one hidden, one active). Added `trackId` column to `production_tasks` with FK to `instrument_tracks`; all task creation and read paths now join on `trackId`. 1,508 rows backfilled.
- **Instrument name uniqueness** — tracks can no longer share a name within a song, active or hidden. Full `UNIQUE(songId, name)` index (not partial); 409 checks and client-side guards updated across MediaBucket, Production Tracker, Dashboard. Error message points to the restore option when the conflicting name is hidden.
- **Restore action left stale UI** — `useRestoreTrack` now invalidates `['production-tasks', songId]`; Production Tracker's restore modal now closes on success (previously only MediaBucket did).
- **Instrument `sortOrder` always hardcoded to 999** — caused new instruments to render alphabetically (via a leftover partial index SQLite's planner preferred, stable-sorting ties in alphabetical order). Fixed to `MAX(sort_order) + 1` per song; 57 existing rows repaired; leftover partial index dropped. No secondary sort tiebreaker added — manual drag-to-reorder is planned and will own this.
- **Section `sortOrder` divergence across tracks** — fixed structurally by the section-add redesign below. Section creation is now a single atomic server-side operation (`POST /api/songs/:songId/sections`) that computes `sortOrder` once (`MAX(existing) + 1`) and shares it across all tracks, replacing the old per-track `Promise.all` flow. No secondary sort tiebreaker (manual drag-to-reorder is planned and will own this).
- **Section restore modal not closing** — Production Tracker's `restoreSectionMutation.onSuccess` was missing the modal-close state resets (`setIsAddSectionOpen(false)`, etc.) that the instrument-restore counterpart already had. Fixed to match.
- **Dashboard "Your Songs" sort not reflecting real activity** — Previously the sort only moved on song creation or direct song metadata edits. Root cause: nearly all mutations never wrote to `activity_log` and/or never invalidated `['songs']` client-side, so `getSongsWithLastActive` had no data to rank by and the Dashboard sort was effectively `createdAt`. Fixed across ~45 mutations spanning `Timeline.tsx`, `Clip.tsx`, `ProductionTracker.tsx`, `use-bucket-mutations.ts`, upload flows, reviews, and `Dashboard.tsx`. Two related sub-bugs found and fixed along the way: (a) several routes stored `req.body.author` verbatim instead of resolving the session user — production task status-change comments and review comments were affected; fixed at the server, `author` removed from client request bodies; (b) task status changes and mark-final actions only wrote to `task_comments` and never reached `activity_log` at all — fixed by adding explicit `logActivity()` calls for `task-status-change` and `marked-final` types, and suppressing the redundant tier-1 synthesis of those two event types from `task_comments` to avoid feed duplication.
- **Railway deploy crash loop from `drizzle-kit push --force` in `prestart`** (2026-08-11) — any schema change to an FK-referenced table (here, adding `instrument_tracks.pan`, referenced by `production_tasks.trackId` and `timeline_clips.trackId`) forces drizzle-kit's SQLite push into a table-recreate strategy (`CREATE new table → copy rows → DROP old → RENAME`). That strategy's `PRAGMA foreign_keys=OFF` toggle is a documented SQLite no-op when run inside an already-open transaction, which is exactly how drizzle-kit runs it — so FK enforcement stayed active through the `DROP TABLE` step and threw `SqliteError: FOREIGN KEY constraint failed` on every boot, leaving production completely unreachable. Production data was confirmed intact afterward: zero FK violations, `PRAGMA integrity_check: ok`, no leftover staging tables (the failed push rolled back cleanly inside its own transaction). Fixed by removing `prestart`'s `drizzle-kit push --force` entirely — schema changes now go exclusively through the idempotent `pragma_table_info`-guarded `ALTER TABLE` pattern in `server/db.ts`, which runs safely at server startup regardless of FK relationships. `drizzle-kit` remains available as a manual, local-dev-only `npm run db:push` command. Full mechanism and the broader "no schema change to an FK-referenced table is safe via `drizzle-kit push`" rule: see "Schema changes — drizzle-kit push is banned from production" in `.claude/skills/deploy/SKILL.md`.
- **Playhead edge-scroll drag — full rebuild and UX tuning** — The playhead flag's edge-scroll-while-dragging behavior was rebuilt around a canonical time-value architecture: time is always derived fresh from pointer position + scrollLeft, computed identically in the pointer-move handler and the auto-scroll rAF loop, with no independently-tracked time state. This eliminated a category of bugs from an earlier implementation (dead zones near t=0/timelineEnd, snap-to-wrong-position on release, jump-and-relocate mid-drag) that were traced to two competing "authorities" over the time value. Additional fixes in the same effort: (a) direction reversal mid-scroll now stops promptly — auto-scroll direction previously responded only to static zone membership, not actual pointer travel direction; (b) the right-edge auto-scroll cap now correctly centers the final clip in the visible track area (accounting for the 256px instrument panel), rather than the full container width; (c) a minimum cumulative-drag-distance gate (tuned to 72px) prevents a static click-and-hold inside the edge zone from engaging on the first sub-pixel jitter. Zone-trigger thresholds tuned to 150px (engage) / 210px (release) for feel. See "Timeline playhead & occlusion" for full mechanism details.
- **Timeline/Media Bucket final and comment badge inconsistency** — the two surfaces had independently-styled, duplicated badge JSX (Timeline used solid corner badges; Media Bucket used an inline checkmark next to the clip name plus a separately-styled comment badge). Fixed by extracting a shared `CornerBadge` component (`variant: 'final' | 'comment'`, `corner: 'top-right' | 'bottom-right'`) now used by both `TimelineClip` and `WaveformPlayerCard`/`BucketClip`. Media Bucket's final indicator moved from an inline icon to a top-right corner badge to match; duration text shifts left (`mr-4`) when a clip is final to avoid collision. Also fixed a related bug where the `isFinal` ring (`ring-1 ring-primary/50`) on the Timeline clip container was invisible everywhere except at the seam between two adjacent clips, where it rendered as an unwanted gold line — the ring was removed entirely since the badge alone communicates final status.

---

## On the horizon

- **Per-instrument hidden sections invisible to Production Tracker** — confirmed via real data (`ideas.active=false` scoped to one track has no effect on cell rendering, since `findTask` doesn't join `ideas`). Design decision needed: dim/disable the cell vs. also gate the complete-status guard.
- **Manual drag-to-reorder (instruments + sections)** — instrument `sortOrder` data is now clean and ready; sections `sortOrder` is now clean too (fixed by section-add redesign).
- **Production Tracker's song-wide `hideSectionMutation` has no error handling** — sends bare `fetch()` PATCH calls with no `res.ok` check; a failed request silently drops with no error toast. Fix: match `useHideIdea`'s error-handling pattern.
- **Section row-label right-click trigger has no visual affordance** — Production Tracker's sticky left column section labels are right-clickable ("Remove Section") but there's no hover indicator, unlike instrument column headers' hover-reveal `+`. Consider a tooltip or hover-reveal `···` button.
- ~~**Activity feed feed-worthiness audit (not started)**~~ **Resolved 2026-08-12.** Every Tier 2 event type was audited and classified feed-visible vs. sort-only, and that classification is now enforced server-side via a `notInArray` filter in `getActivity()` — previously it was documentation intent only, and every sort-only type leaked through as a visible feed row. Full per-type classification and rationale: see "Tier 2 event types — full reference" in `.claude/skills/activity-feed/SKILL.md`.
- **Media Bucket clip name truncation not working** — `WaveformPlayerCard`'s clip name text never truncates with an ellipsis regardless of available width or name length; full text always renders. Not yet investigated — likely a `min-w-0` missing on a flex ancestor between the name `<span>` and the outer card container, but unconfirmed. Surfaced while testing the CornerBadge unification (Aug 2026); may be pre-existing and unrelated to that change.
