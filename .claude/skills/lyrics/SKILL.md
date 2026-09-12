---
name: lyrics
description: Architecture of PatchBay's Lyrics tab (SongHome) — autosave textarea, select-to-comment anchoring, click-to-highlight and position-based ordering, replies/resolved/@mentions, composer positioning, and the browser-timing gotchas fixed along the way. Use when building or debugging Lyrics tab features.
---

## Lyrics tab — ✅ Built

A dedicated "Lyrics" tab on Song Home, alongside Overview / Song Files / Review.
Always-editable, no separate view/edit mode — anyone with song access can see
and edit directly.

### Data model
- `songs.lyrics` — plain text, nullable, no rich formatting. Edited via a dedicated
  `PATCH /api/songs/:id/lyrics` route (not the general song PATCH), following the same
  "dedicated route for a single frequently-written field" pattern as
  `timeline_clips.trimStart`/`trimEnd`.
- `lyrics_comments` — timestamped comments anchored to a text selection via
  `anchorText` + `anchorOffset` (stores the selected substring and its offset for
  re-anchoring on render — if the anchor text can't be found because lyrics were
  edited, the comment is preserved and shown unanchored rather than deleted);
  `resolved` boolean supports a Google-Docs-style resolve/unresolve flow; `parentId`
  (nullable self-reference, no FK) supports one level of replies, same pattern as
  `clip_comments`/`task_comments`/`song_review_comments`.

### Textarea behavior
- Single `<textarea>`, autosave on blur via `PATCH /api/songs/:id/lyrics`.
- If the blurred value matches the last-saved value exactly, no PATCH fires
  (no-op save) — this includes the case where a net-zero edit (e.g. add then
  delete a character) results in the same final string.
- Placeholder text ("No lyrics yet — start typing...") is native `placeholder`
  attribute, never persisted as real content.
- Losing all unsaved edits on a hard page refresh is expected/intentional —
  this feature does autosave-on-blur, not live keystroke sync or draft
  persistence across reloads.

### Comment system — selection and creation
- Selection is captured via the textarea's native `selectionStart`/`selectionEnd`
  (not a DOM Range — a plain `<textarea>` has no rich DOM to select within).
- Two comment-creation triggers, both opening the same inline composer:
  1. A floating "Add comment" pill appears near the mouseup position when a
     real (non-collapsed) selection exists.
  2. Right-clicking an active selection shows a custom context menu with a
     single "Add comment" item (native menu is suppressed only when a
     selection exists; a right-click with no selection shows the normal
     browser menu).
- The comments sidebar (always visible, matches the Activity panel's card
  styling/proportions from Overview) shows each top-level comment with its
  quoted `anchorText` as a truncated caption (~60 chars), author, relative
  timestamp. Ordering is position-based — see "Click-to-highlight and
  position-based ordering" below, not creation timestamp. Replies, the
  resolved/unresolved toggle, and @ mentions are fully built — see "Replies,
  resolved state, and @ mentions" below.

### Click-to-highlight and position-based ordering
- Clicking a comment card selects and highlights its anchored text in the
  textarea using the browser's native selection
  (`textarea.setSelectionRange(start, end)` + `.focus()`) — a real selection,
  not a CSS overlay.
- `resolveCommentAnchor(lyrics, anchorText, anchorOffset)` is the single
  shared function used by both click-to-highlight and sidebar ordering — do
  not duplicate this logic. Resolution order: (1) exact match at the stored
  `anchorOffset`, the fast path when lyrics haven't changed since the comment
  was made; (2) fall back to `indexOf(anchorText)` across the full current
  lyrics if the exact offset no longer matches (lyrics were edited) — first
  match wins, no fancier disambiguation; (3) if the anchor text isn't found
  anywhere, the comment is "unresolved" — clicking it does nothing (fails
  silently, no toast, no error), and it sorts to the end of the sidebar list.
- The comments sidebar sorts by each comment's *resolved* position in the
  document (reading order, top to bottom) — not creation timestamp. This
  means ordering stays correct even after lyrics are edited, since it's
  recomputed from the same shared resolver, not the raw stored `anchorOffset`.
- Clicking a comment card takes priority over any other active state (an
  open composer for a different selection, an unrelated active user
  selection) — it clears whatever was active and switches to the clicked
  comment's highlight.

