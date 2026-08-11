---
name: activity-feed
description: Architecture of PatchBay's cross-song and per-song activity feed — the two-tier event sourcing model, ActivityEvent shape, deep-link routing (activityUrl), and the "Promote to Song" Ideas-to-Song flow. Use when adding a new activity event type, debugging feed entries, or working on Dashboard/Promote to Song.
---

## Activity feed — ✅ Built

The activity feed aggregates recent events across the app into a unified timeline. It lives in `server/storage.ts` as `getActivity(songId?: string)` and is exposed via two routes.

**`ActivityEvent` interface (in `storage.ts`):**
```ts
interface ActivityEvent {
  type: 'file-added' | 'marked-final' | 'clip-comment' | 'task-comment' | 'status-change'
      | 'review-shared' | 'clip-unmarked-final' | 'clip-replaced' | 'clip-added-to-timeline'
      | 'clip-removed-from-timeline' | 'section-added' | 'section-deleted'
      | 'track-added' | 'track-deleted' | 'review-comment' | 'review-reply'
      | 'song-created' | 'idea-created';
  description: string;
  timestamp: number;
  songId: string;
  songName: string;
  instrument?: string;
  sectionName?: string;
  taskId?: string;
  // present on clip-comment and task-comment events for differentiated routing
  source?: 'clip' | 'task';
  clipId?: string;
  // present on review-shared, review-comment, review-reply for deep-link routing
  reviewId?: string;
  commentId?: string;
}
```

**Two-tier event sourcing:**

Events come from two sources that `getActivity()` merges and sorts by timestamp:

**Tier 1 — existing tables (text-parsed at read time):**
1. **`file-added`** — one event per `clips` row (joined through `ideas → instrument_tracks → songs`). Description: `"{uploadedBy} added {clipName} to {trackName} — {sectionName}"` — actor resolved from `clip.metadata.uploadedBy`, falling back to `'Someone'`. Timestamp: `clip.createdAt`.
2. **`marked-final`** — from `task_comments` rows where `text.startsWith('Clip marked as final:')`. Clip name extracted from the text. Timestamp is the moment the user marked it final. Includes `taskId`.
3. **`clip-comment`** — from `clip_comments` where `isNull(parentId)` (top-level only — replies are excluded to avoid duplicate events). Joined through `clips → ideas → instrument_tracks → songs`. `author = 'Unknown'` renders as `"You"`. Description: `"You commented on {trackName} · {sectionName}"`. Includes `source: 'clip'` and `clipId`.
4. **`task-comment` / `status-change`** — from `task_comments` where `isNull(parentId)` (top-level only). Joined through `production_tasks → songs`. Routed by text pattern — see routing rules below.
5. **`review-shared`** — one event per `song_reviews` row. Description: `"{createdBy} exported {name} to Review"`. Song-level only (no `instrument` or `sectionName`).

**Tier 2 — `activity_log` table (type + description stored verbatim at write time):**

All tier-2 events resolve the actor from `req.session.userId → storage.getUser()?.username`, falling back to `'Someone'` if the session can't be resolved. The pattern appears at the top of each route handler as a const before the `logActivity` call.

**Structural events (feed-visible and user-visible):**

