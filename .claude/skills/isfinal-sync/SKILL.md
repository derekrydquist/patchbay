---
name: isfinal-sync
description: isFinal <-> production-task-status bidirectional sync rules for PatchBay clips — the three entry points, same-name/sibling rules, Complete status guard, clip-addition auto-advance, and the Replace flow's isFinal handling. Use when marking a clip final, changing a task to Complete, or touching the Replace submenu.
---

## isFinal ↔ task status bidirectional sync

Marking a clip as final and changing a task's status are kept in sync automatically. There are **three entry points**, all handled in `server/routes.ts`.

#### Same-name rule (applies at all three entry points)

**Same name = same version.** If two timeline clips on the same track have the same `name`, they are the same recording placed twice. Marking one final must mark ALL of them final — regardless of which section they sit in.

**Sibling rule.** Only one version name per section per instrument can be final. When a name is marked final, all clips with a *different* name on the same `trackId + sectionName` are cleared. This is independent of the same-name rule — both run together on every `isFinal: true` write.

**Unmarking** follows the same-name rule in reverse: clearing `isFinal` on one timeline clip clears it on every clip with the same `trackId + name`.

These rules apply from all three entry points. Never write `isFinal` outside the three entry points or the rules will be silently bypassed.

**Entry point 1 — bucket clip marked final (`PATCH /api/clips/:clipId`)**

When `isFinal === true`:
- Clears `isFinal` on all sibling bucket clips in the same idea (`ideaId`, different `id`)
- Sets `isFinal: true` on ALL `timelineClips` where `trackId` matches AND `name` matches (same-name rule)
- Clears `isFinal` on all `timelineClips` where `trackId + sectionName` matches AND `name` does NOT match (sibling rule)
- If the linked task is not already "complete": walks clip → idea → track → `storage.getTaskByInstrumentSection`, calls `storage.updateTask(task.id, { status: "complete" })`, and logs `Clip marked as final: "{clip.name}"`

When `isFinal === false`:
- Clears `isFinal` on ALL `timelineClips` where `trackId` matches AND `name` matches
- If the task is currently "complete": sets task to `"in-progress"` and logs `Clip unmarked as final: "{clip.name}". Status reverted to In Progress.`

**Entry point 2 — timeline clip marked final (`PATCH /api/timeline-clips/:id`)**

`TimelineClip.handleMarkFinal` in `Clip.tsx` sends `PATCH /api/timeline-clips/:id` with `{ isFinal, author: 'Unknown' }`.

The route strips only `author` from the body before passing the remainder to `storage.updateTimelineClip`. If `clipUpdates` is empty after stripping, the route fetches the clip directly instead of calling `.set({})` on an empty object (which would throw a Drizzle error).

When `isFinal === true`, the route:
1. Calls `storage.syncFinalClipFromTimeline(clip.trackId, clip.sectionName, clip.name, isFinal)` to persist to the bucket
2. Sets `isFinal: true` on ALL `timelineClips` where `trackId` matches AND `name` matches (same-name rule)
3. Clears `isFinal` on all `timelineClips` where `trackId + sectionName` matches AND `name` does NOT match (sibling rule)
4. Looks up the track via `clip.trackId`, then calls `storage.getTaskByInstrumentSection` to find the task
5. Applies the same complete/revert logic and comment as entry point 1

When `isFinal === false`, the route:
1. Calls `storage.syncFinalClipFromTimeline` to clear the bucket clip
2. Clears `isFinal` on ALL `timelineClips` where `trackId` matches AND `name` matches
3. Applies the same task revert logic as entry point 1

On success, `TimelineClip.handleMarkFinal` invalidates: `['production-tasks', songId]`, `['final-clips', songId]`, `['bucket', songId]`, `['/api/songs/${songId}/timeline']`, `['activity']`.