### Replies, resolved state, and @ mentions
- **Replies**: one level of nesting only (matches the schema's `parentId`
  design — a reply cannot itself be replied to). Each top-level comment has
  a "Reply" action that opens an inline composer nested directly under it,
  posting to the same `POST /api/songs/:songId/lyrics-comments` route with
  `parentId` set. Since `anchorText`/`anchorOffset` are `NOT NULL` with no
  server-side inheritance, the client explicitly forwards the parent's
  anchor values on a reply (same trick `ReviewPlayer` uses for `timestamp`).
- **Resolved/unresolved toggle**: matches the `song_review_comments`
  convention exactly — resolved comments are hidden by default behind a
  "Show resolved (N)" toggle in the sidebar header, not shown-but-faded. The
  count only reflects top-level resolved comments, not replies (deliberate).
  Reopening a resolved comment is an explicit "Unresolve" action — replying
  does NOT implicitly reopen it (a deliberate choice, discussed and kept for
  is-it-worth-it reasons: an explicit toggle handles the "resolved by
  accident" case without forcing a reply just to undo it).
- **"Show resolved" state is persisted per-song via localStorage**, key
  `patchbay-lyrics-show-resolved-${songId}` — matches the existing
  `patchbay-{feature}-${songId}` convention (e.g. `patchbay-loop-${songId}`
  in `Transport.tsx`). Lazy-initialized from localStorage on mount, same
  pattern as `Transport.tsx`'s `isLooping`/`isMetronomeOn` — correct on
  first paint, no post-mount correction effect.
- **@ mention autocomplete**: same trigger/dropdown/insertion pattern as
  `ClipInfoWindow`/`ReviewPlayer` (`@(\w*)$` regex, arrow-key nav, plain-text
  `@username` insertion via `GET /api/users`). Works in both the top-level
  composer and reply composers. Purely cosmetic — no backend parsing,
  notification, or structured storage; mentions are stored as plain text,
  same as every other comment surface in the app.
- **Mention display**: submitted comments render real `@username` mentions
  in bold + the app's gold accent color, via a shared `MentionText`
  component (`client/src/components/MentionText.tsx`). This is NOT
  Lyrics-specific — the same component is used by `ClipInfoWindow`,
  `ReviewPlayer`, and `ProductionTracker`'s task comments, since all four
  had the identical gap (autocomplete on input, but plain-text display with
  no visual distinction). `MentionText` only styles a match if it's a real
  username in the surface's own scoped user list — a literal "@something"
  that isn't an actual band member stays plain text.
- **Active-comment glow**: clicking a comment card (or its "Reply" action)
  marks it as the active comment, shown via a subtle gold ring (`ring-1
  ring-inset ring-primary/40 bg-primary/5`, reusing `ReviewPlayer`'s existing
  `highlightedCommentId` treatment verbatim) around the ENTIRE card — the
  parent comment plus all its nested replies and an open reply composer, as
  one continuous unit, not just the top line. Only one comment can be active
  at a time. Clears on outside-click, a new manual text selection, or typing
  in the textarea; does NOT clear when collapsing an expanded reply thread
  (a view toggle, not a selection-loss event). Never applies to a comment
  whose anchor text can't be resolved (nothing was actually highlighted, so
  nothing should glow).
- **Delete**: author-only — a comment or reply only shows a "Delete" action
  to the user who wrote it (`author === user?.username` via `useAuth()`),
  matching the same client-side gating pattern used elsewhere, but ALSO
  enforced server-side: `DELETE /api/lyrics-comments/:id` checks the
  requester's session against the comment's stored author and returns 403 if
  they don't match (verified via direct testing — a same-band, different-
  author request is blocked and the row is confirmed untouched in the DB,
  not just rejected at the HTTP layer). Deleting a top-level comment cascades
  to all its replies regardless of who wrote them — the original comment's
  author has full authority over the thread they started, a deliberate
  choice, not an oversight. Deleting a reply only removes that one reply.
  Confirmation dialog only appears when deleting a top-level comment that
  has replies to lose (matches ProductionTracker's Remove Instrument/Section
  AlertDialog pattern exactly, including `trapDialogTab`); deleting a
  comment/reply with nothing else attached happens immediately, no dialog.
  **Note**: `clip_comments`, `task_comments`, and `song_review_comments`
  DELETE routes do NOT have this same server-side author check yet — this is
  a known, pre-existing gap across those three older comment types (see
  "On the horizon" below), not something this session's scope covered.

