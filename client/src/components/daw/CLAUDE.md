# PatchBay — daw component internals

Loaded automatically when working with files in this directory (Timeline.tsx, Track.tsx,
Clip.tsx, MediaBucket.tsx, Transport.tsx, ProductionTracker.tsx, ExportDialog.tsx, and their
modals). The project root `CLAUDE.md` has universal context (what PatchBay is, tech stack,
navigation, database schema, auth, and the safety-critical "What To Avoid" rules) — read that
first if you haven't already; it isn't repeated here.

## Timeline Behavior

### Design principles — do not revert without discussion

These are intentional product decisions, not implementation details:

- **Clips are always contiguous** — no gaps, no overlaps within a track
- **Section-locking is enforced** — a clip can only live in its matching section column
- **Position is always derived, never stored independently** — `clip.start` is always the output of `recalcAllStarts`, never set from a cursor pixel offset or arbitrary value
- **The timeline is plug-and-play by design** — complexity that belongs in a freeform DAW does not belong in PatchBay
- **Mute, solo, zoom, scroll, and selection are client-only, per-browser** — they are never sent to the server. Volume is the only per-track mix value that is shared (stored in `instrument_tracks.volume`). The client-only values follow the same localStorage pattern as MediaBucket (one-shot restore on mount guarded by a `uiRestored` ref, keys scoped `patchbay-*-${songId}`). Do not add mute/solo/zoom/scroll to the DB schema — band members intentionally have independent views of the same arrangement.

### Mental model

The timeline is a **grid**: rows are instrument tracks, columns are song sections (Intro, Verse 1, Chorus 1, …). Each cell in the grid can hold an ordered array of clips. A clip belongs to exactly one section and can only be placed in that section's column — a Verse 1 clip can never land in the Chorus 1 column. PatchBay enforces this in the UI before the user releases the mouse.

### Section columns

Sections are derived entirely from the clips currently on the tracks — there is no independent section list. A section only exists if at least one clip with that `sectionName` is on the timeline. When the last clip for a section is removed, the column disappears immediately.

Section column **order** is stored as an explicit `sectionOrder: string[]` state in `Timeline`. This is the authoritative order — not inferred from `MOCK_SONG.sections`. It is initialized from `MOCK_SONG.sections` on first load, updated when clips are dropped, and pruned by a `useEffect` that removes sections with no clips. A `sectionOrderRef` keeps it accessible inside stale-closure handlers.

Three pure functions (module-level in `Timeline.tsx`) maintain section geometry. All three take `sectionOrder` as their second argument:
- **`getActiveSections(tracks, sectionOrder)`** — returns ordered section names present in clips, using `sectionOrder` as the authoritative sequence. Sections not yet in `sectionOrder` are appended at the end.
- **`computeSectionLayout(tracks, sectionOrder)`** — calls `getActiveSections`, then computes each section's absolute `start` (seconds) and `duration` (sum of effective trimmed durations per track, max across tracks, floored at `MIN_SECTION_WIDTH = 4s`). Effective duration = `(c.trimEnd ?? c.duration) - (c.trimStart ?? 0)`. Returns `SectionInfo[]`.
- **`recalcAllStarts(tracks, sectionOrder)`** — calls `computeSectionLayout` internally and recalculates `clip.start` for every clip using effective trimmed durations to advance position. This is the single source of truth for positions.

The `sectionLayout` `useMemo` inside `Timeline` calls `computeSectionLayout(tracks, sectionOrder)` and is the authoritative list for rendering (section headers, `SectionCell` widths, invalid-section grayout):
```ts
{ name: string; start: number; duration: number }[]
```

**Always pass `sectionOrder` to `recalcAllStarts`.** Never call it with only `tracks`. Handlers inside `useEffect(fn, [])` must use `sectionOrderRef.current` instead of the `sectionOrder` closure variable (stale closure).

### Droppable zones

There are two kinds of droppable zones in the clip-drag `DndContext`:

**1. Track rows** — bare track ID (e.g. `"track-drums"`). One per track. The droppable element is the sections container div inside `TimelineTrack` — it spans the full row from after the 256px header to the right edge. `disabled: isInvalidDrop` when the dragged clip belongs to a different instrument.

**2. Gap zones** — `gap||${gapIndex}` — **clip-boundary** zones within the active drag's section. `gapIndex = 0` is before the first clip; `gapIndex = N` is after clip N−1 (i.e. between clips N−1 and N). Dropping here **reorders clips within the section** — it is not a section column operation. These are rendered as `GapZone` components (defined in `Timeline.tsx`) via a `gapZones` `useMemo` that runs whenever `activeDragData` changes. They are always rendered (not gated on `isDragging`) so their DOM nodes exist for the live rect check. Each zone is 20px wide, centered on the boundary, spanning the full track-area height.

**`GapZone` implementation:** Uses a `refCallback` that writes to both `setNodeRef` (dnd-kit) and a local `nodeRef.current` (for live rect), so the collision function can call `container.node.current?.getBoundingClientRect()` to bypass the stale `droppableRects` cache. `isOver` alone drives the gold insertion line — no state threaded from the parent.

**`gapZones` useMemo:** Reads `activeDragData.trackId` and `activeDragData.clip.sectionName` to find the track and section, then walks the section's clips in order using effective durations to compute each boundary's absolute pixel position (`256 + posSec * zoom`). Returns `[]` when no drag is active.

**Section column reordering** is handled entirely by a **separate inner `DndContext`** that wraps only the section header row. It does not use gap zone IDs — it uses `handleSectionDragMove` (nearest-gap heuristic) and `handleSectionDragEnd` → `reorderSectionOrder`. Clip drag and section-column drag are completely independent drag contexts with no shared drop targets.

**`reorderSectionOrder(sectionOrder, sectionName, gapIndex, activeNames)`** — pure function used only by the section-header DndContext. `activeNames` is `sectionLayout.map(s => s.name)`. It removes the section from its current position, adjusts `gapIndex` for the resulting index shift, and splices the section back in. Returns the new ordered array.

**There are no per-section-cell droppables.** The old `${trackId}||${sectionName}` format was replaced. `SectionCell` is a pure visual component with no dnd-kit involvement.

**Collision detection** — the outer `DndContext` uses the custom `trackFirstCollision` function (defined module-level in `Timeline.tsx`). The outer `DndContext` also sets `measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` to force dnd-kit to remeasure droppables on every render — necessary because gap zones mount and reposition mid-drag.

Gap zones are checked **first** using a live `container.node.current?.getBoundingClientRect()` call (falls back to cached rect if the ref is null). This bypasses the stale `droppableRects` cache for freshly-mounted or repositioned zones. Track rows are checked **second** by vertical band only — any X position on the row matches, preventing `overId: null` in empty horizontal track space.

`handleDragMove` checks `overId.startsWith('gap||')` first. When over a gap, it sets `isOverGap = true` and clears `insertionPoint`. Otherwise it sets `isOverGap = false` and clears `insertionPoint`.

**`handleDragEnd` gap drop — clip reorder:**
- **Bucket clip**: calls `insertClipInSection(targetTrack.id, clipSectionName, clip, gapIndex)`. No index adjustment needed — inserting a new clip, not removing an existing one.
- **Timeline clip**: removes the clip from `sectionClips`, computes `adjustedGapIndex = oldIndex < gapIndex ? gapIndex - 1 : gapIndex` (removal shifts subsequent indices down by 1), splices the clip back at `Math.min(adjustedGapIndex, withoutClip.length)`, calls `recalcAllStarts`, and PATCHes all clips whose `start` changed to the server. Uses `clipFromState` (the clip from current `tracks` state, not the stale drag-data closure) to get current `trimStart`/`trimEnd`.

On a track-row drop, `overId` is the trackId directly — see clip reorder section below.

### Position calculation — `recalcAllStarts`

`recalcAllStarts(tracks, sectionOrder)` is the single source of truth for all clip start times. It:
1. Calls `computeSectionLayout(tracks, sectionOrder)` to get each section's absolute start offset (widest track in that section determines section width)
2. For each track, walks each section's clip array in order and sets `clip.start = sectionOffset + sum of preceding effective trimmed durations`

**Effective duration** — everywhere clip length is used for layout (section width, snap position, mute-state range check, drag overlay width), use `(clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)` rather than raw `clip.duration`. `clip.duration` is the full file length and is never modified.

Call it after every insert, remove, or section reorder. It takes the full tracks array and the current `sectionOrder` and returns a new array with all starts updated. Because it is pure, it can be called inside `setTracks(prev => ...)` safely.

`insertClipInSection` accepts an optional `newOrder` parameter. When a gap drop pre-computes the new `sectionOrder`, pass it here so the recalc uses the already-updated order instead of the stale closure value.

**Do not reintroduce `recalcStarts` (the old global version).** The section-scoped model replaced it. Never derive `clip.start` from a pixel value or cursor position.

### Insertion indicators

There is one active insertion indicator during drag:

**Column-level** — each `GapZone` component renders its own gold vertical line via dnd-kit's `isOver` state when the drag pointer is over it. No separate state is needed; the indicator is owned entirely by the `GapZone`.

**`insertionPoint` is always `null` during drag.** `handleDragMove` unconditionally calls `setInsertionPoint(null)`. As a result, all track-row drops append to the end of the section (`idx = undefined` in `insertClipInSection`). The `SectionCell` gold vertical line never renders during live drag. Do not reintroduce cursor-position–based insertion indicator logic — it caused a "stuck at position zero" visual bug and is incompatible with the full-track droppable model.

### Drop validation (what is rejected)

| Condition | Result |
|---|---|
| Bucket clip's instrument ≠ track name | Reject — `isInvalidDrop` disables the droppable |
| Timeline clip dropped onto different track | Reject — `isInvalidDrop` disables the droppable |
| `over` is null on drag end | Reject — no droppable was hit |

**During drag — visual feedback:**
- **Invalid tracks** get a semi-transparent dark overlay (`rgba(0,0,0,0.5)`) rendered as an absolutely positioned child div with explicit inline styles (`position: absolute`, `left/top/bottom/right: 0`, `zIndex: 20`). The track row's own opacity does not change.
- **Valid track** gets a gold border rendered as an absolutely positioned child div with explicit inline styles (`border: 1px solid rgba(212,175,55,0.6)`). No opacity change, no dimming inside the track.
- `isDragging` is passed as a prop from `Timeline` (`activeDragData !== null`) to each `TimelineTrack` — not from `useDndMonitor` or any hook inside Track.tsx. This ensures all tracks receive the same drag state in the same render pass.
- All overlay positioning uses explicit inline styles, not Tailwind `inset-0`, to avoid paint-clipping issues on wide scrollable containers.
- **The track-level overlay is the single source of truth for all drag visual feedback.** `SectionCell` must never have drag-aware styling of any kind — no opacity, no grayscale, no filter, no className conditions that reference drag state. Clips and cells always render at full brightness regardless of drag state. (A previous `isInvalid && 'opacity-25 grayscale'` on `SectionCell` caused hard-to-trace clip dimming and was removed — do not reintroduce it.)
- **`Clip.tsx` must have zero drag-aware styling.** No `isDragging &&` conditional classes on `TimelineClip` or `BucketClip`. The `DragOverlay` renders the floating ghost separately; the original clip element in the track must not change appearance during drag.
- **The timeline itself does not change during drag.** No ghost section columns are injected speculatively. `sectionLayout` is used directly for all rendering; the old `effectiveSectionLayout` speculative-injection memo has been removed.

### Clip reorder via track-row drop

Dropping a timeline clip onto its own track row (not a gap zone) reorders it within its section using `delta.x` as a proxy for intent:

- `delta.x < 0` (dragged leftward) → move clip to **index 0** (beginning of section)
- `delta.x >= 0` (dragged rightward or no horizontal movement) → move clip to **end of section** (`withoutClip.length`)

**Left-boundary guard:** Before processing a leftward drop, the handler checks whether the pointer released inside the 256px instrument panel. It reads `activatorEvent.clientX + delta.x` and compares to `timelineRef.current.getBoundingClientRect().left`. If the cursor is left of the track area, the drop is cancelled. This prevents accidental reorders when the user drags a clip toward the panel and releases.

**Trim-safe splicing (`clipFromPrev`):** Inside `setTracks(prev => ...)`, the clip must be read from `prev` state rather than from the stale drag-data closure. The closure captures `clip` at drag-start, which may have stale `trimStart`/`trimEnd` if the clip was trimmed after the drag began. `clipFromPrev = sectionClips.find(c => c.id === clip.id) ?? clip` ensures `recalcAllStarts` sees current trim values and computes correct effective durations.

**Index adjustment for capturedPoint (unused path):** If `insertionPoint` ever resumes (currently always null during drag), `oldIndex < newIndex → newIndex -= 1` corrects for the removal shift — same logic as the gap zone `adjustedGapIndex`.

After splicing, `recalcAllStarts(draft, sectionOrder)` is called inside `setTracks`, and all clips whose `start` changed are PATCHed to the server.

### Drag data — `trackId` requirements