6. **`clip-added-to-timeline`** — logged from `POST /api/tracks/:trackId/clips`. Description: `"{user} added {clipName} to {trackName} — {sectionName}"`.
7. **`clip-removed-from-timeline`** — logged from `DELETE /api/timeline-clips/:id`. Description: `"{user} removed {clipName} from {trackName} — {sectionName}"`.
8. **`clip-replaced`** — logged from `PATCH /api/timeline-clips/:id` when name+src both change. Description: `"{user} replaced {oldName} with {newName} in {trackName} — {sectionName}"`.
9. **`clip-unmarked-final`** — logged from `PATCH /api/timeline-clips/:id` and `PATCH /api/clips/:clipId` on `isFinal=false`. Description: `"{user} unmarked {clipName} as final"`.
10. **`marked-final`** — logged from the complete-status guard in `PATCH /api/production-tasks/:id`. Description: `"Clip marked as final: \"{clipName}\""`. Note: tier-1 synthesis of `marked-final` from `task_comments` rows is now suppressed (those rows still exist for audit; the tier-2 event covers the same action).
11. **`task-status-change`** — logged from `PATCH /api/production-tasks/:id` when `status` changes. Description: `"{user} changed {instrument} · {sectionName} to {label}"`. Tier-1 synthesis of `status-change` from `task_comments` rows is suppressed to avoid duplication.
12. **`section-added`** — logged from `POST /api/tracks/:trackId/ideas` with 5-second dedup. Description: `"{user} added section {sectionName}"`. **Skipped entirely when the parent song has `type='idea'`** — sub-bucket creation for idea Parts is an invisible implementation detail. The type check fetches the song via `storage.getSongById(ideaTrack.songId)` after the dedup check.
13. **`section-deleted`** — logged from `DELETE /api/songs/:songId/sections/:sectionName`. Description: `"{user} deleted section {sectionName}"`.
14. **`section-restored`** — logged from `POST /api/songs/:songId/sections/restore`. Description: `"{user} restored section {sectionName}"`.
15. **`idea-hidden`** — logged from `PATCH /api/ideas/:ideaId` (active=false). Description: `"{user} hid section {sectionName} on {trackName}"`.
16. **`idea-restored`** — logged from `POST /api/ideas/:ideaId/restore`. Description: `"{user} restored section {sectionName} on {trackName}"`.
17. **`track-added`** — logged from `POST /api/songs/:songId/tracks`. Description branches on parent song type: `"{user} added a part — {trackName}"` when `song.type === 'idea'`; `"{user} added an instrument — {trackName}"` when `song.type === 'song'`. Song is fetched via `storage.getSongById(req.params.songId)` after track creation.
18. **`track-deleted`** — logged from `DELETE /api/tracks/:trackId`. Description: `"{user} deleted an instrument — {trackName}"`.
19. **`track-restored`** — logged from `POST /api/tracks/:trackId/restore`. Description: `"{user} restored instrument — {trackName}"`.
20. **`song-deleted`** — logged from `DELETE /api/songs/:id`. Song name is fetched BEFORE deletion so it survives the DELETE. Description: `"{user} deleted song — {songName}"`.
21. **`review-shared`** — logged from `POST /api/songs/:songId/reviews`. Description: `"{user} shared {name} to Review"`. (Also synthesized tier-1 from `song_reviews` rows — both coexist.)
22. **`review-comment`** — logged from `POST /api/reviews/:reviewId/comments` (top-level). Description: `"{author} commented on {reviewName}"`.
23. **`review-reply`** — logged from `POST /api/reviews/:reviewId/comments` (reply). Description: `"{author} replied to {parentAuthor}'s comment on {reviewName}"`.
24. **`song-created`** — logged from `POST /api/songs` when `type !== 'idea'`. Description: `"{user} created a new song — {name}"`.
25. **`idea-created`** — logged from `POST /api/songs` when `type === 'idea'`. Description: `"{user} created a new idea — {name}"`.

**Sort-data-only events (written to `activity_log` so `getSongsWithLastActive` can rank the song; not yet evaluated for feed display — see "On the horizon"):**

26. **`file-uploaded`** — logged from `POST /api/ideas/:ideaId/clips`. Bumps the song in the sort even though `file-added` is already synthesized tier-1 from the `clips` table.
27. **`clip-removed`** — logged from `PATCH /api/clips/:clipId { active: false }` (bucket clip soft-delete).
28. **`clip-metadata-edited`** — logged from `PATCH /api/clips/:clipId` when only metadata changes.
29. **`clip-comment-added`** / **`clip-comment-reply`** — logged from `POST /api/clips/:clipId/comments`.
30. **`clip-comment-edited`** / **`clip-comment-deleted`** — logged from `PATCH`/`DELETE /api/clip-comments/:id`.
31. **`task-comment-added`** / **`task-comment-reply`** — logged from `POST /api/production-tasks/:id/comments`.
32. **`task-comment-edited`** / **`task-comment-deleted`** — logged from `PATCH`/`DELETE /api/task-comments/:id`.
33. **`review-comment-edited`** — logged from `PATCH /api/review-comments/:id` when `text` changes.
34. **`review-comment-resolved`** / **`review-comment-unresolved`** — logged from `PATCH /api/review-comments/:id` when `resolved` changes.
35. **`review-comment-deleted`** — logged from `DELETE /api/review-comments/:id`.
36. **`volume-changed`** — logged from `PATCH /api/tracks/:trackId` when `volume` changes.
37. **`clip-trimmed`** — logged from `PATCH /api/timeline-clips/:id/trim` and the general PATCH when trim values change.
38. **`timeline-reordered`** — logged from `PATCH /api/timeline-clips/:id` when `start` changes without a name/src change.
39. **`timeline-cleared`** — logged from `DELETE /api/songs/:songId/timeline-clips/non-final`.

**`task-comment` routing (tier 1, event type 4):**
   - `text.startsWith('Status changed to ')` → **skipped** (now covered by tier-2 `task-status-change` events written at mutation time; suppressed to avoid duplication).
   - `text.startsWith('Clip marked as final:')` → **skipped** (now covered by tier-2 `marked-final` events written at mutation time via the complete-status guard; suppressed to avoid duplication).
   - `text.startsWith('Clip unmarked as final')` → `clip-unmarked-final` — actor from `row.author`, falling back to `'Someone'`.
   - `author === 'System'` or `'Unknown'` (any other text, e.g. assignee/due-date changes) → silently skipped; audit trail only.
   - All other comments → `task-comment`: `"You commented on {instrument} · {sectionName} task"`. Includes `source: 'task'` and `taskId`.

