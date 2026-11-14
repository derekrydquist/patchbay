# PatchBay — daw component internals

Loaded automatically when working with files in this directory (Timeline.tsx, Track.tsx,
Clip.tsx, MediaBucket.tsx, Transport.tsx, ProductionTracker.tsx, ExportDialog.tsx, and their
modals). The project root `CLAUDE.md` has universal context (what PatchBay is, tech stack,
navigation, database schema, auth, and the safety-critical "What To Avoid" rules) — read that
first if you haven't already; it isn't repeated here.

## Timeline Behavior

### Design principles — do not revert without discussion

These are intentional product decisions, not implementation details:

- **Clips never overlap; gaps are fine** — within a track's section a clip sits wherever it was placed. Nothing re-packs a section (see "Timeline layout and arrangement order" and "Timeline placement rules" in root `CLAUDE.md`)
- **Section-locking is enforced** — a clip belongs to its home section (`sectionName`); a drag never changes its section or its track. A pickup still belongs to its section while it hangs before the downbeat
- **Position is always derived from the layout** — a clip's start is its section's start + `sectionOffset` (+ a pickup's head cut), from the shared `layoutTimeline`; never set from a cursor pixel offset, and the stored `start` is never read for a sectioned clip
- **The timeline is plug-and-play by design** — complexity that belongs in a freeform DAW does not belong in PatchBay
- **Mute, solo, zoom, scroll, snap and selection are client-only, per-browser** — they are never sent to the server. Volume and pan are the only per-track mix values that are shared (`instrument_tracks`). The client-only values follow the same localStorage pattern as MediaBucket (one-shot restore on mount guarded by a `uiRestored` ref, keys scoped `patchbay-*-${songId}`; snap is one global `patchbay-snap` key). Do not add mute/solo/zoom/scroll/snap to the DB schema — band members intentionally have independent views of the same arrangement.

### Mental model

The timeline is a **grid**: rows are instrument tracks, columns are song sections (Intro, Verse 1, Chorus 1, …). A clip belongs to exactly one section and is placed by its offset from that section's start. Clips are drawn at the track-row level (`TimelineTrack`), not inside section cells, so a pickup can hang into the previous section and a section's last clip can stick out until the section grows on save. Legacy full takes sit on the same row at their stored start. `TimelineTrack`, its `TrackHeader` and `TimelineClip` are memoized: Timeline keeps every prop stable unless what it describes changed (shared `displaySectionLayout`, `trimLimitsByTrack` objects kept while their values are equal, `useCallback` handlers), so a drag preview change re-renders only the rows it moves.

### Section columns

- **Which sections show** — only sections with at least one non-full-take clip get a column; the column disappears with its last clip. Rules (lengths in beats, base length, orphans, pickups, full takes): see "Timeline layout and arrangement order" in root `CLAUDE.md`.
- **Order** — `song_sections.sort_order` via the `['song-sections', songId]` query (`sections` in `Timeline`), never clip data or `ideas.sortOrder`. There is no `sectionOrder` state or ref.
- **Geometry** — `deriveLayout(trackState, sections, bpm, timeSignature)` (a thin wrapper over `layoutTimeline`) is memoized as `layout`. `tracks` = `trackState` with every clip's in-memory `start` and `headCut` taken from the layout (`positionTracks`), so playback, keyboard nav, skip and `Track.tsx` read layout positions; in-points and lengths come from `playedSpan` (`client/src/lib/clip-span.ts`). `sectionLayout` = `layout.sections` as `{ name, start, duration }[]` (the shape `Track.tsx` takes); `endOfTimeline` = `layout.timelineEnd`.
- **During a drag** — `displayLayout` / `displayTracks` / `displaySectionLayout` come from the drag preview's layout (`clipDragLayout`) when there is one, else the stored layout. `contentEnd` (scroll width, ruler, edge-scroll cap) never shrinks during a drag (`clipDragMaxEndRef`).
- **`SectionCell`** is only a section's background and divider on a row (width + inset-shadow divider); it holds no clips and no drag state.

### Drop targets and collisions

- **Track rows** — one `useDroppable` per row (bare track id), the lane div in `TimelineTrack`. Only a legacy full-take version from the Media Bucket drops on a row (freeform start at the pointer, `insertFreeformClip`); for that drag the row gets `isInvalidDrop` (wrong track: disabled + dark veil `rgba(0,0,0,0.5)` at z 20) or a valid-track gold border. `isDragging` is `activeDragData !== null && type !== 'clip' && !fileDrop`, so timeline clip, version and loose-file drags never show these.
- **Pointer drops** — timeline clip, version and loose-file drags are decided in `handleDragEnd` from the pointer (`computeClipDragPlacement`, `computeVersionDrop`, `computeFileDragPlacement` / `looseNewSectionAt`), never from dnd-kit's `over`, so the drop always matches the preview. There are no gap zones, no `insertionPoint`, no `handleDragMove` and no track-row reorder.
- **Collision detection** — `makeTrackFirstCollision(isVersionDrop)` (memoized as `trackFirstCollision`). While the pointer is inside `[data-media-bucket]`, only Media Bucket targets can match (`matchOrganizeDropTarget`). For file drags (`fileDropRef` set), only bucket targets ever match, and only inside the bucket — a bucket row scrolled out of its column still has a rect that can sit under the timeline. Otherwise bucket targets first (precise X+Y), then track rows by vertical band only.
- **Section column reordering** is a **separate inner `DndContext`** around the section header row (`autoScroll={false}`), independent of the clip drag. `handleSectionDragStart` starts the drag pointer source and a `createEdgeScroller`; the target is `headerDropTarget(…)` (`client/src/lib/section-drag.ts`: the pointer against the midpoints of the other sections on the timeline; null over the section's own spot), held in `headerDrop` state / `headerDropRef`; `handleSectionDragEnd` sends it as `PUT /api/songs/:songId/sections/order` only when non-null; `handleSectionDragCancel` (Esc) sends nothing. `sectionOrderMutation` applies the move to the `['song-sections']` cache at once (`applySectionMove`, the server's own rule) and rolls back on failure; the section poll pauses while it's in flight (`sectionOrderSaving`). There is no header `DragOverlay` — the preview is `SectionDragTag` (a gold name tag in the ruler strip) plus a see-through ghost of the section's clips in the track rows (pickups at their stored offset), positioned imperatively through refs; the dragged section stays in place under a dark veil.

### Section-end handle

- **`SectionEndHandles`** — its own layer (z-20) over the section header row, a sibling of the headers, never inside one; under the z-50 section-band spacer over the track panel. One handle per section on the timeline with a `song_sections` row (no orphans, no full takes), an ~8 px hit area (`SECTION_END_HIT_PX`, fixed at every zoom) centred on the boundary, with a 2px gold bar and grip, shown for the whole drag. A faint gold mark only where the base length adds empty space (`addsVisibleSpace`). No handles while another drag (header, clip, file, loose-file confirm) or a trim (`trimsBusy`, including its save) is running; the faint marks stay. Each handle carries `data-section-end` for scripted checks.
- **Hover** — at most one handle shows at a time, from one source of truth (`hoveredHeader`, set by `handleHeaderRowPointerMove`; no separate CSS hover): the pointer on a handle's ~8 px hit area (found by `closest('[data-section-end]')` on the event target) shows only that handle, even where the hit area overlaps the next section's header; otherwise the hovered header's own end handle shows (the pointer's x against the drawn sections). On very narrow sections the topmost hit area wins. Pointer moves over an open section menu (portalled, so they bubble here through React but aren't inside the row) clear the hover, so no handle is left showing when the menu closes.
- **Pointer handling** — `startSectionEndDrag` / `updateSectionEndDrag` / `finishSectionEndDrag`, on window pointer events (the shared drag pointer source plus `pointerup` / `pointercancel`), no dnd-kit. `onPointerDown` calls `stopPropagation()` and `nativeEvent.stopImmediatePropagation()`, so the header's dnd-kit never sees the press. Nothing moves until the pointer has moved 3 px (`SECTION_END_DRAG_THRESHOLD_PX`); the grab offset from the boundary is kept, so the first move never jumps a stop. A page-wide `* { cursor: col-resize !important }` style during the drag (a body cursor loses to the headers' grab cursor). Esc (capture-phase keydown), window blur and `pointercancel` cancel; Shift is read from every pointer and key event (Shift key events stop in the capture phase).
- **Preview** — `clipDragLayout`'s handle-drag branch overrides that section's `baseLength` (null at the minimum) and feeds `displayLayout` / `displayTracks` / `displaySectionLayout`, so later sections slide with their clips on every track and cut pickups update live. `sectionEndDrag` state changes only when the picked stop changes. `contentEnd` never shrinks during the drag; `recomputeDragIndicatorsRef` re-runs the stop on every pointer move and timeline scroll; edge scroll is `createEdgeScroller` with `startDragPointer` / `stopDragPointer`, as the header drag does it (the cap reads `contentEndRef`, which the 4096-beat maximum bounds). No focus veil. Playback keeps the stored layout. Readout: `SectionDragTag` placed by `positionSectionEndTag` (ruler strip, centred on the handle, clamped to the visible track area), text from `sectionEndReadout` (`"<Section> · 10 bars (+2 bars empty)"`, or `"<Section> · fit"`).
- **Shared logic** — `shared/sectionBaseLength.ts`: `sectionEndRange`, `nearestSectionEndStop` (ties go to the later stop), `baseLengthForEnd`, `formatBarsAndBeats`, `sectionEndReadout`, `sectionEndRelease` (what a release sends: the new base length when the end changed; null at fit whenever a base length is stored, even with no drawn change; otherwise nothing), `addsVisibleSpace(lengthBeats, needBeats)` (decides both the faint gold mark and whether Fit is clickable, so they can't disagree), `canFitToContent` and `shouldSendBaseLength`. Tests in `shared/sectionBaseLength.test.ts`.
- **Saving** — handle release and the menu's Fit to Content share `saveSectionBaseLength`: an instant cache write to `['song-sections', songId]` (`setSectionRowsCache`, synchronous — `onMutate` runs a tick later and can flash the old length), then `sectionBaseLengthMutation` (`mutationKey ['song-sections-base-length', songId]`, `PUT /api/songs/:songId/sections/base-length`). It sends nothing when the stored base length is already null and null is being sent (`shouldSendBaseLength`). `sectionBaseLengthSaving` (`useIsMutating` on that key) pauses the section poll while pending. On error the previous rows come back with a destructive toast carrying the server's message; on success `['songs']` and `['activity']` are invalidated; on settled `['song-sections', songId]`. Only the handle drag takes the clip-drag poll hold (`holdPollsForClipDrag` at pointerdown); it is released when `saveSectionBaseLength`'s promise settles (built on `mutateAsync` — `mutate`'s own callbacks only fire for the latest call, so a quick second drag could leave the polls held), or at once when nothing is sent.
- **First clip** — `firstClipSectionRows` sets `baseLength: null` for a returning section, matching the server reset.

### Section menu (header right-click)

- **Opening** — right-clicking a section header, or its section-end handle, opens a Radix `ContextMenu` (`modal={false}` + `useReopenableContextMenu`, items styled like the clip menu in `Clip.tsx`), never the browser's menu. One content component, `SectionMenuContent`, serves both (via the `SectionMenu` wrapper); the handle opens the menu of the section to its LEFT (the section whose end it is). dnd-kit's sensors ignore non-left buttons, so a right-click never starts a header drag; it fires no click, so nothing is selected or seeked.
- **Items** — "Fit to Content", enabled by `canFitToContent` (stored base length + visible added space + `sectionMenuInteractive`, which is `sectionEndInteractive` with no section-end handle drag running), greyed out (not hidden) otherwise; orphan sections (clips but no `song_sections` row) always greyed. Clicking it calls `saveSectionBaseLength(name, null)` (see "Saving" above). Step 6 adds "Copy section to ▸" below Fit.
- **Focus** — `onCloseAutoFocus` is prevented, so focus never returns to the header: headers are focusable (dnd-kit `tabIndex` / `role="button"`), the right-press focuses them, and after Esc the browser would draw its blue focus outline.
- **Closing on a drag or trim** — most drags close the menu through Radix's outside-press dismiss. Trims and handle drags stop their pointerdown, so Radix never sees it: if `sectionMenuInteractive` turns false while a menu is open (`sectionMenuOpenRef`), the menus remount (`sectionMenuEpoch` in the headers' and `SectionEndHandles`' keys) and it closes.

### Drag pointer source, insertion lines and edge scroll

