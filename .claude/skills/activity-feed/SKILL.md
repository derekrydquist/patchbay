---
name: activity-feed
description: Architecture of PatchBay's cross-song and per-song activity feed — the two-tier event sourcing model, ActivityEvent shape, deep-link routing (activityUrl), and the "Promote to Song" Ideas-to-Song flow. Use when adding a new activity event type, debugging feed entries, or working on Dashboard/Promote to Song.
---

## Activity feed — ✅ Built

The activity feed aggregates recent events across the app into a unified timeline. It lives in `server/storage.ts` as `getActivity(songId?: string)` and is exposed via two routes.

**`ActivityEvent` interface (in `storage.ts`):**
```ts
interface ActivityEvent {
  // Tier 1 (synthesized at read time):
  type: 'file-added' | 'marked-final' | 'clip-comment' | 'task-comment' | 'status-change'
      | 'review-shared' | 'clip-unmarked-final' | 'clip-replaced' | 'clip-added-to-timeline'
      | 'clip-removed-from-timeline' | 'section-added' | 'section-deleted'
      | 'track-added' | 'track-deleted' | 'review-comment' | 'review-reply'
      | 'song-created' | 'idea-created'
      // Tier 2 (written verbatim via logActivity()) — kept in sync with the
      // "Tier 2 event types — full reference" table below; last audited 2026-08-12:
      | 'song-deleted' | 'track-restored' | 'volume-changed' | 'pan-changed'
      | 'section-restored' | 'timeline-reordered' | 'clip-trim-adjusted'
      | 'clip-trim-applied-to-instances' | 'timeline-cleared' | 'idea-hidden'
      | 'idea-restored' | 'clip-metadata-edited' | 'clip-removed' | 'file-uploaded'
      | 'clip-comment-added' | 'clip-comment-reply' | 'clip-comment-edited'
      | 'clip-comment-deleted' | 'task-status-change' | 'task-comment-added'
      | 'task-comment-reply' | 'task-comment-edited' | 'task-comment-deleted'
      | 'review-comment-edited' | 'review-comment-deleted' | 'review-comment-resolved'
      | 'review-comment-unresolved' | 'song-added-to-album' | 'song-removed-from-album';
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

**Read-path filtering (added 2026-08-12):** `activity_log` had never had type-based filtering — every write, including types intended as "sort-only" (meant only to feed `getSongsWithLastActive`'s ranking, never to render), rendered as a visible Activity Feed row. This is now corrected inside `getActivity()` (`server/storage.ts`): a `notInArray(activityLog.type, [...])` condition excludes sort-only types from the `events[]` array returned to the client. The filter is read-path only — `logActivity()` still writes every type unconditionally, and `getSongsWithLastActive` (a separate function, separate query, no `type` condition) is untouched and still sees the full unfiltered table. Sort-only events continue to influence the Dashboard "Your Songs" ranking; they just never appear as feed rows. This also means the "Feed-visible?" column below is no longer just documentation intent — it is enforced in code for the first time. Two classifications changed as a result of actually auditing this (see the numbered lists below for detail): `idea-hidden` (item 15) turned out to be sort-only despite living in the old "Structural events" grouping, and the old single `clip-trimmed` type was split into `clip-trim-adjusted` (sort-only) and `clip-trim-applied-to-instances` (feed-visible) — they were previously indistinguishable in the log.

### Tier 2 event types — full reference

| Type | Feed-visible? | Notes |
|---|---|---|
| `marked-final` | Yes | |
| `clip-unmarked-final` | Yes | |
| `song-created` | Yes | |
| `idea-created` | Yes | |
| `song-deleted` | Yes | |
| `track-added` | Yes | |
| `track-deleted` | Yes | |
| `track-restored` | Yes | |
| `volume-changed` | No — sort-only | Debounced 500ms on the volume slider. Split from `pan-changed` this session — the route previously conflated both under this single type. |
| `pan-changed` | No — sort-only | Discrete on L/C/R button click. New type, split out from `volume-changed`. |
| `section-added` | Yes | Two independent call sites (song section add; per-track idea/section bootstrap) both dedup via a 5-second lookback window against `activity_log` so simultaneous per-track calls collapse to one row. |
| `section-deleted` | Yes | |
| `section-restored` | Yes | Two independent client mutations hit this same server route (MediaBucket's `useRestoreSectionSongWide`, Production Tracker's `restoreSectionMutation`) — both are now wired to invalidate the feed; previously only one was. |
| `clip-added-to-timeline` | Yes | |
| `clip-replaced` | Yes | |
| `timeline-reordered` | No — sort-only | A single drag reorder PATCHes every sibling clip whose `start` shifted. Deduped via a 5-second lookback scoped to `songId + type + instrument + sectionName` (reorders are section-locked, so this is a correct proxy key) so one drag produces one row, not one per shifted clip. |
| `clip-removed-from-timeline` | Yes | |
| `clip-trim-adjusted` | No — sort-only | Single-clip drag trim. Split from the old shared `clip-trimmed` type this session. |
| `clip-trim-applied-to-instances` | Yes | Explicit bulk "Apply Trim to All Instances" action. Split from `clip-trimmed`; distinct from the drag-trim case above — was previously indistinguishable in the log. |
| `timeline-cleared` | Yes | |
| `idea-hidden` | No — sort-only | Per-instrument section hide is a personal decluttering action, not band-visible news. |
| `idea-restored` | Yes | |
| `clip-metadata-edited` | No — sort-only | Fires once per blur-to-save field edit in `ClipInfoWindow` — too granular for the feed. |
| `clip-removed` | Yes | Bucket soft-delete. |
| `file-uploaded` | Yes | |
| `clip-comment-added` / `clip-comment-reply` | Added: Yes / Reply: No | Only the top-level comment has a rationale for feed visibility — no Tier-1 synthesized counterpart exists for replies, so surfacing them would risk duplicate-feeling events. |
| `clip-comment-edited` / `clip-comment-deleted` | No — sort-only | Editing/deleting comment text isn't meaningful production activity. |
| `task-status-change` | Yes | |
| `task-comment-added` / `task-comment-reply` | Added: Yes / Reply: No | Same rationale as clip comments. |
| `task-comment-edited` / `task-comment-deleted` | No — sort-only | Same rationale as clip comments. |
| `review-shared` | Yes | |
| `review-comment` / `review-reply` | Yes | Review comments are the one comment surface where all five actions (add/reply/edit/delete/resolve) were already correctly wired for live feed updates before this session — reference pattern. |
| `review-comment-edited` / `review-comment-deleted` | No — sort-only | Consistent with clip/task comment treatment, despite review comments' add/reply being feed-visible. |
| `review-comment-resolved` / `review-comment-unresolved` | Yes | |
| `album-created` / `album-renamed` / `album-deleted` | Not implemented | No `songId` to attach to under the current `activity_log` schema (`songId` is NOT NULL). Deferred — would require a nullable `songId` (or new `albumId` column), a LEFT JOIN change in `getActivity()`, and client `ActivityEvent`/`activityUrl()` changes to route song-less events. Scoped as a future schema decision, not implemented this session. |
| `song-added-to-album` | Yes | Dedup note: the album song picker POSTs this route sequentially per selected song. No `albumId` column exists on `activity_log` to scope a tight dedup key, so this dedups on `bandId + type` within a 5-second window — looser than other dedup keys in this doc. Tradeoff: two different users adding songs to two different albums within the same 5 seconds would also collapse to one logged row. Underlying album membership writes are unaffected either way — this only suppresses a duplicate log row. |
| `song-removed-from-album` | Yes | |
| `album-song-reordered` | No — sort-only, and not currently implemented | The Move Up/Down route (`PATCH /api/albums/:id/songs/:songId/move`) has no `logActivity()` call today. Listed here so if that logging is ever added, it's pre-classified as sort-only, consistent with `timeline-reordered`. |

**Known dedup tradeoffs:** Three event types use a 5-second lookback window to collapse a burst of near-identical server calls (from one client gesture) into a single logged row: `section-added`, `timeline-reordered`, `song-added-to-album`. In all three cases, the dedup key is a proxy for "same user gesture," not a guarantee — two independent actions from different users landing in the same narrow window and matching the same key will also collapse to one row. This is treated as an acceptable tradeoff: the underlying mutation always succeeds regardless of what gets logged; only the activity-feed/sort-input row can be silently suppressed in the rare collision case.

The numbered lists below retain per-event route and description detail not repeated in the table above; where the two disagree on feed-visibility, the table above is authoritative (it reflects the enforced filter, not just original intent).

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
15. **`idea-hidden`** — logged from `PATCH /api/ideas/:ideaId` (active=false). Description: `"{user} hid section {sectionName} on {trackName}"`. **Reclassified sort-only as of 2026-08-12** — despite living in this "Structural events" grouping historically, it's excluded by the read-path filter (see "Tier 2 event types — full reference" above): a per-instrument section hide is a personal decluttering action, not band-visible news.
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

**Events 26–42 below (mixed feed-visibility — see "Tier 2 event types — full reference" above for the authoritative Yes/No per type):**

This grouping predates the read-path filter and originally assumed every item here was sort-only "not yet evaluated for feed display." That assumption turned out to be wrong for several of them once actually audited (2026-08-12) — `file-uploaded`, `clip-removed`, `clip-comment-added`, `task-comment-added`, `review-comment-resolved`/`unresolved`, `clip-trim-applied-to-instances`, `timeline-cleared`, `song-added-to-album`, and `song-removed-from-album` are all feed-visible today. The reference table above is the source of truth for visibility; this list keeps the per-route implementation detail.

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
36. **`volume-changed`** — logged from `PATCH /api/tracks/:trackId` when `volume` changes, debounced 500ms on slider drag. **Split from `pan-changed` (item 36b) on 2026-08-12** — the route previously wrote `volume-changed` for both volume and pan updates.
36b. **`pan-changed`** — logged from the same `PATCH /api/tracks/:trackId` route when `pan` changes (L/C/R button click, discrete). New type as of 2026-08-12; previously indistinguishable from `volume-changed` in the log.
37. **`clip-trim-adjusted`** — logged from `PATCH /api/timeline-clips/:id/trim` (single-clip drag trim). **Split from the old shared `clip-trimmed` type on 2026-08-12** into this (sort-only) and item 37b (feed-visible) — they were previously the same type and indistinguishable in the log.
37b. **`clip-trim-applied-to-instances`** — logged from `POST /api/timeline-clips/apply-trim-to-instances`, covering both the "Apply Trim to All Instances" and "Reset Trim on All Instances" actions. Feed-visible — an explicit bulk action, unlike the single-clip drag trim above.
38. **`timeline-reordered`** — logged from `PATCH /api/timeline-clips/:id` when `start` changes without a name/src change. Deduped via a 5-second lookback scoped to `songId + type + instrument + sectionName` (see "Known dedup tradeoffs" above) so one drag reorder (which PATCHes every shifted sibling clip) produces one row.
39. **`timeline-cleared`** — logged from `DELETE /api/songs/:songId/timeline-clips/non-final`.
40. **`song-added-to-album`** — logged from `POST /api/albums/:id/songs`. Deduped on `bandId + type` within a 5-second window (looser than other dedup keys here — `activity_log` has no `albumId` column to scope tighter) so the album song picker's sequential per-song POSTs collapse to one row.
41. **`song-removed-from-album`** — logged from `DELETE /api/albums/:id/songs/:songId`. No dedup (not a batch-prone action).
42. **`album-song-reordered`** — not currently implemented. `PATCH /api/albums/:id/songs/:songId/move` (Move Up/Down) has no `logActivity()` call today. Pre-classified sort-only for whenever that logging is added, consistent with `timeline-reordered`.

**Album lifecycle events not implemented:** `album-created` / `album-renamed` / `album-deleted` have no logging path — `activity_log.songId` is `NOT NULL`, and albums have no song to attach an event to. Implementing these would need a nullable `songId` (or a new `albumId` column), a `LEFT JOIN` change in `getActivity()`, and client `ActivityEvent`/`activityUrl()` changes to route song-less events. Scoped as a future schema decision.

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

**TanStack Query invalidation:** `queryClient.invalidateQueries({ queryKey: ['activity'] })` uses prefix matching — it invalidates both `['activity']` (Dashboard) and `['activity', songId]` (SongHome) simultaneously. Every mutation that triggers a feed-visible activity event should call this in its `onSuccess` (or `.then()` for fire-and-forget fetches) — note that even a mutation missing this call isn't permanently stale: both surfaces also poll on `refetchInterval: 10000`, so a missing invalidation shows up as up to a 10-second display delay, not a dead feed.

An audit on 2026-08-12 found 10 mutation call sites missing this invalidation and fixed them: `Dashboard.tsx` `createSong` (song-created) and `deleteSong` (song-deleted); `Dashboard.tsx` `addSongToAlbumMutation` and `removeSongFromAlbumMutation` (song-added-to-album / song-removed-from-album); `Track.tsx` `patchPan` (pan-changed); `Timeline.tsx` `handleUpdateVolume` (volume-changed) plus all 5 of its start-shift PATCH call sites that produce `timeline-reordered`; `Clip.tsx` `patchTrim` and `performApplyTrimToInstances` (plus its Reset-to-instances sibling) for `clip-trim-adjusted`/`clip-trim-applied-to-instances`; and Production Tracker's `restoreSectionMutation` (`section-restored`) — a second, independent client mutation hitting the same restore route as MediaBucket's already-correct `useRestoreSectionSongWide`. Mutations confirmed correctly wired (including pre-existing ones): idea created (modal), file upload, clip added to timeline, clip removed from timeline, clip marked/unmarked final (both bucket and timeline), clip replaced, section added, section deleted, track (instrument/part) added/deleted/restored, review shared, and all five review-comment actions (add/reply/edit/delete/resolve) — the last of these was already a full reference pattern for comment-thread invalidation before this session, unlike the equivalent clip-comment and task-comment surfaces (see the `clip-comment-reply`/`task-comment-reply` note in the reference table above — those remain sort-only by design, not a gap).

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