**`syncFinalClipFromTimeline(trackId, sectionName, clipName, isFinal)`** (in `storage.ts`):
- Looks up the idea via `trackId + sectionName`
- Fetches all clips for that idea
- If `isFinal: true`: clears `isFinal` on all sibling clips first, then sets `isFinal = true` on the clip whose name matches `clipName` (falls back to the most recently created clip if no exact match)
- If `isFinal: false`: clears `isFinal` on any currently-final clip for that idea whose name matches `clipName`

**Entry point 3 — task manually set to "complete" (`PATCH /api/production-tasks/:id`)**

See "Complete status guard" section below.

**Task changed away from "complete" → clip unmarked**

In `PATCH /api/production-tasks/:id`, when `status` changes away from `"complete"` and the previous status was `"complete"`:
1. Call `storage.getFinalClipForTask(task.instrument, task.sectionName, task.songId)` — three sequential DB lookups: track by songId+name → idea by trackId+sectionName → clip where isFinal=true
2. If found, call `storage.updateClip(clip.id, { isFinal: false })`
3. Call `storage.addTaskComment()` with text: `Clip unmarked as final: "{clip.name}". Status changed to {new status label}.`

**Author field**

All three PATCH routes accept an optional `author` field in `req.body`. It is destructured out before passing updates to storage (so it never reaches Drizzle's `.set()`). Used as the comment author, falling back to `"Unknown"`. The frontend sends `user.username` from `useAuth()` for all patches. Do not use `task.assignee` as the author.

**Change comment logging (manual)**

`PATCH /api/production-tasks/:id` always fetches the pre-update task (unconditional PK lookup) so it can diff every field. After `updateTask()` succeeds, three `await`ed `addTaskComment` calls run in sequence — one per changed field. All three complete before `res.json(task)` sends the response. This eliminates a race where the client's `onSettled` refetch of `['task-comments', task.id]` could arrive before the comment write completed — most visible on the "complete" transition specifically, because the `await storage.getUser()` call in the status block gives the event loop more time to yield before the DB write, widening the window for that particular transition. Errors propagate via Express 5's async error handling to the global handler in `server/index.ts` — there are no `.catch(console.error)` suppressors on these calls.

- **Status** — if `req.body.status` differs from previous: `"Status changed to To Do"` / `"Status changed to In Progress"` / `"Status changed to Complete"` / `"Status changed to Will Not Play"`
- **Assignee** — if `'assignee' in req.body` and value differs from previous: `"Assignee set to {name}"` or `"Assignee removed"`
- **Due date** — if `'dueDate' in req.body` and value differs from previous: `"Due date set to {date}"` or `"Due date removed"`

All three use `'in taskUpdates'` checks (not truthiness) to distinguish "field was sent as empty" from "field was not sent at all".

### Complete status guard

`PATCH /api/production-tasks/:id` enforces a rule when `status === "complete"`: at least one of these conditions must be true or the request is rejected with 400.

**Condition A** — a clip exists in the timeline for this instrument+section (query `timelineClips` joined to `instrumentTracks` by trackId, filtered by `instrumentTracks.name = task.instrument`, `instrumentTracks.songId = task.songId`, `timelineClips.sectionName = task.sectionName`). Storage method: `getTimelineClipForTask(instrument, sectionName, songId)`.

**Condition B** — a bucket clip with `isFinal = true` exists for this instrument+section. Storage method: `getFinalClipForTask(instrument, sectionName, songId)`.

If **neither** passes → `400 { message: "Cannot mark as complete — no clip in the timeline or marked as final for this instrument and section." }`

If **A passes but B does not** (clip on timeline, nothing yet marked final in bucket) → the route auto-promotes a bucket clip to final:
1. Looks up the track → idea → first clip for that idea
2. Calls `storage.updateClip(bucketClip.id, { isFinal: true })`
3. Calls `storage.updateTimelineClip(timelineClipForTask.id, { isFinal: true })` to sync the timeline clip
4. Clears `isFinal` on all other timeline clips with the same `trackId + sectionName`
5. Logs `Clip marked as final: "{bucketClip.name}"` as a session note
6. Then proceeds with `updateTask()` as normal

If **B passes** (final clip already exists) → proceeds directly with `updateTask()`.

The guard runs **before** `updateTask()` is called, so a rejected request makes no DB changes.

**Frontend** — `CellModal.patchTask.mutationFn` throws on non-OK responses. `onError` calls `useToast()` with `variant: 'destructive'` and the server's message. The optimistic update is rolled back via `context.prev`. `<Toaster />` is mounted in `App.tsx` at the app root.

**`['final-clips', 'patchbay-default']` query key**

`ProductionTracker` subscribes to this key via a `useQuery` that fetches `/api/songs/${SONG_ID}/bucket` and derives a `finalClipsMap: Record<"${instrument}__${sectionName}", clipName>`. Complete cells in the grid show the actual final clip name from this map (falling back to `task.title`). The key is invalidated by both `BucketClip.handleToggleFinal` and `CellModal.patchTask.onSettled`, causing the grid to update instantly.

`patchTask.onSettled` in `CellModal` invalidates: `['production-tasks', SONG_ID]`, `['task-comments', task.id]`, `['final-clips', 'patchbay-default']`, `['bucket', 'patchbay-default']`, and `['/api/songs/patchbay-default/timeline']` (so the timeline checkmark updates within the next poll cycle).

### Clip addition → task in-progress

Adding any clip — whether via bucket upload (`POST /api/ideas/:ideaId/clips`) or timeline placement (`POST /api/tracks/:trackId/clips`) — automatically advances the linked production task from `todo` to `in-progress`. Both routes call `storage.getTaskByInstrumentSection(instrument, sectionName, songId)` after the clip is created. If the task's current status is `"todo"`, they call `storage.updateTask(task.id, { status: "in-progress" })`. The transition is strictly one-directional — status is never downgraded:

| Current status | Result |
|---|---|
| `todo` | advanced to `in-progress` |
| `in-progress` / `complete` / `will-not-play` | no-op |

Both routes wrap this logic in a `try/catch` so a task-lookup failure (e.g. no task row exists for this instrument+section) never blocks clip creation. Both client-side mutations invalidate `['production-tasks', songId]` in their `onSuccess` handler so the tracker reflects the new status immediately.

This is distinct from the `isFinal ↔ task status` bidirectional sync: clip addition advances `todo → in-progress` (one-way); marking a clip final advances `in-progress → complete` (bidirectional — unmarking reverts to `in-progress`).

### Replace flow — isFinal handling — ✅ Fixed (Aug 10, 2026)

Replace (`PATCH /api/timeline-clips/:id` from the Replace submenu) has two isFinal-related rules, both server-enforced:

**Replace never writes to the `clips` table.** `syncFinalClipFromTimeline` — the function that propagates an explicit final/non-final *decision* to the bucket — is gated on `!isReplace` in this route. Replace's `isFinal` value is a mechanical reset of the timeline row, not a user decision about the bucket clip's identity; it must never be interpreted as one. (Historical bug: before this gate existed, replacing a clip would incorrectly strip `isFinal` from the *replacement's* bucket clip, because the sync call ran after the row had already been renamed to the replacement's name and used the post-rename name to look up which bucket clip to unmark.)

**The new timeline row inherits isFinal from the replacement's current bucket status**, read server-side via `bucketClipId` (not from the client's `ReplacementClip.isFinal`, which can be stale by the time the user confirms — another user may have changed the bucket clip's final status between menu-open and confirm). This matches how drag-to-timeline and "Add to Timeline" already behave — all three placement paths now consistently reflect the source clip's final status on arrival.

If the clip being **displaced** by Replace was itself final, its bucket clip's `isFinal` is left untouched — Replace does not rescind a prior final designation; only an explicit unmark action does that.