- **Pointer source** — while a header, timeline clip or file drag runs, the pointer comes from a window `pointermove` listener (capture phase) plus the timeline's `scroll` event (`startDragPointer` / `stopDragPointer`, `dragClientXRef` / `dragClientYRef`), never from dnd-kit's `activatorEvent.clientX + delta.x`. Song time under the pointer = `dragPointerTime(clientX)` = (clientX − timeline left + scrollLeft − 256) ÷ zoom. Every move and every timeline scroll runs `recomputeDragIndicatorsRef` (header target, new-section line, drag preview, tag and ghost positions).
- **`nudgeDndCollision`** — during a file drag, each timeline scroll dispatches a synthetic `pointermove` at the last pointer position (carrying the live Shift/Option state), so dnd-kit re-runs collisions against re-measured rects and modifier tracking never sees a release.
- **`SplitInsertionLine`** — every gold insertion line (header drag, new-section line `newSectionLineX`) is drawn in two identical parts at the same content X, each portalled into its own layer: one inside the sticky header row (running 1px past it to cover its `border-b`), one over the track rows. From the top of the header row to the bottom of the tracks, never in the ruler.
- **Edge scroll** — `createEdgeScroller` (`client/src/lib/edge-scroller.ts`; options `getEl`, `axis`, `startInset`, `endScrollCap`, `onScrolled`; the playhead's constants `EDGE_ZONE_PX` 150 / `EDGE_ZONE_RELEASE_PX` 210 / `MIN_DRAG_DISTANCE_PX` 72 / `SCROLL_SPEED_PX`). Header and clip drags scroll horizontally from the track panel's edge. File drags (`startFileEdgeScroll`, `fileEdgeScrollMove`) run a horizontal scroller only while the pointer is over the track area, restarted on each entry so the 72 px gate counts from there, plus a vertical scroller (`axis: 'y'`) whose area is the whole timeline element (ruler and header included) with its zone measured from below the header. `endScrollCap` reads `contentEndRef` live, since a drag preview can grow the content. `dndAutoScroll.canScroll` keeps dnd-kit off the timeline and the bucket columns (off entirely for clip drags); the columns scroll with `useColumnEdgeScroll` (`client/src/hooks/use-column-edge-scroll.ts`).

### Snap controls

`SnapControls` (`SnapControls.tsx`) sits in the ruler spacer, the corner above the track names. `SnapSetting = { on, unit }` with units Bar / 1/4 / 1/8 / 1/16 (`SNAP_UNITS`), stored per browser under one `patchbay-snap` localStorage key (`readSnapSetting` / `writeSnapSetting`; missing or invalid → on, 1/4). The grid step is `snapGridSeconds(unit, bpm, timeSignature)`; Shift is read from each pointer and key event. Snap is used by clip and file drags, never by trims. The section-end handle follows the snap setting too: Bar = bar lines, anything else = beats, Shift = beats.

### Timeline clip drags

- **Start** (`startClipDrag`): takes the poll hold, records the grab offset (pointer song time − clip layout start), reads Shift/Option from every pointer and key event (Shift/Alt key events stop in the capture phase so arrow-key navigation never sees them), sets a page-wide grabbing cursor, and starts a rAF loop for the floating clip. Window `blur` clears the modifiers and dispatches `visibilitychange`, which makes dnd-kit's pointer sensor cancel the drag (→ `handleDragCancel`).
- **Floating clip** — `positionFloatingClip` writes `translateX` on the clip and its `data-clip-drag-lift` shadow layer every frame (never through React), so following the pointer never re-renders. `stopClipDrag` clears it in the same synchronous update as the drop's state, so the clip never flashes at its old spot.
- **Placement** — `computeClipDragPlacement`: horizontal position only, anywhere over the timeline (`isPointerOverTimeline`, not over the Media Bucket); `placeDraggedClip` with the stored clips (`storedClipsInSection`) for the gaps and the drawn spans (`drawnSpansInSection`, cut pickups at their cut start) for flush snapping; `minOffset` from `clipDragMinOffset` + `pickupLeftLimit`. The result is `clipDragPreview` state (never written into the tracks); `updateClipDragPreview` keeps the same object when nothing changed.
- **Drop** — `commitClipDragPlacement` applies the offsets at once and saves only the changed ones through `saveClipOffsets` (`PUT /api/songs/:songId/timeline-clips/offsets`); failure restores every offset and toasts. `placementChanged` false → nothing saved.
- **Focus veil** — `ClipDragFocusVeil` dims the track rows and section header row outside [home section start − one bar, home section end].

### Media Bucket file drags (versions and loose files)

- **Start** — `handleDragStart` → `startFileEdgeScroll({ vertical: true })`, `startFileDragBlurCancel`, then `startFileDropPreview` (version) or `startLooseDropPreview` (loose file); both call `beginFileDrop`, which takes the poll hold, sets the content-width floor and listens for Shift. The virtual clip (`virtualFileClip`) gets a new `nanoid()` that the drop POSTs.
- **Version** — `{ kind: 'version', trackId, sectionName, firstClip }`; placement on its own track and section by horizontal position (`computeFileDragPlacement` → shared `computeFileDropPlacement`). `firstClip` (section not on the timeline): no preview, the new-section line (`firstClipBoundaryAt` / `firstClipHintAt`); drop at offset 0 with the hint. `commitVersionDrop` shows the clip and pushes at once, POSTs with `pushed` (and `placement` for a first clip), glows on success, rolls back (clip, pushes, section order) with a destructive toast on failure.
- **Loose file** — `{ kind: 'loose', looseFileId, originTrackId }`; destination from `looseDropDestination` (track row by Y via `trackRowAt`, section via `sectionAt` on the stored layout, and the track must have that section folder: `trackHasSection`). Release with a placement → `freezeLoosePlacement` (reports `'deferred'` to the organize hook; the frozen preview is `looseConfirm.placement`) → confirm dialog (the standard `Dialog` with `data-light-backdrop` — a 25% backdrop from `index.css` so the frozen outline and pushed clips stay visible; positioned by `confirmDialogTop` in `client/src/lib/confirm-dialog-position.ts`: centred over the Media Bucket between the app header and the timeline, never over the outline; focus starts on Place, so Enter places; Esc / Cancel / X / outside click cancel) → `commitLoosePlacement` → `commitLooseLanding` (moves the file into the bucket cache at once with `moveLooseFileIntoBucketCache`, then `placeLooseFileAtPositionMutation`). Past the last section with off-timeline folders (`looseNewSectionAt`, `offTimelineSectionNames`) → the new-section dialog → `commitLooseLanding` with no position (append, new section at the end). Nothing else → nothing happens. Cancel resolves the deferred drop as not moved, so a spring-opened selection is restored.
- **Media Bucket element** — frozen for the drag (`mediaBucketElementRef`, `bucketFrozen`): React skips the subtree, while its own state, queries and dnd-kit hooks still update it.

### Positions — offsets, no packing

- **Nothing packs.** `packSectionOffsets`, `patchChangedOffsets`, `recalcAllStarts`, `computeSectionLayout`, `getActiveSections`, `MIN_SECTION_WIDTH` and the `sectionOrder` state are all gone. A clip's offset changes only when it is dragged, pushed later by a placement, or its own left edge is trimmed.
- **Effective duration** — layout and placement use the trimmed length, `(trimEnd ?? duration) - (trimStart ?? 0)` (`effectiveLength`, `clipLength`); drawing and playback use `playedSpan` (trimmed length − head cut). `clip.duration` is the full file length and is never modified.
- **`insertClipInSection(trackId, sectionName, clip)`** — Media Bucket menu "Add to Timeline" only: appends after the furthest clip end (`appendOffset`) on screen and POSTs with no `sectionOffset`, keeping the offset the server answers with. For a section's first clip it applies `placeFirstClipSection` to the `['song-sections']` cache (end rule) and pauses the section poll until the POST settles.
- Never derive `clip.start` from a pixel value or cursor position, and never add a layout outside `layoutTimeline`.

### Drag data — `trackId` requirements

**`BucketClip`** embeds `trackId` in its dnd-kit drag data: `{ clip, type: 'bucket-clip', trackId, ideaId, songId, isFullTake, trackName }` (`BucketClipDragData`). `clip` comes from `apiClipToClip` (`bucket-api.ts`), which carries `ideaId`; the other fields are for the bucket drop targets (see "Moving real-song versions" in root `CLAUDE.md`). The Songs quick-browser's cards use the same payload with drag id `songs-clip-{id}`. `Timeline.handleDragStart` stores it in `activeDragData` and starts the version preview from it; the full-take row validation uses the same `trackId`. The MOCK_SONG instrument-name lookup is a fallback for legacy mock clips only — real API clips always have `trackId` set.

**`TimelineClip`** embeds `trackId` in its drag data: `{ clip: {...}, type: 'clip', trackId }`; `startClipDrag` needs it. `trackId` is a prop: `Timeline` → `TimelineTrack` → `TimelineClip`.

**`onAddToTimeline` (right-click "Add to Timeline")** follows the same contract as drag-drop. `BucketClip` passes `trackId` explicitly and `clip.sectionName` is read directly on the clip object — no name-parsing or substring heuristics. `Timeline`'s handler bails with `console.warn('[AddToTimeline] missing', ...)` when either value is absent. **Known landmine:** a clip whose `section_name` is `null` in the DB (can happen with idea-sourced clips that were never associated to a section) will silently no-op — the warn fires but no placement occurs. Do not add silent fallbacks (e.g. using `tracks[0]` or deriving sectionName from the clip name string) — they silently place clips on the wrong track.

### Stale closure rule

All event handlers registered inside `useEffect(fn, [])` (e.g. `handleRemoveClip`, `handleToggleMute`, `handleTrimPreview`) must use `setTracks(prev => ...)` and read current state from `prev`, not from the `tracks` variable in the outer closure (which is permanently `[]` in those handlers). Drag code that runs from window listeners reads refs (`clipDragRef`, `fileDropRef`, `dragClientXRef`, `clipDragKeysRef`, `recomputeDragIndicatorsRef`, `positionFloatingClipRef`), refreshed every render.

### API calls after mutations

- Drag saves, version drops and loose-file drops: see "Saving" in root `CLAUDE.md`. Each holds the polls until its save and the refetch after it are done, rolls back on failure and toasts.
- Remove: `DELETE /api/timeline-clips/:id`; the clips after it keep their offsets, nothing else is sent.
- Menu Add to Timeline: `POST /api/tracks/:trackId/clips` with no `sectionOffset` (checks `res.ok`), plus `placement` for a section's first clip.
- Offsets are never sent through `start`; the server writes the `start` cache from the layout.

### Timeline polling and live track sync

The timeline `useQuery` (`/api/songs/${songId}/timeline`) and the `['song-sections', songId]` query both have `refetchInterval: 3000`, set to `false` while `timelineEditBusy` (clip/file drag holds via `clipDragsBusy`, trim drags and saves via `trimsBusy` from `trim-busy` events). The section query also pauses for this browser's own reorder (`sectionOrderSaving`), section-end handle save (`sectionBaseLengthSaving`) and first-clip POSTs (`firstClipPostsInFlight`). Taking a hold calls `dropPollsInFlight` (cancels both queries) so a response already on its way can't bring back the old state. A drag's hold is taken by `holdPollsForClipDrag` (clip drags in `startClipDrag`, file drags in `beginFileDrop`, section-end handle drags in `startSectionEndDrag`) and released exactly once through the function `takeClipDragHold` returns: at once when the drag ends with nothing to save (Esc, blur, a no-change release), otherwise after the save and the refetch after it, whether the save worked or not. A loose file's hold passes to its confirm or new-section dialog and is released on Cancel or after its save. Trims use `trim-busy` events (+1 on start, −1 when the trim's save and refetch finish).

There are two `useEffect`s that sync `apiTracks` into the local `tracks` state:

1. **Initial load** (guarded by `tracksInitialized.current`): runs once when `apiTracks`, the song's `song_sections` and the song (tempo) have all loaded, so the first paint has the right order and widths; converts and sets the full tracks array. After this, `tracksInitialized.current = true` and this branch never runs again.

2. **Live sync** (runs on every `apiTracks` poll): removes any tracks missing from `apiTracks`, syncs clips for existing tracks from the API response, and appends any new tracks. Preserves local `muted`/`solo` state. New tracks start with empty clips. Clips and `sectionOffset` are taken from the server as they are (`serverClipsToClips` orders each section by offset); it never re-packs or writes. Clip sync is needed so that when a section is hidden (which deletes its timeline clips on the server), the timeline removes those clips within 3 seconds without a manual refresh.

**Do not merge the two effects.** The initial-load guard exists to prevent the API response from clobbering clip state that the user has added to the timeline mid-session (before the refetch fires).

---

### Audio playback system — ✅ Built

Real per-clip audio playback is handled entirely in `Timeline.tsx`. `Transport.tsx` is a pure controls component — it only dispatches CustomEvents and displays state. No audio logic lives in Transport.

**Key refs in `Timeline.tsx`:**
- `customAudioRefs` — `{ [clipId: string]: HTMLAudioElement }`. One `Audio` object pre-created per clip as clips appear in `tracks`. Set `audio.preload = 'auto'` so the browser buffers ahead of play. Created in a `useEffect` on `tracks`; only adds new entries, never overwrites existing ones.
- `pendingPlayRef` — `Set<string>` of clip IDs whose `.play()` Promise is still resolving. Guards against calling `.play()` again before the previous call settles, which would throw `AbortError`.
- `audioCtxRef` — persistent `AudioContext | null`. Originally used solely to unlock Safari's audio pipeline. Since track panning it also routes clip audio for any clip that's been wired into the Web Audio graph (see **Track panning** below) — no longer "not used to route audio." Suspended, not unconditionally closed, once any clip has been routed through it — see the gotcha under Track panning.
- `masterVolumeRef` — `number`, initialized to `0.8` (matching the Transport slider's default of 80). Updated by a `useEffect` listening for `update-master-volume` events (`e.detail.volume / 100`). The listener also immediately applies the new volume to all currently-playing elements in `customAudioRefs`. The rAF loop multiplies per-track volume by this ref: `audio.volume = (track.volume / 100) * masterVolumeRef.current`.

**Playhead position model:**
`playheadTimeSecs` (state, set via `setPlayheadTime`) and `playheadRef` store the playhead in **seconds**, not pixels. The content-space pixel position is derived at render time: `playheadPx = 256 + playheadTimeSecs * zoom`. The playhead has two DOM elements, both inside the scroller content root — no scroll-offset math anywhere:

- **Line** — `position: absolute; left: playheadPx; top: 0; bottom: 0` at z-40. Scrolls natively with content; zero compositor lag.
- **Flag** (draggable handle + triangle) — `position: absolute; left: playheadPx` inside the sticky flag band (z-35). Sticks vertically with the band; `handlePlayheadPointerDown` computes `clientX - rect.left + scrollLeft` to get content coordinates on pointermove.

See **Timeline playhead & occlusion** section below for the full z-map and WebKit sticky rules.

**Animation loop:**
The `requestAnimationFrame` loop runs while `isPlaying === true`. Each frame:
1. Advances the playhead by `timeDelta` seconds (frame delta / 1000) — the playhead is time, so zoom plays no part in advancing it.
2. Uses that time directly as `playheadTime` (no pixel conversion).
3. For each clip in `tracks`: if `playheadTime ∈ [clip.start, clip.start + playedSpan(clip).length)` (`clip.start` is the layout's cut start; `playedSpan` counts trim and a pickup's head cut), calls `audio.play()` guarded by `pendingPlayRef`, and sets `volume` and `muted` every frame. `playbackRate` is never written — see "Tempo source" below. When playback starts, `audio.currentTime` is set to the played in-point (`playedSpan(clip).inPoint` + time already past the clip's start).
4. If the clip is out of range and not paused, calls `audio.pause()`.

**Safari AudioContext unlock:**
Safari requires `AudioContext.resume()` to be called synchronously within a user gesture window. The rAF loop fires asynchronously — outside that window — so raw `audio.play()` from the loop has a ~0.5s delay.

Fix: `Timeline.tsx` listens to the `toggle-play` CustomEvent synchronously. `Transport.tsx` dispatches this event synchronously from the play button click handler and the spacebar handler. When `isPlaying: true` arrives in that synchronous listener, `Timeline.tsx` immediately calls `audioCtxRef.current.resume()` — still within the gesture window. The `audio.play()` calls that happen frames later then run without delay.

When `isPlaying` becomes `false`: all audios are paused, `pendingPlayRef` is cleared, and `audioCtxRef` is either suspended or closed depending on whether any clip has been routed through the Web Audio graph — see **Track panning** below for the exact rule and why. (This branch did not exist before track panning; previously the close was unconditional.)

**Stale audio on clip replace — `clip-replaced` CustomEvent:**
When a timeline clip is replaced via `PATCH /api/timeline-clips/:id` (from the Replace submenu in `Clip.tsx`), the old `HTMLAudioElement` in `customAudioRefs` still holds the old `src` and will keep playing. Fix: `Clip.tsx` dispatches `clip-replaced` with `{ clipId }` after a successful PATCH. `Timeline.tsx` listens for this event (in a `useEffect(fn, [])`, so `customAudioRefs.current` is never stale) and pauses + removes the old element. The pre-create `useEffect` then creates a fresh `Audio` for the new `src` when `tracks` updates after the query refetch.

**Do not:**
- Move audio playback logic into `Transport.tsx` — it belongs in `Timeline.tsx` where clip positions are known.
- Call `audio.play()` outside the rAF loop without checking `pendingPlayRef` — overlapping play/pause calls throw `AbortError`.
- Create a new `AudioContext` per clip or per play call — one persistent `audioCtxRef` per play session is correct.
- Remove the `toggle-play` listener in `Timeline.tsx` that calls `audioCtxRef.current.resume()` — it is the Safari unlock and must remain synchronous with the gesture.
- Unconditionally `.close()` `audioCtxRef` on stop once any clip may have been routed through the Web Audio graph — see **Track panning** below for the suspend/close rule and why.
- Modify the pre-create `useEffect` to detect src changes via URL comparison — `audio.src` is an absolute URL while `clip.src` is a relative path; use the `clip-replaced` event instead.
- Put side effects (ref writes, scroll/DOM mutations) inside a `setPlayheadTime` state-updater function — React may invoke updaters more than once per render (StrictMode double-invocation, retried concurrent renders), causing any side effect to fire multiple times against a stale snapshot of related state. This caused an early ~2-second scroll overshoot bug during development. All auto-scroll logic lives in the rAF `animate` function body, which runs exactly once per real frame.

**Auto-stop at end of timeline:**
Each frame, `animate` reads `frameTimelineEnd` (seconds) from `endOfTimeline` (`layout.timelineEnd`). The playback effect depends on `layout` and `endOfTimeline`, so it re-runs whenever the layout changes and edits to tracks/sections mid-playback are respected.

If `playheadRef.current + timeDelta` reaches or passes `frameTimelineEnd` on a given frame (and looping is off): the playhead is clamped to exactly `frameTimelineEnd` (frames advance in discrete jumps, so the raw computed position will usually overshoot slightly before the check catches it), the existing manual stop sequence is invoked (pause all audios, clear `pendingPlayRef`, close + null `audioCtxRef`, `isPlaying` → `false`), and the rest of that frame's per-clip play/pause logic is skipped.

**Do not:** cache `frameTimelineEnd` at play-start outside that effect — it must follow the current layout. Do not write a second/parallel stop implementation — this must call into the same stop path manual pause uses.

**Transport button sync (`playback-ended` event):** Transport.tsx and Timeline.tsx hold independent `isPlaying` state with no shared props or context. Transport dispatches `toggle-play` on button/spacebar (one-way, Transport → Timeline). Because auto-stop originates in Timeline.tsx (not via a `toggle-play` dispatch), a second one-way event was added: Timeline's auto-stop block dispatches `playback-ended` immediately after its own `setIsPlaying(false)`; Transport listens for it and calls its own local `setIsPlaying(false)` to un-stick the button.

**Do not:** have Transport dispatch `playback-ended`, or have Timeline listen for it — this must stay strictly one-way (Timeline → Transport) to avoid a dispatch loop. The manual pause/stop path (originating from Transport's own `toggle-play`) does not dispatch `playback-ended` — only the auto-stop block does, since Transport already knows its own state in the manual case.

**Tempo source:**
- Timeline seeds `bpm` / `bpmRef` and the time signature from the `['song', songId]` query, once per song (`songTempoSeededForRef`) — not from `MOCK_SONG`, and not from an event Transport sends on mount. In-session edits still arrive via the `update-bpm` / `update-time-signature` events. Transport's own song-data seed guard (`songDataInitialized`) is also per song.
- Null `bpm` → 120 (`DEFAULT_BPM` from `client/src/lib/musical-time.ts`) in both Timeline and Transport — display only, never written to the DB. Missing/empty time signature → `'4/4'` in both.
- **Clip audio always plays at its recorded speed.** The old per-frame `playbackRate = bpm / 120` write was removed: tempo describes the grid and metronome and must never time-stretch recordings. (A future personal "practice speed" control would be a separate, client-only feature.)
- After a reload the Transport shows the restored playhead: Timeline dispatches `time-update` right after the playhead restore, and Transport sends `request-time-update` on mount, answered with `playheadRef.current`.

### Musical grid — ✅ Built

- **Helper** — `client/src/lib/musical-time.ts`, pure functions, no React: `DEFAULT_BPM` (120), `parseTimeSignature` (numerator with `|| 4`; denominator returned but unused), `secondsPerBeat` (falls back to 120 for null/zero/non-numeric bpm), `secondsToBarsBeats`, `formatBarsBeats` (`"bar.beat.sixteenth"`, 1-based), `barStartSeconds`, `gridDensity`, `gridTile`.
- **Same math as the metronome** — beats are counted from song time 0. Beat and sixteenth indexes use the metronome's form, `Math.floor(t / secondsPerBeat)` (sixteenths: `/ (secondsPerBeat / 4)`), never `t * bpm / 60` — the two round differently at boundaries, and the readout would change a frame away from the click.
- **6/8** is six quarter-note beats per bar, matching the metronome. Handling the denominator is an open decision; change grid and metronome together or not at all.
- **`gridDensity`** thresholds are named constants: bar lines thin to every 2/4/8… bars below 24px per bar; beat lines from 8px per beat and only when every bar line is drawn; 1/8 lines from 48px per beat; 1/16 from 96px per beat; bar-number labels at least 48px apart.
- **`BeatGrid`** (`BeatGrid.tsx`) — an SVG with a `<pattern patternUnits="userSpaceOnUse">`, one tile per bar (or per N bars when thinned), starting at x = 0 = song time 0, rendered as the first child of each track lane's droppable div in `Track.tsx`: `pointer-events-none`, `absolute inset-0`, no z-index, so SectionCells and clips paint above it and dnd-kit measuring is unaffected. Pattern ids come from `useId`. Line colors are constants (bar 0.10, beat 0.045, subdivision 0.04 white alpha). It replaced the old quarter-second `linear-gradient` lane background. `React.memo` on primitive props so it doesn't redraw every playback frame.
- **Ruler** (`Ruler.tsx`) — the outer shell is unchanged (`h-8`, sticky, z-30, opaque `bg-card`, `w-64` placeholder, `onSeek` contract); only its marks changed. 1-based bar numbers thinned by `gridDensity`; bar/beat/subdivision ticks as an SVG pattern in a 16px bottom band (bar 12px, beat 7px, subdivision 4px; tick opacities 0.5 / 0.35 / 0.32 of `text-muted-foreground`). It draws across `contentSeconds = max(endOfTimeline + 15, 100)` — the full content width; the old 100-label cap is gone. Positions are `t * zoom` with no +256 offset (the ruler's inner div already starts past the panel). Marks live in a memoized `RulerMarks` (Timeline re-renders every frame during playback).
- **Transport** shows a BAR readout (`formatBarsBeats`) next to the timecode, fed by the same `time-update` events.
- **Sections vs bars** — every section starts on a beat, but not necessarily on a bar: section lengths are whole beats (content rounded up, or `base_length`).

### Transport row layout

- The row is `grid grid-cols-[1fr_auto_1fr]`; the three groups (time readouts / transport controls / volume + Export) no longer use `w-1/3`. A `1fr` column never shrinks below its content, so the left group can't spill under the center group; the controls stay centered whenever both side columns fit at equal width.
- Master volume wrapper is `hidden lg:flex flex-1 min-w-24 max-w-48`: full size (192px) until space runs out, shrinks toward 96px, hidden below `lg`. Export is `flex-none` and always shown.
- Why: on fixed thirds, the BAR readout made the left group's content wider than its third; the overflow sat under the center group's transparent box (a later flex item paints and hit-tests on top), and the time signature Select stopped receiving clicks.

### Track panning — ✅ Built

`instrument_tracks.pan` (see Database > Tables in root `CLAUDE.md`) drives per-track stereo pan. This is the first feature to route clip audio through the Web Audio API — previously all clip playback was plain `<audio>` elements with `audio.volume` set directly, no Web Audio graph involved at all.

**Web Audio graph (`Timeline.tsx`):**
- `panNodesRef` — `{ [clipId: string]: StereoPannerNode }`. One node per clip, created lazily.
- `ensurePanNode(clipId, audio)` — called every frame a clip is in-range and playing, in the rAF `animate` loop, the same place `audio.volume`/`muted` are updated. Guarded by `panNodesRef.current[clipId]` — a `<audio>` element can only ever be passed to `createMediaElementSource` once; a second call throws. Wires `audio → createMediaElementSource → StereoPannerNode → audioCtxRef.current.destination`.
- `panner.pan.value = track.pan / 100` — converts the `-100..100` integer column to the Web Audio API's `-1..1` range. Applied every frame alongside volume/mute, not just at wiring time.
- `audio.volume` is **unchanged** and still applies pre-graph, upstream of the pan node. Volume and pan are independent, non-interfering paths — panning does not replace or wrap the existing volume mechanism.

**Gotcha — never unconditionally `.close()` `audioCtxRef` once any clip may have been panned:**
`createMediaElementSource` permanently binds an `<audio>` element to the `AudioContext` it was created from — an element can never be rebound to a new context. Closing and recreating `audioCtxRef` on every stop (the pre-panning behavior) would silently break playback for every previously-panned clip on the next play — a fresh context can't reconnect to an already-bound element. The stop paths (the `isPlaying → false` effect, auto-stop-at-end-of-timeline, and the rAF loop's own stop branch) now all branch on `Object.keys(panNodesRef.current).length > 0`: if any clip has been wired in, `audioCtxRef.current?.suspend()` — context and graph survive, resumed on next play via the existing Safari-unlock `toggle-play` listener; if not, the original unconditional `.close()` + null-out still applies. The unmount cleanup `useEffect` still always closes unconditionally — that's fine, the component is going away and nothing needs to survive.

**UI — L/C/R segmented buttons (`Track.tsx`):**
Not a slider, not shadcn's `ToggleGroup` — Radix's deselect-to-null semantics don't fit "pan always has a value." A hand-rolled three-button group next to the M/S buttons, matching their sizing/border/hover treatment. Discrete values only: `L = -65`, `C = 0`, `R = 65`. Active-button state uses strict equality (`track.pan === -65 / 0 / 65`) with no nearest-match fallback — an out-of-band pan value (possible since the column allows the full `-100..100` range) shows no button highlighted rather than guessing the closest one, consistent with the project's "warn loudly, don't silently coerce" convention (see `onAddToTimeline` in root `CLAUDE.md`'s What To Avoid). Writes go through `patchPan` (`useMutation` → `PATCH /api/tracks/:trackId`, same route and pattern as volume) — there is no separate pan-specific write path.

### Safari playback-start failure — parked, unresolved

Confirmed via manual testing in real Safari.app: playback fails to start on first press more than 50% of the time. More severe than, but likely related to, the pre-existing minor stutter on pressing play (see root `CLAUDE.md` Known Issues). Root cause not yet isolated.

**Lead, not a confirmed cause — a code-level race:** in the rAF `animate` loop above, `audio.play()` (guarded by `pendingPlayRef`) and `ensurePanNode(clip.id, audio)` both run in the same synchronous pass of the same frame, with no gate between them — `ensurePanNode` wires the Web Audio graph immediately after `.play()` fires, not after its promise resolves.

**Investigation to date:**
- Reproducing via headless WebKit (Playwright) as a Safari proxy: 0/24 fresh-load failures — could not reproduce.
- The race window WAS observed to occur in that harness, but only in Firefox, and Firefox silently recovered rather than failing audibly/visibly.

**Gotcha for any future session picking this up:** headless WebKit via Playwright does not reliably reproduce this failure — real Safari.app is required to test any fix. The likely explanation is real audio-hardware session init latency and system load that a clean automated headless environment doesn't reproduce. Do not trust a headless-only pass/fail result here; any fix must be confirmed against real Safari.app directly.

**Metronome — ✅ Built**

Split-button control in Transport (before SkipBack): a plain `<button>` (not the standard `Button` component — see gotcha below) holds the metronome icon and toggles on/off exactly as before. A small `ChevronDown` (`size={11}`, `strokeWidth={3}`, marker class `metronome-chevron-trigger`) sits immediately adjacent — glyph-to-glyph gap tuned to ~4px via `p-1` icon padding + `gap-0` on the wrapping flex row + `-ml-0.5` on the chevron's own wrapper — and opens a `Popover` with a volume `Slider` (0–100, default 70) and a hand-rolled three-button subdivision picker (1/4, 1/8, 1/16 — same pattern as the L/C/R pan buttons in `Track.tsx`, not shadcn's `ToggleGroup`). No visible border or background at rest, reading as one plain icon-with-arrow unit matching sibling transport buttons. `hover:bg-white/5` appears only on real mouse hover of the chevron itself (never `focus-visible` — see gotcha below), isolated to a small `rounded-full` wrapper around just the chevron. Hovering the chevron also triggers the icon's own hover-brightness state (`group-has-[.metronome-chevron-trigger:hover]:text-foreground` / `:text-primary/80`, mirroring the icon's existing direct-hover classes exactly) so the two read as linked, without altering the icon's own independent hover.

`isMetronomeOn` state persisted per song to localStorage (`patchbay-metronome-${songId}`), lazy-initialized for correct first paint. Dispatches `toggle-metronome` event; Timeline listens and syncs `isMetronomeOnRef.current`. Volume and subdivision follow the identical per-song localStorage + CustomEvent pattern: `patchbay-metronome-volume-${songId}` / `patchbay-metronome-subdivision-${songId}`, synced to `Timeline.tsx` via `update-metronome-volume` / `update-metronome-subdivision` CustomEvents. No standalone/practice mode — metronome only ticks during playback.

**Click generation:** Inside the rAF `animate` loop, beat detection computes a **tick** index — `tickInterval = secondsPerBeat / subdivisionFactor`, `currentTickIndex = Math.floor(playheadTimeSecs / tickInterval)` — where a tick is a quarter/eighth/sixteenth-note interval per the current subdivision setting (`subdivisionFactor`: 1/4→1, 1/8→2, 1/16→4). When `currentTickIndex !== lastBeatIndexRef.current`, `playMetronomeClick` fires: creates an `OscillatorNode → GainNode → audioCtxRef.current.destination` (same `audioCtxRef` as the Safari unlock, no separate AudioContext), `osc.type = 'square'` (deliberately not the sine default — far more harmonic content at the same gain, reads as a sharper click that cuts through the mix), 1000 Hz on beat 0 of each measure (accent), 800 Hz otherwise. Gain envelope: 0 → `peakGain` over 5ms, then exponential decay to 0.0001 over 45ms, total duration 50ms. Gain is **not** scaled by `masterVolumeRef` — intentional so guide clicks stay audible when the mix is turned down.

**Gain curve — decibel-based, not linear or power-curve:** `peakGain` is derived from `metronomeVolumeRef.current` (0–100) via a dB-linear mapping, not a flat multiplier:
```ts
const t = metronomeVolumeRef.current / 100;
const minDb = -12; // volume=0 → quiet but present (gain ≈0.25), not near-silent
const maxDb = 0;   // volume=100 → peak gain 1.0 (unity, stays clear of clipping)
const db = minDb + t * (maxDb - minDb);
const peakGain = Math.max(0.0001, Math.pow(10, db / 20));
```
This went through several iterations before landing here — worth knowing the rejected alternatives so they aren't retried: a flat linear multiplier (`t * 0.5`, then `t * 1.0`) made 50–100% sound nearly identical (human loudness perception is roughly logarithmic, not linear in gain); a sqrt power curve (`0.05 + Math.pow(t, 0.5) * 2.45`) front-loaded the perceptual difference at the low end and flattened out badly in the top half of the range for the same reason, and its high ceiling (peak gain 2.5) caused audible crackling from destination clipping, worsened by the square wave's extra harmonic energy. The current dB-linear mapping is the fix for both problems at once: perceptually even across the whole slider, and hard-capped at unity gain (1.0) at 100% so it can't clip. `minDb = -12` (not a lower floor like -30) was also tuned up from an initial pass that left the metronome inaudible below ~80% on the slider — don't lower it further without re-checking usability at the low end.

**Subdivision control:** `metronomeSubdivisionRef` (`'1/4' | '1/8' | '1/16'`), same localStorage-key convention (`patchbay-metronome-subdivision-${songId}`). `METRONOME_SUBDIVISION_FACTORS` (module-level constant in `Timeline.tsx`) maps each setting to ticks-per-quarter-note. **Accent must stay tied to true quarter-note beat 0, never a subdivision tick:** `isQuarterNoteBeat = currentTickIndex % subdivisionFactor === 0`; `quarterNoteBeatIndex = currentTickIndex / subdivisionFactor`; accent fires only when `isQuarterNoteBeat && quarterNoteBeatIndex % beatsPerMeasure === 0`. Without this, an 1/8 or 1/16 tick landing between quarter notes would wrongly trigger the accent pitch.

**Gotcha 1 — seed `lastBeatIndexRef` on play-press:** If initialized to `null`, the `!== lastBeatIndexRef.current` check always fires on the first rAF frame regardless of actual tick position, producing a spurious click. Seed to `Math.floor(playheadTime / tickInterval)` at the top of the rAF `useEffect`'s `if (isPlaying)` block (not in the `[]` Safari-unlock listener, which has stale `bpm`/`zoom`/subdivision values from mount).

**Gotcha 2 — position-0 edge case:** When `playheadTime === 0`, seeding to `Math.floor(0 / tickInterval) = 0` matches the first frame's `currentTickIndex = 0`, silently dropping tick 0's click. Fix: seed to `-1` when `playheadTime === 0`.

**Gotcha 3 — reseed `lastBeatIndexRef` on subdivision change, not just on play-press:** Changing subdivision mid-playback (e.g. 1/4 → 1/16) changes what "tick index" means at the current playhead position — without a reseed, the next rAF frame sees a large index jump from the old subdivision's tick count and fires a burst of catch-up clicks trying to reconcile it. The `update-metronome-subdivision` event handler (registered in a zero-dep `useEffect`) reseeds `lastBeatIndexRef` inline, mirroring the play-press seed logic exactly (including the position-0 → `-1` case). This requires a stale-closure-safe `bpmRef` (mirrored from `bpm` state via its own `useEffect`) since the zero-dep handler can't close over current `bpm` directly.

**Gotcha 4 — `exponentialRampToValueAtTime` throws if its starting value is 0:** at `metronomeVolumeRef.current === 0`, the dB formula's `Math.pow(10, db/20)` never actually reaches exactly 0 in practice, but `peakGain` is still floored at `Math.max(0.0001, ...)` as a hard safety clamp — a bare `0` scheduled via `linearRampToValueAtTime` immediately before the `exponentialRampToValueAtTime(0.0001, ...)` call would throw a `RangeError` and silently kill the rest of that `animate()` frame, including the `requestAnimationFrame(animate)` call at the end — i.e. **a single bad gain value here can freeze the entire playback loop**, not just mute the click. Any future change to the gain formula must preserve this floor.

**Metronome split-button UI (`Transport.tsx`) — hard-won gotchas:**

The on/off icon + chevron-opens-popover pairing went through several structural rewrites before landing on its current form (plain side-by-side `flex` row, no divider/pill/corner-overlap) — the intermediate attempts and why they were rejected are worth knowing so they aren't retried:

- **`localStorage.getItem(...)` returning `null` silently becomes a valid `0`, not a fallback default:** `Number(localStorage.getItem(key))` is `0` (not `NaN`) when the key is unset, so a naive `Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback` range check passes for the unset case and returns `0` instead of the intended default. Fix (used for `metronomeVolume`/`metronomeVolumeRef` in both `Transport.tsx` and `Timeline.tsx`): check `if (saved) { ... }` (truthy string) before parsing, matching the pattern already used for `zoom`. Any future numeric localStorage read needs the same guard.
- **`Button`'s `size="icon"` variant is a fixed 36px hit-target box with the icon centered inside** — this leaves ~9px of invisible padding on every side that swallowed multiple rounds of attempts to close the visual gap to the chevron purely via the chevron's own padding/margin or the flex `gap`. The actual fix required abandoning the shared `Button` component for the icon and using a plain `<button>` with small explicit padding (`p-1`) instead, so the rendered box hugs the glyph.
- **`Button`'s base classes force every descendant `<svg>` to 16px regardless of the icon's own `size` prop**, via a global `[&_svg]:size-4` Tailwind rule. `MetronomeIcon size={18}` was therefore *always* silently rendering at 16px (confirmed via `getBoundingClientRect`, matching its Button-wrapped siblings) — the `18` was never actually taking effect. Stepping outside `Button` removes that clamp, so `size={16}` must be set explicitly to hold the same rendered size instead of jumping to a visually mismatched 18px.
- **`hover-elevate` / `active-elevate-2` (present in `Button`'s base class string) are dead classes app-wide — confirmed via a full `document.styleSheets` scan finding zero matching CSS rules anywhere.** Ghost-variant buttons in this app have no real background-on-hover; only the `hover:text-foreground` color change actually does anything. Don't assume these classes do something when styling any other ghost button — verify with computed styles, not the class name.
- **Radix `Popover`'s focus-return-to-trigger-on-close is a real, correct accessibility behavior — but a `focus-visible:` background class on the trigger will read as a permanently "stuck" hover pill because of it.** Confirmed via `element.matches(':focus-visible')`: Chromium's focus-visible heuristic engages on that programmatic refocus (Escape, selecting a popover option, clicking outside all trigger it), so `focus-visible:bg-*` on a `PopoverTrigger` stays lit indefinitely after *any* interaction with the popover, not just real keyboard focus. Fix: the chevron's hover-pill background is `hover:` only (mouse), with no `focus-visible:` background counterpart. Don't add one back without solving this first.
- **There's no actual "glow" (box-shadow/drop-shadow/filter) anywhere in the transport row's icon buttons** — confirmed by diffing every visually-relevant computed style on hover across all four transport icons. The only hover effect on any of them, metronome included, is a plain `color` change (`text-muted-foreground → text-foreground`, or `text-primary → text-primary/80` when active). Don't go looking for a shadow-based glow mechanism to reuse elsewhere in this row; it doesn't exist.
- **Making the chevron trigger the icon's own hover effect (icon and chevron are siblings, not ancestor/descendant) uses `group-has-[]`, not plain `group-hover:`.** The wrapping `flex` row is `group`; a stable marker class (`metronome-chevron-trigger`) on the chevron lets the icon apply `group-has-[.metronome-chevron-trigger:hover]:text-foreground` (and the `:text-primary/80` on-state equivalent) as a *second* trigger path for its own existing `hover:` classes — reusing the literal same classes, not a new effect. Plain `group-hover:` on the icon would incorrectly also fire when hovering the icon's own box, since group-hover fires on hover anywhere inside the `.group` ancestor, icon included.
- **Visual icon "boldness" can differ between icon sources at identical `size`, due to stroke-width-to-viewBox ratio differences, not container size.** Confirmed via rendered-pixel ink-density measurement (draw the SVG to an offscreen canvas, count non-transparent pixels) — `MetronomeIcon` measured ~12% lower ink coverage than its lucide siblings (SkipBack, Repeat) at the same nominal 16px render size. Fixed via a `strokeWidth` bump on `MetronomeIcon` itself (`2 → 2.5`), not by changing its bounding-box size, which brought density back in line (~26% vs. siblings' ~25%). If an icon "looks smaller" than its siblings despite an identical `size` prop, measure ink density before assuming the size prop is wrong — it may already be correct.

**Do not** re-wrap the metronome toggle in the shared `Button` component to "simplify" it back — that's what caused the icon-swallows-the-gap problem in the first place. **Do not** re-add `focus-visible:bg-*` to the chevron without first addressing the Popover-refocus interaction above.

**Known false alarm — metronome loudness/timbre changes can make clip/master playback sound quieter by contrast (auditory masking), not a real regression.** After the square-wave + gain-curve work, clip/master playback was reported as sounding quieter overall. Confirmed via full diff review that nothing outside `playMetronomeClick`'s own gain calculation was touched: clip playback (`audio.volume`, driven by `masterVolumeRef`) and the metronome's own per-click `GainNode` are fully independent Web Audio paths with no shared node — both merely fan into the same `ctx.destination`, which is normal Web Audio mixing, not a shared gain stage. The much louder, harmonically denser square-wave click is the likely cause of a perceptual masking/contrast effect, not an actual gain reduction elsewhere. If this resurfaces, toggle the metronome off and A/B before assuming a regression.

**Section-loop visual indicator — ✅ Built**

Previously, the only signal that looping was active was audible repetition. A gold header highlight now shows which section is being looped.

**`loopedSectionName` — derived, never stored from the rAF loop:**
```ts
const loopedSectionName = React.useMemo(() => {
  if (!isLooping) return null;
  return sectionLayout.find(
    (sec) => playheadTimeSecs >= sec.start && playheadTimeSecs < sec.start + sec.duration
  )?.name ?? null;
}, [isLooping, playheadTimeSecs, sectionLayout]);
```
Recomputed on every render from render-time state — deliberately not gated on `isPlaying` — so the indicator stays correct while paused. There is no separate "pinned" loop section; the derivation is always live from the current playhead position.

**Disable-on-reposition (generalized watcher):**
A `useEffect` watching `[playheadTimeSecs, isLooping, sectionLayout]` compares the current derived section against the previous one via `prevLoopedSectionRef`. If `isLooping` is true, the previous section was non-null (guards against mount), and the section changes, `isLooping` is set to `false`. This works correctly because the loop's own boundary-reset always keeps the playhead inside the same section during normal looping — an observed section change during `isLooping` can only mean the user repositioned the playhead manually (flag drag, ruler click, or any other input method). No per-input-method special-casing is needed.

**Cross-component sync:**
`isLooping` is tracked independently in both `Transport.tsx` and `Timeline.tsx`. `toggle-loop` flows Transport → Timeline only. When Timeline's watcher auto-disables loop, it dispatches `loop-force-disabled` (no payload) and Transport listens for it to set its own `isLooping` to `false` directly — without re-dispatching `toggle-loop`, which would create an event ping-pong.

**Header styling (`DraggableSectionHeader`):**
`isLooped` → `bg-primary/10 border-b-2 border-b-primary`, plus the same faint right divider as every header (`border-r border-primary/20`). No gold right border and no rounded corner (removed in 4g3: the right edge belongs to the section-end handle and its faint added-space mark). Use `border-b-primary`, not `border-primary`: `border-primary` sets all four sides and would turn the right divider solid gold. Still deliberately not a solid fill — solid fills are reserved for clip track-identity color, not state indicators. The loop feature is due for a redesign; its look will be decided then.

**Out of scope for this version:** no retargeting to a new section when the playhead moves — loop simply disables on reposition. No toast/notification on auto-disable. Multi-section loop ranges are a separate future feature.

**Last-section loop fix — gotcha:**
Looping the final section previously failed: `animate()`'s end-of-timeline guard (`playheadRef.current + timeDelta >= frameTimelineEnd`) ran before `setPlayheadTime` was called and returned early unconditionally, stopping playback instead of resetting. The last section's end and `frameTimelineEnd` are numerically identical by construction, so the guard always fired first, preventing the loop boundary-reset (which lives inside the `setPlayheadTime` updater) from ever being reached. Fixed by gating the guard on `!isLooping` — it now only stops playback when not looping, deferring to the existing loop boundary-reset when looping is active. **Any future changes to end-of-timeline handling must preserve this `!isLooping` check.**

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
- Trim starts within 8px of an edge (see "Clip trim visual redesign" below); there are no visible handles
- `displayWidth` = played length (`playedSpan`) × zoom; `left = clip.start * zoom` on the track row. A left trim moves the clip's start with the audio (its offset changes by the same amount as `trimStart`), so the right edge stays put
- Free movement, no snap. Limits come from props computed in `TimelineTrack` (`trimPrevEnd`, `trimPickupPrevEnd`, `trimNextStart`: `trimNeighbours` with the track's pickup limit and `nextPickupStop`), applied by the shared `clampTrim`; minimum length `minTrimLength` (0.5 s or the whole file). Option, read live, lets a left trim make a pickup (same `startPickupDrag` / `pickupAllowed` / `afterPickupPlacement` state as drags). Esc and window blur cancel
- Each trim drag and save signals `trim-busy` (+1/−1) so Timeline holds both polls
- Drag is captured with `window.addEventListener('pointermove'/'pointerup')` (no `setPointerCapture`) to avoid conflicts with dnd-kit sensors. `e.nativeEvent.stopImmediatePropagation()` on `pointerdown` prevents dnd-kit from starting a drag
- `isTrimDragging` ref gates the `positionStyle` so dnd-kit's `style` prop (transform) is suppressed during trim drag
- Local `trimStart`/`trimEnd` state is updated on every `pointermove` frame; `patchTrim` fires on `pointerup`
- On every `pointermove` frame, `Clip.tsx` (`showTrim`) also dispatches a `trim-preview` CustomEvent: `{ clipId, trimStart, trimEnd, sectionOffset? }`. `Timeline.tsx`'s zero-dep `handleTrimPreview` updates only that clip's trim (and, for a sectioned clip, its offset) inside `setTracks(prev => ...)`. Neighbours never move and nothing is re-packed; nothing is saved from here
- A `useEffect` syncs `trimStart`/`trimEnd` from the prop whenever the API refetches (so a live-sync poll doesn't clobber active drag state — the effect only runs when the clip is not being dragged)
- All trim actions live inside a **▶ Trim submenu** (`ContextMenuSub`) in the `TimelineClip` right-click menu. Menu order: Detect Trim Points → Apply Trim to All Instances (conditional) → Reset Trim on All Instances (conditional) → Reset Trim (conditional). The submenu is always visible; individual items appear conditionally.

**API — `PATCH /api/timeline-clips/:id/trim`:**
Accepts `{ trimStart: number, trimEnd: number | null }`. Goes through `writeTimelineClipTrim` (`storage.ts`), the one write for trim values: 400 unless 0 ≤ trimStart < trimEnd ≤ duration, the clip stays at least `minTrimLength`, and the new offset respects the pickup limits; moves `section_offset` with `trimStart`. Does not touch `isFinal`; nothing else moves. On success, `patchTrim` in `TimelineClip` calls `queryClient.invalidateQueries({ queryKey: ['/api/songs/${songId}/timeline'] })` to push the new trim values into the tracks state so the rAF loop and live-sync effect see them immediately.

**Layout — effective duration everywhere:**
`layoutTimeline` and the placement helpers use the trimmed length `(clip.trimEnd ?? clip.duration) - (clip.trimStart ?? 0)`; drawing, playback, seek, skip, mute and arrow keys use `playedSpan` (trimmed length − head cut). Section columns match the audible content, not the raw file length.

**After a trim:**
Positions are never read from stored `start`: the layout recomputes from the trim values and offsets the refetch brings back. The polls stay held until that refetch, so the clip never snaps back.

**New and replaced clips always start untrimmed:**
Every new-clip path (`insertClipInSection`, version and loose-file drops via `virtualFileClip`) sets `trimStart: 0, trimEnd: null` and sends them in the POST body. Spreading from the bucket clip drag data is not sufficient because bucket clips don't carry these fields. `performReplace` in `TimelineClip` also sends `trimStart: 0, trimEnd: null` in its `PATCH /api/timeline-clips/:id` body; the server (`updateTimelineClipKeepingSpot` → `writeTimelineClipTrim` with `keepOffset`) keeps the clip's offset and cuts `trimEnd` short where the next clip starts (`trimEndBeforeNext`; not for the last clip in a section). Replace refuses with 409 when the new file is shorter than the minimum length, or a pickup's new file can't reach the downbeat; the client toasts.

**Export:**
`ExportDialog.tsx` passes trim to the `OfflineAudioContext` via `source.start(when, inPoint, length)`, where the in-point is `trimStart` + the layout's head cut (`exportClipsFor`, shared by mix and stems); zero-length clips are skipped. The total export duration also uses effective trimmed durations so silence is not rendered past the trim out-point.

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
`TimelineClip` receives an `instanceCount?: number` prop (default 1). `TimelineTrack` (`Track.tsx`) computes it per clip from the full track clip array — not just the section, because the same name may appear in a different section:
```ts
instanceCount={track.clips.filter((c) => c.name === clip.name).length}
```
Do not compute the instance count from query cache data — the prop is always fresh because the row re-renders whenever `track.clips` changes.

**Both instance actions are only shown when `instanceCount > 1 && (trimStart > 0 || trimEnd !== null)`.** When N = 1 (only this clip), the items are absent entirely — no toast, no confirmation.

**Confirmation dialogs:** "Apply Trim to All Instances" shows the count as `instanceCount - 1` (excluding the selected clip itself). "Reset Trim on All Instances" shows the same count.

**After success:** `queryClient.invalidateQueries({ queryKey: ['/api/songs/${songId}/timeline'] })` is called so the live-sync effect picks up the new trim values for all affected clips within the next poll cycle.

**`POST /api/timeline-clips/apply-trim-to-instances` route** is registered before `PATCH /api/timeline-clips/:id` in `routes.ts`. Although Express won't confuse a POST with a PATCH, keeping static paths before parameterized ones is the convention. The route (`applyTrimToInstances`) writes each instance through `writeTimelineClipTrim`, clamping it at its own neighbours and limits (or skipping it when no allowed trim exists); it never creates a pickup.

### Bucket clip cards — WaveformPlayerCard — ✅ Built

`BucketClip` in `Clip.tsx` renders a **`WaveformPlayerCard`** (`client/src/components/daw/WaveformPlayerCard.tsx`) in the Files column of `MediaBucket`. The same component is used in the Dashboard file browser (Songs and Ideas modes).

**`WaveformPlayerCard` props:** `src`, `name`, `duration`, `isFinal`, `color?` (left border), `waveformHeight?` (default 20px; MediaBucket's `BucketClip` passes `waveformHeight={20}`), `className?`, `cardRef?` (the card's root element — the landing flash animates it, not the drag wrapper).

**What it renders:**
- Thin colored left border accent (`absolute left-0 top-0 bottom-0 w-0.5`) — only when `color` is provided; MediaBucket passes `clip.color`, Dashboard omits it
- Round gold play/pause button (explicit click trigger — **no hover-to-play anywhere**)
- Clip name in gold text when `isFinal` (icon-free — the final indicator itself is a `CornerBadge`, see below) — **no "FINAL" text label anywhere**
- Duration display (shows total duration when stopped, current position when playing); shifts left (`mr-4`) when `isFinal` so it clears the corner badge
- Waveform canvas: decoded once via `AudioContext.decodeAudioData`, drawn with gold playhead progress

**Drag compatibility:** `BucketClip` wraps `WaveformPlayerCard` with `ContextMenuTrigger asChild` on the dnd-kit drag div. The play button and canvas both call `e.stopPropagation()` on `onPointerDown`, gated to the left button only (`e.button !== 2`), so they do not accidentally activate drag without also swallowing right-click's dismiss signal to other open menus — see "Platform and browser gotchas" below. Right-click anywhere opens the context menu normally via `ContextMenu`.

**Reopening on a second right-click of the same trigger** — Radix's `ContextMenu` doesn't natively support re-firing when the same trigger is right-clicked again while its own menu is already open. Fixed via `use-reopenable-context-menu.ts` (a nonce-driven `key` remount on `ContextMenuContent`) paired with `modal={false}` on the `ContextMenu` root; wired into `BucketClip`, `IdeaFileContextMenu`, and `SongsClipContextMenuCard` (all in `Dashboard.tsx`/`Clip.tsx`). See "Platform and browser gotchas" below for why.

**Context menu items (BucketClip):** More Info · Add Note · Mark as Final / Unmark Final · Add to Timeline (only when `onAddToTimeline` is passed — Workspace, not SongHome) · Download · Remove from Section (above Remove; song-level loose file — hidden for Full Take versions and on non-song surfaces) · **Remove** (red). Remove calls `POST /api/clips/:clipId/remove` (soft-delete, `active = false`) through `useClipInUseAction`; see "Remove and the in-use check" below. The `clips` table has an `active` column (boolean, default true); `getBucket` in `storage.ts` filters `eq(clips.active, true)`.

**`isFinal` persistence** — `useEffect` syncs `isFinal` from the prop whenever the bucket query refetches. Local state is optimistically updated and reverted on API failure. `executeMark(newIsFinal)` is the shared path for both the direct toggle and the sibling-confirmation dialog.

**Sibling-final confirmation dialog** — before marking a clip final, `BucketClip` checks `siblingClips.some(c => c.id !== clip.id && c.isFinal)`. If a sibling is already final, an `AlertDialog` ("Change Final Version?") appears. `siblingClips` is passed from `MediaBucket` via `siblingClips={selectedIdea.clips.map(toClip)}`.

**Timeline clip removal guard** — `TimelineClip` shows an `AlertDialog` ("Remove Final Clip?") when a user selects "Remove Clip" from the context menu and `isFinal === true`. This is managed via `showRemoveConfirm` state in `TimelineClip`.

**Auto-isFinal on timeline clip placement** — `POST /api/tracks/:trackId/clips` checks whether a final bucket clip exists for the same `trackId + sectionName`. If one exists, the newly placed timeline clip is immediately set to `isFinal: true`.

### Remove and the in-use check — ✅ Built

- **Trigger:** removing or moving a real-song version (Remove, move-to-section, move-to-loose) with timeline copies or Final returns 409 `{ code: 'clip-in-use', dependents }`. `ClipInUseDialog` lists them; confirming repeats with `confirm: true`. A task status change alone never opens the dialog.
- **On confirm:** `releaseClipDependencies` (`storage.ts`) deletes the clip's timeline copies by `bucketClipId`, clears Final on that one clip and nulls `relatedClipId`; then the section's task is recomputed. Audio, notes and metadata stay.
- **Task rule** (`taskStatusAfterVersionLeaves`, `shared/clip-dependents.ts`): no active versions left → To Do; Complete → In Progress only if the leaving file was Final and no other Final remains; will-not-play never touched.
- **Moves (built):** move-to-section and move-to-loose reuse `releaseClipDependencies`, the 409 shape and `postClipLeave`. `useClipInUseAction` takes `run(vars)` and exposes `pendingVars` and `onCancel`; moves host one `VersionMoveInUseDialog` per surface (the source card can unmount), Remove's dialog stays in `BucketClip`.
- **Dialog wording:** both use the shared `describeLeaveDependents` — intro `Removing "X" will:` / `Moving "X" to Track › Section will:` / `Moving "X" out of Track › Section will:`; bullets "Remove it from the timeline in Track › Section" (or "Remove its N placements…"), "Clear its Final mark", "Change the Track › Section task from X to Y"; then "The audio file, notes and metadata are kept." Buttons: Cancel / Remove anyway or Move.

### Shared CornerBadge component — final/comment badges — ✅ Built

`CornerBadge` (`client/src/components/daw/CornerBadge.tsx`) is the single source of styling for the two small badges that can appear on a clip card: the final-version checkmark and the comment indicator. It replaced independently-styled, duplicated inline badge JSX that had drifted apart between `TimelineClip` and `WaveformPlayerCard`/`BucketClip`.

**Props:** `variant: 'final' | 'comment'`, `corner: 'top-right' | 'bottom-right'`, `hasUnread?: boolean` (comment variant only), `onClick?: () => void` (comment variant only — the final badge is never clickable).

**Rendering:**
- `variant="final"` — `bg-primary rounded-bl shadow-sm z-10`, black `CheckCircle2` (size 10). Not interactive.
- `variant="comment"` — `rounded-tl shadow-sm z-[21] cursor-pointer`; `bg-primary` + black `MessageCircle` when `hasUnread`, else `bg-white/[0.25]` + `text-white/60` `MessageCircle`. Swallows `onPointerDown` (`stopPropagation` + `stopImmediatePropagation`) so it never starts a dnd-kit drag, and `stopPropagation`s its own `onClick` before calling the passed handler so it doesn't bubble into the card's own click/select behavior.
- `corner` positions the badge absolutely within its parent: `top-right` → `absolute top-0 right-0 p-0.5`; `bottom-right` → `absolute bottom-0 right-0 p-0.5`. The parent must be `relative` (both `TimelineClip`'s container and `WaveformPlayerCard`'s outer card are).

**Used by:**
- **`TimelineClip`** (`Clip.tsx`) — final badge `top-right` (only clip-level indicator; the `isFinal` ring on the clip container was removed — it rendered as an unwanted gold line at clip seams and added no information the badge doesn't already convey), comment badge `bottom-right` with `tcHasUnread`/`tcCommentInfo`-driven `onClick` opening `ClipInfoWindow` with `focusComments: true`.
- **`WaveformPlayerCard`** — final badge `top-right`, rendered directly on the outer card whenever `isFinal` is true. **`BucketClip`** passes the comment badge in as `children` (`bottom-right`, `hasUnread`-driven, `onClick` opens `ClipInfoWindow` with `focusComments: true`) — both badges share the same `relative overflow-hidden` card container, so they never need coordination beyond their fixed corners.

- **Dashboard** — organized file cards on the Ideas shelf and Songs quick-browser (`clipNotesBadge` → `SongsClipContextMenuCard`'s `notesBadge` prop), and the Ideas-shelf loose-file preview card. All open More Info with `focusComments` and mark read on open.
- **`LooseFileRow`** uses a small inline `MessageCircle` instead (plain text row, not a card) — non-interactive, gold when unread.

**Unread rule (all badges):** `hasUnreadComments(latestOthersCommentAt, lastViewed)` from `Clip.tsx` — someone else commented after this browser's last view. A missing `patchbay-lastViewedComments` entry counts as unread. Your own comments never count (`latestOthersCommentAt` excludes the session user server-side). Read state stays in localStorage, keyed by clip id or loose file id (organize reuses the loose file's id as the clip id, so it carries over).

**Freshness:** `['clip-comment-summary', songId]` and the loose-file lists use `liveCommentRefetch` (focus + 30s). For the summary, that's applied once per surface via `useLiveClipCommentSummary(songId)` (Timeline, MediaBucket) — not on the per-clip observers, which would each run their own interval.

**Do not** re-inline badge JSX at a new call site — extend `CornerBadge` (e.g. a new `corner` value) instead, or the two surfaces will drift apart again.

### Media Bucket — "Add Section"

Hovering over the Sections header in `MediaBucket.tsx` reveals a `+` button that opens `AddSectionModal` (from `client/src/components/daw/modals/AddSectionModal.tsx`). Submitting calls `useAddSection` (from `use-bucket-mutations.ts`).

**Add Section** — `useAddSection(songId, bucket)` → `POST /api/songs/:songId/sections`, a single atomic server-side call that creates one idea row per active track in a transaction. Server computes `sortOrder` once, shared across all tracks (not per-track). Section names must be unique per song, active or hidden, no exceptions — enforced by a `UNIQUE(track_id, section_name)` index on `ideas` (schema.ts) plus a server-side pre-check. Duplicate attempts return 409, distinguishing an active conflict ("already exists") from a hidden conflict ("exists but hidden — restore it"), mirroring the instrument-duplicate pattern. Restore scope matches remove scope: MediaBucket (and the Library Songs browser) restore one track via `POST /api/ideas/:ideaId/restore` (`useRestoreSection`); Production Tracker restores song-wide via `POST /api/songs/:songId/sections/restore` (`useRestoreSectionSongWide`). See "Section hide and restore" in root `CLAUDE.md`.

**`AddInstrumentModal` duplicate-name guard (client-side):** `AddInstrumentModal`'s onSubmit handler performs a pre-check against the current bucket data before mutating: `tracks.some(t => t.name.trim().toLowerCase() === name.toLowerCase())`. If a duplicate is found, `setAddInstrumentError` is called and the mutation is not fired. The error clears automatically on the next keystroke via `onClearError`. The same pattern applies on the Dashboard Files tab surface (`fileBucket` instead of `tracks`). Section uniqueness is now enforced server-side (409) — `AddSectionModal` no longer performs a client-side pre-check.

**Auto-select + scroll after creation:** `addSectionMutation.onCreated` fetches the fresh bucket via `queryClient.fetchQuery`, finds the selected track's new idea by `sectionName === <created name>`, and calls `setSelectedIdea`. A `selectedIdeaRef` + `useEffect([selectedIdea?.id])` then scrolls the idea row button into view — parity with the instrument-add pattern.

**Right-click "Remove Section"** hides the idea for that one instrument only (`useHideIdea` → `PATCH /api/ideas/:ideaId` → `active = false`). This is per-instrument, not song-wide; unconfirmed here (the Library Songs browser confirms). A song-wide hard-delete endpoint (`DELETE /api/songs/:songId/sections/:sectionName`) exists on the server but is not wired to any UI action — do not add a UI affordance for it without a product discussion.

**User-added sections always appear at the bottom of the sections list.** `getBucket` in `storage.ts` orders ideas by `asc(ideas.sortOrder)` before returning them; MediaBucket renders in that order — no client-side re-sort. Do not change this to alphabetical or insertion-point ordering without discussion. Append-to-bottom is the intentional UX.

### Media Bucket — hidden-tracks query invalidation

The `hiddenTracks` useQuery (key: `['hidden-tracks', DEFAULT_SONG_ID]`) has `enabled: isAddInstrumentOpen` so it only runs when the Add Instrument dialog is open. It also has `refetchOnMount: true` and `refetchOnWindowFocus: false` — this ensures it always fetches fresh data when the dialog opens, even if the cache was previously populated.

**Two places must invalidate this key** whenever an instrument is soft-deleted (hidden):
1. `deleteTrackMutation.onSuccess` in `MediaBucket.tsx` — triggered when the user removes an instrument from the bucket panel's right-click menu
2. `handleDeleteTrack` in `Timeline.tsx` — triggered when the user removes an instrument from the timeline track header right-click menu

Both fire `queryClient.invalidateQueries({ queryKey: ['hidden-tracks', SONG_ID] })`. If either is missing, the restore dropdown in the Add Instrument dialog will show stale data until a manual page refresh.

### Media Bucket — Files column empty state

When a section is selected but has no clips, the Files column renders a full-height dashed-border drop zone (matching the Dashboard file browser empty state style) instead of plain text:

```tsx
<div className="flex-1 p-2">
  <div className={cn(
    'flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors',
    filesColumnDrop.isOver ? 'border-primary/50 bg-primary/5' : 'border-white/[0.08]'
  )}>
    <Upload size={18} ... />
    <p ...>No files yet</p>
    <p ...>Drop audio files or use Upload above</p>
  </div>
</div>
```

The empty state is rendered **outside** `ScrollArea` as a `flex-1` sibling of the column header div — this is required so `h-full` on the inner bordered div has a proper flex parent (the `flex flex-col` versions column div) to fill against. When placed inside a `ScrollArea`, `h-full` has no bounded parent and the div collapses to its content height.

`filesColumnDrop.isOver` (the column's `useNativeFileDrop` instance) drives the gold border / tinted background — a recolor of the same 2px dashed border, so the box never changes size. The text stays "No files yet" during a drag. Flicker over child elements is handled by the hook's enter/leave counting, not `relatedTarget`; see "Finder drops vs. Upload buttons" and the `useNativeFileDrop` rules under "What To Avoid" in root `CLAUDE.md`.

When clips exist (or a search query is active), `ScrollArea` renders as normal for the clip list.

### Media Bucket — session persistence

`MediaBucket.tsx` persists the last selected instrument and section idea to `localStorage` under keys `patchbay-selected-track-${songId}` and `patchbay-selected-idea-${songId}` (scoped per song). On mount, a one-time restore effect (guarded by a `sessionRestored` ref) reads these keys and restores the selection before falling back to URL param logic. The guard ensures the restore only runs once — it does not re-run on subsequent bucket refetches, preventing the selection from snapping back on poll.

**Song name in MediaBucket header** — The "Project: …" label in MediaBucket's header uses `useQuery(['song', songId])` to fetch the song name dynamically. In the SongHome context, this cache entry is already warm (SongHome fetches the same key). In the Workspace context, it makes one small fetch. Never hardcode the song name here.

**URL param priority** — On fresh mount, `MediaBucket` checks for `?instrument=`, `?section=`, `?clipId=`, and `?openComments=` query params before falling back to localStorage. `instrument` + `section` navigate the three-column browser to the right idea. `clipId` + `openComments=true` (both must be present) set `autoOpenClipId` state, which causes the matching `BucketClip` to auto-open its More Info modal with the comment input focused. `?file=` (Add to Song / Promote to Song toast links) is also read: with no `instrument` it selects the track and section holding that clip. `file` (or else `clipId`) triggers the landing flash on that clip's card (`requestLandingFlash`, see "Landing flash" in root `CLAUDE.md`), replacing BucketClip's old 3-second `?file=` ring. All of these are read in the same one-shot session restore `useEffect` so they resolve atomically on the first bucket data load. **Arrival params are one-shot:** the More Info auto-open fires once (BucketClip's `onAutoOpenHandled` clears `autoOpenClipId`, so a remount from a spring, section change or restore doesn't reopen it), and after handling, `clipId`, `openComments` and `file` are removed from the URL with `history.replaceState` (no history entry, pathname untouched). `instrument` and `section` stay — Timeline still reads `section` to scroll once its layout loads.

### Timeline — session persistence

`Timeline.tsx` uses localStorage for all client-only UI state. A `uiRestored` ref (initialized `false`) guards the full restore path — a one-shot `useLayoutEffect([tracks, songId])` that fires when tracks first become non-empty. The ref is set to `true` at the top of the restore body (before any state updates) so the persist effects in the same render cycle already see it as true. The persist effects check `if (!uiRestored.current) return` to avoid writing the initial React defaults before the restore runs.

**Keys (all scoped per songId):**

| Key | Type | What it stores |
|---|---|---|
| `patchbay-track-muted-${songId}` | JSON `Record<trackId, boolean>` | Per-track mute state |
| `patchbay-track-solo-${songId}` | JSON `Record<trackId, boolean>` | Per-track solo state |
| `patchbay-zoom-${songId}` | number string | Pixels-per-second zoom level |
| `patchbay-scroll-${songId}` | number string | `scrollLeft` of the timeline scroller (debounced 200ms via DOM listener) |
| `patchbay-vscroll-${songId}` | number string | `scrollTop` of the timeline scroller (same debounced DOM listener as `scrollLeft` — one shared 200ms timer writes both keys together) |
| `patchbay-playhead-${songId}` | number string | Playhead position as **time in seconds** — the same unit the playhead state uses, restored directly with no conversion |
| `patchbay-selected-timeline-track-${songId}` | string | ID of the last clicked track header |
| `patchbay-selected-timeline-clip-${songId}` | string | ID of the last clicked timeline clip |

**Restore ordering:** `zoom` and `playheadTimeSecs` are restored via **lazy `useState` initializers** (`useState(() => localStorage.getItem(...))`), not via the `useLayoutEffect` restore. This means the correct values are the initial values — they exist before the first render, so no wrong value is ever painted by construction. The `useLayoutEffect` restore still re-sets them when tracks arrive (idempotent; React bails out of the state update if the value hasn't changed). Mute/solo, scroll, and selection ARE still handled by the `useLayoutEffect` restore because they depend on tracks being loaded (mute/solo need track IDs; scroll uses `requestAnimationFrame` to wait for the content to render at the restored zoom width). The restore is declared before the muted/solo persist effect so it runs first in the same effect-flush cycle.

**`patchbay-playhead` persist** — the persist effect fires on `playheadTimeSecs`, `isPlaying` and `songId` changes, but is gated on `isPlaying === false`: when audio is playing the effect clears any pending write and returns immediately (no write attempted, not just debounced). A 200ms debounce on writes matches the scroll persist pattern. This means refreshing the page mid-playback intentionally falls back to the last paused or scrubbed position, not the live position — this is expected behavior, not a bug.

**Lazy-init as the preferred pattern for first-paint state** — a `useEffect` or even `useLayoutEffect` that corrects state after mount still means the component's first render used the wrong default. With React Query's cache, `apiTracks` can be immediately available but `tracks` (separate `useState`) always starts empty, so the first render always happens with the default values before the restore logic runs. Any state that must be visually correct on the very first paint should be lazy-initialized directly from its persisted source, not corrected by a post-mount effect. The BPM input flash was worked around with a `disabled` gate — lazy init is the cleaner, more general solution. Apply it whenever this bug class (flash-default-then-jump) appears for other persisted values.

**Scroll restore** is deferred via `requestAnimationFrame` so the content has rendered at the restored zoom level before `scrollLeft` is set — otherwise the scroller may not be wide enough to reach the saved position. Vertical scroll is persisted the same way as horizontal: `scrollTop` is written to `patchbay-vscroll-${songId}` by the same debounced scroll listener that writes `patchbay-scroll-${songId}` (one shared 200ms timer, both axes written together). On restore, `scrollLeft` and `scrollTop` are both set inside the same `requestAnimationFrame` callback in the `uiRestored` layout effect — not two separate rAF chains — so both axes land on the same paint tick instead of one visibly lagging the other. An earlier version wrapped the vertical restore in a second, nested rAF on the theory that row height might not be settled a frame early; real-browser testing showed this was unnecessary and caused a visible ~14ms secondary scroll jump right after the initial track pop-in (see the Known Issues entry on Timeline content pop-in in root `CLAUDE.md`) — do not reintroduce the double-rAF without a concrete repro showing the single-rAF version restores to the wrong position.

**Source of truth summary:**
- **DB-backed (shared across the band):** `songs.bpm`, `instrument_tracks.volume`
- **localStorage-backed (per-browser, not shared):** mute, solo, zoom, horizontal + vertical scroll, playhead position, selected track, selected clip

**Why activity feed links navigate to `/workspace` not `/songs/:songId`** — The `sessionRestored` ref is a one-shot guard. If the user is already on SongHome and clicks an activity row that would just change the URL params on the same page, the guard has already fired and will not re-run. Navigating to `/songs/:songId/workspace` ensures MediaBucket is always a fresh component mount, so the URL param restore logic runs cleanly. Never use the `find-in-bucket` CustomEvent for activity-feed navigation — that path is for within-workspace navigation only (e.g. "Show in File Browser" from a timeline clip right-click).

### Media Bucket — "new content" indicator — ✅ Built

Gold dot next to instrument and section folder names in MediaBucket's INSTRUMENTS/SECTIONS columns, showing content added since the current user last opened that folder.

**Schema:** `bucket_folder_views` (id, userId, ideaId, viewedAt) — unique index on (userId, ideaId), upserted per user per idea. Created via a guarded `CREATE TABLE IF NOT EXISTS` in `server/db.ts` at boot (not `drizzle-kit push`, per the migration-safety rule above). On first creation only, backfills a `viewedAt = now` row for every existing user × idea pair so no pre-existing content is falsely flagged new at launch — this backfill does not re-run on subsequent boots.

**Server:** `GET /api/songs/:id/bucket` now takes the session user into account and returns `hasNew: boolean` on every idea — true if any active clip's `createdAt` is later than that user's `viewedAt` for that idea (a missing view row counts as "never viewed," so any clips present make it `true`). `POST /api/ideas/:ideaId/view` upserts the view row for the current session user; ownership-checked against the idea's song.

**Client:** Selecting a section (`selectedIdea` change in `MediaBucket.tsx` — covers direct clicks, `find-in-bucket` navigation, add-section/add-instrument auto-select, and session restore) fires the view mutation and invalidates `['bucket', songId]` so the dot clears immediately rather than waiting for the next poll. **Springs:** a section selected by a spring-loaded drag (see "Spring-loaded tracks and sections" in root `CLAUDE.md`) is marked viewed only when the drag settles with it still selected, and only if it differs from the last section viewed outside a spring (`springViewHeldRef`, `onSpringSettled`); a spring that is restored marks nothing.

- **Section-level dot:** rendered when `idea.hasNew` is true.
- **Instrument-level dot:** pure client-side derivation, no separate tracking — `track.ideas.some(i => i.active && i.hasNew)`. The `active` check matters: without it, a hidden section's stale `hasNew` can light up the parent with no way for the user to clear it.
- Full Takes ideas need no special-casing — they're a normal `ideas` row and flow through the same path as any other section.
- Clip-level (Files column) is intentionally untouched — this is folder-level only.

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
- **Version drops, right-click "Add to Timeline" and full-take drops** (`commitVersionDrop` via `virtualFileClip`, `insertClipInSection`, `insertFreeformClip` in `Timeline.tsx`) — set `bucketClipId: clip.id` directly, since `clip` at these call sites is always the source bucket clip. A placed loose file's clip keeps the loose file's id, so `bucketClipId` is that id.
- **Timeline clip drags** — only `sectionOffset` is saved (`PUT …/timeline-clips/offsets`); `bucketClipId` is never touched.
- **Replace** (`PATCH /api/timeline-clips/:id` from the Replace submenu) — sets `bucketClipId` to the selected replacement's `id`, so the source link correctly repoints to the new version rather than staying attached to the old one.

`ClipInfoWindow` reads `effectiveId = clip.bucketClipId ?? clip.id` for all comment API calls (unless a `target` is passed — see "Comment targets" below), and resolves `effectiveMetadata` via a direct `bucketClipId` lookup against the bucket cache (an O(1) find, not a nested walk). The old name-matching code is left in place, commented out, as a deprecated fallback — not deleted, in case a row is ever found with a null `bucketClipId` (should not happen given the backfill, but defensive).

**Do not** reintroduce trackId+sectionName+name matching as a resolution path. If a future feature needs to resolve a timeline clip's source, use `bucketClipId` directly.

**Mount-gating:** `ClipInfoWindow` is mounted conditionally (`{showInfo && <ClipInfoWindow ... />}`) on both `TimelineClip` and `BucketClip`. This is required, not optional — the component's resolution logic (bucketClipId lookup, `effectiveMetadata` computation, comment query, peak-level decode) previously ran unconditionally on every render for every visible clip on both surfaces, confirmed via direct render-count testing (~80+ resolution calls/sec from an idle MediaBucket view alone before the fix). `autoOpenInfo` is safe with mount-gating — it calls `setShowInfo(true)`, which mounts the component on demand rather than requiring it to be pre-mounted.

**`focusNotes` prop:**
Both `BucketClip` and `TimelineClip` have a `focusNotes` state that is set to `true` when "Add Note" is selected from the context menu and reset to `false` when the dialog closes. `ClipInfoWindow` receives this as a prop and triggers `setTimeout(() => noteInputRef.current?.focus(), 150)` inside `useEffect([open, focusNotes])`.

**Comment CRUD with threading:**
- `GET /api/clips/:clipId/comments` — fetched by `useQuery(["clip-comments", effectiveId])` with `enabled: open`; returns `ClipCommentWithReplies[]`
- `POST /api/clips/:clipId/comments` — `{ text, parentId? }` (author is resolved server-side; never sent)
- `PATCH /api/clip-comments/:id` — inline edit (author-only)
- `DELETE /api/clip-comments/:id` — server deletes replies first, then the parent (author-only)

Edit/delete controls render only on the current user's own comments (`isOwnComment`, case-insensitive).

**Comment targets (`target` prop):** `{ kind: 'clip' | 'loose', id }` picks the thread. `'loose'` uses `/api/loose-files/:id/comments` and `/api/loose-file-comments/:id`, query key `['loose-file-comments', id]`, and invalidates `looseFileKeys.all()` + `bucketKeys.bucket(songId)` (the row badge counts ride on the lists). Omitted → clip, as before.

**`metadataWriter` prop:** `(merged, updates)`. Clips fall back to `PATCH /api/clips/:id` (full object); loose files pass one from `useLooseFileInfoWindow` that sends only `updates` to `PATCH /api/loose-files/:id/metadata`. A passed writer that throws gets the field rolled back + a toast; with no writer the fields render read-only (`InfoStat`).

**Loose files — one window per surface:** `useLooseFileInfoWindow()` + `LooseFileInfoProvider` (`LooseFileRow.tsx`), mounted in `MediaBucket` and `Dashboard`. `LooseFileContextMenu` (More Info / Add Note / Add to Timeline / Delete) reads `open` from context. "Add to Timeline" shows only under a `LooseFilePlacementProvider` (mounted by Timeline, so Workspace only); it opens Timeline's Place on Timeline dialog, pre-selecting the file's shelf track. The window lives at the surface root, never inside a row — a dialog portaled from inside a row still bubbles React click/pointer events into the row's `onClick` and dnd-kit listeners. Opening it marks the notes read.

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
- `canvasRef` — `HTMLCanvasElement | null`. The canvas is `position: absolute; top: 0; left: 0; width: 100%; height: 100%` with `zIndex: 2` — above the clip's track-tinted body background, below the `z-10` label and `z-20` trim handles.
- `decodedBufferRef` — `AudioBuffer | null`. Populated once after the first fetch+decode. All subsequent redraws (trim, zoom) read from this ref — no re-fetch or re-decode.
- `drawRef` — `(() => void) | null`. Reassigned in the component body on every render, so it always closes over the current `trimStart`, `trimEnd`, and `clip.duration`. The `ResizeObserver` and trim `useEffect` both call `drawRef.current?.()` with no stale-closure risk.

**Three effects:**
1. **Decode effect** `[clip.src, isOverlay]` — fetches the audio file, decodes via `AudioContext.decodeAudioData()` (channel 0 only), stores the buffer in `decodedBufferRef`, then calls `drawRef.current?.()`. Skipped for overlay clips. Fails silently. Cancellation flag prevents stale writes after unmount.
2. **Trim redraw effect** `[trimStart, trimEnd, clip.duration, trackColor]` — calls `drawRef.current?.()`. Buffer is already cached; redraw is a pure canvas operation. Also redraws when the track color changes.
3. **Resize effect** `[]` — attaches a `ResizeObserver` to the canvas and calls `drawRef.current?.()` on every size change (fires on zoom-in/out since the clip container width tracks `displayWidth`).

**Draw function (`drawRef.current`):**
- Reads `canvas.offsetWidth` / `canvas.offsetHeight` for current CSS pixel dimensions.
- Applies device pixel ratio: `canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr)` — renders at physical pixel resolution, displays at CSS size.
- Slices `buffer.getChannelData(0)` to the played region from `playedSpan` (trim plus a pickup's head cut): `[inPoint * sampleRate, outPoint * sampleRate)`.
- Iterates one column per CSS pixel, finds min/max sample in each slice, draws a vertical `fillRect` centered at `midY`. Minimum bar height: 1px (for silence).
- Color: the track color, read back resolved via `getComputedStyle(canvas).color` (the canvas element's CSS `color` is `trackColor`; canvas `fillStyle` can't resolve `var()`), at canvas CSS opacity 0.5. See "Timeline clip look" in root `CLAUDE.md`.

**`isOverlay` guard:** The decode effect returns early for overlay (drag ghost) clips. No waveform fetch is initiated during drag.

**Do not** add waveform rendering to `BucketClip` — bucket clips use hover audio preview instead (see Audio hover preview section).

### Timeline background right-click context menu

Currently has three surfaces (timeline clips have their own menu in `Clip.tsx`):

- **Background right-click** — "Clear Timeline" action. A hand-built popup, not a Radix menu: extend via the `contextMenuPos` state + the fixed-position `<div>` near the bottom of `Timeline.tsx`'s return. It still holds only Clear Timeline.
- **Track header right-click** — "Remove Track" action in `Track.tsx`, wrapped in an `AlertDialog` for confirmation. The `onDeleteTrack` callback prop flows from `Timeline.tsx` → `TimelineTrack` → confirmation → API call + local state removal + bucket query invalidation.
- **Section header / section-end handle right-click** — the section menu ("Fit to Content"), a Radix menu separate from the Clear Timeline popup. See "Section menu (header right-click)" above.

The track header and section menus use the shadcn `ContextMenu` component (`@/components/ui/context-menu`). When adding new track-level actions, extend the `ContextMenuContent` in `Track.tsx`; new section actions go in `SectionMenuContent` (`Timeline.tsx`); new global timeline actions go in the Clear Timeline popup.

**`handleTimelineContextMenu` guards** (the timeline container's `onContextMenu`), in order:
1. `e.defaultPrevented` — bail (a Radix menu trigger inside already handled it: the section menu on headers and section-end handles, and right-clicks inside the section menu's own content). Before 4g3 a right-click on the section-end handle also opened Clear Timeline.
2. `target.closest('.cursor-grab')` — bail (clips, section headers, playhead flag); the browser's own menu is not suppressed here.
3. `e.clientX - containerRect.left < 256` — bail (the track panel).
Otherwise `preventDefault()` and open the Clear Timeline popup at the pointer.

**Smart "Clear Timeline" — server-driven branching dialog:**

Clicking "Clear Timeline" in the background context menu triggers a `GET /api/songs/:songId/timeline-has-finals` call before showing any dialog. The result drives which dialog appears:

- **No finals on the timeline** (`hasFinals: false`) → simple dialog: Cancel / Clear Timeline (destructive). Same as the old behavior — clears local state and fires individual `DELETE /api/timeline-clips/:id` for each clip.
- **Finals exist** (`hasFinals: true`) → enhanced dialog: Cancel / Leave Final Clips / Clear All.
  - **Clear All** — same as the simple path; deletes everything.
  - **Leave Final Clips** — fires `DELETE /api/songs/:songId/timeline-clips/non-final` (fire-and-forget), closes the dialog immediately, then calls `queryClient.invalidateQueries` for the timeline key. No manual local state update — the live sync picks up the server result when the query refetches.

**`deleteNonFinalTimelineClips` (server):**
One transaction: deletes the non-final clips on the song's active tracks (they leave gaps; the finals keep their offsets, nothing is re-packed), and writes each remaining sectioned clip's `start` cache from `computeSongLayout`. A final full take is never moved; `song_sections` is never touched. See "Timeline layout and arrangement order" in root `CLAUDE.md`.

`clearDialogState` in `Timeline.tsx` is a string union `'none' | 'checking' | 'simple' | 'enhanced'` (replaced the old `showClearConfirm: boolean`). The `'checking'` state covers the async server round-trip before the dialog appears.

### Timeline clip right-click — "Show in File Browser"

Right-clicking a timeline clip shows a "Show in File Browser" menu item (icon: `FolderSearch`). Clicking it dispatches a `find-in-bucket` CustomEvent with `{ trackId, sectionName, clipName }`, which causes `MediaBucket` to navigate its three-column browser to the matching instrument → section → versions view.

**`trackId` prop threading:**
`TimelineClip` receives `trackId` as an optional prop (`ClipProps.trackId?: string`). `TimelineTrack` passes `trackId={track.id}` straight to each `TimelineClip` (clips are drawn at row level; `SectionCell` takes no clip props).

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

**Place on Timeline picker (a loose file's "Add to Timeline" menu item):** the Section list shows only the chosen track's active, non-Full-Take sections; a track switch clears an invalid section. Failures show a destructive toast (the dialog closes before the server answers). A loose-file **drop** never opens this picker; it uses the confirm dialog or the new-section dialog (see "Media Bucket file drags").

**Placed loose file in the Media Bucket (`flashBucketDestination` in `Timeline.tsx`):** after a successful placement (drop or picker) the bucket shows where the file went with the landing flash's gold, never changing its selection: the new version card when its section is the one open in the Files column (a `requestLandingFlash` with a 3 s wait; that column scrolls the minimum to show it, smooth, instant under reduced motion), otherwise the destination Track row and, for the open track, its Section row, only if visible, with no scrolling. Rows are found by their drop ids (`springRowAttrs`). It no longer jumps to the file.

Context-menu "Add to Timeline" fires a styled toast and scrolls the newly placed clip into view with a gold landing flash. Place on Timeline (the loose-file picker from the menu) flashes the placed clip the same way, no toast. Version and loose-file drops onto the timeline glow too once their save succeeds, no toast; a placed loose file is also shown in the Media Bucket (`flashBucketDestination`, see "Landing flash" in root `CLAUDE.md`). Timeline clip drags (moving a clip already on the timeline) don't flash.

**Gold outer glow (`TimelineClip` in `Clip.tsx`):**
The shared landing flash (see "Landing flash" in root `CLAUDE.md`): `flashGold(clipContainerRef.current, { look: 'outerGlow', peakAlpha: TIMELINE_LANDING_GLOW_ALPHA, reducedMotion: 'ring' })` — a 2px gold ring plus soft glow OUTSIDE the clip's edge, animated as `box-shadow` on the container. Never a tint: Drums clips are gold. Under `prefers-reduced-motion`, a static gold outline just outside the edge for ~1.5s. While `isFlash` is set the clip's `zIndex` goes 1 → 2 (above neighbouring clips). Clips are drawn at row level, so no section cell clips the glow. **Do not use `ring-*` classes on timeline clips** — `overflow-hidden` on the clip container clips inline box-shadows (rings) to a sliver on one edge.

**Flash plumbing:**
- `insertClipInSection` and the drop paths use a client `nanoid()` id, the same value POSTed to the server (a confirmed drop's clip is already on screen under it); the Place on Timeline picker's `onSuccess` uses the server's `timelineClip.id`, which mounts with `isFlash` already set once live sync merges it
- `flashClipId: string | null` state lives in `Timeline`; a `flashTimerRef` clears it after 1800ms
- Threaded as props: `Timeline (flashClipId)` → `TimelineTrack (flashClipId?)` → `TimelineClip (isFlash = flashClipId === clip.id)`
- A `useEffect([isFlash])` in `TimelineClip` calls `clipContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })` and then `flashGold` when `isFlash` becomes true; `combinedRef` satisfies both dnd-kit's `setNodeRef` and the local `clipContainerRef`

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
const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom * factor));
```
- Multiplicative, not additive — `Math.exp` maps the signed accumulated `deltaY` to a ratio applied to the current zoom
- Positive `deltaY` (pinch-close / Ctrl+scroll-down) → `factor < 1` → zoom out; negative → zoom in
- Bounds come from `MIN_ZOOM`/`MAX_ZOOM` (10–300) in `client/src/lib/timeline-zoom.ts`, shared with the `DawScrollbar.tsx` handles and both zoom restore paths (`parseSavedZoom` clamps a saved value into range; `DEFAULT_ZOOM` 80)
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

- Playhead line lives INSIDE the scroller content at left = playheadPx (`256 + playheadTimeSecs
  * zoom`, content coordinates). Never position it with scrollLeft math or toggle it from scroll events: Safari
  throttles scroll events during momentum/rubber-band (sparse deltas, negative scrollLeft) while
  the compositor moves content every frame — JS cannot keep up, by construction.
- The draggable flag is a separate element inside the sticky flag band (band z-35 by default —
  see the dynamic-stacking entry below — so the flag, which overflows the 6px band, paints over
  the z-30 ruler). Line and flag both read playheadPx.
- **Playhead flag/panel stacking is dynamic, not a static z-map entry (updated 2026-08-12).** The
  playhead is two independently-positioned elements sharing one source value, `playheadPx = 256 +
  playheadTimeSecs * zoom` (256 = `TRACK_PANEL_WIDTH`): the full-height line (z-40, `left:
  playheadPx`, `translateX(-50%)`) and the flag/marker (`left: playheadPx`, same
  `translateX(-50%)`, no clamp). Both now derive position identically — a prior clamp on the
  flag's `left` (`Math.max(playheadPx, TRACK_PANEL_WIDTH + 6.5)`) that kept it fully clear of the
  sticky instruments panel at low timecodes has been removed; the flag's point now stays
  pixel-aligned with the line at all times, including t=0, at the cost of the flag's body
  legitimately overhanging left onto the panel near t=0.

  To keep that overhang visible (not hidden behind the panel's opaque background) without
  breaking the case where the playhead is scrolled fully off-screen to the left (where the panel
  must still occlude it), the flag-band's z-index is now computed per render rather than static:
  ```ts
  const flagAbovePanel = playheadPx - scrollLeft >= TRACK_PANEL_WIDTH;
  // flag-band zIndex: 51 when flagAbovePanel, 35 otherwise
  ```
  51 sits above the panel's z-50 spacer (fully visible overhang); 35 is the original resting
  layer (correctly hidden when scrolled away). A scroll listener (`flagAbovePanelRef`) forces a
  re-render on pure-scroll boundary crossings, since playhead-position state alone doesn't change
  in that case.

  **Gotcha:** this z-index is applied to the whole sticky flag-band container, not just the flag
  element inside it — raising only the child would leave it trapped under the band's own
  stacking context (see the WebKit sticky-stacking-context rule below). Don't try to z-index the
  flag div directly.
- WEBKIT LAW: position:sticky creates a stacking context even at z-index auto. Occluders must BE
  the sticky element (z on the leaf, plain non-sticky/z-auto/transform-free ancestors up to the
  scroll content root) — never a child of a sticky band root. Band spacers are content-root
  siblings overlaying their bands via negative margins.
- Z-map (leaves only; all containers z-auto — read as the default/resting order; the flag-band is
  the one exception that toggles between two z values based on scroll position, per the
  dynamic-stacking entry above): panel spacers/cells 50 > playhead line 40 > flag band 35 >
  ruler & section bands 30 (fully opaque) > resize strip 25.
- The top-edge pane-resize strip must stay BELOW the flag band and the flag opts into pointer
  events (band is pointer-events-none, flag pointer-events-auto) — the strip intercepted all
  scrub input for multiple debugging rounds before DevTools inspection caught it.
- Debugging discipline proven repeatedly: if a fix produces IDENTICAL symptoms, the causal model
  is wrong — stop patching; instrument (console logs) or inspect the live DOM (DevTools element
  picker). Source-reading cannot see browser-specific behavior or hit-testing.

### Playhead edge-scroll drag — architecture and constants

**Canonical time-value rule:** the playhead's time position must always be derived from a single formula — pointer screen position combined with current `scrollLeft` — computed fresh on every `pointermove` event and every `rAF` frame. Never write to the time value independently from two different code paths; this was the root cause of a full day of edge-scroll bugs (dead zones, release snaps, mid-drag jumps) before the rebuild. The edge-scroll auto-scroll loop's only job is to advance `scrollLeft`; it must never write time directly.

**Zone hysteresis (prevents flicker):** edge-scroll activation uses two thresholds, not one, so pointer jitter right at a boundary can't flip the zone on/off/on repeatedly:
- `EDGE_ZONE_PX` (150) — pointer must come within this distance of the true edge for the zone to activate.
- `EDGE_ZONE_RELEASE_PX` (210) — pointer must move back out past this wider distance for the zone to deactivate. The gap between the two absorbs normal hand jitter.

**Minimum drag-distance gate:** `MIN_DRAG_DISTANCE_PX` (72) requires cumulative pointer displacement from the pointerdown origin (via `Math.hypot`, so diagonal movement counts) before initial zone engagement is allowed. Without this, a static click-and-hold with the flag already positioned inside the edge zone would engage auto-scroll on the very first sub-pixel jitter — no real mouse or trackpad holds literally zero pixels of movement. This constant only gates the OFF→ON transition; once engaged, it plays no further role.

**Known geometric tradeoff:** if the flag is re-grabbed at a starting position closer to the edge than `MIN_DRAG_DISTANCE_PX`, a natural drag further toward the edge can require the cursor to briefly cross onto the instrument panel (negative `leftDist`) before the cumulative-displacement gate is satisfied. This is unavoidable geometry given the mechanism, not a bug — the "danger zone" for this shrinks proportionally as `MIN_DRAG_DISTANCE_PX` is lowered, but can't be fully eliminated without a structural change (e.g., clamping the phantom cursor position at the panel boundary). Considered low-priority; only affects re-grabbing very close to an edge.

**Right-edge centering cap:** when auto-scroll reaches the right edge, `scrollLeft` stops such that the final clip's end sits at the horizontal center of the *visible track area* — i.e., `256 + (clientWidth - TRACK_PANEL_WIDTH) / 2` — not the center of the full container. Using `clientWidth / 2` alone lands 128px (half of `TRACK_PANEL_WIDTH`) short of true visual center, since the instrument panel eats real screen space on the left that isn't part of the timeline.

**Reversal-pause mechanism:** while auto-scroll is engaged, a sample-to-sample comparison (not a distance threshold) checks whether the pointer's distance-from-edge increased or decreased since the last event. Any increase (even 1px) pauses auto-scroll on that same event; any decrease resumes it. This has no delay and no minimum threshold — deliberately, to stop a reversal as promptly as possible.

**Known UX friction (open, not yet addressed):** because the reversal-pause check has zero threshold, real trackpad input's involuntary micro-movements (which a user doesn't consciously make, but the OS's tracking/acceleration curve still registers) can be misread as an intentional reversal, pausing auto-scroll unexpectedly. This is two individually-correct behaviors interacting badly, not a bug in either one. Likely fix direction if revisited: add a small deadband specifically to the reversal-pause check (distinct from `MIN_DRAG_DISTANCE_PX`, which only gates initial engagement, not continued tracking) so trivial jitter doesn't register as a reversal once already engaged.

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

### Production Tracker — row order

Section rows sort by the lowest `ideas.sortOrder` any active track gives that section (stable sort, so ties keep first-appearance order), never by the first track's order — a section hidden on the first track must not drop to the bottom.

### Production Tracker — due-date field

Native `<input type="date">` with `[color-scheme:dark]` so Chrome's calendar icon shows on the dark field. No click handler: `showPicker()` on click blocked typing in Chrome.

### Production Tracker — Add/Remove Section & Instrument

Restored in commit `9ed4001` (regression introduced in `2924252` during the mock-data → real-API rewrite).

**Entry point — corner cell:** A single always-visible `+ Add` button in the sticky corner cell opens a "Create New…"-style chooser modal (two cards: Section · Instrument). Selecting a card closes the chooser and opens the existing `AddSectionModal` or `AddInstrumentModal` — no new mutation logic, only new trigger UI. Corner cell: outer sticky div keeps `bg-[#0c0c0e]` (opaque, prevents scroll-content bleed through the semi-transparent inner pill); inner pill carries `bg-primary/10 + border-primary/35 + rounded-md`, stepping up on hover. Full cell is the click target; no `transform`/`filter` on the sticky element so Safari stacking-context rules remain intact.

**Add Section** — `useAddSection(songId, bucket)` → `POST /api/songs/:songId/sections`, a single atomic server-side call that creates one idea row per active track in a transaction. Server computes `sortOrder` once, shared across all tracks (not per-track). Section names must be unique per song, active or hidden, no exceptions — enforced by a `UNIQUE(track_id, section_name)` index on `ideas` (schema.ts) plus a server-side pre-check. Duplicate attempts return 409, distinguishing an active conflict ("already exists") from a hidden conflict ("exists but hidden — restore it"), mirroring the instrument-duplicate pattern. Restore scope matches remove scope: MediaBucket (and the Library Songs browser) restore one track via `POST /api/ideas/:ideaId/restore` (`useRestoreSection`); Production Tracker restores song-wide via `POST /api/songs/:songId/sections/restore` (`useRestoreSectionSongWide`). See "Section hide and restore" in root `CLAUDE.md`.

**Add Instrument** — `useAddInstrument(songId)` → `POST /api/songs/:songId/tracks`. Duplicate-name guard + hidden-track restore dropdown. Already invalidates `['production-tasks', songId]` (this invalidation was added to the hook in an earlier session).

**Remove Section (right-click row label)** — hides the section **song-wide across ALL instrument tracks** in one call, `POST /api/songs/:songId/sections/hide` (one `section-hidden` feed row for the action). **This is intentionally different from MediaBucket's per-instrument hide** (right-clicking a section there hides it for one instrument only). Restore available via Add Section → restore dropdown, which lists every section hidden on ANY active track (`GET /api/songs/:songId/hidden-sections`) and restores it song-wide. A section hidden for one track renders as a disabled cell (see `production_tasks` in root `CLAUDE.md`).

**Remove Instrument (right-click column header)** — `AlertDialog` confirmation, then `useDeleteTrack(songId)` → `DELETE /api/tracks/:trackId`. Mirrors Timeline's existing Remove Instrument right-click pattern. Restore available via Add Instrument → restore dropdown.

## Clip trim visual redesign (Clip.tsx)
- Trim handles are no longer rendered as visible elements. Trim is triggered by cursor proximity: `onPointerDown` within 8px of a clip's left or right edge (checked via `getBoundingClientRect()` at press time) starts the existing `handleLeftTrimDrag`/`handleRightTrimDrag` flow unchanged; `onMouseMove` sets `trimEdge` state (`'left' | 'right' | null`) which drives `cursor: ew-resize` via `positionStyle` inline style (overrides Tailwind `cursor-grab`).
- Hover shows a grey inset glow via a separate `pointer-events-none absolute inset-0 z-20` child div rendered after the waveform canvas — `boxShadow: 'inset 0 0 0 2px rgba(180,180,180,0.7), inset 0 0 14px rgba(180,180,180,0.15)'` (grey, not gold — see the hover glow passage above). Never a `boxShadow` on the container itself: `flashGold` animates the root's box-shadow, and the root paints nothing itself (see "Timeline clip look" in root `CLAUDE.md`). Absent on DragOverlay ghost (`isOverlay` condition).
- **Gotcha:** dnd-kit's `listeners.onPointerDown` must be extracted into a variable (`dndOnPointerDown`) and called explicitly in the non-trim branch — placing a custom `onPointerDown` after `{...listeners}` in JSX silently overrides dnd-kit's handler and breaks drag. `restListeners` (listeners minus `onPointerDown`) is spread instead.

## Platform and browser gotchas

- A `stopPropagation()` added to block dnd-kit drag-on-click must gate to the left button only (`e.button !== 2`) — otherwise it silently blocks other open context menus from dismissing on right-click.
- dnd-kit's `tabIndex={0}` side effect + Radix returning focus on Escape causes a stray focus-visible outline unless the trigger has `focus-visible:outline-none` (same fix as `TimelineClip`, now also on `BucketClip`).
- **dnd-kit's `isOver` reflects pure geometric hover — it does not know about a droppable's `disabled` state.** Any highlight on a conditionally-disabled droppable must check `isOver && !disabledCondition` explicitly (e.g. the Tracks-column background: `isOver && !isTracksBackgroundDisabled`).
- **`matchOrganizeDropTarget` (`client/src/hooks/use-loose-file-organize-dnd.ts`): column backgrounds are fallback-only.** Both the Tracks- and Sections-column backgrounds (`bucket-tracks-bg||`, `bucket-sections-bg||`) nest other targets (Track rows / Section rows); a background hit is remembered and returned only if nothing more specific matched. Any new nesting target must join `isBackgroundDropId`.
- **Own-track loose-file drops cancel in `handleDragEnd`** (Track row or Sections background with `originTrackId === destTrackId`): no mutation, toast, or `onOrganized`. For a version the same drop is a real move (Move C/D: section → its track's shelf). The own Track row stays an ENABLED droppable — dnd-kit drops disabled droppables from collision detection, so disabling it lets the drop fall through to the Tracks background and un-assign. Highlights for both are gated off by `organizeDropRules` (`trackRow` / `sectionsBackground`).
- **Drop targets get the active drag from `useActiveOrganizeDrag` (`useDndMonitor`), not `useDndContext`** — `useDndContext` changes on every pointer move; the monitor only fires on start/end/cancel, so rows re-render twice per drag. MediaBucket calls it once and passes it to every row.
- **Workspace mounts at most one `DragOverlay`** — `LooseFileDragOverlay` for loose-file and version drags; a timeline clip drag has none (the clip floats in its row). dnd-kit draws an overlay's wrapper during any drag, even with no children, so two mounted overlays left an invisible box under the cursor. The drag type is known in the same batched update as the drag start, so the overlay is in place on the first frame.
- **Timeline's `DndContext` needs `onDragCancel`** — Escape (and window blur, via a dispatched `visibilitychange`) cancels a pointer drag; `handleDragCancel` clears `activeDragData`, the clip/file drag state, the edge scrollers and the drag pointer, and releases the poll hold.

---

