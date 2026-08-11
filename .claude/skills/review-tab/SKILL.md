---
name: review-tab
description: Architecture of PatchBay's Review tab (SongHome) — ReviewPlayer component, waveform canvas + drag-to-scrub, avatar markers, threaded comments, resolve/edit/delete, @mention autocomplete, activity-feed deep links. Use when building or debugging Review tab features.
---

## Review tab — ✅ Built

The Review tab lives on the SongHome page (`/songs/:songId`) as one of three tabs (Overview / Files / Review). It lets band members share exported mixes and leave time-stamped feedback directly on the waveform.

**Tab and data:**
`activeTab`, `autoReviewId`, and `autoCommentId` are derived directly from `useSearch()` (wouter's reactive search hook) on every render — not stored in `useState`. This means navigating to the same SongHome route with different search params (e.g. an activity-feed deep-link while already on the page) correctly re-derives all three values without a remount. `useSearch()` returns the query string reactively; **do not revert to `window.location.search` or wouter's `useLocation()` for these values** — `useLocation()` does not include query strings. Clicking a tab calls `setLocation` with `?tab=review` or `?tab=files` appended (Overview deletes the param for a clean URL). `activeTab` is derived as `tabParam === 'review' || tabParam === 'files' ? tabParam : 'overview'`. Reviews are fetched via `useQuery(['reviews', songId])` against `GET /api/songs/:songId/reviews`. The tab label shows `Review (N)` when at least one review exists. The upload button in the Review tab header fires `POST /api/songs/:songId/reviews` as multipart — no separate upload page.

**Activity feed deep-link routing to the Review tab:**
`activityUrl` in both `Dashboard.tsx` and `SongHome.tsx` handles three review event types explicitly (before the `instrument+sectionName` fallthrough):
- `review-shared` → `/songs/:id?tab=review&reviewId=X` (SongHome, not workspace)
- `review-comment` / `review-reply` → `/songs/:id?tab=review&reviewId=X&commentId=Y`

`SongHome` reads `autoReviewId` and `autoCommentId` from `useSearch()` and passes `autoCommentId` to the matching `ReviewPlayer` (the one whose `review.id === autoReviewId`). `ReviewPlayer` accepts an `autoCommentId?: string | null` prop and uses a `useEffect([autoCommentId, comments.length])` to scroll and highlight once comments are loaded:
- **Top-level comment**: sets `highlightedCommentId`, scrolls to `#review-comment-${commentId}`, clears after 1500ms
- **Reply**: finds the parent comment, sets `expandedThreadId`, scrolls to the parent element

`autoHighlightFired` is `useRef<string | null>(null)` — stores the last highlighted comment ID (not a boolean) so clicking a second activity row with a different `commentId` re-fires correctly. The guard is `autoHighlightFired.current === autoCommentId`.

Review files are stored in `uploads/reviews/` (auto-created by the server if absent). Naming: `review_{songId}_{timestamp}.{ext}`. `GET /api/songs/:songId/reviews` returns reviews newest-first.

**`ReviewPlayer` component (inline in `SongHome.tsx`):**

Each `SongReview` row renders a `ReviewPlayer` — a self-contained card with its own audio element, waveform canvas, comment state, and input handlers. It is not a separate file.

**Data types:**
```ts
interface ReviewType {
  id: string; songId: string; name: string; src: string;
  format: string; duration: number; createdAt: string; createdBy: string;
}
interface ReviewComment {
  id: string; reviewId: string; parentId?: string | null;
  author: string; text: string; timestamp: number; createdAt: string;
  resolved?: boolean; editedAt?: string | null;
  replies?: ReviewComment[];   // only present on top-level comments
}
```

**Schema additions (`shared/schema.ts`):**
`songReviewComments` has two extra columns beyond the base spec:
- `resolved: integer("resolved", { mode: "boolean" }).notNull().default(false)` — whether a comment has been resolved
- `editedAt: text("edited_at")` — nullable ISO timestamp; set automatically by the PATCH route when `text` is changed

These were added after initial scaffolding via `npx drizzle-kit push --force` (interactive `db:push` fails without a TTY — always use `--force`).

**Threaded comment types (in `storage.ts`):**
```ts
export type ClipCommentWithReplies  = ClipComment  & { replies: ClipComment[] };
export type TaskCommentWithReplies  = TaskComment  & { replies: TaskComment[] };
type ReviewCommentWithReplies = SongReviewComment & { replies: SongReviewComment[] };
```
All three use the same pattern: fetch all rows for the parent entity, separate top-level (`!parentId`) from replies, build a `replyMap`, and attach replies to each parent. `getClipComments` and `getTaskComments` are exported from `IStorage` and return the `WithReplies` shapes. `getReviewComments` is internal to the review section.

**`delete*Comment` methods in `storage.ts`:**
All three (`deleteClipComment`, `deleteTaskComment`, `deleteReviewComment`) delete child replies first (no FK ON DELETE CASCADE since `parentId` is a self-reference), then delete the parent. This prevents orphaned reply rows.

**Audio playback:**
`ReviewPlayer` creates `new Audio(review.src)` in a `useEffect([review.src])`. `timeupdate` events drive `currentTime` state. `ended` resets the player. The audio element is managed entirely through the `audioRef` ref — no Web Audio API routing.

**Waveform canvas:**
- `canvasRef` holds a `<canvas>` element inside the waveform div.
- `decodedBufferRef` holds the decoded `AudioBuffer` (channel 0 only). Decoded once via a `fetch(review.src) → arrayBuffer() → AudioContext.decodeAudioData()` effect. Cancellation flag prevents stale writes after unmount.
- `drawRef.current` is reassigned every render so it always closes over current `currentTime`. It reads `canvas.offsetWidth`/`offsetHeight`, applies device pixel ratio (`canvas.width = w * dpr; ctx.scale(dpr, dpr)`), and draws one vertical bar per CSS pixel. Played region: `rgba(212,175,55,0.85)` (gold); unplayed: `rgba(255,255,255,0.2)`. The gold playhead line is a separate `position: absolute` div (not canvas-drawn) to avoid full redraws on every timeupdate frame.
- Three effects trigger redraws: decode complete, `currentTime` change, `ResizeObserver` on the canvas element.

**Drag-to-scrub:**
The waveform div uses pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`) with `setPointerCapture` for reliable cross-element drag. An `isDraggingRef` guards move events. A `dragTimeRef` holds the latest computed time so a rAF-throttled frame (`dragRafRef`) can call `setCurrentTime(dragTimeRef.current)` — one React state update per frame regardless of mouse speed. `audioRef.current.currentTime` is set on every move (immediate audio sync) while the React state update is throttled.

**Avatar markers on waveform:**
Top-level comments are grouped into clusters: `avatarGroups` is a `useMemo([visibleComments])` that sorts comments by timestamp and groups any within 0.25s of each other. **The dependency must be `[visibleComments]`, not `[comments]`** — if it were `[comments]`, toggling `showResolved` would not recompute the groups because `comments` (from TanStack Query) doesn't change when only the filter changes.

Each group renders one marker element positioned absolutely below the waveform (`paddingBottom: '14px'` on the outer div lets markers straddle the bottom edge). Single comment → colored avatar circle with author initials. Multiple comments → gold circle with count. Both show a tooltip on hover (`hoveredAvatarId` state). Resolved markers render at `opacity: 0.35` (single: grey background; cluster: full opacity reduced).

Clicking a single marker: seeks playhead + scrolls the comment into view + highlights it for 1500ms (`highlightedCommentId` state → `ring-1 ring-inset ring-primary/40 bg-primary/5`).
Clicking a cluster: seeks to the first comment's timestamp, then highlights each comment in the group sequentially with a 1500ms gap (`setTimeout(fn, i * 1500)`).

**Comment list:**
`visibleComments = showResolved ? comments : comments.filter(c => !c.resolved)`, sorted by timestamp ascending. Rendered in a `max-h-64 overflow-y-auto` scrollable div. The main comment input is pinned below the scrollable area with a `border-t` separator — it is not inside the scrollable div.

Clicking a comment card calls `toggleThread(comment.id)` (expand/collapse replies). The timestamp badge inside the card has its own `onClick` with `e.stopPropagation()` to seek the playhead without toggling the thread.

When the ••• menu is open for a comment, that card has `bg-white/[0.04]` applied (active highlight) and the ••• button is forced fully visible with `bg-white/10` (activated state). This makes it unambiguous which comment's menu is open.

**Thread expand/collapse:**
`expandedThreadId: string | null` — one thread can be open at a time. `toggleThread` flips it and resets `replyText`/`replyMentionQuery`. When a thread is expanded, its replies render indented (`pl-14`) below the parent, followed by a reply input area. Replies inherit the parent's timestamp — `submitReply` reads `comments.find(c => c.id === parentId)?.timestamp` and sends it in the POST body so replies appear at the same waveform position as the parent.

Replies support their own ••• menu (Edit + Delete only — no Resolve on replies). The ••• menu for replies uses the same `openMenu` / `menuOpenId` mechanism as top-level comments.

**••• menu architecture:**
`menuOpenId: string | null` tracks which comment's menu is open (works for both top-level and replies since all IDs are unique). `openMenu(e, id)` stores `e.currentTarget` in `menuButtonRef` and toggles `menuOpenId`. A document `click` capture listener closes the menu on outside clicks — but skips closing if the click target is `menuButtonRef.current` (the ••• button itself), letting `openMenu`'s toggle logic run cleanly so clicking ••• again closes the menu. All menu item actions use `onMouseDown` (not `onClick`) to prevent the document capture listener from closing the menu before the action fires.

**Delete flow:**
Clicking Delete in the ••• menu sets `deleteConfirmId`. An inline confirmation row appears below the comment (`bg-red-950/20 border-t border-red-900/30`) with Cancel and Delete buttons. Confirming calls `DELETE /api/review-comments/:id`. If the deleted comment has `expandedThreadId === commentId`, the thread is closed. For top-level deletions the message notes how many replies will also be deleted.

**Resolve / edit flow:**
- **Resolve:** `PATCH /api/review-comments/:id { resolved: true/false }`. Refetches comments. Resolved comments show `line-through text-white/40` text and a `CheckCircle2` icon in the header.
- **Show resolved toggle:** Only shown when `resolvedCount > 0`. Toggles `showResolved` state. Both the comment list and the waveform avatar markers respect this filter.
- **Edit:** `startEdit` sets `editingId` + `editText`, focuses `editInputRef`. Inline input replaces the comment text. Save calls `PATCH /api/review-comments/:id { text }` — the server sets `editedAt` automatically. `(edited)` label appears next to the author name when `editedAt` is set.

**@ mention autocomplete:**
`mainMentionQuery: string | null` (for the main input) and `replyMentionQuery: string | null` (for the reply input). **The type is `string | null`, not `string`** — `null` means not in mention mode; `''` means `@` was typed with no chars yet (show all members). Using `''` as the "inactive" sentinel is a bug because `''` is falsy — the `!== null` guard is required. `/@(\w*)$/` regex captures the characters after `@`; `setMainMentionQuery(m ? m[1] : null)` — `m[1]` is `''` when user types just `@`, which is intentionally shown (displays all members). `BAND_MEMBERS` is a module-level constant; results filter by `startsWith`. ArrowUp/Down navigate the list; Enter inserts the mention with a trailing space; Escape dismisses. Dropdown renders above the input (`bottom-full`) as an `absolute` positioned div. Each item uses `onMouseDown` + `e.preventDefault()` to prevent the input from losing focus before the click registers.

**Helper functions (module-level in `SongHome.tsx`):**
- `memberAvatarColor(name)` — deterministic hex color from a fixed palette, hashed from the name string
- `memberInitials(name)` — first two chars of first + last name, or first two chars if single word
- `formatTime(secs)` — `"M:SS"` format
- `formatReviewDate(iso)` — `"Month D, YYYY"` display format

