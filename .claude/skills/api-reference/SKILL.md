---
name: api-reference
description: Full reference of every implemented PatchBay API route (method, path, request body, and behavior notes) under server/routes.ts. Use when adding a new API route, checking whether an endpoint already exists, or looking up an existing route's exact contract.
---

## API Conventions

All API routes live under `/api/`. Define them in `server/routes.ts`.

Always return JSON. Use standard HTTP status codes. Wrap errors as:
```json
{ "message": "Human-readable error description" }
```

### Implemented endpoints

```
GET    /api/users                        — list all users; returns [{ id, username }] (password omitted);
                                           used by assignee dropdowns and @ mention autocomplete

POST   /api/auth/login                   — body: { username, password }; normalizes username to lowercase;
                                           validates against users table via bcrypt.compare; sets
                                           req.session.userId on success; returns user object without password
POST   /api/auth/logout                  — destroys the session; returns { ok: true }
GET    /api/auth/me                      — returns current user from session (without password) or 401

GET    /api/settings                     — returns { defaultInstruments, defaultSections, defaultBpm };
                                           auto-seeds factory defaults on first call if the row is missing
PATCH  /api/settings                     — partial update; body: { defaultInstruments?, defaultSections?,
                                           defaultBpm? }; uses INSERT … ON CONFLICT DO UPDATE so the
                                           global row is always present; returns { ok: true }

GET    /api/songs                        — list all songs (ordered by createdAt); each song is
                                           annotated with `hasFiles: boolean` — computed via a
                                           JOIN (clips → ideas → instrument_tracks) that builds
                                           a Set of songIds with at least one clip; used by the
                                           Dashboard Files tab to fill the Lightbulb icon on Ideas
GET    /api/songs/:id                    — get a song with nested tracks → ideas → clips
POST   /api/songs                        — create a song; body: { name, bpm?, sections, type?,
                                           instruments? }; `type` defaults to `"song"`; when
                                           `type === "idea"`, `seedSong` is skipped so the new
                                           song has no instrument tracks or sections bootstrapped;
                                           always logs a `song-created` or `idea-created` activity
                                           event with the session-resolved username
PATCH  /api/songs/:id                    — partial update of song metadata
DELETE /api/songs/:id                    — delete a song and all associated data

GET    /api/tasks                        — list all production tasks across all songs; includes
                                           songId and songName fields for cross-song context;
                                           used by Dashboard task widget
GET    /api/activity                     — aggregated activity feed across all songs; returns
                                           ActivityEvent[] sorted by timestamp desc — see
                                           Activity Feed architecture section
GET    /api/songs/:songId/activity       — same as /api/activity but filtered to one song

GET    /api/songs/:id/timeline           — get instrument tracks with their placed timeline clips
                                           auto-bootstraps the default song + tracks if missing
POST   /api/tracks/:trackId/clips        — place a clip on the timeline; body: InsertTimelineClip;
                                           auto-sets isFinal: true if a final bucket clip already
                                           exists for this track+section; advances the linked
                                           production task from todo to in-progress if its current
                                           status is todo (no-op otherwise); wrapped in try/catch
                                           so a missing task never blocks clip creation
PATCH  /api/timeline-clips/:id           — update a placed clip (start position, etc.); also accepts
                                           { isFinal: bool, author? } to mark/unmark the clip as
                                           final — syncs the bucket clip via syncFinalClipFromTimeline,
                                           marks ALL same-name timeline clips on the track final (or
                                           clears them), clears sibling names in the same section,
                                           and updates the linked production task status
PATCH  /api/timeline-clips/:id/trim      — update trim points only; body: { trimStart: number,
                                           trimEnd: number | null }; does not touch isFinal or start;
                                           client calls queryClient.invalidateQueries on success to
                                           push updated trimStart/trimEnd into the tracks state
POST   /api/timeline-clips/apply-trim-to-instances — bulk-sets trimStart/trimEnd on all timeline clips
                                           where trackId AND name match; body: { trackId, name,
                                           trimStart, trimEnd }; used by both "Apply Trim to All
                                           Instances" (current values) and "Reset Trim on All
                                           Instances" (trimStart: 0, trimEnd: null); single DB UPDATE
DELETE /api/timeline-clips/:id           — remove a clip from the timeline
GET    /api/timeline-clips/:id/replacements — returns bucket clips that can replace this timeline clip:
                                              looks up the clip's trackId+sectionName → idea → all
                                              clips for that idea, excluding the one whose name matches
                                              the current clip. Fields: id, name, duration, src,
                                              isFinal, createdAt. Ordered by createdAt asc. Returns []
                                              if clip not found or has no sectionName.
GET    /api/songs/:songId/timeline-has-finals     — returns { hasFinals: boolean }; true if any
                                                    timeline clip with isFinal=true exists for this song
DELETE /api/songs/:songId/timeline-clips/non-final — deletes all non-final timeline clips for the song,
                                                      then recomputes and persists correct start values
                                                      for the remaining final clips → 204

GET    /api/songs/:id/bucket             — full bucket tree: tracks → ideas → clips (active only)
POST   /api/songs/:id/tracks             — create a new instrument track; body: { name }; server
                                           generates id, sets type "audio", color, sortOrder 999;
                                           also creates one idea per DEFAULT_SECTION automatically
DELETE /api/tracks/:trackId              — hide a track (active=false); also deletes its timeline clips
POST   /api/tracks/:trackId/restore      — restore a hidden track (active=true)
GET    /api/songs/:songId/hidden-tracks  — list hidden tracks for a song
POST   /api/tracks/:trackId/ideas        — create an idea (section slot) under a track;
                                           server generates id and defaults sortOrder to 0
PATCH  /api/ideas/:ideaId               — hide an idea (active=false); also deletes timeline clips
                                           for that track+section
POST   /api/ideas/:ideaId/restore        — restore a hidden idea (active=true)
GET    /api/tracks/:trackId/hidden-ideas — list hidden ideas for a track
POST   /api/ideas/:ideaId/clips          — attach a clip record to an idea; also advances
                                           the linked production task from todo to in-progress
                                           via getTaskByInstrumentSection (no-op if already
                                           in-progress, complete, or will-not-play); wrapped
                                           in try/catch so a missing task never blocks the
                                           clip create
PATCH  /api/clips/:clipId               — partial update of a bucket clip; when isFinal: true,
                                           clears isFinal on all sibling bucket clips (same ideaId),
                                           marks ALL same-name timeline clips on the track as final,
                                           and clears sibling timeline clips (same trackId+sectionName,
                                           different name); when isFinal: false, clears all same-name
                                           timeline clips on the track
GET    /api/clips/:clipId/comments       — list comments on a bucket clip; returns ClipCommentWithReplies[]
                                           (top-level comments with a `replies` array); ordered by
                                           timestamp asc; replies ordered by createdAt asc
POST   /api/clips/:clipId/comments       — add a comment; body: { author, text, parentId? }; timestamp
                                           set to Date.now(); if parentId provided, validates it
                                           references a top-level comment (no grandchild replies → 400)
PATCH  /api/clip-comments/:id            — edit a comment's text; body: { text }
DELETE /api/clip-comments/:id            — deletes child replies first (no FK cascade on parentId),
                                           then deletes the parent → 204

POST   /api/upload                       — upload an audio file; multipart fields: file, instrument,
                                           section, ideaId; returns { url, duration, format, originalFileName }

GET    /api/songs/:songId/task-counts             — returns { completed: number, total: number } for
                                                     a song; counts `complete` and `will-not-play` both
                                                     as completed; `will-not-play` is a final decision

GET    /api/songs/:songId/clip-comment-summary      — map of { clipId → { count, latestCommentAt } }
                                                     for clips that have at least one comment; aggregates
                                                     clip_comments by clipId (GROUP BY) including replies
                                                     (replies share clipId, only differ by parentId); used
                                                     by the clip comment indicator badge to compute
                                                     read/unread state client-side

GET    /api/songs/:songId/task-comment-counts      — map of { taskId → count } for human comments
                                                     (excludes author = "System" or "Unknown")

GET    /api/songs/:songId/production-tasks        — list all tasks for a song
PATCH  /api/production-tasks/:id                  — partial update of a task (status, assignee, dueDate, etc.)
GET    /api/production-tasks/:id/comments         — list comments on a task; returns
                                                     TaskCommentWithReplies[] (top-level comments
                                                     with a `replies` array); ordered by timestamp asc
POST   /api/production-tasks/:id/comments         — add a comment; body: { author, text, parentId? };
                                                     if parentId provided, validates it references a
                                                     top-level comment (no grandchild replies → 400)
PATCH  /api/task-comments/:id                     — edit a comment's text; body: { text }
DELETE /api/task-comments/:id                     — deletes child replies first, then deletes
                                                     the parent → 204

GET    /api/songs/:songId/reviews           — list all reviews for a song (ordered by createdAt desc)
POST   /api/songs/:songId/reviews           — upload a review mix; multipart fields: file (audio);
                                             writes to uploads/reviews/{reviewId}.{ext}; returns
                                             SongReview with { id, name, src, format, duration,
                                             createdAt, createdBy }
DELETE /api/reviews/:reviewId               — delete a review and its comments

GET    /api/reviews/:reviewId/comments      — list top-level comments + nested replies for a review;
                                             ordered by timestamp asc; top-level comments include a
                                             `replies` array of child comments; returns
                                             ReviewCommentWithReplies[]
POST   /api/reviews/:reviewId/comments      — add a comment; body: { author, text, timestamp,
                                             parentId? }; validates that parentId (if set) is itself
                                             a top-level comment (no grandchild replies); sets
                                             resolved: false, editedAt: null; returns 201
PATCH  /api/review-comments/:id            — partial update; body accepts { text?, resolved? };
                                             when text is patched, sets editedAt to current ISO
                                             timestamp automatically; returns updated comment
DELETE /api/review-comments/:id            — deletes all child replies first (no FK cascade on
                                             parentId), then deletes the parent → 204
```

---