**Implementation note — status-change author:** Status-change comments in `task_comments` are written by `PATCH /api/production-tasks/:id` with `author` set to the session user (resolved via `req.session.userId → storage.getUser()`), falling back to the `commentAuthor` from the request body, then `'Unknown'`. This stores the actual actor (not the assignee) so the activity feed can attribute the action correctly. Assignee/due-date system comments still use the same `author` resolution. Mark-final comments (e.g. `"Clip marked as final: ..."`) use `commentAuthor || 'Unknown'` from the request body — the client always sends `user.username` here.

**JS-level merge, no SQL UNION:** Each event type is fetched with a separate Drizzle query (or read from `activity_log`) and merged into a single `events[]` array in JavaScript, then sorted by `timestamp` descending. No SQL UNION needed.

**Frontend queries:**
```ts
// Dashboard — cross-song
useQuery({ queryKey: ['activity'], queryFn: () => fetch('/api/activity').then(r => r.json()), refetchInterval: 10000 })

// SongHome — per-song
useQuery({ queryKey: ['activity', songId], queryFn: () => fetch(`/api/songs/${songId}/activity`).then(r => r.json()), refetchInterval: 10000 })
```

**TanStack Query invalidation:** `queryClient.invalidateQueries({ queryKey: ['activity'] })` uses prefix matching — it invalidates both `['activity']` (Dashboard) and `['activity', songId]` (SongHome) simultaneously. Every mutation that triggers an activity event must call this in its `onSuccess` (or `.then()` for fire-and-forget fetches). Mutations that currently do this: song created (modal), idea created (modal), file upload, clip added to timeline, clip removed from timeline, clip marked/unmarked final (both bucket and timeline), clip replaced, section added, section deleted, track (instrument/part) added, track deleted, review shared, review comment/reply posted.

**Current user:** Auth is built — `CURRENT_USER` is no longer a hardcoded constant anywhere in the codebase. On the client, `Dashboard.tsx` and `SongHome.tsx` read `user?.username ?? ''` from `useAuth()` to filter tasks to the logged-in user. On the server, actors are resolved from `req.session.userId → storage.getUser()` for all activity events — `uploadedBy`/`createdBy` in upload/review routes, `author` on status-change task comments, and tier-2 `activity_log` descriptions. `getActivity()` in `storage.ts` reads `row.author` (stored at write time) and `clip.metadata.uploadedBy` for tier-1 events — no hardcoded name anywhere.

**Deep-link navigation from activity rows:**

```ts
function activityUrl(event: ActivityEvent): string {
  const base = `/songs/${event.songId}/workspace`;
  const songBase = `/songs/${event.songId}`;
  if (event.type === 'status-change' && event.taskId)
    return `${base}?tab=production&taskId=${event.taskId}`;
  if (event.type === 'task-comment' && event.source === 'task' && event.taskId)
    return `${base}?tab=production&taskId=${event.taskId}`;
  if (event.type === 'clip-comment' && event.source === 'clip' && event.instrument && event.sectionName) {
    const params = new URLSearchParams({
      instrument: event.instrument,
      section: event.sectionName,
      ...(event.clipId ? { clipId: event.clipId } : {}),
      openComments: 'true',
    });
    return `${base}?${params}`;
  }
  if (event.type === 'review-shared' && event.reviewId)
    return `${songBase}?tab=review&reviewId=${event.reviewId}`;
  if ((event.type === 'review-comment' || event.type === 'review-reply') && event.reviewId) {
    const params = new URLSearchParams({ tab: 'review', reviewId: event.reviewId });
    if (event.commentId) params.set('commentId', event.commentId);
    return `${songBase}?${params}`;
  }
  if (event.type === 'song-created')
    return `/?tab=files&filter=songs&songId=${event.songId}`;
  if (event.type === 'idea-created')
    return `/?tab=files&filter=ideas&ideaId=${event.songId}`;
  if (event.instrument && event.sectionName)
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  return songBase;
}
```

- **`status-change`** and **`task-comment`** events open the workspace Production tab with the task modal auto-opened (ProductionTracker reads `?taskId=` from the URL on mount).
- **`clip-comment`** events open the workspace File Browser navigated to the matching instrument + section, then automatically open the More Info / inspection modal for the specific clip with the notes input focused. See `autoOpenInfo` prop below.
- **`song-created`** navigates to `/?tab=files&filter=songs&songId=X` — Dashboard reads this via `useSearch()` and auto-selects the song in the Files tab Songs column.
- **`idea-created`** navigates to `/?tab=files&filter=ideas&ideaId=X` — Dashboard reads this and auto-selects the idea in the Ideas column.
- All other events (`file-added`, `marked-final`) open the workspace File Browser via `?instrument=` + `?section=`.