**`BucketClip`** embeds `trackId` in its dnd-kit drag data: `{ clip: {...}, type: 'bucket-clip', trackId }`. `Timeline.handleDragStart` stores it in `activeDragData`. All drop validation (wrong-track rejection, `isInvalidDrop` render, `gapZones` useMemo) uses this `trackId`. The MOCK_SONG instrument-name lookup is a fallback for legacy mock clips only — real API clips always have `trackId` set.

**`TimelineClip`** must also embed `trackId` in its drag data: `{ clip: {...}, type: 'clip', trackId }`. Without it, gap drops and track-row reorders fail silently because `dragData?.trackId` is undefined and the handlers bail early. `trackId` is threaded as a prop: `Timeline` → `TimelineTrack` (passes `trackId={track.id}`) → `SectionCell` (prop `trackId: string`) → `TimelineClip` (prop `trackId?: string`).

`clipSectionName` in `handleDragEnd` is read as `dragData?.clip?.sectionName ?? dragData?.sectionName` — the double path handles real API clips (sectionName at top level of dragData) vs. mock clips (on dragData.clip).

**`onAddToTimeline` (right-click "Add to Timeline")** follows the same contract as drag-drop. `BucketClip` passes `trackId` explicitly and `clip.sectionName` is read directly on the clip object — no name-parsing or substring heuristics. `Timeline`'s handler (`handleAddToTimeline`) bails with `console.warn('[AddToTimeline] missing', ...)` when either value is absent. **Known landmine:** a clip whose `section_name` is `null` in the DB (can happen with idea-sourced clips that were never associated to a section) will silently no-op on both drag-drop and right-click add — the warn fires but no placement occurs. Do not add silent fallbacks (e.g. using `tracks[0]` or deriving sectionName from the clip name string) — they silently place clips on the wrong track.

### Stale closure rule

All event handlers registered inside `useEffect(fn, [])` (e.g. `handleRemoveClip`, `handleToggleMute`) must use `setTracks(prev => ...)` and read current state from `prev`, not from the `tracks` variable in the outer closure (which is permanently `[]` in those handlers).

The same problem applies to `sectionOrder`. Handlers inside `useEffect(fn, [])` that call `recalcAllStarts` must use `sectionOrderRef.current` (a ref kept in sync via a separate `useEffect`), not the `sectionOrder` closure variable.

`insertClipInSection` is called from non-stale contexts (recreated on every render), so it can read `sectionOrder` directly from the closure.

### API calls after mutations

Every insert fires a `POST /api/tracks/:trackId/clips` for the new clip, then `PATCH /api/timeline-clips/:id` for every existing clip whose `start` changed. Every remove fires `DELETE` then patches shifted clips. All are fire-and-forget (`.catch(console.error)`).

### Timeline polling and live track sync

The timeline `useQuery` has `refetchInterval: 3000` and an explicit `queryFn` that fetches `/api/songs/${SONG_ID}/timeline`. This means the timeline is always at most 3 seconds out of date when instruments are added or removed from outside the timeline view.

There are two `useEffect`s that sync `apiTracks` into the local `tracks` state:

1. **Initial load** (guarded by `tracksInitialized.current`): runs once on first non-null `apiTracks`, converts and sets the full tracks array, sets `sectionOrder`. After this, `tracksInitialized.current = true` and this branch never runs again.

2. **Live sync** (runs on every `apiTracks` poll): removes any tracks missing from `apiTracks`, syncs clips for existing tracks from the API response, and appends any new tracks. Preserves local `muted`/`solo`/`volume` state. New tracks start with empty clips. Clip sync is needed so that when a section is hidden (which deletes its timeline clips on the server), the timeline removes those clips within 3 seconds without a manual refresh.

**Do not merge the two effects.** The initial-load guard exists to prevent the API response from clobbering clip state that the user has added to the timeline mid-session (before the refetch fires).

---

### Audio playback system — ✅ Built

Real per-clip audio playback is handled entirely in `Timeline.tsx`. `Transport.tsx` is a pure controls component — it only dispatches CustomEvents and displays state. No audio logic lives in Transport.