### Textarea auto-grow
- The lyrics textarea has no manual resize handle and no internal scrollbar
  — it auto-grows to fit its content via a `useLayoutEffect` keyed on the
  lyrics value, which resets height to `'auto'` then sets it to `scrollHeight`.
  The reset-to-`auto` step is required — `scrollHeight` alone won't detect
  that the textarea should *shrink* after content is deleted, only that it
  needs to grow.
- `min-h-[640px]` sets the floor; there is no max — the textarea grows
  indefinitely and the page scrolls, not the textarea internally.
- Because the effect is keyed on the lyrics value (not just user input
  events), it also correctly sizes to fit content loaded from the server on
  initial page load, not just after the user's first keystroke.
- This also simplified the selection-highlight overlay (see gotchas below)
  by removing a whole category of scroll-sync risk — the overlay only ever
  needed to match the wrapper's height, and since there's no separate
  internal scroll position to track, it works correctly with zero scroll-
  aware code.

### Composer positioning
- The comment composer is positioned with pure CSS, not JS measurement:
  `top: composerAnchor.bottomY` plus `transform: translateY(-100%)`. This
  anchors the composer's bottom edge exactly to the pill's (or right-click
  point's) position and grows upward — no gap, no height-based calculation,
  no "flip to below" logic of any kind.
- **This is a deliberate simplification, not an oversight.** An earlier
  version calculated position as `topY - height - gap` with a "flip to below
  if not enough room above" branch. That approach required measuring the
  composer's own rendered height via `getBoundingClientRect()` inside a
  `useLayoutEffect`, which proved fragile across several rounds of real-
  browser bugs (composer rendering disconnected from its trigger with a
  large empty gap; the flip logic never correctly triggering; automated
  Playwright verification repeatedly reporting success on a fix that was
  visibly broken in a real browser). The whole flip branch — and the
  `COMPOSER_GAP`/`COMPOSER_VIEWPORT_MARGIN` constants it used — was deleted
  outright rather than debugged further.
- **Accepted tradeoff**: for a selection very close to the top of the
  visible viewport, the composer can render up over the header/nav. This is
  intentional, confirmed acceptable by product decision — not a bug to fix.
- `composerAnchor` is `{x, bottomY}` (viewport-relative, captured live via
  `getBoundingClientRect()`/`clientX`/`clientY` at the moment the composer
  opens) — do not confuse this with `iconPos` (the pill's position), which
  is intentionally wrapper-relative/document-flow-relative so it scrolls
  naturally with the page. These are two different coordinate spaces for two
  different `position` values (composer is `fixed`; the pill's containing
  wrapper is `absolute` inside normal document flow) — do not let one leak
  into the other.

### Reload race condition (fixed)
On a hard page reload (not ordinary SPA navigation — the in-memory React
Query cache with `staleTime: Infinity` and no persister means a reload is a
genuine cold start), two independent one-frame races could occur before
being fixed:
- The lyrics textarea's placeholder briefly flashed even when real lyrics
  existed, because the one-shot seed effect was a plain `useEffect` (runs
  after paint) — fixed by switching it to `useLayoutEffect`, same pattern
  already used for the auto-grow effect in this file.
- The comments sidebar briefly showed "No comments yet" or the wrong sort
  order (newest-first instead of position-based), because `resolvedAnchors`
  depends on `lyricsDraft`, and the comments query could resolve before the
  song query — resolving every anchor against empty lyrics and falling back
  to the "unresolved" tiebreak. Fixed by gating the sidebar's render on BOTH
  queries having loaded (`song !== undefined && !commentsLoading`), not
  whichever resolves first.

### Known browser-timing gotchas (all fixed, documented for future reference)
- **Right-click event order**: in Chromium/Firefox, a right-click's native
  event order is `mousedown` → `contextmenu` → `mouseup` — the trailing
  `mouseup` fires AFTER `contextmenu`, not before. A mouseup handler that
  doesn't check `e.button` will clobber state set by the contextmenu handler
  moments earlier. Fix: `handleTextareaMouseUp` bails immediately on
  `e.button !== 0`.
- **Same-commit ref-nulling race**: clicking the pill unmounts the pill and
  mounts the composer in the same React commit. The composer's `autoFocus`
  fires a synchronous blur on the textarea during React's mutation phase —
  before the composer's ref attaches in the later layout phase — while the
  pill's own ref is already `null` from unmounting. A blur handler relying on
  `e.relatedTarget` matching a ref will fail in this exact window. Fix: a
  plain synchronous ref flag (`suppressNextBlurResetRef`), set by
  `openComposer` only when `document.activeElement === textareaRef.current`
  (true for the pill path; false for the right-click path, which doesn't need
  it since focus already moved to the menu in an earlier, separate commit).
- **Stale selection after OS-level focus loss**: if the browser window loses
  OS-level focus entirely (switching to a different app/window — NOT just
  switching browser tabs, which doesn't blur the element at all) while text
  is selected, Chromium does not synchronously settle the caret position on
  the refocusing click's `mouseup` — `mousedown`, `focus`, `mouseup`, and even
  the immediately-following microtask all report the stale pre-blur selection.
  Only a read deferred via `setTimeout(0)` (or the native `selectionchange`
  event) sees the real, settled value. Fix: `handleTextareaMouseUp` reads
  selection state one tick later via `setTimeout(0)`, reading from
  `textareaRef.current` rather than the synthetic event's `currentTarget`.
  Confirmed to be a no-op for the normal (already-focused) case.
- **Pill position must be document-flow-relative, not viewport-fixed**: an
  earlier version of the floating "Add comment" pill used `position: fixed`
  with `left`/`top` set once from `e.clientX`/`e.clientY` at mouseup — this
  broke as soon as the page scrolled, since nothing recalculated the fixed
  coordinates. Fixed by moving the pill to `position: absolute` inside the
  same in-flow wrapper used by the selection-highlight overlay, with its
  position derived reactively (via `useLayoutEffect`, keyed on
  `[selectionRange, contextMenuPos, composerOpen]`) from `getClientRects()`
  on a mirrored selection span, measured relative to that wrapper. Because
  the wrapper is a normal in-flow element, this offset now scrolls with the
  page automatically — no scroll listener needed. The composer itself
  deliberately does NOT use this same wrapper-relative value (see "Composer
  positioning" above) since it needs viewport-relative coordinates instead —
  reusing `iconPos` for the composer was tried and was wrong.
- **Delete/Backspace doesn't fire `mouseup`**: the floating pill's
  visibility was originally only recalculated inside `handleTextareaMouseUp`,
  so deleting a selected range via keyboard (which collapses the selection
  without any mouse event) left the pill incorrectly visible, pointing at
  now-deleted text. Fixed by adding a check inside the textarea's `onChange`
  handler: after updating the lyrics draft, if the selection is now
  collapsed while pill/selection state is still tracking something, call
  `resetSelectionUi()`.

### On the horizon
- **Pill fails to appear on selections that include (but don't start at) the
  first or last character of a wrapped line.** Confirmed via real testing: if
  a selection *starts* at that boundary character, the pill works fine; if
  the selection merely *includes* it (e.g. drag ends on/past the wrap
  boundary), the pill silently fails to appear and nothing is logged —
  meaning whatever's wrong happens upstream of the pill's own positioning
  logic, most likely inside `handleTextareaMouseUp`'s selection-collapse
  check. Instrumentation for this was added but the exact repro was never
  captured before this session ended — pick this up first in the next Lyrics
  session, instrumentation may still be in place.
- **Cut/paste can break highlighting for comments after the affected text.**
  Repro: cut a stretch of lyrics with an existing comment anchored to it,
  paste it back in elsewhere near a different commented string — comments
  positioned after the pasted text stop highlighting when clicked. Not yet
  reproduced reliably enough to diagnose; needs a tighter repro (exact
  selection method, exact paste location, which specific comments break)
  before another investigation attempt.
- **Copy/cut/paste not yet added to the custom right-click menu** (currently
  only has "Add comment"). Needs its own investigation before implementation
  — browser clipboard permissions are non-trivial, particularly
  programmatic Paste, which is heavily restricted by browsers for security
  reasons and may require a permission prompt or simply not work reliably
  cross-browser. Investigate `document.execCommand` vs. the Clipboard API
  and report real constraints before implementing. Not started.
- **`clip_comments` author-trust gap** — `clip_comments` (unlike
  `lyrics_comments`, `task_comments`, and `song_review_comments`) still
  reads `author` verbatim from `req.body` on POST rather than resolving it
  server-side from the session. Small, isolated fix, not yet scoped as its
  own session. See "Author fields throughout the app" in root `CLAUDE.md`.