**`autoOpenInfo` — clip inspection modal auto-open:**

`MediaBucket` reads `clipId` and `openComments` from the URL params inside the session restore `useEffect` (the same one-shot effect that resolves `instrument` and `section`). If both are present, it sets `autoOpenClipId` state and passes `autoOpenInfo={clip.id === autoOpenClipId}` to the matching `BucketClip`.

`BucketClip` (`Clip.tsx`) has an `autoOpenInfo?: boolean` prop. A `useEffect([autoOpenInfo])` calls `setShowInfo(true)` and `setFocusNotes(true)` when it becomes true — replicating the same trigger path as the right-click "Add Note" shortcut. The `ClipInfoWindow` then opens with the comment input focused.

**ProductionTracker auto-open modal from URL:**
```ts
const taskIdFromUrl = new URLSearchParams(window.location.search).get('taskId');
const { data: tasks = [] } = useQuery<ProductionTask[]>({ ... }); // must be declared BEFORE the useEffect

// IMPORTANT: useEffect must come AFTER the tasks declaration to avoid temporal dead zone
useEffect(() => {
  if (taskIdFromUrl && tasks.length > 0 && !activeTaskId) {
    setActiveTaskId(taskIdFromUrl);
  }
}, [taskIdFromUrl, tasks.length]);
```

The `useEffect` must come after the `tasks` query declaration in the component body — placing it before causes a `"Cannot access uninitialized variable"` runtime error due to JavaScript's temporal dead zone for `const`.

### Promote to Song (Ideas file browser) — ✅ Built

Right-clicking a clip in the IDEAS mode FILES column shows **"Promote to Song"** (gold `Sparkles` icon, separated from "Add to Song" by a `ContextMenuSeparator`). This creates a brand-new song from the clip and places a copy of the audio in a chosen instrument + section of that new song.

**Modal state (in `Dashboard.tsx`):**
```ts
const [promoteClip, setPromoteClip] = useState<ApiClipDash | null>(null);
const [promoteSongName, setPromoteSongName] = useState('');
const [promoteInstrument, setPromoteInstrument] = useState('');
const [promoteSection, setPromoteSection] = useState('');
const [isPromoting, setIsPromoting] = useState(false);
```

**On menu click** — pre-populates:
- `promoteSongName` = clip name with file extension stripped (`clip.name.replace(/\.[^.]+$/, '')`)
- `promoteInstrument` = first entry from `settings?.defaultInstruments ?? DEFAULT_INSTRUMENTS`
- `promoteSection` = first entry from `settings?.defaultSections ?? DEFAULT_SECTIONS`

**Modal** — user can edit all three fields. Instrument and section selects are driven by `settings?.defaultInstruments`/`settings?.defaultSections` (falls back to `DEFAULT_INSTRUMENTS`/`DEFAULT_SECTIONS`). Submit is disabled until all three fields are non-empty and `isPromoting` is false.

**`handlePromoteToSong` — sequential async steps:**
1. `POST /api/songs` — creates the new song using `settings.defaultBpm`, `settings.defaultSections`, `settings.defaultInstruments`, `type: 'song'`. This triggers the normal seed bootstrap (instrument tracks + section ideas auto-created).
2. `GET /api/songs/:newSongId/bucket` — fetches the freshly seeded bucket to resolve real `trackId`/`ideaId` for the selected instrument + section name.
3. `fetch(promoteClip.src)` → re-uploads the audio via `POST /api/upload` with the correct `instrument`, `section`, `ideaId`.
4. `POST /api/ideas/:ideaId/clips` — creates the clip record in the new song's bucket. Clip name follows the Songs convention: `"{instrument} {section} V1"`. Metadata is copied from the upload response.
5. `PATCH /api/clips/:sourceClipId { addedToSongs: [...] }` — stamps the source clip with `{ songId, songName, instrument, section }` so a gold pill badge appears on the original clip without waiting for a refetch. Also calls `setSelectedInstrument(prev => ...)` for immediate local state update.
6. Invalidates `['bucket', sourceFileId]` and `['songs']`.
7. `closePromoteModal()` then shows a toast: `"Promoted to {songName} — {instrument} · {section}"` with an **"Open Workspace →"** `ToastAction` that navigates to `/songs/:newSongId/workspace?instrument=...&section=...`.

**No backend changes** — reuses `/api/songs`, `/api/songs/:id/bucket`, `/api/upload`, `/api/ideas/:id/clips`, and `/api/clips/:id`.

---