**Key refs in `Timeline.tsx`:**
- `customAudioRefs` — `{ [clipId: string]: HTMLAudioElement }`. One `Audio` object pre-created per clip as clips appear in `tracks`. Set `audio.preload = 'auto'` so the browser buffers ahead of play. Created in a `useEffect` on `tracks`; only adds new entries, never overwrites existing ones.
- `pendingPlayRef` — `Set<string>` of clip IDs whose `.play()` Promise is still resolving. Guards against calling `.play()` again before the previous call settles, which would throw `AbortError`.
- `audioCtxRef` — persistent `AudioContext | null`. Used solely to unlock Safari's audio pipeline; not used to route audio. Closed when playback stops.
- `masterVolumeRef` — `number`, initialized to `0.8` (matching the Transport slider's default of 80). Updated by a `useEffect` listening for `update-master-volume` events (`e.detail.volume / 100`). The listener also immediately applies the new volume to all currently-playing elements in `customAudioRefs`. The rAF loop multiplies per-track volume by this ref: `audio.volume = (track.volume / 100) * masterVolumeRef.current`.

**Playhead position model:**
`playheadPositionState` (and `playheadRef`) store the playhead in **content-space pixels**: `256 + timeInSeconds * zoom`. The playhead has two DOM elements, both inside the scroller content root — no scroll-offset math anywhere:

- **Line** — `position: absolute; left: playheadPositionState; top: 0; bottom: 0` at z-40. Scrolls natively with content; zero compositor lag.
- **Flag** (draggable handle + triangle) — `position: absolute; left: playheadPositionState` inside the sticky flag band (z-35). Sticks vertically with the band; `handlePlayheadPointerDown` computes `clientX - rect.left + scrollLeft` to get content coordinates on pointermove.

See **Timeline playhead & occlusion** section below for the full z-map and WebKit sticky rules.

**Animation loop:**
The `requestAnimationFrame` loop runs while `isPlaying === true`. Each frame:
1. Advances the playhead by `delta * zoom` pixels (zoom is pixels/second).
2. Computes `playheadTime` in seconds from the pixel position.
3. For each clip in `tracks`: if `playheadTime ∈ [clip.start, clip.start + effectiveDuration)` (where `effectiveDuration = (clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)`), calls `audio.play()` guarded by `pendingPlayRef`, and sets `volume`, `muted`, and `playbackRate` every frame. When playback starts, `audio.currentTime` is set to `clip.trimStart ?? 0` so the audio begins at the trimmed in-point.
4. If the clip is out of range and not paused, calls `audio.pause()`.

**Safari AudioContext unlock:**
Safari requires `AudioContext.resume()` to be called synchronously within a user gesture window. The rAF loop fires asynchronously — outside that window — so raw `audio.play()` from the loop has a ~0.5s delay.

Fix: `Timeline.tsx` listens to the `toggle-play` CustomEvent synchronously. `Transport.tsx` dispatches this event synchronously from the play button click handler and the spacebar handler. When `isPlaying: true` arrives in that synchronous listener, `Timeline.tsx` immediately calls `audioCtxRef.current.resume()` — still within the gesture window. The `audio.play()` calls that happen frames later then run without delay.

When `isPlaying` becomes `false`: all audios are paused, `pendingPlayRef` is cleared, `audioCtxRef.current?.close()` is called, and `audioCtxRef` is set to `null`.

**Stale audio on clip replace — `clip-replaced` CustomEvent:**
When a timeline clip is replaced via `PATCH /api/timeline-clips/:id` (from the Replace submenu in `Clip.tsx`), the old `HTMLAudioElement` in `customAudioRefs` still holds the old `src` and will keep playing. Fix: `Clip.tsx` dispatches `clip-replaced` with `{ clipId }` after a successful PATCH. `Timeline.tsx` listens for this event (in a `useEffect(fn, [])`, so `customAudioRefs.current` is never stale) and pauses + removes the old element. The pre-create `useEffect` then creates a fresh `Audio` for the new `src` when `tracks` updates after the query refetch.

**Do not:**
- Move audio playback logic into `Transport.tsx` — it belongs in `Timeline.tsx` where clip positions are known.
- Call `audio.play()` outside the rAF loop without checking `pendingPlayRef` — overlapping play/pause calls throw `AbortError`.
- Create a new `AudioContext` per clip or per play call — one persistent `audioCtxRef` per play session is correct.
- Remove the `toggle-play` listener in `Timeline.tsx` that calls `audioCtxRef.current.resume()` — it is the Safari unlock and must remain synchronous with the gesture.
- Modify the pre-create `useEffect` to detect src changes via URL comparison — `audio.src` is an absolute URL while `clip.src` is a relative path; use the `clip-replaced` event instead.
- Put side effects (ref writes, scroll/DOM mutations) inside a `setPlayheadPosition` state-updater function — React may invoke updaters more than once per render (StrictMode double-invocation, retried concurrent renders), causing any side effect to fire multiple times against a stale snapshot of related state. This caused an early ~2-second scroll overshoot bug during development. All auto-scroll logic lives in the rAF `animate` function body, which runs exactly once per real frame.

**Auto-stop at end of timeline:**
Each frame, `animate` re-derives `timelineEndPx` fresh from `computeSectionLayout(tracks, sectionOrder)`: `256 + (lastSection.start + lastSection.duration) * zoom`. Zero sections → `timelineEndPx = 256` (time 0). This is intentionally re-derived every frame, not cached at play-start, so edits to tracks/sections mid-playback are respected.

If the playhead's pixel position reaches or passes `timelineEndPx` on a given frame: the playhead is clamped to exactly `timelineEndPx` (frames advance in discrete jumps, so the raw computed position will usually overshoot slightly before the check catches it), the existing manual stop sequence is invoked (pause all audios, clear `pendingPlayRef`, close + null `audioCtxRef`, `isPlaying` → `false`), and the rest of that frame's per-clip play/pause logic is skipped.

**Do not:** compute `timelineEndPx` once and reuse it across the play session — always re-derive per frame. Do not write a second/parallel stop implementation — this must call into the same stop path manual pause uses.

**Transport button sync (`playback-ended` event):** Transport.tsx and Timeline.tsx hold independent `isPlaying` state with no shared props or context. Transport dispatches `toggle-play` on button/spacebar (one-way, Transport → Timeline). Because auto-stop originates in Timeline.tsx (not via a `toggle-play` dispatch), a second one-way event was added: Timeline's auto-stop block dispatches `playback-ended` immediately after its own `setIsPlaying(false)`; Transport listens for it and calls its own local `setIsPlaying(false)` to un-stick the button.

**Do not:** have Transport dispatch `playback-ended`, or have Timeline listen for it — this must stay strictly one-way (Timeline → Transport) to avoid a dispatch loop. The manual pause/stop path (originating from Transport's own `toggle-play`) does not dispatch `playback-ended` — only the auto-stop block does, since Transport already knows its own state in the manual case.

**Metronome — ✅ Built**

Bare ghost icon button in Transport (before SkipBack). `isMetronomeOn` state persisted per song to localStorage (`patchbay-metronome-${songId}`), lazy-initialized for correct first paint. Dispatches `toggle-metronome` event; Timeline listens and syncs `isMetronomeOnRef.current`. No standalone/practice mode — metronome only ticks during playback.

**Click generation:** Inside the rAF `animate` loop, beat detection computes `currentBeatIndex = Math.floor(playheadTimeSecs / secondsPerBeat)`. When `currentBeatIndex !== lastBeatIndexRef.current`, `playMetronomeClick` fires: creates an `OscillatorNode → GainNode → audioCtxRef.current.destination` (same `audioCtxRef` as the Safari unlock, no separate AudioContext), 1000 Hz on beat 0 of each measure (accent), 800 Hz on all other beats. Gain envelope: 0 → 0.25 over 5ms, then exponential decay to 0.0001 over 45ms, total duration 50ms. Gain is **not** scaled by `masterVolumeRef` — intentional so guide clicks stay audible when the mix is turned down.

**Gotcha 1 — seed `lastBeatIndexRef` on play-press:** If initialized to `null`, the `!== lastBeatIndexRef.current` check always fires on the first rAF frame regardless of actual beat position, producing a spurious click. Seed to `Math.floor(playheadTime / secondsPerBeat)` at the top of the rAF `useEffect`'s `if (isPlaying)` block (not in the `[]` Safari-unlock listener, which has stale `bpm`/`zoom` values from mount).

**Gotcha 2 — position-0 edge case:** When `playheadTime === 0`, seeding to `Math.floor(0 / secondsPerBeat) = 0` matches the first frame's `currentBeatIndex = 0`, silently dropping beat 0's click. Fix: seed to `-1` when `playheadTime === 0`.

**Section-loop visual indicator — ✅ Built**

Previously, the only signal that looping was active was audible repetition. A gold header highlight now shows which section is being looped.

**`loopedSectionName` — derived, never stored from the rAF loop:**
```ts
const loopedSectionName = React.useMemo(() => {
  if (!isLooping) return null;
  const playheadTime = (playheadPositionState - 256) / zoom;
  return sectionLayout.find(
    (sec) => playheadTime >= sec.start && playheadTime < sec.start + sec.duration
  )?.name ?? null;
}, [isLooping, playheadPositionState, sectionLayout, zoom]);
```
Recomputed on every render from render-time state — deliberately not gated on `isPlaying` — so the indicator stays correct while paused. There is no separate "pinned" loop section; the derivation is always live from the current playhead position.

**Disable-on-reposition (generalized watcher):**
A `useEffect` watching `[playheadPositionState, isLooping, sectionLayout, zoom]` compares the current derived section against the previous one via `prevLoopedSectionRef`. If `isLooping` is true, the previous section was non-null (guards against mount), and the section changes, `isLooping` is set to `false`. This works correctly because the loop's own boundary-reset always keeps the playhead inside the same section during normal looping — an observed section change during `isLooping` can only mean the user repositioned the playhead manually (flag drag, ruler click, or any other input method). No per-input-method special-casing is needed.

**Cross-component sync:**
`isLooping` is tracked independently in both `Transport.tsx` and `Timeline.tsx`. `toggle-loop` flows Transport → Timeline only. When Timeline's watcher auto-disables loop, it dispatches `loop-force-disabled` (no payload) and Transport listens for it to set its own `isLooping` to `false` directly — without re-dispatching `toggle-loop`, which would create an event ping-pong.

**Header styling (`DraggableSectionHeader`):**
`isLooped && 'bg-primary/10 border-b-2 border-r-2 border-primary rounded-br-md'` — a gold underline + right-edge boundary line (same 2px weight, matching `border-primary`, meeting at a rounded corner), plus a subtle background tint. Deliberately not a solid/opaque fill — solid fills are reserved for clip track-identity color, not state indicators. The underline weight and color match the active-tab style used in AppHeader's ARRANGEMENT/PRODUCTION tabs.

**Out of scope for this version:** no retargeting to a new section when the playhead moves — loop simply disables on reposition. No toast/notification on auto-disable. Multi-section loop ranges are a separate future feature.

**Last-section loop fix — gotcha:**
Looping the final section previously failed: `animate()`'s end-of-timeline guard (`playheadRef.current + pixelDelta >= timelineEndPx`) ran before `setPlayheadPosition` was called and returned early unconditionally, stopping playback instead of resetting. The last section's end position and `timelineEndPx` are numerically identical by construction, so the guard always fired first, preventing the loop boundary-reset (which lives inside the `setPlayheadPosition` updater) from ever being reached. Fixed by gating the guard on `!isLooping` — it now only stops playback when not looping, deferring to the existing loop boundary-reset when looping is active. **Any future changes to end-of-timeline handling must preserve this `!isLooping` check.**

**`isLooping` persistence:**
`isLooping` is persisted per-song to localStorage under `patchbay-loop-${songId}`, following the same personal-UI-state convention as mute/solo, zoom, scroll, and playhead position. Restored via lazy `useState` initialization on mount in both `Transport.tsx` and `Timeline.tsx` — not a post-mount `useEffect` — so the button and indicator are correct on first paint (same reasoning as the BPM-flash fix documented under Timeline session persistence). `loopedSectionName` itself remains a pure derived value and is not persisted.

**Auto-scroll during playback — edge-riding:**

Two approaches were tried and rejected before the current model was built:
- **Page-turning** (scroll by one viewport width when the playhead hits the right edge): caused a stale-closure tween bug where the tween start position was captured from an already-outdated ref, producing overshoot. Discarded.
- **Naive continuous centering** (keep playhead at 50% every frame): fights any manual scroll attempt the way Premiere Pro's scroll-follows-playhead does, which users find disorienting. Discarded.

The current model is **edge-riding**: once the playhead enters the last 12% of the viewport ("edge zone"), `scrollLeft` is derived each frame directly from the playhead's authoritative float position — `scrollLeft = playheadRef.current − cw * 0.88`, clamped to `[0, scrollWidth − clientWidth]`. This keeps the playhead pinned at the 88% boundary with zero drift.

**Why direct derivation, not accumulation (`scrollLeft += pixelDelta`):**
Accumulating `scrollLeft` independently from `playheadRef.current` drifts apart over time. `el.scrollLeft` is a DOM property quantized to integer CSS pixels on 1× displays (or 0.5px on Retina). At zoom = 80 and 60fps, `pixelDelta ≈ 1.333px/frame` — `scrollLeft` accumulates at ~1px/frame while `playheadRef.current` (pure IEEE 754 float) advances at 1.333px/frame, producing ~20px/second rightward drift. Direct derivation from the same float source each frame eliminates this entirely — there is no running total to accumulate error in.

**Engagement state — `isFollowingRef` (boolean):**
Edge-riding engagement is tracked explicitly as a boolean ref, not recomputed from the boundary formula each frame. Earlier: `pos >= el.scrollLeft + cw * 0.88` was recomputed every frame to decide whether to write `scrollLeft`. This cannot distinguish "playhead approaching the edge" from "playhead already far off-screen" (both satisfy the inequality), so any manual backward scroll instantly re-triggered a snap back to the boundary — the user's scroll was silently cancelled every frame.

**Manual scroll handling (symmetric, either direction):**
Each rAF frame, `el.scrollLeft` is compared against `lastAutoScrollRef.current` (the value edge-riding last wrote). If they diverge by more than 1px (browser rounding tolerance), something other than edge-riding moved the viewport — `isFollowingRef` is set to `false` immediately. While disengaged, `el.scrollLeft` is never touched and the 88% boundary is never evaluated, regardless of how far off-screen the playhead drifts or for how long.

**Re-engagement — visibility-gated, not boundary-gated:**
Edge-riding re-engages only when the playhead is visible within the current viewport: `el.scrollLeft <= playheadRef.current <= el.scrollLeft + clientWidth`. This is a pure visibility check. Once true, `isFollowingRef` is set back to `true` and `lastAutoScrollRef` is seeded with the current `el.scrollLeft` as the new baseline. The 88% condition is then evaluated normally — if the playhead is visible but not yet in the edge zone, no scroll happens yet; edge-riding only activates once it crosses the boundary. This gives the user an unlimited "look ahead" or "look behind" window with a clean, natural re-entry.

**On fresh play press:**
If the playhead is not currently visible, a one-time snap centers it at 50% of the viewport (`scrollLeft = pos − cw * 0.5`). This is deliberately different from the 88% edge-riding boundary — landing at 88% caused edge-riding to trigger almost immediately after the snap, which felt abrupt. 50% gives a normal viewing beat before edge-riding begins. After the snap, `lastAutoScrollRef` and `isFollowingRef` are both seeded so the first rAF frame doesn't misread the snap itself as a manual scroll.

**Key refs added for edge-riding:**
- `lastAutoScrollRef` — `number | null`. The `scrollLeft` value edge-riding last wrote. Used exclusively for manual-scroll detection. Does not accumulate — it is set to the exact derived value on each write, never incremented.
- `isFollowingRef` — `boolean`. Whether edge-riding is currently engaged. Set to `true` on play start; `false` on manual scroll detection; `true` again when visibility is restored.

### Non-destructive clip trim — ✅ Built

Timeline clips have left and right trim handles that physically resize the clip container without modifying `clip.duration`. `clip.duration` always stores the full file length; trim state is held in `trimStart` (seconds to skip from the start, default 0) and `trimEnd` (cutoff point in seconds, `null` = play to end), both stored in the `timeline_clips` DB table.

**UI — `TimelineClip` in `Clip.tsx`:**
- Gold 8px-wide handles render at `left: 0` and `right: 0` on hover (`isHovered` state, driven by `onMouseEnter`/`onMouseLeave` on the clip container)
- `displayWidth = ((trimEnd ?? clip.duration) - trimStart) * zoom` — the clip container's `width` is set to this value; the `left` position stays fixed at `(clip.start - sectionStart) * zoom` so the clip never shifts horizontally during a left-handle drag
- Drag is captured with `window.addEventListener('pointermove'/'pointerup')` (no `setPointerCapture`) to avoid conflicts with dnd-kit sensors. `e.nativeEvent.stopImmediatePropagation()` on `pointerdown` prevents dnd-kit from starting a drag
- `isTrimDragging` ref gates the `positionStyle` so dnd-kit's `style` prop (transform) is suppressed during trim drag
- Local `trimStart`/`trimEnd` state is updated on every `pointermove` frame; `patchTrim` fires on `pointerup`
- On every `pointermove` frame, `Clip.tsx` also dispatches a `trim-preview` CustomEvent: `{ clipId, trimStart, trimEnd }`. `Timeline.tsx` listens in a zero-dep `useEffect` and calls `setTracks(prev => recalcAllStarts(...))` with `sectionOrderRef.current` — so neighboring clips reflow in real time during drag without waiting for the server PATCH
- A `useEffect` syncs `trimStart`/`trimEnd` from the prop whenever the API refetches (so a live-sync poll doesn't clobber active drag state — the effect only runs when the clip is not being dragged)
- All trim actions live inside a **▶ Trim submenu** (`ContextMenuSub`) in the `TimelineClip` right-click menu. Menu order: Detect Trim Points → Apply Trim to All Instances (conditional) → Reset Trim on All Instances (conditional) → Reset Trim (conditional). The submenu is always visible; individual items appear conditionally.

**API — `PATCH /api/timeline-clips/:id/trim`:**
Accepts `{ trimStart: number, trimEnd: number | null }`. Validates both fields. Calls `storage.updateTimelineClip`. Does not touch `isFinal` or `start`. On success, `patchTrim` in `TimelineClip` calls `queryClient.invalidateQueries({ queryKey: ['/api/songs/${songId}/timeline'] })` to push the new trim values into the tracks state so the rAF loop and live-sync effect see them immediately.

**Layout — effective duration everywhere:**
`computeSectionLayout`, `recalcAllStarts`, the mute-state range check, and the `DragOverlay` width all use `(clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)` instead of raw `clip.duration`. This ensures section columns expand/contract to match the audible content, not the raw file length.

**Live-sync fix:**
After a trim PATCH, the server's `start` values for sibling clips may be stale (they were computed before the trim change). The live-sync `useEffect` in `Timeline.tsx` calls `recalcAllStarts(merged, sectionOrderRef.current)` at the end of its `setTracks` callback to recompute all positions from the fresh trim values.

**New and replaced clips always start untrimmed:**
`insertClipInSection` explicitly sets `trimStart: 0, trimEnd: null` on every new clip it creates and in the `POST /api/tracks/:trackId/clips` body. Spreading from the bucket clip drag data is not sufficient because bucket clips don't carry these fields. `performReplace` in `TimelineClip` also explicitly sends `trimStart: 0, trimEnd: null` in its `PATCH /api/timeline-clips/:id` body — the general PATCH route is a partial update and would otherwise preserve the original clip's trim values on the replacement.

**Export:**
`ExportDialog.tsx` passes trim to the `OfflineAudioContext` via `source.start(when, trimStartSecs, trimDuration)` where `trimDuration = (clip.trimEnd ?? decoded.duration) - trimStartSecs`. The total export duration also uses effective trimmed durations so silence is not rendered past the trim out-point.

### AI trim detection (client-side) — ✅ Built

"Detect Trim Points" in the Trim submenu runs entirely in the browser using the `AudioBuffer` already decoded for waveform rendering — no re-fetch, no re-decode.

**Algorithm (`detectTrimPoints` in `TimelineClip`):**
1. Read channel 0 from `decodedBufferRef.current`
2. Find peak amplitude across all samples
3. Threshold = 1% of peak — filters pops/clicks that would otherwise anchor the trim at the very first sample
4. Scan forward in 100ms windows (`windowSize = Math.floor(sampleRate * 0.1)`); `trimStart` = start of first window whose average absolute amplitude exceeds threshold
5. Scan backward in 100ms windows from the end; `trimEnd` = end of last active window
6. Enforce minimum effective duration of 0.5s (expand from center if needed)

**The menu item is disabled (`disabled={!hasDecodedBuffer}`)** until the `AudioBuffer` is ready. `hasDecodedBuffer` is a state boolean set to `true` inside the decode `useEffect` after `decodedBufferRef.current` is populated. Because refs don't trigger re-renders, this state flag is required — reading `decodedBufferRef.current` directly in JSX would not reflect async updates.

**Visual preview overlay:** When `detectedTrim` state is set, two semi-transparent blue (`rgba(59,130,246,0.4)`) regions are rendered absolutely over the clip — one on the left (suggested silence to trim from start) and one on the right (from end). The active region between them shows gold **Apply** and muted **Dismiss** buttons. Both buttons use `onPointerDown` with `e.stopPropagation()` + `e.nativeEvent.stopImmediatePropagation()` to prevent dnd-kit from starting a drag. **Apply** dispatches `trim-preview` (immediate Timeline reflow), then calls `patchTrim`. **Dismiss** clears the state.

**Do not** re-read `decodedBufferRef.current` to check if decoding is complete — use `hasDecodedBuffer` state instead.

### Apply / Reset trim to all instances — ✅ Built

The same clip name placed multiple times on the same track (same `trackId + name`) represents the same recording in different sections. "Apply Trim to All Instances" stamps the selected clip's current `trimStart`/`trimEnd` onto all of them. "Reset Trim on All Instances" sets `trimStart: 0, trimEnd: null` on all of them. Both reuse `POST /api/timeline-clips/apply-trim-to-instances`.

**`instanceCount` prop threading:**
`TimelineClip` receives an `instanceCount?: number` prop (default 1). The count is computed in `SectionCell` (`Track.tsx`) per clip using the full track clip array — not just the section slice, because the same name may appear in a different section:
```ts
const instanceCount = allTrackClips.filter((c) => c.name === clip.name).length;
```
`allTrackClips` is passed from `TimelineTrack` as `track.clips` (all clips across all sections of the track). The `SectionCellProps` interface includes `allTrackClips: Clip[]`. Do not compute the instance count from query cache data — the prop is always fresh because `SectionCell` re-renders whenever `track.clips` changes.

**Both instance actions are only shown when `instanceCount > 1 && (trimStart > 0 || trimEnd !== null)`.** When N = 1 (only this clip), the items are absent entirely — no toast, no confirmation.

**Confirmation dialogs:** "Apply Trim to All Instances" shows the count as `instanceCount - 1` (excluding the selected clip itself). "Reset Trim on All Instances" shows the same count.

**After success:** `queryClient.invalidateQueries({ queryKey: ['/api/songs/${songId}/timeline'] })` is called so the live-sync effect picks up the new trim values for all affected clips within the next poll cycle.

**`POST /api/timeline-clips/apply-trim-to-instances` route** is registered before `PATCH /api/timeline-clips/:id` in `routes.ts`. Although Express won't confuse a POST with a PATCH, keeping static paths before parameterized ones is the convention. The route runs a single `db.update(timelineClips).set({ trimStart, trimEnd }).where(and(eq(trackId), eq(name))).run()` — one DB round-trip regardless of instance count.

### Bucket clip cards — WaveformPlayerCard — ✅ Built

`BucketClip` in `Clip.tsx` renders a **`WaveformPlayerCard`** (`client/src/components/daw/WaveformPlayerCard.tsx`) in the VERSIONS column of `MediaBucket`. The same component is used in the Dashboard file browser (Songs and Ideas modes).

**`WaveformPlayerCard` props:** `src`, `name`, `duration`, `isFinal`, `color?` (left border), `waveformHeight?` (default 20px; MediaBucket uses 32px), `className?`.

**What it renders:**
- Thin colored left border accent (`absolute left-0 top-0 bottom-0 w-0.5`) — only when `color` is provided; MediaBucket passes `clip.color`, Dashboard omits it
- Round gold play/pause button (explicit click trigger — **no hover-to-play anywhere**)
- Clip name with gold `CheckCircle2` icon when `isFinal` — **no "FINAL" text label anywhere**
- Duration display (shows total duration when stopped, current position when playing)
- Waveform canvas: decoded once via `AudioContext.decodeAudioData`, drawn with gold playhead progress

**Drag compatibility:** `BucketClip` wraps `WaveformPlayerCard` with `ContextMenuTrigger asChild` on the dnd-kit drag div. The play button and canvas both call `e.stopPropagation()` on `onPointerDown` so they do not accidentally activate drag. Right-click anywhere opens the context menu normally via `ContextMenu`.

**Context menu items (BucketClip):** More Info · Add Note · Mark as Final / Unmark Final · Add to Timeline · Download · **Remove** (red). Remove calls `PATCH /api/clips/:clipId { active: false }` (soft-delete) and invalidates `['bucket', songId]`. The `clips` table has an `active` column (boolean, default true); `getBucket` in `storage.ts` filters `eq(clips.active, true)`.

**`isFinal` persistence** — `useEffect` syncs `isFinal` from the prop whenever the bucket query refetches. Local state is optimistically updated and reverted on API failure. `executeMark(newIsFinal)` is the shared path for both the direct toggle and the sibling-confirmation dialog.

**Sibling-final confirmation dialog** — before marking a clip final, `BucketClip` checks `siblingClips.some(c => c.id !== clip.id && c.isFinal)`. If a sibling is already final, an `AlertDialog` ("Change Final Version?") appears. `siblingClips` is passed from `MediaBucket` via `siblingClips={selectedIdea.clips.map(toClip)}`.

**Timeline clip removal guard** — `TimelineClip` shows an `AlertDialog` ("Remove Final Clip?") when a user selects "Remove Clip" from the context menu and `isFinal === true`. This is managed via `showRemoveConfirm` state in `TimelineClip`.

**Auto-isFinal on timeline clip placement** — `POST /api/tracks/:trackId/clips` checks whether a final bucket clip exists for the same `trackId + sectionName`. If one exists, the newly placed timeline clip is immediately set to `isFinal: true`.

### Media Bucket — "Add Section"

Hovering over the Sections header in `MediaBucket.tsx` reveals a `+` button that opens `AddSectionModal` (from `client/src/components/daw/modals/AddSectionModal.tsx`). Submitting calls `useAddSection` (from `use-bucket-mutations.ts`).

**Add Section** — `useAddSection(songId, bucket)` → `POST /api/songs/:songId/sections`, a single atomic server-side call that creates one idea row per active track in a transaction. Server computes `sortOrder` once, shared across all tracks (not per-track). Section names must be unique per song, active or hidden, no exceptions — enforced by a `UNIQUE(track_id, section_name)` index on `ideas` (schema.ts) plus a server-side pre-check. Duplicate attempts return 409, distinguishing an active conflict ("already exists") from a hidden conflict ("exists but hidden — restore it"), mirroring the instrument-duplicate pattern. Restore goes through the song-wide `POST /api/songs/:songId/sections/restore` endpoint on both MediaBucket and Production Tracker.

**`AddInstrumentModal` duplicate-name guard (client-side):** `AddInstrumentModal`'s onSubmit handler performs a pre-check against the current bucket data before mutating: `tracks.some(t => t.name.trim().toLowerCase() === name.toLowerCase())`. If a duplicate is found, `setAddInstrumentError` is called and the mutation is not fired. The error clears automatically on the next keystroke via `onClearError`. The same pattern applies on the Dashboard Files tab surface (`fileBucket` instead of `tracks`). Section uniqueness is now enforced server-side (409) — `AddSectionModal` no longer performs a client-side pre-check.

**Auto-select + scroll after creation:** `addSectionMutation.onCreated` fetches the fresh bucket via `queryClient.fetchQuery`, finds the selected track's new idea by `sectionName === <created name>`, and calls `setSelectedIdea`. A `selectedIdeaRef` + `useEffect([selectedIdea?.id])` then scrolls the idea row button into view — parity with the instrument-add pattern.

**Right-click "Remove from This Instrument"** hides the idea for that one instrument only (`useHideIdea` → `PATCH /api/ideas/:ideaId` → `active = false`). This is per-instrument, not song-wide. A song-wide hard-delete endpoint (`DELETE /api/songs/:songId/sections/:sectionName`) exists on the server but is not wired to any UI action — do not add a UI affordance for it without a product discussion.

**User-added sections always appear at the bottom of the sections list.** `getBucket` in `storage.ts` orders ideas by `asc(ideas.sortOrder)` before returning them; MediaBucket renders in that order — no client-side re-sort. Do not change this to alphabetical or insertion-point ordering without discussion. Append-to-bottom is the intentional UX.

### Media Bucket — hidden-tracks query invalidation

The `hiddenTracks` useQuery (key: `['hidden-tracks', DEFAULT_SONG_ID]`) has `enabled: isAddInstrumentOpen` so it only runs when the Add Instrument dialog is open. It also has `refetchOnMount: true` and `refetchOnWindowFocus: false` — this ensures it always fetches fresh data when the dialog opens, even if the cache was previously populated.

**Two places must invalidate this key** whenever an instrument is soft-deleted (hidden):
1. `deleteTrackMutation.onSuccess` in `MediaBucket.tsx` — triggered when the user removes an instrument from the bucket panel's right-click menu
2. `handleDeleteTrack` in `Timeline.tsx` — triggered when the user removes an instrument from the timeline track header right-click menu

Both fire `queryClient.invalidateQueries({ queryKey: ['hidden-tracks', SONG_ID] })`. If either is missing, the restore dropdown in the Add Instrument dialog will show stale data until a manual page refresh.

### Media Bucket — VERSIONS column empty state

When a section is selected but has no clips, the VERSIONS column renders a full-height dashed-border drop zone (matching the Dashboard file browser empty state style) instead of plain text:

```tsx
<div className="flex-1 p-2">
  <div className={cn(
    'flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors',
    isVersionsDragOver ? 'border-primary/50 bg-primary/5' : 'border-white/[0.08]'
  )}>
    <Upload size={18} ... />
    <p ...>{isVersionsDragOver ? 'Drop to upload' : 'No files yet'}</p>
    <p ...>Drop audio files or use Upload above</p>
  </div>
</div>
```

The empty state is rendered **outside** `ScrollArea` as a `flex-1` sibling of the column header div — this is required so `h-full` on the inner bordered div has a proper flex parent (the `flex flex-col` versions column div) to fill against. When placed inside a `ScrollArea`, `h-full` has no bounded parent and the div collapses to its content height.

`isVersionsDragOver` state (in `MediaBucket`) drives the gold border / tinted background. The `onDragLeave` handler uses `e.currentTarget.contains(e.relatedTarget as Node)` to avoid flickering when the pointer moves over child elements within the column.

When clips exist (or a search query is active), `ScrollArea` renders as normal for the clip list.

### Media Bucket — session persistence

`MediaBucket.tsx` persists the last selected instrument and section idea to `localStorage` under keys `patchbay-selected-track-${songId}` and `patchbay-selected-idea-${songId}` (scoped per song). On mount, a one-time restore effect (guarded by a `sessionRestored` ref) reads these keys and restores the selection before falling back to URL param logic. The guard ensures the restore only runs once — it does not re-run on subsequent bucket refetches, preventing the selection from snapping back on poll.

**Song name in MediaBucket header** — The "Project: …" label in MediaBucket's header uses `useQuery(['song', songId])` to fetch the song name dynamically. In the SongHome context, this cache entry is already warm (SongHome fetches the same key). In the Workspace context, it makes one small fetch. Never hardcode the song name here.

**URL param priority** — On fresh mount, `MediaBucket` checks for `?instrument=`, `?section=`, `?clipId=`, and `?openComments=` query params before falling back to localStorage. `instrument` + `section` navigate the three-column browser to the right idea. `clipId` + `openComments=true` (both must be present) set `autoOpenClipId` state, which causes the matching `BucketClip` to auto-open its More Info modal with the comment input focused. All four params are read in the same one-shot session restore `useEffect` so they resolve atomically on the first bucket data load.

### Timeline — session persistence

`Timeline.tsx` uses localStorage for all client-only UI state. A `uiRestored` ref (initialized `false`) guards the full restore path — a one-shot `useLayoutEffect([tracks, songId])` that fires when tracks first become non-empty. The ref is set to `true` at the top of the restore body (before any state updates) so the persist effects in the same render cycle already see it as true. The persist effects check `if (!uiRestored.current) return` to avoid writing the initial React defaults before the restore runs.

**Keys (all scoped per songId):**

| Key | Type | What it stores |
|---|---|---|
| `patchbay-track-muted-${songId}` | JSON `Record<trackId, boolean>` | Per-track mute state |
| `patchbay-track-solo-${songId}` | JSON `Record<trackId, boolean>` | Per-track solo state |
| `patchbay-zoom-${songId}` | number string | Pixels-per-second zoom level |
| `patchbay-scroll-${songId}` | number string | `scrollLeft` of the timeline scroller (debounced 200ms via DOM listener) |
| `patchbay-playhead-${songId}` | number string | Playhead position as **time in seconds** (not pixels — pixel position is zoom-dependent; converted to pixels on restore using the already-restored zoom value) |
| `patchbay-selected-timeline-track-${songId}` | string | ID of the last clicked track header |
| `patchbay-selected-timeline-clip-${songId}` | string | ID of the last clicked timeline clip |

**Restore ordering:** `zoom` and `playheadPositionState` are restored via **lazy `useState` initializers** (`useState(() => localStorage.getItem(...))`), not via the `useLayoutEffect` restore. This means the correct values are the initial values — they exist before the first render, so no wrong value is ever painted by construction. The `useLayoutEffect` restore still re-sets them when tracks arrive (idempotent; React bails out of the state update if the value hasn't changed). Mute/solo, scroll, and selection ARE still handled by the `useLayoutEffect` restore because they depend on tracks being loaded (mute/solo need track IDs; scroll uses `requestAnimationFrame` to wait for the content to render at the restored zoom width). The restore is declared before the muted/solo persist effect so it runs first in the same effect-flush cycle.

**`patchbay-playhead` persist** — the persist effect fires on `playheadPositionState`, `isPlaying`, `songId`, and `zoom` changes, but is gated on `isPlaying === false`: when audio is playing the effect clears any pending write and returns immediately (no write attempted, not just debounced). A 200ms debounce on writes matches the scroll persist pattern. This means refreshing the page mid-playback intentionally falls back to the last paused or scrubbed position, not the live position — this is expected behavior, not a bug.

**Lazy-init as the preferred pattern for first-paint state** — a `useEffect` or even `useLayoutEffect` that corrects state after mount still means the component's first render used the wrong default. With React Query's cache, `apiTracks` can be immediately available but `tracks` (separate `useState`) always starts empty, so the first render always happens with the default values before the restore logic runs. Any state that must be visually correct on the very first paint should be lazy-initialized directly from its persisted source, not corrected by a post-mount effect. The BPM input flash was worked around with a `disabled` gate — lazy init is the cleaner, more general solution. Apply it whenever this bug class (flash-default-then-jump) appears for other persisted values.

**Scroll restore** is deferred via `requestAnimationFrame` so the content has rendered at the restored zoom level before `scrollLeft` is set — otherwise the scroller may not be wide enough to reach the saved position.

**Source of truth summary:**
- **DB-backed (shared across the band):** `songs.bpm`, `instrument_tracks.volume`
- **localStorage-backed (per-browser, not shared):** mute, solo, zoom, scroll, playhead position, selected track, selected clip

**Why activity feed links navigate to `/workspace` not `/songs/:songId`** — The `sessionRestored` ref is a one-shot guard. If the user is already on SongHome and clicks an activity row that would just change the URL params on the same page, the guard has already fired and will not re-run. Navigating to `/songs/:songId/workspace` ensures MediaBucket is always a fresh component mount, so the URL param restore logic runs cleanly. Never use the `find-in-bucket` CustomEvent for activity-feed navigation — that path is for within-workspace navigation only (e.g. "Show in File Browser" from a timeline clip right-click).

### Media Bucket — "new content" indicator — ✅ Built

Gold dot next to instrument and section folder names in MediaBucket's INSTRUMENTS/SECTIONS columns, showing content added since the current user last opened that folder.

**Schema:** `bucket_folder_views` (id, userId, ideaId, viewedAt) — unique index on (userId, ideaId), upserted per user per idea. Created via a guarded `CREATE TABLE IF NOT EXISTS` in `server/db.ts` at boot (not `drizzle-kit push`, per the migration-safety rule above). On first creation only, backfills a `viewedAt = now` row for every existing user × idea pair so no pre-existing content is falsely flagged new at launch — this backfill does not re-run on subsequent boots.

**Server:** `GET /api/songs/:id/bucket` now takes the session user into account and returns `hasNew: boolean` on every idea — true if any active clip's `createdAt` is later than that user's `viewedAt` for that idea (a missing view row counts as "never viewed," so any clips present make it `true`). `POST /api/ideas/:ideaId/view` upserts the view row for the current session user; ownership-checked against the idea's song.

**Client:** Selecting a section (`selectedIdea` change in `MediaBucket.tsx` — covers direct clicks, `find-in-bucket` navigation, add-section/add-instrument auto-select, and session restore) fires the view mutation and invalidates `['bucket', songId]` so the dot clears immediately rather than waiting for the next poll.

- **Section-level dot:** rendered when `idea.hasNew` is true.
- **Instrument-level dot:** pure client-side derivation, no separate tracking — `track.ideas.some(i => i.active && i.hasNew)`. The `active` check matters: without it, a hidden section's stale `hasNew` can light up the parent with no way for the user to clear it.
- Full Takes ideas need no special-casing — they're a normal `ideas` row and flow through the same path as any other section.
- Clip-level (VERSIONS column) is intentionally untouched — this is folder-level only.

### Timeline Selection — ✅ Built

`selectedTimelineTrackId` and `selectedTimelineClipId` are personal, per-song localStorage state (same pattern as mute/solo/zoom/scroll). Selecting a clip always sets both (clip + its parent track). Selecting a track header directly sets track only and clears clip. Both are persisted to `patchbay-selected-timeline-track-${songId}` and `patchbay-selected-timeline-clip-${songId}` and restored by the one-shot `useLayoutEffect` on first tracks load.

**Visual indicator — selected clip:**
A separate `pointer-events-none absolute inset-0 rounded-md border-2 border-primary bg-primary/10 z-[19]` child div is rendered inside the clip container when `!isOverlay && isSelected`. This is an inset border (not `ring-*`) because `overflow-hidden` on the clip container clips inline box-shadows to a sliver on one edge — `ring-*` is not usable on `TimelineClip`.

**Visual indicator — track-only selection:**
No visual indicator. Track selection is kept exclusively as a "current track" reference for keyboard navigation (`selectedTimelineTrackId`) — a highlight added no value and confused users. Selecting a track header only clears the clip selection; the track ID is remembered silently.

**Hover glow:**
`isHovered && !isOverlay` renders a child div with `boxShadow: 'inset 0 0 0 2px rgba(180,180,180,0.7), inset 0 0 14px rgba(180,180,180,0.15)'` — deliberately grey, not gold. Gold is reserved app-wide for "this is the thing keyboard actions will act on" (the selection state). Hover being visually identical to selection was a real bug source, especially since Delete acts on the selected clip, not the hovered one.

**`tabIndex` and `focus-visible`:**
`TimelineClip`'s container div carries `focus-visible:outline-none`. The `tabIndex={0}` is added automatically by dnd-kit's `{...attributes}` spread from `useDraggable` — `KeyboardSensor` is not configured in this app's `DndContext` so it is not wired to any drag behavior. The `outline-none` class suppresses the native blue focus ring that appears after arrow-key navigation moves selection away from a clip that still holds native browser focus from an earlier click.

**Click-to-deselect:**
`handleTimelineClick` fires on the timeline container's `onClick`. Guards:
1. `controlInteractionRef.current` — bail (Mute/Solo/slider interaction)
2. `!e.currentTarget.contains(target)` — bail (Radix portal content is not a DOM descendant of the Timeline even when visually overlapping; `contains` is the only general test that excludes all current and future Radix overlays without per-component allowlisting)
3. `target.closest('.cursor-grab')` — bail (clip, section header, playhead flag)
4. `e.clientX - containerRect.left < 256` — bail (click was inside the 256px instrument panel)
If all guards pass: `clearTimelineSelection()`.

**Right-click also selects:**
`TimelineClip`'s `onContextMenu` dispatches `timeline-clip-selected` (same event as left-click `onClick`), so right-clicking a clip selects it before the context menu opens. This ensures context-menu actions and subsequent keyboard shortcuts always target the same clip you were just inspecting. Previously decoupled — right-clicking a clip could leave Delete targeting a different, previously-selected clip elsewhere on screen.

**Mute/Solo/volume-slider guard — `controlInteractionRef`:**
Set `true` on `pointerdown` for any Mute/Solo/volume-slider control in the track header; cleared on `requestAnimationFrame` after `pointerup`. Checked at the top of both `handleTrackSelected` and `handleTimelineClick`. This is necessary because dragging the volume slider to its exact min/max causes the browser to synthesize a `click` event that lands on a sibling element at release time — outside any `stopPropagation` wrapper — which would otherwise be read as "clicked blank space" and clear the selection.

### Clip session notes (More Info panel) — ✅ Built

`ClipInfoWindow` in `Clip.tsx` is the shared "More Info" dialog for both `BucketClip` and `TimelineClip`. It shows clip metadata stats and a full comment thread backed by the `clip_comments` table.

**`bucketClipId` — direct foreign key, not a name match:**
`timeline_clips` has a `bucketClipId` column (nullable text, references `clips.id`) that stores a direct link to the source bucket clip. This replaced an earlier soft-matching scheme that resolved the link at read-time by walking the bucket cache and matching on `trackId + sectionName + name` — a guessable link that silently broke on rename, Replace, or duplicate-name collisions within a section.

`bucketClipId` is set at write time by every path that creates or repoints a timeline clip's source:
- **Drag-to-timeline** and **right-click "Add to Timeline"** (both go through `insertClipInSection` in `Timeline.tsx`) — set `bucketClipId: clip.id` directly, since `clip` at these call sites is always the source bucket clip.
- **Timeline-clip reorder** (gap drop, track-row drop with `activeType === 'clip'`) — does not call `insertClipInSection` and never touches `bucketClipId`; only `start` is patched. The existing value is preserved automatically.
- **Replace** (`PATCH /api/timeline-clips/:id` from the Replace submenu) — sets `bucketClipId` to the selected replacement's `id`, so the source link correctly repoints to the new version rather than staying attached to the old one.

`ClipInfoWindow` reads `effectiveId = clip.bucketClipId ?? clip.id` for all comment API calls, and resolves `effectiveMetadata` via a direct `bucketClipId` lookup against the bucket cache (an O(1) find, not a nested walk). The old name-matching code is left in place, commented out, as a deprecated fallback — not deleted, in case a row is ever found with a null `bucketClipId` (should not happen given the backfill, but defensive).

**Do not** reintroduce trackId+sectionName+name matching as a resolution path. If a future feature needs to resolve a timeline clip's source, use `bucketClipId` directly.

**Mount-gating:** `ClipInfoWindow` is mounted conditionally (`{showInfo && <ClipInfoWindow ... />}`) on both `TimelineClip` and `BucketClip`. This is required, not optional — the component's resolution logic (bucketClipId lookup, `effectiveMetadata` computation, comment query, peak-level decode) previously ran unconditionally on every render for every visible clip on both surfaces, confirmed via direct render-count testing (~80+ resolution calls/sec from an idle MediaBucket view alone before the fix). `autoOpenInfo` is safe with mount-gating — it calls `setShowInfo(true)`, which mounts the component on demand rather than requiring it to be pre-mounted.

**`focusNotes` prop:**
Both `BucketClip` and `TimelineClip` have a `focusNotes` state that is set to `true` when "Add Note" is selected from the context menu and reset to `false` when the dialog closes. `ClipInfoWindow` receives this as a prop and triggers `setTimeout(() => noteInputRef.current?.focus(), 150)` inside `useEffect([open, focusNotes])`.

**Comment CRUD with threading:**
- `GET /api/clips/:clipId/comments` — fetched by `useQuery(["clip-comments", effectiveId])` with `enabled: open`; returns `ClipCommentWithReplies[]`
- `POST /api/clips/:clipId/comments` — `{ author, text, parentId? }`
- `PATCH /api/clip-comments/:id` — inline edit
- `DELETE /api/clip-comments/:id` — server deletes replies first, then the parent

**Note:** `clip_comments` references `clips.id` only, so all timeline placements of the same bucket clip share one comment thread by design — this is unrelated to the `bucketClipId` migration and predates it. Per-placement (instance-specific) comments would need a separate schema change; not scoped or started.

### More Info panel — real file metadata — ✅ Built

`ClipInfoWindow` in `Clip.tsx` is fully populated with real data from both the upload pipeline and client-side audio analysis.

**Upload pipeline (server):**
`POST /api/upload` in `routes.ts` parses the audio buffer with `music-metadata` (`parseBuffer`) and extracts:
- `sampleRate` — formatted as `"44.1kHz"` or `"48kHz"` (Hz → kHz with one decimal if not a round number)
- `bitDepth` — formatted as `"24-bit"`
- `channels` — `"Mono"` (1), `"Stereo"` (2), or `"5.1"` (6); empty string for other counts
- `uploadedDate` — ISO date string of upload (e.g. `"2026-05-18"`)
- `uploadedBy` — `"Jordan"` placeholder until auth is built (`// TODO: replace with real auth user`)

These are returned in the upload response. `MediaBucket.tsx` destructures them and passes them into the `metadata` JSON when calling `POST /api/ideas/:ideaId/clips`. Musical Intelligence fields (`bpm`, `key`, `timeSignature`) and `tags` start empty for user entry — no longer hardcoded.

**Peak level (client-side, state only):**
`ClipInfoWindow` receives an optional `audioBuffer?: AudioBuffer` prop. `TimelineClip` passes `decodedBufferRef.current` (already decoded for waveform rendering — no extra fetch). For `BucketClip`, `audioBuffer` is undefined, so `ClipInfoWindow` decodes the audio on-demand when `open` becomes true by fetching `clip.src` and calling `AudioContext.decodeAudioData()`. Peak = `20 * Math.log10(max absolute sample across all channels)`, displayed as `"-7.1 dBFS"`. Stored in component state (`peakLevel`), never written to the DB.

**Duration formatting:**
`formatDuration(secs)` — under 60s: `"4.84s"`; 60s or more: `"1m 4s"`.

**Musical Intelligence (editable, blur-to-save):**
BPM, Time Signature, Key/Scale, and Tags are editable fields — see "Musical Intelligence & Meta Tags fields" section below for the current read/write pattern. BPM uses `type="text" inputMode="decimal"` (no spinner arrows). Key/Scale treats stored `'Unknown'` as empty so the placeholder `"e.g. C Minor"` shows. All inputs have `placeholder:text-[10px] placeholder:text-muted-foreground placeholder:italic` styling. A 1.5s green "Saved" flash appears next to the field label via `savedField` state + `flashSaved(field)` helper.

**Meta Tags (editable):**
User types into a text `<Input>` and presses Enter to add a tag (lowercased, spaces → hyphens, deduped). Each existing tag renders as a pill with an `×` button that removes it immediately. "Saved" flash on add only.

**`patchMeta` and invalidation:**
Sends `PATCH /api/clips/${effectiveId}` with `{ metadata: merged }` and invalidates `['bucket', songId]`. The `PATCH /api/clips/:clipId` route handles metadata updates without triggering `isFinal` sync logic (since `isFinal` is not in the body). `ClipInfoWindow` receives `songId?: string` (default `'patchbay-default'`) for scoped invalidation.

**Header:** Shows only the clip name (and `(FINAL)` if applicable). The type badge and clip ID have been removed.

**Focus-stealing fixes (surfaced by comment badge auto-scroll work):**
- Radix's default "focus first focusable element" behavior on `ClipInfoWindow`'s `DialogContent` was autofocusing the BPM input on every More Info open, regardless of entry path. Fixed via `onOpenAutoFocus={e => e.preventDefault()}` on the `DialogContent`. Pre-existing issue (not introduced by badge work), but it actively conflicted with badge-triggered auto-scroll — typing immediately after open could unintentionally edit BPM, or scroll position would jump to the focused off-screen field.
- The reply input's `autoFocus` attribute was firing on any `expandedThreadId` change, including programmatic expansion (e.g. badge's auto-scroll-to-latest-reply effect), not just user-initiated "Reply" clicks. Fixed by removing `autoFocus` from the reply input and instead calling `replyInputRef.current?.focus()` directly inside the "Reply" link's `onClick`, only when the click is opening the thread (not closing it). The "N replies" toggle still calls `toggleThread` alone with no focus side effect.

### Musical Intelligence & Meta Tags fields — read/write consistency — ✅ Built

BPM, Time Signature, Key/Scale, and Tags in `ClipInfoWindow` all read from and write to `effectiveMetadata`/`effectiveId`, consistently — this was not always true. `bpm` was fixed first; `timeSignature`, `keyScale`, and `tags` previously read `clip.metadata` directly, which is always `undefined` on timeline-originated clip objects (the timeline conversion in `Timeline.tsx` never includes metadata). This meant those three fields always displayed blank and reset to blank after every save when opened from a timeline clip, even though the underlying save succeeded.

**`patchMeta`'s merge base is `effectiveMetadata`, not `clip.metadata` — this is load-bearing.**
```ts
const patchMeta = async (updates: Partial<NonNullable<Clip['metadata']>>) => {
  const merged = { ...(effectiveMetadata ?? {}), ...updates };
  // ...PATCH /api/clips/${effectiveId} with { metadata: merged }
```
Using `clip.metadata` as the merge base is a data-loss bug on timeline clips: since `clip.metadata` is always empty there, any single-field save would silently wipe every other previously-saved metadata field on that clip (e.g. saving a new Time Signature would erase an existing BPM value). Verified fixed via direct test — editing one field with three others already populated leaves all three intact. **Do not revert this merge base to `clip.metadata`**, even to "simplify" — it will reintroduce silent metadata loss on every timeline-clip edit.

### Timeline clip waveform — ✅ Built

Each `TimelineClip` in `Clip.tsx` renders a `<canvas>` waveform over its clip background. The waveform is decoded once and cached; redrawing on trim change or zoom is cheap (no re-fetch).

**Key refs in `TimelineClip`:**
- `canvasRef` — `HTMLCanvasElement | null`. The canvas is `position: absolute; top: 0; left: 0; width: 100%; height: 100%` with `zIndex: 2` — above the clip color background, below the `z-10` label and `z-20` trim handles.
- `decodedBufferRef` — `AudioBuffer | null`. Populated once after the first fetch+decode. All subsequent redraws (trim, zoom) read from this ref — no re-fetch or re-decode.
- `drawRef` — `(() => void) | null`. Reassigned in the component body on every render, so it always closes over the current `trimStart`, `trimEnd`, and `clip.duration`. The `ResizeObserver` and trim `useEffect` both call `drawRef.current?.()` with no stale-closure risk.

**Three effects:**
1. **Decode effect** `[clip.src, isOverlay]` — fetches the audio file, decodes via `AudioContext.decodeAudioData()` (channel 0 only), stores the buffer in `decodedBufferRef`, then calls `drawRef.current?.()`. Skipped for overlay clips. Fails silently. Cancellation flag prevents stale writes after unmount.
2. **Trim redraw effect** `[trimStart, trimEnd, clip.duration]` — calls `drawRef.current?.()`. Buffer is already cached; redraw is a pure canvas operation.
3. **Resize effect** `[]` — attaches a `ResizeObserver` to the canvas and calls `drawRef.current?.()` on every size change (fires on zoom-in/out since the clip container width tracks `displayWidth`).

**Draw function (`drawRef.current`):**
- Reads `canvas.offsetWidth` / `canvas.offsetHeight` for current CSS pixel dimensions.
- Applies device pixel ratio: `canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr)` — renders at physical pixel resolution, displays at CSS size.
- Slices `buffer.getChannelData(0)` to the trimmed region: `[trimStart * sampleRate, (trimEnd ?? duration) * sampleRate)`.
- Iterates one column per CSS pixel, finds min/max sample in each slice, draws a vertical `fillRect` centered at `midY`. Minimum bar height: 1px (for silence).
- Color: `rgba(0, 0, 0, 0.4)` — semi-transparent dark over the clip color.

**`isOverlay` guard:** The decode effect returns early for overlay (drag ghost) clips. No waveform fetch is initiated during drag.

**Do not** add waveform rendering to `BucketClip` — bucket clips use hover audio preview instead (see Audio hover preview section).

### Timeline background right-click context menu

Currently has two surfaces:

- **Background right-click** — "Clear Timeline" action. Extend via the `contextMenuPos` state + the fixed-position `<div>` near the bottom of `Timeline.tsx`'s return.
- **Track header right-click** — "Remove Instrument" action in `Track.tsx`, wrapped in an `AlertDialog` for confirmation. The `onDeleteTrack` callback prop flows from `Timeline.tsx` → `TimelineTrack` → confirmation → API call + local state removal + bucket query invalidation.

Both menus use the shadcn `ContextMenu` component (`@/components/ui/context-menu`). When adding new track-level actions, extend the `ContextMenuContent` in `Track.tsx`. When adding new global timeline actions, extend the menu in `Timeline.tsx`.

**Smart "Clear Timeline" — server-driven branching dialog:**

Clicking "Clear Timeline" in the background context menu triggers a `GET /api/songs/:songId/timeline-has-finals` call before showing any dialog. The result drives which dialog appears:

- **No finals on the timeline** (`hasFinals: false`) → simple dialog: Cancel / Clear Timeline (destructive). Same as the old behavior — clears local state and fires individual `DELETE /api/timeline-clips/:id` for each clip.
- **Finals exist** (`hasFinals: true`) → enhanced dialog: Cancel / Leave Final Clips / Clear All.
  - **Clear All** — same as the simple path; deletes everything.
  - **Leave Final Clips** — fires `DELETE /api/songs/:songId/timeline-clips/non-final` (fire-and-forget), closes the dialog immediately, then calls `queryClient.invalidateQueries` for the timeline key. No manual local state update — the live sync picks up the server result when the query refetches.

**`deleteNonFinalTimelineClips` server-side recalc:**
After deleting non-final clips, the server recomputes correct `start` values for the remaining final clips using the same algorithm as the client's `recalcAllStarts`: infers section order from the clips' pre-deletion `start` values (smallest per section), computes section widths (max total final-clip duration per section across all tracks, floored at 4s), then walks each track+section and writes updated `start` values to the DB. This ensures the client's live sync picks up geometrically correct positions without needing a client-side recalc.

`clearDialogState` in `Timeline.tsx` is a string union `'none' | 'checking' | 'simple' | 'enhanced'` (replaced the old `showClearConfirm: boolean`). The `'checking'` state covers the async server round-trip before the dialog appears.

### Timeline clip right-click — "Show in File Browser"

Right-clicking a timeline clip shows a "Show in File Browser" menu item (icon: `FolderSearch`). Clicking it dispatches a `find-in-bucket` CustomEvent with `{ trackId, sectionName, clipName }`, which causes `MediaBucket` to navigate its three-column browser to the matching instrument → section → versions view.

**`trackId` prop threading:**
`TimelineClip` receives `trackId` as an optional prop (`ClipProps.trackId?: string`). It is threaded down from `TimelineTrack` → `SectionCell` → `TimelineClip` — both `SectionCellProps.trackId: string` (required) and `ClipProps.trackId?: string` (optional). `TimelineTrack` passes `trackId={track.id}` to each `SectionCell` in the sections map.

**`find-in-bucket` CustomEvent:**
Dispatched by `TimelineClip` (`Clip.tsx`) on menu click:
```ts
window.dispatchEvent(new CustomEvent('find-in-bucket', {
  detail: { trackId, sectionName: clip.sectionName, clipName: clip.name },
}));
```

The event payload accepts either `trackId` (stable ID string) or `instrumentName` (display name string) for track lookup — whichever is available. Use `trackId` when possible; `instrumentName` is the fallback for callers that don't have the track ID.

**`MediaBucket.tsx` listener:**
A `useEffect(fn, [])` registers the handler. To avoid stale closures (the handler is registered once but `tracks` changes on every poll), `MediaBucket` keeps a `tracksRef = useRef<ApiTrack[]>([])` and syncs it inside the existing `useEffect` on `tracks`. The handler:
1. Reads `tracksRef.current` (always current)
2. Finds the matching track — first by `trackId`, then by case-insensitive `instrumentName` match
3. Finds the matching idea by case-insensitive `sectionName`
4. Calls `setSelectedTrack(track)` + `setSelectedIdea(idea)` — the three-column UI updates immediately

---

### Placement feedback (Add to Timeline) — ✅ Built

Context-menu "Add to Timeline" fires a styled toast and scrolls the newly placed clip into view with a brief flash halo. Drag-and-drop placement is **deliberately silent** — do not add toasts or flashes to the drag path (`handleDragEnd`).

**Flash halo pattern (`TimelineClip` in `Clip.tsx`):**
An `absolute inset-0 rounded-md` overlay div is rendered as the last child inside the clip's `relative` container. It uses `transition-opacity duration-700` to fade between `opacity-100` (flash active) and `opacity-0` (idle). Key classes: `border-2 border-white/90 shadow-[0_0_12px_rgba(255,255,255,0.6)] z-20 pointer-events-none`. **Do not use `ring-*` classes on timeline clips** — `overflow-hidden` on the clip container clips inline box-shadows (rings) to a sliver on one edge.

**Flash plumbing:**
- `insertClipInSection` returns the new clip's `id` (`nanoid()` generated, same value POSTed to the server)
- `flashClipId: string | null` state lives in `Timeline`; a `flashTimerRef` clears it after 1800ms
- Threaded as props: `Timeline (flashClipId)` → `TimelineTrack (flashClipId?)` → `SectionCell (flashClipId?)` → `TimelineClip (isFlash = flashClipId === clip.id)`
- A `useEffect([isFlash])` in `TimelineClip` calls `clipContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })` when `isFlash` becomes true; `combinedRef` satisfies both dnd-kit's `setNodeRef` and the local `clipContainerRef`

**Toast style convention for placement/creation toasts:**
Gold-bordered card: `className: 'border-primary/50 bg-[#161410] shadow-[0_0_24px_rgba(234,179,8,0.25)]'`. Title: small-caps gold text with a lucide icon (`text-[11px] font-bold uppercase tracking-[0.2em] text-primary`). Description key values: `text-white font-semibold`; separator: `text-white/40`. The Add-to-Song toast in Dashboard predates this treatment — align it when next touched.

**`useToast` / `ToasterToast` type fix (`client/src/hooks/use-toast.ts`):**
`ToasterToast` uses `Omit<ToastProps, 'title'>` (not bare `ToastProps &`) to prevent the HTML `title?: string` attribute from collapsing the `title?: React.ReactNode` field to `string` via TypeScript intersection.

### Timeline Keyboard Shortcuts — ✅ Built

All shortcut handlers live in `Timeline.tsx`. Common guard pattern (applied in each handler before doing anything): `isTypingTarget` check (`INPUT`, `TEXTAREA`, `contentEditable`) + `document.querySelector('[data-state="open"]')` (any open Radix overlay). When either guard fires, the handler returns without calling `e.preventDefault()` so the browser's native behavior is preserved. Constants: `TRACK_PANEL_WIDTH = 256` (px), `KEYBOARD_NAV_OVERSCROLL_PX = 80` (px).

**Return/Enter — seek to timeline start:**
Registered as `document.addEventListener('keydown', onReturnKey)` with deps `[setPlayheadTime]`. Calls `e.preventDefault()` after the typing-target and dialog guards to prevent the browser's "Enter activates focused button" behavior. Sets `seekPendingRef.current = true`, then calls `setPlayheadTime(0)` and dispatches `time-update` with `{ time: 0 }`. The `e.repeat` guard bails early (no repeated seeks on hold). Does NOT stop or start playback — continues uninterrupted if already playing.

After dispatching `time-update`, corrects horizontal scroll position if position 0 is not currently visible in the unoccluded viewport: checks `newPos < sl + TRACK_PANEL_WIDTH || newPos > sl + cw` (panel-aware — see Sticky Panel & Scroll Guards below), writes `el.scrollLeft`, reads the **post-write value** back into `lastAutoScrollRef.current`, and sets `isFollowingRef.current = true`. The post-write read-back (not the pre-clamp computed value) is load-bearing — the browser silently clamps `scrollLeft` to `[0, scrollWidth - clientWidth]`, so the ref must reflect what actually landed or the rAF edge-riding loop's manual-scroll detector will see a false divergence and disengage auto-follow on the very next frame. Uses `zoomRef.current` (not the closure-captured `zoom`) so the pixel position is always current even though the effect deps are just `[setPlayheadTime]`.

**`seekPendingRef` — audio sync for in-range clips:** `seekPendingRef.current` is read inside the rAF `animate` loop. When a clip is within the playhead's range and is not paused (so the loop's out-of-range→in-range transition check never fires), the loop normally just lets it keep playing from wherever it is. When `seekPendingRef.current` is `true`, the loop additionally force-resets `audio.currentTime = trimStart + Math.max(0, newTime - clipStart)` on those in-range, non-paused clips so they sync to the new position. Cleared unconditionally at the end of every rAF frame.

**Delete/Backspace — remove selected clip:**
Registered with deps `[selectedTimelineClipId, activeDragData]`. Guards: `!selectedTimelineClipId` → no-op; `activeDragData` → no-op during drag. After the common guards and `e.preventDefault()`, dispatches `keyboard-remove-clip` CustomEvent with `{ clipId: selectedTimelineClipId }`.

`TimelineClip` listens for `keyboard-remove-clip` (in a `useEffect([clip.id])`) and routes identically to the right-click "Remove Clip" menu item: if `isFinalRef.current` → opens the `showRemoveConfirm` AlertDialog; otherwise → dispatches `remove-clip` immediately. Uses `isFinalRef.current` (a ref synced from the `isFinal` prop and local state) to avoid stale closure. No duplicate deletion logic.

The `showRemoveConfirm` `AlertDialogContent` overrides `onOpenAutoFocus`:
```tsx
onOpenAutoFocus={(e) => { e.preventDefault(); removeClipButtonRef.current?.focus(); }}
```
This is required because Radix's default `focusFirst` fallback loses to ContextMenu's FocusScope timing when the dialog is opened via right-click — the Cancel button may never receive focus, leaving the dialog unkeyboardable. The override explicitly focuses the destructive action button so Return always confirms deletion regardless of whether the dialog was triggered by right-click or keyboard.

**Arrow Keys — clip/track navigation:**
Registered with deps `[tracks, selectedTimelineTrackId, selectedTimelineClipId, songId, activeDragData]`. The handler calls `e.preventDefault()` before checking `e.repeat` — this is load-bearing: without it, the held-key early-return lets the event fall through to the browser's native "scroll a focused container" behavior.

*Nothing selected:* Any arrow key selects the first clip (by `start` time) on the first track (in render order) that has any clips.

*ArrowLeft / ArrowRight:* Navigate to prev/next clip in time order within the current track. At a boundary (no more clips that direction on the current track): fall through to the next track in that direction, skipping tracks with no qualifying clip. Fall-through logic uses strict `< refStart` (Left) / `> refStart` (Right) — not `<=`/`>=` — to avoid same-timestamp ties causing sideways jumps between tracks that start at the same time. "True" start/end of the timeline (no candidates in any direction) → clean no-op.

*ArrowUp / ArrowDown:* Step to the adjacent track, finding a clip whose audible range `[c.start, c.start + effectiveDuration)` contains `currentClip.start`. Skips tracks with no clip covering that time, so Up/Down can visually jump multiple rows when intervening tracks are empty at the current timestamp — this is intentional. Track-only selection (no clip): walks to the next non-empty track and selects its earliest clip.

*`scrollClipIntoView(clipId, direction)`:* Called after every successful selection change. Reads the clip's pixel position (`TRACK_PANEL_WIDTH + clip.start * zoom` for left edge, `+ displayWidth` for right edge). Checks full visibility accounting for the 256px panel (`clipLeft >= scrollLeft + TRACK_PANEL_WIDTH`). Formulas:
- `'left'`: `newScrollLeft = clipLeft - TRACK_PANEL_WIDTH - KEYBOARD_NAV_OVERSCROLL_PX`
- `'right'`: `newScrollLeft = clipRight - clientWidth + KEYBOARD_NAV_OVERSCROLL_PX`
- `'vertical'`: picks left or right formula based on which side is off-screen
Clamped to `[0, maxScroll]`. The 80px overscroll (`KEYBOARD_NAV_OVERSCROLL_PX`) ensures the next clip in the navigation direction is partially visible after the scroll.

Arrow navigation does NOT move the playhead — selection and playback are deliberately decoupled.

**Escape — deselect:**
Registered with `{ capture: true }` on both `addEventListener` and `removeEventListener`. The capture phase is required because Radix's `DismissableLayer` (used by Dialog, AlertDialog, ContextMenu) closes overlays via its own capture-phase Escape listener. A bubble-phase listener would only see the event after Radix has already torn the overlay down, making the `[data-state="open"]` guard always find `null` and incorrectly calling `clearTimelineSelection()` every time the user closes a modal. Guards: typing target; open Radix overlay (returns without `stopPropagation` so Radix still receives the event); nothing selected (no-op). Never calls `stopPropagation` or `preventDefault` on bail.

### Pinch-to-zoom / Ctrl+scroll — ✅ Built

Cursor-anchored zoom on the timeline triggered by trackpad pinch or literal Ctrl+scroll. Both gestures set `e.ctrlKey = true` in all major browsers — no separate `GestureEvent` or `PointerEvent` handling is needed.

**Refs** (declared alongside other timeline refs in `Timeline.tsx`):
- `wheelDeltaAccRef` — running sum of raw `e.deltaY` between rAF ticks; reset to 0 after each tick consumes it
- `wheelRafRef` — pending `requestAnimationFrame` handle; `null` means no tick is scheduled
- `wheelCursorClientXRef` — stores the most recent `e.clientX`; the rAF tick uses whatever the last wheel event recorded, so anchoring reflects the current cursor position even when many events fire before a single tick

**Listener registration:**
```ts
el.addEventListener('wheel', handleWheel, { passive: false });
```
Registered on `timelineRef.current` (the `overflow-x-auto overflow-y-auto` scroll container). `passive: false` is required so `e.preventDefault()` can suppress the browser's native page zoom. The listener is added in a `useEffect([songId])` that mirrors the scroll-persist effect's dep and cleanup pattern. When `e.ctrlKey` is false the handler returns immediately — normal two-finger pan is completely untouched.

**Zoom calculation (per rAF tick):**
```ts
const factor = Math.exp(-accumulated * 0.0040);
const newZoom = Math.max(10, Math.min(300, currentZoom * factor));
```
- Multiplicative, not additive — `Math.exp` maps the signed accumulated `deltaY` to a ratio applied to the current zoom
- Positive `deltaY` (pinch-close / Ctrl+scroll-down) → `factor < 1` → zoom out; negative → zoom in
- Bounds `10–300` match `MIN_ZOOM`/`MAX_ZOOM` in `DawScrollbar.tsx` (the only other zoom control)
- Sensitivity 0.0040 tuned so a moderate pinch gesture covers close to the full zoom range in 1–2 gestures

**Cursor-anchored scroll write (same rAF tick as the zoom update):**
```ts
const containerLeft = el.getBoundingClientRect().left;
const cursorXInContent = el.scrollLeft + (wheelCursorClientXRef.current - containerLeft);
const cursorTimeSec = Math.max(0, (cursorXInContent - TRACK_PANEL_WIDTH) / currentZoom);
const targetScrollLeft = cursorTimeSec * newZoom + TRACK_PANEL_WIDTH - (wheelCursorClientXRef.current - containerLeft);
const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
const newScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScroll));
```
Uses the `TRACK_PANEL_WIDTH`-aware formula established elsewhere — see **Sticky Panel & Scroll Guards** section for why `TRACK_PANEL_WIDTH` must appear in both the cursor position calculation and the `scrollLeft` clamp check. Do not write a bare `scrollLeft + clientX` formula without the panel offset.

After writing `el.scrollLeft`, the handler seeds the edge-riding refs exactly as every other programmatic scroll-write does:
```ts
lastAutoScrollRef.current = el.scrollLeft; // post-write DOM value, not the pre-clamp target
isFollowingRef.current = true;
```
This prevents the rAF edge-riding loop from misreading the zoom-driven scroll as a manual drag and disengaging auto-follow during playback.

**Known issue — oscillation/bounce near the timeline's right boundary**

*Symptom:* During a pinch gesture, zoom oscillates (rapidly zooms in and out) when the trailing edge of the last real clip sits near the viewport's right boundary. The zoom value itself bounces between the outgoing and incoming zoom levels rather than advancing smoothly.

*Confirmed NOT the cause:* Scroll clamping against `maxScroll`. Instrumentation (logging `el.scrollWidth`, `el.clientWidth`, `targetScrollLeft`, and `maxScroll` both before and after `setZoom`) showed the clamp never engages in this scenario — `newScrollLeft` equals `targetScrollLeft` throughout the affected frames, and `scrollLeft` never approaches `maxScroll`.

*Three remediation attempts, all reverted (each made behavior worse):*
1. **EMA smoothing on the accumulated delta** (`smoothedDeltaRef * 0.6 + rawAcc * 0.4`) — eliminated large spikes but introduced lag-then-overshoot on gesture reversals; the smoothed value lagged direction changes and then kept driving in the old direction after the user corrected.
2. **Hard per-tick delta clamp** (`Math.max(-150, Math.min(150, accumulated))`) — capped individual tick magnitude but traded infrequent large swings for more-frequent small ones; felt more jittery, not less, especially at the boundary.
3. **60ms update batching** (accumulate all events in a time window, apply once) — caused visible black-frame-like flashes between updates; smooth trackpad input rendered as discrete jumps at ~16fps.

*Current shipped state:* The original per-tick raw-accumulated-delta approach. The boundary oscillation is unresolved and deferred.

*Next investigation direction:* Log raw wheel event `deltaY` values individually (before accumulation) during a boundary-case pinch, not just post-accumulation totals. Also worth testing zoom with cursor-anchoring disabled (hard-code `newScrollLeft = el.scrollLeft`) to isolate whether the anchor math itself is contributing to the oscillation or whether it is entirely in the zoom factor.

### AlertDialog focus management — ✅ Built (Aug 10, 2026 audit)

Every `AlertDialog` in the app that performs a destructive or confirmable action follows this pattern:

**`onOpenAutoFocus`** — Radix's default `focusFirst` behavior focuses the first element in DOM order, which is always `AlertDialogCancel` given how these dialogs are structured. Without an override, pressing Enter immediately on open silently cancels instead of confirming. Every dialog with more than a pure informational message sets:
```tsx
onOpenAutoFocus={(e) => {
  e.preventDefault();
  actionButtonRef.current?.focus();
}}
```
For dialogs with two non-equal action buttons (e.g. Clear Timeline's "Leave Final Clips" vs. "Clear All"), focus defaults to the **non-destructive** option. The more destructive action always requires an explicit click — never bind it as the Enter-key default.

**`trapDialogTab`** (in `utils.ts`) — `@radix-ui/react-focus-scope@1.1.7`'s `loop: true` Tab-wrap has a bug (reasoned from source, not an upstream-confirmed issue): when focus starts on the *last* tabbable element (which `onOpenAutoFocus` above deliberately does), pressing Tab moves focus to the dialog's own container `div[tabindex="-1"]` instead of wrapping to the first button. This never surfaces with Radix's own default (focus starts on Cancel, the *first* element), which is why it went unnoticed until dialogs started intentionally focusing the action button. Fix: `trapDialogTab` is applied via `onKeyDown` on every `AlertDialogContent` that also sets `onOpenAutoFocus` — it runs before `FocusScope`'s own handler (via `Slot`'s `mergeProps` ordering) and moves focus correctly, so `FocusScope` has nothing left to act on.

**Any new AlertDialog with more than one action button must include both `onOpenAutoFocus` (targeting the safe/expected action) and `onKeyDown={trapDialogTab}`.** Omitting either reintroduces one of the two bugs above.

**Known gap:** the focus-visible ring (`ring-2 ring-offset-2`) that should visually indicate the currently-focused button is invisible in Safari specifically — a WebKit bug in the interaction between CSS Nesting and `@property(inherits:false)` custom properties (Tailwind v4 generates `focus-visible:` variants via CSS nesting; WebKit incorrectly falls back to the registered property's transparent initial-value instead of the value set in the same nested block). This affects every `ring-2` component app-wide (Button, TabsTrigger, Switch, Input, Select, Checkbox), not just dialogs. Purely cosmetic — Tab still moves focus correctly — and deliberately deprioritized. If ever revisited, non-nested ring rules (e.g. the existing `.ring-ring` class) already render correctly in Safari, so the fix is restructuring the ring utility's CSS generation, not a full pattern change.

**Resolved:** ProductionTracker's Add Instrument/Section chooser modal previously appeared to have broken Tab-focus (Section card seemingly un-leavable). Investigation found this was not a focus-trap bug — these two option cards are plain `<button>` elements that never had `focus-visible` ring styling applied (unlike the shared `Button` component), and were missing `ring-offset-background`, which meant the ring rendered with a stark white offset instead of blending into the dark UI. Once ring classes were added, Tab was confirmed to move focus correctly between the two cards in Chrome (the earlier "stuck" report was compounded by the Safari ring-invisibility bug documented above, which made real focus movement invisible during that test).

### Sticky Panel & Scroll Guards — load-bearing

The Timeline has a sticky, always-visible 256px track panel (`TRACK_PANEL_WIDTH = 256`) that occludes the left edge of the scrollable content area regardless of `scrollLeft`. Any code that checks "is this content position currently visible" or computes a scroll target **must** account for this — the actual unoccluded viewport starts at `scrollLeft + TRACK_PANEL_WIDTH`, not `scrollLeft` alone.

**The bug a naive check produces:** `newPos < sl || newPos > sl + cw` incorrectly treats content in the range `[scrollLeft, scrollLeft + TRACK_PANEL_WIDTH)` as "already visible" when it is actually hidden behind the panel. The symptom looks intermittent: state updates correctly (playhead jumps, selection moves), but the view doesn't scroll to expose it. On repeated presses each target inches closer to clearing the dead zone, so it can take 2–3 presses before a scroll finally fires — which makes it easy to misattribute to a race condition or page-load timing issue rather than a permanently wrong constant.

**This bug was independently found and fixed in three separate call sites in this file:**
1. `scrollClipIntoView` — arrow-key clip navigation (fixed earlier)
2. The Return handler — seek-to-zero scroll correction (fixed this session)
3. `handleSkipToClip` — skip-back / skip-next (fixed this session; both directions share one handler so one fix covered both)

**The corrected guard formula used at all three sites:**
```ts
if (newPos < sl + TRACK_PANEL_WIDTH || newPos > sl + cw) { ... }
```

**Reference implementation:** `scrollClipIntoView` is the canonical version — it has the visibility check, a direction-aware scroll target (left/right/vertical cases), and overscroll handling all in one place. Any future scroll-into-view or scroll-target code added to `Timeline.tsx` must use the `TRACK_PANEL_WIDTH`-aware formula from the start. This is the second and third time this exact bug has been independently rediscovered in this file; it should not need a fourth.

**`lastAutoScrollRef` / `isFollowingRef` contract (applies to all three sites):**
After writing `el.scrollLeft`, always:
1. Read `lastAutoScrollRef.current = el.scrollLeft` — the **post-write DOM value**, not the pre-clamp computed value. The browser clamps silently; the ref must reflect what actually landed.
2. Set `isFollowingRef.current = true` — marks this write as programmatic so the rAF edge-riding loop's manual-scroll detector doesn't misread it as a user drag and disengage auto-follow on the next frame.

---

## Timeline playhead & occlusion — hard-won rules (do not relearn these)

- Playhead line lives INSIDE the scroller content at left = playheadPositionState (content
  coordinates). Never position it with scrollLeft math or toggle it from scroll events: Safari
  throttles scroll events during momentum/rubber-band (sparse deltas, negative scrollLeft) while
  the compositor moves content every frame — JS cannot keep up, by construction.
- The draggable flag is a separate element inside the sticky flag band (band z-35 so the flag,
  which overflows the 6px band, paints over the z-30 ruler). Line and flag both read
  playheadPositionState.
- WEBKIT LAW: position:sticky creates a stacking context even at z-index auto. Occluders must BE
  the sticky element (z on the leaf, plain non-sticky/z-auto/transform-free ancestors up to the
  scroll content root) — never a child of a sticky band root. Band spacers are content-root
  siblings overlaying their bands via negative margins.
- Z-map (leaves only; all containers z-auto): panel spacers/cells 50 > playhead line 40 >
  flag band 35 > ruler & section bands 30 (fully opaque) > resize strip 25.
- The top-edge pane-resize strip must stay BELOW the flag band and the flag opts into pointer
  events (band is pointer-events-none, flag pointer-events-auto) — the strip intercepted all
  scrub input for multiple debugging rounds before DevTools inspection caught it.
- Debugging discipline proven repeatedly: if a fix produces IDENTICAL symptoms, the causal model
  is wrong — stop patching; instrument (console logs) or inspect the live DOM (DevTools element
  picker). Source-reading cannot see browser-specific behavior or hit-testing.

## Production Tracker scroll container architecture — hard-won rules (do not relearn these)

**The card div is the single scroll owner for both axes** — `overflow-x-auto overflow-y-auto max-h-full`, with `ref={cardRef}`. This is the only element that should ever own scroll here. Two failure modes were hit and ruled out:

1. **Wrapper as scroll owner breaks all sticky elements.** If the outer wrapper (`p-6` padding div) gets `overflow-auto` instead of the card, every `position: sticky` element in the grid anchors to the wrapper's padded edges — sticky elements pin 24px inward from the card's visual border/background, appearing visually disconnected. `position: sticky` anchors to the nearest overflow ancestor; that ancestor must BE the card.

2. **Fixed `min-w-[...]` floor on the card breaks at browser zoom.** A fixed pixel floor (e.g. `min-w-[1100px]`) only forces overflow once the viewport shrinks below that threshold. At higher browser zoom levels, the effective CSS pixel viewport shrinks non-linearly and the grid's `1fr` columns can still exactly fill the card with zero true overflow (`scrollWidth === clientWidth`), so the scrollbar never appears and content is clipped. **Fix: the grid itself gets `minWidth: 220 + bucket.length * 200px`**, scaling with instrument count — this guarantees overflow proportional to content at every zoom level. Never revert to a static pixel floor on the card; the grid's own `minWidth` is the correct place for this.

**Sticky header + first column stacking rules:**
- **Header row cells:** `sticky top-0 z-10` with opaque background (`bg-[#0c0c0e]`)
- **First column (section labels):** `sticky left-0 z-10`
- **Corner cell (intersection):** `sticky top-0 left-0 z-20` — must be one z-level above either individually or it gets painted over during diagonal scroll

All three depend on the card (not the wrapper) being their nearest overflow ancestor.

**Custom scrollbar must be JS-driven, not CSS-only.** `.scrollbar-gold` (`::-webkit-scrollbar` + Firefox `scrollbar-color` fallback) was tried first but is unreliable: macOS suppresses hover-triggered custom scrollbar styling at the OS level in both Chrome and Safari (system "overlay scrollbar" behavior, tied to trackpad scrolling settings) — the custom color applies but only renders during active scroll, never on hover, making it undiscoverable for mouse-only interaction. **Fix:** native scrollbar is hidden (`scrollbar-hide`), replaced by a JS-driven thumb (`position: sticky` within the card, driven by `scrollLeft/scrollWidth/clientWidth`, updated via scroll listener + `ResizeObserver`, throttled with `requestAnimationFrame`) with drag-to-scroll support. This is universal — no Safari-specific code path exists or should be reintroduced.

**Thumb color must be solid `rgba`, not `opacity`.** Using CSS `opacity` on the thumb blends it visually with whatever row color is underneath (gray TO-DO rows vs. colored in-progress/final rows), producing an inconsistent-looking thumb. Fix: thumb `backgroundColor` is a fixed `rgba(gold, alpha)` with `opacity: 1` on the element — only the alpha channel varies between rest/hover/drag states.

**Scrollbar visibility is intentionally always-on at low opacity**, not hover/scroll-triggered. The thumb renders at low opacity whenever horizontal overflow exists, brightening on hover/drag. This was a side effect of the JS-scrollbar fix above (no reliable "hover reveals it" behavior available on macOS overlay-scrollbar mode), but is kept deliberately — a scrollbar invisible until actively scrolled makes the scroll affordance undiscoverable for mouse-only users on a daily-use tool. Any future custom scrollbar elsewhere in the app should follow this same always-visible-low-opacity pattern.

**Scrollbar hover/visibility timing (if building similar fade logic elsewhere):** check hover state at fire-time, not schedule-time. An early version scheduled a flat 600ms hide-timer on every scroll event regardless of current hover state, causing a flash-then-fade bug when hovering right as a scroll ended. Correct pattern: `show()` clears any pending hide timer without scheduling a new one; `scheduleHide()` queues a 600ms timeout whose callback checks current `isHovering`/`isDragging` refs before hiding (no-ops if either is still true); `mouseenter`/`mouseleave` toggle the hover ref directly and call `show()`/`scheduleHide()` respectively.

**Vertical scroll indicator is intentionally simpler than horizontal.** Vertical uses a native, lightly CSS-styled scrollbar (`::-webkit-scrollbar:vertical`, thin + gold, reusing the same `rgba` values as the horizontal JS thumb) rather than a custom JS-driven thumb. The `.scrollbar-hide-x` utility class hides only the native horizontal bar (`::-webkit-scrollbar:horizontal { display: none }`) while leaving the vertical bar visible and styled. This asymmetry — native/reveal-on-scroll/Safari-gray vs. horizontal's always-visible/JS-driven/gold-in-both-browsers — is a deliberate cost/effort trade-off, not a bug. Vertical scroll is a well-understood gesture that didn't need the same discoverability treatment as horizontal. Full parity, if ever wanted, would mean generalizing the horizontal JS thumb to handle both axes.

### Production Tracker — Add/Remove Section & Instrument

Restored in commit `9ed4001` (regression introduced in `2924252` during the mock-data → real-API rewrite).

**Entry point — corner cell:** A single always-visible `+ Add` button in the sticky corner cell opens a "Create New…"-style chooser modal (two cards: Section · Instrument). Selecting a card closes the chooser and opens the existing `AddSectionModal` or `AddInstrumentModal` — no new mutation logic, only new trigger UI. Corner cell: outer sticky div keeps `bg-[#0c0c0e]` (opaque, prevents scroll-content bleed through the semi-transparent inner pill); inner pill carries `bg-primary/10 + border-primary/35 + rounded-md`, stepping up on hover. Full cell is the click target; no `transform`/`filter` on the sticky element so Safari stacking-context rules remain intact.

**Add Section** — `useAddSection(songId, bucket)` → `POST /api/songs/:songId/sections`, a single atomic server-side call that creates one idea row per active track in a transaction. Server computes `sortOrder` once, shared across all tracks (not per-track). Section names must be unique per song, active or hidden, no exceptions — enforced by a `UNIQUE(track_id, section_name)` index on `ideas` (schema.ts) plus a server-side pre-check. Duplicate attempts return 409, distinguishing an active conflict ("already exists") from a hidden conflict ("exists but hidden — restore it"), mirroring the instrument-duplicate pattern. Restore goes through the song-wide `POST /api/songs/:songId/sections/restore` endpoint on both MediaBucket and Production Tracker.

**Add Instrument** — `useAddInstrument(songId)` → `POST /api/songs/:songId/tracks`. Duplicate-name guard + hidden-track restore dropdown. Already invalidates `['production-tasks', songId]` (this invalidation was added to the hook in an earlier session).

**Remove Section (right-click row label)** — hides the section **song-wide across ALL instrument tracks** via `Promise.all PATCH /api/ideas/:ideaId` for every track's matching idea. **This is intentionally different from MediaBucket's per-instrument hide** (right-clicking a section there hides it for one instrument only). Restore available via Add Section → restore dropdown.

**Remove Instrument (right-click column header)** — `AlertDialog` confirmation, then `useDeleteTrack(songId)` → `DELETE /api/tracks/:trackId`. Mirrors Timeline's existing Remove Instrument right-click pattern. Restore available via Add Instrument → restore dropdown.

## Clip trim visual redesign (Clip.tsx)
- Trim handles are no longer rendered as visible elements. Trim is triggered by cursor proximity: `onPointerDown` within 8px of a clip's left or right edge (checked via `getBoundingClientRect()` at press time) starts the existing `handleLeftTrimDrag`/`handleRightTrimDrag` flow unchanged; `onMouseMove` sets `trimEdge` state (`'left' | 'right' | null`) which drives `cursor: ew-resize` via `positionStyle` inline style (overrides Tailwind `cursor-grab`).
- Hover shows a gold glow via a separate `pointer-events-none absolute inset-0 z-20` child div rendered after the fill and waveform canvas — `boxShadow: 'inset 0 0 0 2px rgba(212,175,55,0.9), inset 0 0 14px rgba(212,175,55,0.35)'`. Never a `boxShadow` on the container itself (the `absolute inset-0 opacity-80` fill div paints on top of the container's own style and buries it). Absent on DragOverlay ghost (`isOverlay` condition).
- **Gotcha:** dnd-kit's `listeners.onPointerDown` must be extracted into a variable (`dndOnPointerDown`) and called explicitly in the non-trim branch — placing a custom `onPointerDown` after `{...listeners}` in JSX silently overrides dnd-kit's handler and breaks drag. `restListeners` (listeners minus `onPointerDown`) is spread instead.

## Free-position (manualOffset) feature — attempted and reverted
- A Shift+drag free-positioning feature was built and fully reverted via `git reset` (never committed; no trace in codebase or schema).
- **Key architectural conflict:** `recalcAllStarts` recomputes every un-offset clip's `start` from scratch on every call. Trimming a clip triggers a recalc that immediately re-closes any gap the trim created — there is never a moment where trimmed space persists long enough to drag another clip into it. Any future free-position attempt must resolve this first: decide whether trim should stop triggering a section-wide recalc (leaving sibling `start` values untouched).
- **Clamping gap:** the first wall-clamp implementation only checked section outer edges, not actual sibling clip positions, allowing real clip-to-clip overlap. Clamping must bound against per-drag sibling positions looked up from current track state.
- **Investigation discipline:** this session required multiple compactions during a single "read and understand" prompt. Split future attempts into: (1) a no-changes trace prompt to confirm recalc behavior at specific file/line granularity, (2) a scoped implementation prompt referencing those findings. Avoid broad "read and understand the whole system" asks in one shot.

---

