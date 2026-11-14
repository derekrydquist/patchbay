import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient, useMutation, useIsMutating } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  DndContext,
  DragStartEvent,
  DragEndEvent,
  CollisionDetection,
  MeasuringStrategy,
  useSensor,
  useSensors,
  useDraggable,
  PointerSensor,
  TouchSensor,
  MouseSensor,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { cn, trapDialogTab } from '@/lib/utils';
import { Track, Clip, MOCK_SONG } from '@/lib/daw-data';
import { bucketKeys, looseFileKeys, fetchBucket, fetchSongSections, songSectionsKey, type SongSectionRow, type ApiTrack as ApiBucketTrack, type ApiLooseFile } from '@/lib/bucket-api';
import { LooseFilePlacementProvider } from './LooseFileRow';
import { useLiveClipCommentSummary } from './Clip';
import { usePlaceLooseFileOnTimeline } from '@/hooks/use-bucket-mutations';
import {
  useLooseFileOrganizeDnd,
  isBucketOrganizeDropId,
  matchOrganizeDropTarget,
  reportLooseFileDrop,
  resolveDeferredLooseFileDrop,
  BUCKET_CLIP_DRAG_TYPE,
  bucketSectionDropId,
  bucketTrackDropId,
  useVersionMoveDnd,
  VersionMoveOutContext,
} from '@/hooks/use-loose-file-organize-dnd';
import { apiRequest } from '@/lib/queryClient';
import { requestLandingFlash, clipLandingZone, flashGold, isVisibleInOwnScroller, LANDING_FLASH_PEAK_ALPHA } from '@/hooks/use-landing-flash';
import { trackDisplayColor } from '@/lib/track-color';
import { VersionMoveInUseDialog } from './ClipInUseDialog';
import { LooseFileDragOverlay, CURSOR_GAP_PX } from './LooseFileDragOverlay';
import { TimelineTrack, SectionInfo, type TrackTrimLimits } from './Track';
import { nanoid } from 'nanoid';
import { Ruler } from './Ruler';
import { DEFAULT_BPM, snapGridSeconds, parseTimeSignature, secondsPerBeat } from '@/lib/musical-time';
import { layoutTimeline, sectionAt, effectiveLength, contentNeedBeats, type TimelineLayout } from '@shared/timelineLayout';
import { sectionEndRange, nearestSectionEndStop, baseLengthForEnd, sectionEndReadout, sectionEndRelease, type SectionEndRange } from '@shared/sectionBaseLength';
import { playedSpan, hasPlayedLength } from '@/lib/clip-span';
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, parseSavedZoom } from '@/lib/timeline-zoom';
import { placeDraggedClip, computeFileDropPlacement, toPlacementClip, appendOffset, pickupLeftLimit, nextPickupStop, clipDragMinOffset, placementChanged, startPickupDrag, pickupAllowed, afterPickupPlacement, PLACEMENT_EPSILON, type PickupDragState } from '@shared/timelinePlacement';
import { SnapControls, readSnapSetting, writeSnapSetting, type SnapSetting } from './SnapControls';
import { moveSection, placeFirstClipSection, type SectionPlacementHint } from '@shared/sectionOrder';
import { headerDropTarget, type HeaderDropTarget } from '@/lib/section-drag';
import { DawScrollbar } from './DawScrollbar';
import { isColumnScrollElement } from '@/hooks/use-column-edge-scroll';
import { createEdgeScroller, type EdgeScroller, SCROLL_SPEED_PX, EDGE_ZONE_PX, EDGE_ZONE_RELEASE_PX, MIN_DRAG_DISTANCE_PX } from '@/lib/edge-scroller';
import { MediaBucket } from './MediaBucket';
import { CheckCircle2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { confirmDialogTop } from '@/lib/confirm-dialog-position';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const TRACK_PANEL_WIDTH = 256;

const KEYBOARD_NAV_OVERSCROLL_PX = 80; // extra px past the clip edge when keyboard nav triggers a scroll
// Ticks per quarter-note beat for each metronome subdivision setting.
const METRONOME_SUBDIVISION_FACTORS: Record<string, number> = { '1/4': 1, '1/8': 2, '1/16': 4 };

type ApiTrack = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  sortOrder: number;
  songId: string;
  volume: number;
  pan: number;
  timelineClips: {
    id: string;
    name: string;
    type: string;
    color: string;
    start: number;
    duration: number;
    src: string | null;
    sectionName: string | null;
    isFinal: boolean;
    isFullTake?: boolean;
    trimStart: number;
    trimEnd: number | null;
    bucketClipId: string | null;
    sectionOffset: number | null;
  }[];
};

const EMPTY_SECTIONS: SongSectionRow[] = [];
// A track with no sectioned clips: no trim limits.
const NO_TRIM_LIMITS: TrackTrimLimits = { pickupLimits: new Map(), pickupStops: new Map() };

function sameNumberMap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of Array.from(a)) if (b.get(k) !== v) return false;
  return true;
}

// dnd-kit sensor options, as constants: useSensor memoizes on its options object, so
// options written inline made new sensors on every Timeline render — new activators,
// a new dnd-kit internal context, and every useDraggable / useDroppable (every
// timeline clip, the Media Bucket's drop targets) re-rendered whenever Timeline did.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 250, tolerance: 5 } };

type ApiTimelineClip = ApiTrack['timelineClips'][number];

// Audible length of a clip: trimmed, never the raw file length.
function clipLength(c: Pick<Clip, 'duration' | 'trimStart' | 'trimEnd'>): number {
  return (c.trimEnd ?? c.duration) - (c.trimStart ?? 0);
}

// The timeline's section layout (shared/timelineLayout.ts) for a set of tracks. Every
// position on the timeline comes from this: section starts and widths, the end of the
// timeline, and each clip's start (its home section's start + sectionOffset; a full
// take keeps its stored start). The component derives it once per render (the
// `layout` memo); write paths that need a new clip's start call it on the tracks they
// are about to save.
function deriveLayout(
  tracks: Track[],
  sections: SongSectionRow[],
  bpm: number,
  timeSignature: string,
): TimelineLayout {
  return layoutTimeline({
    sections,
    clips: tracks.flatMap((t) => t.clips.map((c) => ({
      id: c.id,
      trackId: t.id,
      sectionName: c.sectionName,
      sectionOffset: c.sectionOffset ?? null,
      duration: c.duration,
      trimStart: c.trimStart ?? 0,
      trimEnd: c.trimEnd ?? null,
      isFullTake: !!c.isFullTake,
      start: c.start,
    }))),
    bpm,
    timeSignature,
  });
}

// Tracks with every clip's in-memory start and head cut taken from the layout, so code
// that reads clip.start (playback, keyboard nav, skip, Track.tsx) sees layout positions.
// clip.start is the cut start; its in-point and length come from playedSpan
// (lib/clip-span.ts), which counts the head cut. Always overwrites headCut, so a value
// copied back into the tracks state by a write path never survives a layout.
function positionTracks(tracks: Track[], layout: TimelineLayout): Track[] {
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => withLayoutPosition(clip, layout)),
  }));
}

// One clip at its layout start and head cut; the same object when neither changes.
function withLayoutPosition(clip: Clip, layout: TimelineLayout): Clip {
  const start = layout.clipStarts.get(clip.id) ?? clip.start;
  const headCut = layout.clipHeadCuts.get(clip.id) ?? 0;
  return start === clip.start && headCut === (clip.headCut ?? 0) ? clip : { ...clip, start, headCut };
}

// Whether a timeline clip is a pickup: it starts before its section's downbeat.
function isPickupClip(c: Pick<Clip, 'sectionOffset' | 'isFullTake'>): boolean {
  return !c.isFullTake && (c.sectionOffset ?? 0) < -PLACEMENT_EPSILON;
}

// A section header drag as PUT /api/songs/:songId/sections/order sends it: the
// dragged section and the visible timeline sections it now sits in front of (before)
// and behind (after).
interface SectionMove { section: string; before: string | null; after: string | null }

// The song_sections rows after a section move — the same rule the server applies
// (moveSection, then every row renumbered 0…n−1), so the cache matches the server
// before it answers.
function applySectionMove(sections: SongSectionRow[], move: SectionMove): SongSectionRow[] {
  const byName = new Map(sections.map((s) => [s.name, s]));
  const ordered = [...sections].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.name);
  return moveSection(ordered, move.section, move.before, move.after)
    .map((name, i) => ({ ...byName.get(name)!, sortOrder: i }));
}

// Saves many clips' sectionOffset in one request (PUT /api/songs/:songId/timeline-
// clips/offsets): one transaction on the server, which refuses the whole save (409) if
// it would leave two clips overlapping. Only sectionOffset is sent (the server never
// takes start from the client); the server logs one sort-only timeline-reordered row.
// Rejects with the server's message on any non-2xx answer.
async function saveClipOffsets(songId: string, clips: { id: string; sectionOffset: number }[]): Promise<void> {
  const res = await fetch(`/api/songs/${songId}/timeline-clips/offsets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clips }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Saving clip positions failed (${res.status})`);
  }
}

// A client clip in the shape the shared placement helpers take (trim defaults filled).
function placementInput(c: Clip) {
  return { id: c.id, sectionOffset: c.sectionOffset ?? null, duration: c.duration, trimStart: c.trimStart ?? 0, trimEnd: c.trimEnd ?? null };
}

// A track's clips in timeline order — by sectionOffset, stably, the same order
// serverClipsToClips gives, so the array follows the offsets after a clip is placed freely.
function sortClipsByOffset(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => (a.sectionOffset ?? 0) - (b.sectionOffset ?? 0));
}

// One track's clips from the server. sectionOffset is the server's; within a section,
// clips are ordered by it (stable, so equal offsets keep the server's order). Stored
// start is copied but only full takes read it — the layout positions everything else.
function serverClipsToClips(apiClips: ApiTimelineClip[]): Clip[] {
  return [...apiClips]
    .sort((a, b) => (a.sectionOffset ?? 0) - (b.sectionOffset ?? 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type as Clip['type'],
      color: c.color,
      start: c.start,
      duration: c.duration,
      src: c.src ?? undefined,
      sectionName: c.sectionName ?? undefined,
      isFinal: c.isFinal ?? false,
      isFullTake: c.isFullTake ?? false,
      trimStart: c.trimStart ?? 0,
      trimEnd: c.trimEnd ?? null,
      bucketClipId: c.bucketClipId ?? undefined,
      sectionOffset: c.sectionOffset ?? null,
    }));
}

function apiTrackToTrack(t: ApiTrack): Track {
  return {
    id: t.id,
    name: t.name,
    type: t.type as Track['type'],
    volume: t.volume ?? 100,
    pan: t.pan ?? 0,
    muted: false,
    solo: false,
    color: t.color ?? 'hsl(var(--chart-1))',
    clips: serverClipsToClips(t.timelineClips),
  };
}

// Whether the pointer is inside MediaBucket's on-screen bounds (its root carries
// data-media-bucket). Read live on every collision pass — the bucket pane can be
// resized, and this must follow the pointer, never the drag overlay's rect.
function isPointerInMediaBucket(x: number, y: number): boolean {
  const el = document.querySelector('[data-media-bucket]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// Custom collision detection: track rows match by vertical overlap only — any X position on
// the row resolves to that track.
//
// While the pointer is over MediaBucket, only the bucket's own targets can match. Track rows
// match on Y alone and their rects stay measured when scrolled out of view, so without this a
// release on MediaBucket's blank space could match a timeline track row hidden behind it and
// place the clip on the timeline.
//
// A Media Bucket version drag (isVersionDrop — not a legacy full take) is dropped by the
// pointer, never by `over` (handleDragEnd): only the bucket's own targets ever match for
// it, and only while the pointer is over the bucket. A bucket row scrolled out of its
// column still has a rect, and when the bucket pane is short that rect can sit under the
// timeline — it matched there, sprang open and took the drop.
const makeTrackFirstCollision = (isVersionDrop: () => boolean): CollisionDetection => ({ droppableContainers, droppableRects, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  const { x, y } = pointerCoordinates;

  if (isPointerInMediaBucket(x, y)) {
    const bucketMatch = matchOrganizeDropTarget(droppableContainers, droppableRects, x, y);
    return bucketMatch ? [bucketMatch] : [];
  }
  if (isVersionDrop()) return [];

  // First pass — MediaBucket organize drop targets (Section row, Versions column),
  // live bounds check. These are narrow rows/panels in a side column, not full-width
  // bands, so the vertical-band-only heuristic below would wrongly match any X
  // position at the same row height (e.g. hovering over an unrelated column). Shared
  // with Dashboard's Ideas shelf / Songs quick-browser via use-loose-file-organize-dnd.
  const organizeMatch = matchOrganizeDropTarget(droppableContainers, droppableRects, x, y);
  if (organizeMatch) return [organizeMatch];

  // Second pass — track rows, vertical band only (X is irrelevant).
  for (const container of droppableContainers) {
    if (isBucketOrganizeDropId(container.id)) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    if (y >= rect.top && y <= rect.bottom) {
      return [{ id: container.id }];
    }
  }

  return [];
};

// Draggable section header label — used inside the section-reorder DndContext.
// id format: sec||${sectionName}
function DraggableSectionHeader({ name, width, isLooped }: { name: string; width: number; isLooped?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `sec||${name}` });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'border-r border-primary/20 flex items-start pt-1 px-2 shrink-0 cursor-grab active:cursor-grabbing select-none transition-opacity',
        isDragging && 'opacity-30',
        isLooped && 'bg-primary/10 border-b-2 border-r-2 border-primary rounded-br-md'
      )}
      style={{ width, minWidth: width }}
    >
      <span className="text-[9px] font-bold text-primary/70 uppercase tracking-widest bg-[#09090b]/80 px-1 rounded backdrop-blur-sm pointer-events-none">
        {name}
      </span>
    </div>
  );
}

// The gold insertion line, centred in its (relatively positioned) parent. Only
// SplitInsertionLine draws it.
function InsertionLine() {
  return (
    <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-primary shadow-[0_0_12px_rgba(212,175,55,0.9)] pointer-events-none" />
  );
}

// Every gold insertion line on the timeline — the new-section line (first-clip drop)
// and the section header drag's destination — is a
// SplitInsertionLine, so they all look the same: one unbroken line from the top of the
// section header row to the bottom of the track rows, never in the ruler. It's drawn
// in two identical parts at the same content X, each portalled into its own layer
// (Timeline's insertion-line layers): one inside the sticky header row, running 1px
// past it to cover its border-b, and one over the track rows. Two parts because the
// header row is sticky and the rows scroll vertically. `left` is in content px
// (including the 256px track panel). pointer-events: none throughout.
interface InsertionLineLayers { header: HTMLDivElement | null; rows: HTMLDivElement | null }
function SplitInsertionLine({ left, layers }: { left: number; layers: InsertionLineLayers }) {
  const part = (
    <div className="absolute top-0 bottom-0 -translate-x-1/2 pointer-events-none" style={{ left, width: 20 }}>
      <InsertionLine />
    </div>
  );
  return (
    <>
      {layers.header && createPortal(part, layers.header)}
      {layers.rows && createPortal(part, layers.rows)}
    </>
  );
}

// Content-root offsets: the 6px flag band and 32px ruler sit above the 24px section
// header row; the 64px track rows start below it.
const RULER_TOP_PX = 6;
const RULER_HEIGHT_PX = 32;
const TRACK_ROWS_TOP_PX = 62;
const TRACK_ROW_HEIGHT_PX = 64;

// Compact name tag that follows the pointer during a section header drag. Portalled to
// <body> with position: fixed, and placed imperatively by the drag pointer source
// (Timeline's positionSectionDragTag), so following the pointer never re-renders the
// timeline. Hidden until it has been placed once.
// The dark veil a timeline clip drag puts over everything but its focus range: two
// boxes, one left of litLeft and one right of litRight (content px), never catching the
// pointer. Used twice — in the track rows and in the section header row.
function ClipDragFocusVeil({ litLeft, litRight, top, height, zIndex }: {
  litLeft: number;
  litRight: number;
  top: number;
  height: number | string;
  zIndex: number;
}) {
  const veil = 'absolute pointer-events-none bg-[#09090b]/55';
  return (
    <>
      {litLeft > TRACK_PANEL_WIDTH && (
        <div aria-hidden className={veil} style={{ left: TRACK_PANEL_WIDTH, width: litLeft - TRACK_PANEL_WIDTH, top, height, zIndex }} />
      )}
      <div aria-hidden className={veil} style={{ left: litRight, right: 0, top, height, zIndex }} />
    </>
  );
}

function SectionDragTag({ name, tagRef }: { name: string; tagRef: (node: HTMLDivElement | null) => void }) {
  return createPortal(
    <div
      ref={tagRef}
      className="fixed left-0 top-0 z-[70] pointer-events-none select-none rounded border border-primary bg-[#09090b] px-1.5 py-0.5 shadow-[0_0_12px_rgba(212,175,55,0.45)]"
      style={{ visibility: 'hidden' }}
    >
      <span className="block text-[9px] leading-none font-bold text-primary uppercase tracking-widest whitespace-nowrap">
        {name}
      </span>
    </div>,
    document.body,
  );
}

// A section-end handle drag. Beats are whole beats from song time 0.
interface SectionEndDrag {
  name: string;
  range: SectionEndRange;   // start, minimum end (content need) and maximum end
  storedEndBeat: number;    // the end as stored (the drag's start)
  storedBaseLength: number | null; // song_sections.base_length as stored
  endBeat: number;          // the stop the pointer has picked
  grabOffsetSec: number;    // pointer song time − the section's end, at pointerdown
  originX: number;          // pointerdown clientX, for the 3px start threshold
  moved: boolean;           // the pointer has passed the threshold
}
// A handle press moves nothing until the pointer has moved this far (px), so a click
// or a shaky press never changes the length.
const SECTION_END_DRAG_THRESHOLD_PX = 3;

// One section's end on the header row, for the section-end handles (SectionEndHandles).
interface SectionEndMark {
  name: string;
  endPx: number;       // content px (including the 256px track panel)
  addsSpace: boolean;  // its stored base length adds empty space after its content
}

// The gold section-end handles: one per section on the timeline that has a
// song_sections row, at its right boundary. Their own layer over the section header
// row (a sibling of the headers, never inside one), so a handle can straddle the
// boundary and sit above the next header and the looped header's gold border. The hit
// area is 8px wide at every zoom; the gold bar and grip show while the pointer is over
// the section's header (hoveredName) or the handle itself, and for the whole drag. A
// section whose base length adds space always shows a faint gold mark there.
// `interactive` false (another drag or trim running): no handles, only the marks.
// Pointer handling is the Timeline's own (startSectionEndDrag), never dnd-kit.
const SECTION_END_HIT_PX = 8;
const SectionEndHandles = React.memo(function SectionEndHandles({ marks, hoveredName, draggingName, interactive, onPointerDown }: {
  marks: SectionEndMark[];
  hoveredName: string | null;
  draggingName: string | null;
  interactive: boolean;
  onPointerDown: (e: React.PointerEvent, name: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      {marks.map((m) => {
        const dragging = draggingName === m.name;
        const live = dragging || (interactive && draggingName === null);
        if (!live && !m.addsSpace) return null;
        const shown = dragging || (live && hoveredName === m.name);
        return (
          <div
            key={m.name}
            data-section-end={m.name}
            className={cn('group/end absolute top-0 h-full', live && 'pointer-events-auto cursor-col-resize')}
            style={{ left: m.endPx - SECTION_END_HIT_PX / 2, width: SECTION_END_HIT_PX }}
            onPointerDown={live ? (e) => onPointerDown(e, m.name) : undefined}
          >
            {m.addsSpace && !shown && (
              <div aria-hidden className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-primary/35" />
            )}
            {live && (
              <div
                aria-hidden
                className={cn('absolute inset-0 transition-opacity duration-100', shown ? 'opacity-100' : 'opacity-0 group-hover/end:opacity-100')}
              >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-primary shadow-[0_0_6px_rgba(212,175,55,0.6)]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-3 rounded-[2px] bg-primary border border-[#09090b]/70" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

export function Timeline({ songId, modeTabs }: { songId: string; modeTabs?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-select the destination after a drag-driven organize/assign-track, matching
  // every other creation action's auto-select (Add Instrument, Add Section, ...).
  // MediaBucket owns selectedTrack/selectedIdea internally with no external props
  // to control it, so this reuses the same `find-in-bucket` CustomEvent the
  // "Show in File Browser" timeline-clip context menu item already dispatches
  // (Clip.tsx) rather than inventing new prop plumbing between Timeline and
  // MediaBucket. Omitting sectionName (assign-track's destination) selects the
  // track and leaves the section blank, which is correct — assign-track doesn't
  // specify one.
  const looseFileOrganizeDnd = useLooseFileOrganizeDnd(songId, {
    onOrganized: (dest) => {
      // Un-assign back to the Tracks shelf leaves the current selection alone.
      if (dest.action === 'unassign-track') return;
      window.dispatchEvent(new CustomEvent('find-in-bucket', {
        detail: dest.action === 'organize'
          ? { trackId: dest.trackId, sectionName: dest.sectionName }
          : { trackId: dest.trackId },
      }));
    },
  });
  // Version (bucket-clip) moves to another section — Move A. The view follows the
  // file through the same find-in-bucket event organize uses. Its in-use dialog is
  // rendered below, at this level, since the dragged card leaves its section.
  const versionMoveDnd = useVersionMoveDnd({
    // The view follows the file: into its new section (Move A), or onto the track
    // whose shelf now holds it (Moves C/D — track selected, no section). A song-level
    // move (Move B, "Remove from Section") leaves the selection as is; the file shows
    // in the Tracks column.
    onMoved: (dest) => {
      if (dest.kind === 'loose' && !dest.trackId) return;
      window.dispatchEvent(new CustomEvent('find-in-bucket', {
        detail: dest.kind === 'section'
          ? { trackId: dest.trackId, sectionName: dest.sectionName }
          : { trackId: dest.trackId },
      }));
    },
  });
  // "Remove from Section" is offered on version cards only for a real song (type
  // 'song') — same cache entry Workspace reads for the song name. Also seeds the
  // metronome's tempo and time signature (see the seeding effect below the bpm state).
  const { data: songInfo } = useQuery<{ type?: string; bpm?: number | null; timeSignature?: string | null }>({
    queryKey: ['song', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}`).then(r => r.json()),
  });
  // A placed loose file: the clip gets the gold landing glow, like a version's
  // context-menu Add to Timeline, and the Media Bucket shows where the file went
  // (flashBucketDestination) without changing its selection or scroll. Shared by the
  // Place on Timeline picker (the loose-file "Add to Timeline" menu item) and a
  // confirmed timeline drop; called only when the save succeeded. The picker's clip
  // mounts with isFlash already set once live sync merges it (the timeline query is
  // invalidated on success); a confirmed drop's clip is already on screen under the
  // same id.
  const onLooseFilePlaced = ({ clip, timelineClip }: { clip: { id: string; ideaId: string }; timelineClip: { id: string; trackId: string; sectionName: string | null } }) => {
    flashBucketDestination(timelineClip.trackId, clip.ideaId, clip.id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashClipId(timelineClip.id);
    flashTimerRef.current = setTimeout(() => setFlashClipId(null), 1800);
  };
  // Where a placed loose file went, shown in the Media Bucket with the landing flash's
  // gold (flashGold at LANDING_FLASH_PEAK_ALPHA, the look every landed file row and
  // card uses), never changing its selection:
  //  - the destination section is the one the Files column shows (its Section row
  //    carries data-open-section): the new version's card. It may only render after the
  //    refetch, so this is a landing-flash request (the card's own useLandingFlash takes
  //    it on mount, or at once if it's already there) with a 3 s wait; a card that never
  //    appears (a search hides it) just doesn't flash. The new card is added at the
  //    bottom of the list, usually just out of view, so this one case keeps the landing
  //    flash's scroll: only the card's own scroller (the Files column), the minimum to
  //    show it, smooth (instant under reduced motion), nothing if it's already in view
  //    — never the page, the timeline, or the Tracks and Sections columns.
  //  - otherwise, with no scrolling: the destination Track row if it's visible in the Tracks column, and
  //    the destination Section row too when that track is the open one (only the open
  //    track's Section rows are rendered) and it's visible. Nothing visible: no flash.
  // Rows are found by their drop ids (springRowAttrs). Called after the save, long after
  // the drag ended, so the Media Bucket isn't frozen (mediaBucketElementRef) any more.
  const flashBucketDestination = (trackId: string, ideaId: string, clipId: string) => {
    const bucket = document.querySelector<HTMLElement>('[data-media-bucket]');
    if (!bucket) return;
    const row = (dropId: string) => bucket.querySelector<HTMLElement>(`[data-spring-row="${CSS.escape(dropId)}"]`);
    const sectionRow = row(bucketSectionDropId(ideaId));
    if (sectionRow?.hasAttribute('data-open-section')) {
      requestLandingFlash([{ id: clipId, zone: clipLandingZone(ideaId) }], { ttlMs: 3000 });
      return;
    }
    for (const el of [row(bucketTrackDropId(trackId)), sectionRow]) {
      if (el && isVisibleInOwnScroller(el)) flashGold(el, { peakAlpha: LANDING_FLASH_PEAK_ALPHA, reducedMotion: 'ring' });
    }
  };
  const placeLooseFileOnTimelineMutation = usePlaceLooseFileOnTimeline(songId, {
    onSuccess: onLooseFilePlaced,
    // The dialog closes on confirm, before the server answers — without a toast a
    // failed placement looks like nothing happened.
    onError: (msg) => {
      console.error('[placeLooseFileOnTimeline] error:', msg);
      toast({ title: 'Failed to place file on the timeline', description: msg, variant: 'destructive' });
    },
  });
  // A confirmed loose-file timeline drop (commitLoosePlacement): its rollback and toast
  // are per call, so the hook-level toast above isn't used.
  const placeLooseFileAtPositionMutation = usePlaceLooseFileOnTimeline(songId, {
    onSuccess: onLooseFilePlaced,
    onError: (msg) => console.error('[placeLooseFileAtPosition] error:', msg),
  });

  // Backs the Place-on-Timeline modal's Track/Section dropdowns. Same query key
  // MediaBucket's Instruments column uses — already warm, no extra network cost.
  // Deliberately NOT songs.sections: that column is only ever written at song
  // creation (confirmed via routes.ts — POST /api/songs/:songId/sections, the
  // Add Section route, never updates it), so it goes stale the moment a section
  // is added later and would silently omit real options. The live, song-wide
  // section list is the union of active idea sectionNames across all active
  // tracks — same data MediaBucket's Sections column is ultimately built from,
  // just not filtered down to one selected track.
  const { data: bucketTracksForPlacement = [] } = useQuery<ApiBucketTrack[]>({
    queryKey: bucketKeys.bucket(songId),
    queryFn: () => fetchBucket(songId),
  });
  const songSectionNames = React.useMemo(
    () => Array.from(new Set(
      bucketTracksForPlacement.flatMap((t) => t.ideas.filter((i) => i.active).map((i) => i.sectionName))
    )),
    [bucketTracksForPlacement]
  );

  // Keeps the TimelineClip comment badges current (one observer for the whole timeline).
  useLiveClipCommentSummary(songId);

  // Timeline clip drags running, and their position saves (until the refetch after the
  // save is done) — see takeClipDragHold — and Media Bucket version drags (until the
  // drop; startFileDropPreview). Both polls (timeline clips and song
  // sections) pause meanwhile, so one can't put the old positions or section lengths
  // back on screen mid-drag or before the save lands.
  const [clipDragsBusy, setClipDragsBusy] = useState(0);
  // Trim drags and trim saves running (TimelineClip's 'trim-busy' events). Both polls
  // pause for them too, so they can't snap a trimmed clip back mid-drag or before the
  // save lands.
  const [trimsBusy, setTrimsBusy] = useState(0);
  const timelineEditBusy = clipDragsBusy > 0 || trimsBusy > 0;
  // A poll response already on its way when a drag or trim starts would bring back the
  // old state — drop it (both polls).
  const dropPollsInFlight = () => {
    queryClient.cancelQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
    queryClient.cancelQueries({ queryKey: songSectionsKey(songId) });
  };
  const dropPollsInFlightRef = useRef(dropPollsInFlight);
  dropPollsInFlightRef.current = dropPollsInFlight;
  const { data: apiTracks } = useQuery<ApiTrack[]>({
    queryKey: [`/api/songs/${songId}/timeline`],
    queryFn: async () => {
      const res = await fetch(`/api/songs/${songId}/timeline`);
      if (!res.ok) throw new Error('Failed to fetch timeline');
      const body = await res.json();
      // Response shape is { songName, tracks } — extract the array.
      return Array.isArray(body) ? body : body.tracks;
    },
    refetchInterval: timelineEditBusy ? false : 3000,
  });
  useEffect(() => {
    const onTrimBusy = (e: Event) => {
      const delta = (e as CustomEvent<{ delta: 1 | -1 }>).detail.delta;
      // A poll already on its way would bring back the old trim — drop it.
      if (delta > 0) dropPollsInFlightRef.current();
      setTrimsBusy((n) => Math.max(0, n + delta));
    };
    window.addEventListener('trim-busy', onTrimBusy);
    return () => window.removeEventListener('trim-busy', onTrimBusy);
  }, [queryClient, songId]);

  // Section order and base lengths (song_sections), polled with the timeline so a
  // bandmate's section reorder shows up. Paused while this browser's own reorder is
  // in flight, so a poll can't put the old order back before the server answers.
  // Also paused while a section's first-clip POST is in flight (insertClipInSection),
  // which sets the section's arrangement place in the cache before the server has it.
  const sectionOrderSaving = useIsMutating({ mutationKey: ['song-sections-order', songId] }) > 0;
  // Same for this browser's own section-end handle save (sectionBaseLengthMutation).
  const sectionBaseLengthSaving = useIsMutating({ mutationKey: ['song-sections-base-length', songId] }) > 0;
  const [firstClipPostsInFlight, setFirstClipPostsInFlight] = useState(0);
  const { data: songSections } = useQuery<SongSectionRow[]>({
    queryKey: songSectionsKey(songId),
    queryFn: () => fetchSongSections(songId),
    refetchInterval: sectionOrderSaving || sectionBaseLengthSaving || firstClipPostsInFlight > 0 || timelineEditBusy ? false : 3000,
  });
  const sections = songSections ?? EMPTY_SECTIONS;

  // Clip data as stored: sectionOffset is the truth for a sectioned clip, and its start
  // here is not read. `tracks` below is this with every start taken from the layout.
  const [trackState, setTracks] = useState<Track[]>([]);
  const tracksInitialized = useRef(false);
  // Section-reorder drag state — separate from clip drag state.
  const [activeSectionName, setActiveSectionName] = useState<string | null>(null);
  // Section-end handle drag (startSectionEndDrag): the section, its range in whole
  // beats, its end as stored and the end the pointer has picked. Replaced only when
  // the picked stop changes, so the preview layout is recomputed only then.
  const [sectionEndDrag, setSectionEndDrag] = useState<SectionEndDrag | null>(null);
  // The section header under the pointer (its end handle shows), or null.
  const [hoveredHeader, setHoveredHeader] = useState<string | null>(null);

  // Placeholder until the song query resolves — the seeding effect below replaces it with the
  // song's stored tempo. 120 is also the fallback for songs whose stored bpm is null.
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [timeSignature, setTimeSignature] = useState('4/4');

  // The timeline layout — the one place positions are derived (see deriveLayout).
  // Section widths and headers, grayout, end of timeline, looping, the
  // playhead's section, drop → section, ?section= scroll, the ruler and the grid all
  // read from this, directly or through `tracks` / `sectionLayout`.
  const layout = React.useMemo(
    () => deriveLayout(trackState, sections, bpm, timeSignature),
    [trackState, sections, bpm, timeSignature]
  );
  const tracks = React.useMemo(() => positionTracks(trackState, layout), [trackState, layout]);
  // Section geometry in the shape Track.tsx takes. Sections with no non-full-take clip
  // are absent — no column, no space.
  const sectionLayout = React.useMemo<SectionInfo[]>(
    () => layout.sections.map((s) => ({ name: s.name, start: s.start, duration: s.length })),
    [layout]
  );
  // Trim limits per track, by section name (Track.tsx → trimNeighbours): each section's
  // pickup left limit (shared pickupLeftLimit — a pickup's left edge, or with Option any
  // clip's) and where its clips' right edges stop for a later section's pickup (shared
  // nextPickupStop). A trim reads them as they were when it started.
  // Their input: every stored clip, the tempo and time signature.
  const pickupLimitInput = React.useMemo(() => ({
    clips: trackState.flatMap((t) => t.clips.map((c) => ({ id: c.id, trackId: t.id, sectionName: c.sectionName, sectionOffset: c.sectionOffset ?? null, isFullTake: !!c.isFullTake }))),
    bpm,
    timeSignature,
  }), [trackState, bpm, timeSignature]);
  // A track keeps its previous limits object while the values are the same, so its
  // memoized row isn't re-rendered (a trim preview changes trackState on every move).
  const trimLimitsRef = useRef(new Map<string, TrackTrimLimits>());
  const trimLimitsByTrack = React.useMemo(() => {
    const input = pickupLimitInput;
    const byTrack = new Map<string, TrackTrimLimits>();
    for (const t of trackState) {
      const pickupLimits = new Map<string, number>();
      const pickupStops = new Map<string, number>();
      for (const c of t.clips) {
        if (c.isFullTake || !c.sectionName || pickupLimits.has(c.sectionName)) continue;
        pickupLimits.set(c.sectionName, pickupLeftLimit(input, layout, t.id, c.sectionName));
        pickupStops.set(c.sectionName, nextPickupStop(input, layout, t.id, c.sectionName));
      }
      const prev = trimLimitsRef.current.get(t.id);
      const same = prev && sameNumberMap(prev.pickupLimits, pickupLimits) && sameNumberMap(prev.pickupStops, pickupStops);
      byTrack.set(t.id, same ? prev : { pickupLimits, pickupStops });
    }
    trimLimitsRef.current = byTrack;
    return byTrack;
  }, [trackState, layout, pickupLimitInput]);
  const endOfTimeline = layout.timelineEnd;
  // The content's right end as last rendered (contentEnd below), for the edge-scroll cap.
  const contentEndRef = useRef(endOfTimeline);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  // First load waits for the sections and the song's tempo too, so the first paint
  // already has the right section order and widths.
  useEffect(() => {
    if (apiTracks && songSections && songInfo && !tracksInitialized.current) {
      setTracks(apiTracks.map(apiTrackToTrack));
      tracksInitialized.current = true;
      const durationMs = Math.round(performance.now() - mountTimeRef.current);
      if (durationMs > 2000) {
        console.warn('[SLOW LOAD]', { durationMs, songId, timestamp: new Date().toISOString() });
      }
    }
  }, [apiTracks, songSections, songInfo]);

  // Merge track additions, removals, and clip changes after initial load.
  // Trusts server for volume/pan; preserves local mute/solo state for existing tracks.
  // Clips (and their sectionOffset) are taken from the server as they are: nothing is
  // re-packed or re-ordered here, and a sync never writes anything back.
  useEffect(() => {
    if (!apiTracks || !tracksInitialized.current) return;
    setTracks(prev => {
      const apiIds = new Set(apiTracks.map(t => t.id));
      const existingIds = new Set(prev.map(t => t.id));

      const withRemovals = prev.filter(t => apiIds.has(t.id));

      const withUpdatedClips = withRemovals.map(track => {
        const apiTrack = apiTracks.find(t => t.id === track.id);
        if (!apiTrack) return track;
        return {
          ...track,
          clips: serverClipsToClips(apiTrack.timelineClips),
          volume: apiTrack.volume ?? 100,
          pan: apiTrack.pan ?? 0,
        };
      });

      const newTracks = apiTracks
        .filter(t => !existingIds.has(t.id))
        .map(t => ({ ...apiTrackToTrack(t), clips: [] }));

      return [...withUpdatedClips, ...newTracks];
    });
  }, [apiTracks]);

  const [activeDragData, setActiveDragData] = useState<{ clip: Clip; type: string; trackId?: string; sectionName?: string; songId?: string } | null>(null);
  // Place-on-Timeline modal state (the loose-file right-click Add to Timeline).
  // trackId/sectionName are '' when unresolved — picked via the modal's own
  // Track/Section dropdowns (see the cascading-picker rework).
  const [loosePlacementModal, setLoosePlacementModal] = useState<{
    looseFileId: string; trackId: string; sectionName: string;
  } | null>(null);
  // Place-on-Timeline's Section options: only the chosen track's own active,
  // non-Full-Take sections — the server needs that exact idea row to exist, and
  // Full Take isn't a section column. A selection that isn't in this list (after a
  // track switch) reads as empty.
  // Also the base of the new-section dialog's list (offTimelineSectionNames). In filing
  // order (the bucket's ideas order).
  const placeableSectionNames = (trackId: string | undefined): string[] => {
    const track = bucketTracksForPlacement.find((t) => t.id === trackId);
    return track ? track.ideas.filter((i) => i.active && !i.isFullTake).map((i) => i.sectionName) : [];
  };
  const placementSectionNames = React.useMemo(
    () => placeableSectionNames(loosePlacementModal?.trackId),
    [bucketTracksForPlacement, loosePlacementModal?.trackId],
  );
  const placementSectionName = loosePlacementModal && placementSectionNames.includes(loosePlacementModal.sectionName)
    ? loosePlacementModal.sectionName
    : '';
  // The loose-file "Add to Timeline" menu item: the song has no sections at all, so
  // the placement picker has nothing to offer.
  const showNoSectionsToast = () => toast({
    title: 'No sections yet',
    description: 'This song has no sections yet — add one first, then place the file on the timeline.',
    variant: 'destructive',
  });
  // Loose-file right-click "Add to Timeline" (LooseFilePlacementProvider, MediaBucket's
  // rows): the placement picker — the track is pre-selected only for a file on a
  // track's shelf, the section never.
  const openLooseFilePlacement = (looseFile: ApiLooseFile) => {
    if (songSectionNames.length === 0) {
      showNoSectionsToast();
      return;
    }
    const shelfTrackId = looseFile.trackId && bucketTracksForPlacement.some((t) => t.id === looseFile.trackId)
      ? looseFile.trackId
      : '';
    setLoosePlacementModal({ looseFileId: looseFile.id, trackId: shelfTrackId, sectionName: '' });
  };
  const [playheadTimeSecs, setPlayheadTimeState] = useState(() => {
    const saved = localStorage.getItem(`patchbay-playhead-${songId}`);
    if (saved) {
      const t = Number(saved);
      if (t >= 0 && isFinite(t)) return t;
    }
    return 0;
  });
  // Initialize ref to match the lazy-initialized state so they're in sync from the first render.
  const playheadRef = React.useRef(playheadTimeSecs);
  const [isPlaying, setIsPlaying] = useState(false);
  // Pointer capture (used by the playhead flag drag) does not retarget the synthetic `click` the
  // browser fires on pointerup — that click hit-tests wherever the cursor physically is, which is
  // very often over the Ruler (they share the same horizontal strip). Without this guard, ending a
  // flag drag there immediately re-seeks via handleRulerSeek's raw, unclamped click position,
  // overwriting whatever the drag had just (correctly, clamped) landed on. Set by the drag's
  // cleanup, consumed (and cleared) by the very next ruler click.
  const suppressRulerClickRef = React.useRef(false);

  const setPlayheadTime = React.useCallback((val: number | ((prev: number) => number)) => {
    if (typeof val === 'function') {
      playheadRef.current = val(playheadRef.current);
    } else {
      playheadRef.current = val;
    }
    setPlayheadTimeState(playheadRef.current);
  }, []);

  const [zoom, setZoom] = useState(() => parseSavedZoom(localStorage.getItem(`patchbay-zoom-${songId}`)) ?? DEFAULT_ZOOM);
  const [isLooping, setIsLooping] = useState(() => localStorage.getItem(`patchbay-loop-${songId}`) === 'true');
  const [isMetronomeOn, setIsMetronomeOn] = useState(() => localStorage.getItem(`patchbay-metronome-${songId}`) === 'true');
  const [selectedTimelineTrackId, setSelectedTimelineTrackId] = useState<string | null>(null);
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  const animationRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);
  // Last scrollLeft value edge-riding itself wrote — used to detect manual scroll.
  const lastAutoScrollRef = React.useRef<number | null>(null);
  // Whether edge-riding is currently engaged. Disengaged by any manual scroll;
  // re-engaged only when the playhead is visible in the viewport again.
  const isFollowingRef = React.useRef<boolean>(true);
  const volumePatchTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const uiRestored = React.useRef(false);
  const scrollSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const playheadSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the playhead flag's point is at/right of the sticky instruments panel's edge, last
  // computed by either a render (playhead-driven) or the scroll listener below (scroll-driven).
  // Kept in sync via a useEffect on flagAbovePanel further down; used only to dedupe the scroll
  // listener's force-rerenders so pure scrolling doesn't re-render on every pixel.
  const flagAbovePanelRef = React.useRef(true);
  const [, bumpFlagStack] = useState(0);

  const timelineRef = React.useRef<HTMLDivElement>(null!);
  const customAudioRefs = React.useRef<{ [clipId: string]: HTMLAudioElement }>({});
  const panNodesRef = React.useRef<{ [clipId: string]: StereoPannerNode }>({});
  const pendingPlayRef = React.useRef<Set<string>>(new Set());
  const seekPendingRef = React.useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // True once audioCtxRef's most recent resume() call has resolved to "running". Gates
  // audio.play() in the rAF loop so it never fires while the Web Audio graph is still on
  // a suspended context (see the toggle-play handler and the rAF play-call site below).
  const audioCtxReadyRef = useRef<boolean>(false);
  const masterVolumeRef = React.useRef<number>(0.8); // 0–1, matches slider default of 80
  const lastBeatIndexRef = useRef<number>(-1);
  const isMetronomeOnRef = useRef(isMetronomeOn);
  // Lazy-initialized from the same localStorage keys Transport.tsx writes to, so a page
  // reload doesn't reset metronome volume/subdivision to defaults.
  const metronomeVolumeRef = useRef<number>((() => {
    const saved = localStorage.getItem(`patchbay-metronome-volume-${songId}`);
    if (saved) { const v = Number(saved); if (Number.isFinite(v) && v >= 0 && v <= 100) return v; }
    return 70;
  })());
  const metronomeSubdivisionRef = useRef<string>((() => {
    const saved = localStorage.getItem(`patchbay-metronome-subdivision-${songId}`);
    return saved && METRONOME_SUBDIVISION_FACTORS[saved] ? saved : '1/4';
  })());
  // Stale-closure-safe mirror of `bpm` state, needed inside zero-dep effect handlers
  // (the subdivision-change reseed) that can't depend on the main rAF effect's bpm closure.
  const bpmRef = useRef(DEFAULT_BPM);
  // Seed tempo + time signature from the song's stored values once per song. Guarded so a later
  // refetch of ['song', songId] can't overwrite an edit made this session (edits arrive via the
  // update-bpm / update-time-signature listeners). bpmRef is written directly, not just via the
  // bpm mirror effect, so the subdivision reseed sees the loaded tempo immediately.
  // Null bpm / missing time signature fall back to 120 and '4/4' — display only, nothing is
  // written back. Transport applies the same fallbacks so both always agree.
  const songTempoSeededForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!songInfo || songTempoSeededForRef.current === songId) return;
    songTempoSeededForRef.current = songId;
    const seededBpm = songInfo.bpm ?? DEFAULT_BPM;
    bpmRef.current = seededBpm;
    setBpm(seededBpm);
    setTimeSignature(songInfo.timeSignature || '4/4');
  }, [songInfo, songId]);
  // Captured at first render; compared against when tracks first arrive to detect slow loads.
  const mountTimeRef = useRef(performance.now());
  // Stable refs for mutable values needed inside zero-dep useEffect handlers (stale closure safety).
  const tracksRef = React.useRef<Track[]>(tracks);
  const zoomRef = React.useRef<number>(zoom);
  // Chained skip-back: track the last landing point and when it happened so rapid
  // successive presses walk backward one boundary at a time instead of searching
  // from live current time (which drifts forward during playback between clicks).
  const lastSkipBackTargetRef = React.useRef<number | null>(null);
  const lastSkipBackTimestampRef = React.useRef<number | null>(null);
  // Set to true on pointerdown for Mute/Solo/volume-slider in track headers, cleared after the
  // next rAF post-pointerup. Guards handleTrackSelected and handleTimelineClick against the second
  // native click event that the browser fires at the cursor's physical position after a drag
  // releases pointer capture — which can land on the track header even when the drag started inside
  // a child control.
  const controlInteractionRef = React.useRef(false);

  // Pinch-to-zoom / Ctrl+scroll — accumulator and rAF handle
  const wheelDeltaAccRef = React.useRef<number>(0);
  const wheelRafRef = React.useRef<number | null>(null);
  const wheelCursorClientXRef = React.useRef<number>(0);

  // Derived: which section the playhead is currently in, when loop is active.
  // Purely from render-time state — no rAF writes, no manual clears needed.
  const loopedSectionName = React.useMemo(() => {
    if (!isLooping) return null;
    return sectionAt(playheadTimeSecs, layout.sections)?.name ?? null;
  }, [isLooping, playheadTimeSecs, layout]);

  // Disable loop whenever the playhead moves to a different section while looping, regardless of
  // how the repositioning happened (flag drag, ruler click, section click, keyboard, etc.).
  // The rAF loop's own boundary-reset always keeps the playhead inside the same section during
  // normal looping, so any section change we observe here means the user repositioned it.
  const prevLoopedSectionRef = useRef<string | null>(null);
  useEffect(() => {
    const rawSection = sectionAt(playheadTimeSecs, layout.sections)?.name ?? null;
    if (isLooping && prevLoopedSectionRef.current !== null && rawSection !== prevLoopedSectionRef.current) {
      setIsLooping(false);
      window.dispatchEvent(new CustomEvent('loop-force-disabled'));
    }
    prevLoopedSectionRef.current = rawSection;
  }, [playheadTimeSecs, isLooping, layout]);

  useEffect(() => {
    tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        if (clip.src && !customAudioRefs.current[clip.id]) {
          const audio = new Audio(clip.src);
          audio.preload = 'auto';
          customAudioRefs.current[clip.id] = audio;
        }
      });
    });
  }, [tracks]);

  useEffect(() => {
    const handleClipReplaced = (e: any) => {
      const audio = customAudioRefs.current[e.detail.clipId];
      if (audio) {
        audio.pause();
        delete customAudioRefs.current[e.detail.clipId];
      }
    };
    window.addEventListener('clip-replaced', handleClipReplaced);
    return () => window.removeEventListener('clip-replaced', handleClipReplaced);
  }, []);

  useEffect(() => {
    const handleTrimPreview = (e: any) => {
      const { clipId, trimStart, trimEnd, sectionOffset } = e.detail as {
        clipId: string; trimStart: number; trimEnd: number | null; sectionOffset?: number;
      };
      // Only the trimmed clip changes: its trim, and for a sectioned clip the offset
      // that moves with trimStart (TimelineClip clamps both at its neighbours). The
      // neighbours never move and nothing is re-packed; the trim route saves it.
      setTracks((prev) => prev.map((t) => !t.clips.some((c) => c.id === clipId) ? t : {
        ...t,
        clips: t.clips.map((c) => c.id !== clipId ? c : {
          ...c,
          trimStart,
          trimEnd,
          ...(sectionOffset !== undefined && c.sectionName && !c.isFullTake ? { sectionOffset } : {}),
        }),
      }));
    };
    window.addEventListener('trim-preview', handleTrimPreview);
    return () => window.removeEventListener('trim-preview', handleTrimPreview);
  }, []);

  useEffect(() => {
    const handleTogglePlay = (e: any) => {
      if (e.detail.isPlaying) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        // Gate audio.play() in the rAF loop until resume() has actually resolved to
        // "running". Calling play() while ctx.state is still "suspended" (confirmed via
        // real-Safari instrumentation to happen on essentially every play press, 70-260ms
        // window) leaves the <audio> element reporting paused:false with no audible output,
        // since the Web Audio graph downstream (source → panner → destination) produces no
        // sound on a suspended context. See audioCtxReadyRef read site in the rAF loop below.
        audioCtxReadyRef.current = false;
        audioCtxRef.current.resume()
          .then(() => {
            audioCtxReadyRef.current = true;
          })
          .catch((err) => {
            // resume() rejecting is rare, but if it happens we still flip the gate open
            // rather than leaving playback permanently silent-stuck waiting on a promise
            // that will never resolve — this falls back to the old (racy) behavior only
            // in that edge case, which is strictly no worse than before this fix.
            audioCtxReadyRef.current = true;
          });
      }
    };
    window.addEventListener('toggle-play', handleTogglePlay);
    return () => window.removeEventListener('toggle-play', handleTogglePlay);
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      Object.values(customAudioRefs.current).forEach((audio) => audio.pause());
      pendingPlayRef.current.clear();
      // Once any clip has been wired into the Web Audio graph (panNodesRef non-empty),
      // its <audio> element is permanently bound to this AudioContext per the
      // createMediaElementSource spec — closing it here would leave that clip's audio
      // with no output path on the next play (a new context can never rebind it).
      // Suspend instead so the same context and node graph can be resumed next play.
      if (Object.keys(panNodesRef.current).length > 0) {
        audioCtxRef.current?.suspend();
      } else {
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
      }
    }
  }, [isPlaying]);

  // Stop all audio on unmount so navigating away (back button, nav links, etc.) doesn't
  // leave audio playing. Refs are read at unmount time so this always sees current values.
  useEffect(() => {
    return () => {
      Object.values(customAudioRefs.current).forEach((audio) => audio.pause());
      pendingPlayRef.current.clear();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleBpmUpdated = (e: any) => setBpm(e.detail.bpm);
    window.addEventListener('update-bpm', handleBpmUpdated);
    return () => window.removeEventListener('update-bpm', handleBpmUpdated);
  }, []);

  useEffect(() => {
    const handleMetronomeToggle = (e: any) => {
      setIsMetronomeOn(e.detail.enabled);
      isMetronomeOnRef.current = e.detail.enabled;
    };
    window.addEventListener('toggle-metronome', handleMetronomeToggle);
    return () => window.removeEventListener('toggle-metronome', handleMetronomeToggle);
  }, []);

  useEffect(() => {
    const handleMetronomeVolumeUpdate = (e: any) => {
      metronomeVolumeRef.current = e.detail.volume;
    };
    const handleMetronomeSubdivisionUpdate = (e: any) => {
      metronomeSubdivisionRef.current = e.detail.subdivision;
      // Reseed lastBeatIndexRef to the tick index at the *current* playhead position under the
      // new subdivision — otherwise the next rAF frame sees a large index jump (old subdivision's
      // tick count vs. new subdivision's tick count) and fires a burst of catch-up clicks.
      // Mirrors the play-press seeding logic in the rAF effect below, including the
      // position-0 → -1 special case.
      const playheadTime = Math.max(0, playheadRef.current);
      const subdivisionFactor = METRONOME_SUBDIVISION_FACTORS[e.detail.subdivision] ?? 1;
      const secondsPerBeat = 60 / bpmRef.current;
      const tickInterval = secondsPerBeat / subdivisionFactor;
      const currentTickIndex = Math.floor(playheadTime / tickInterval);
      lastBeatIndexRef.current = playheadTime === 0 ? -1 : currentTickIndex;
    };
    window.addEventListener('update-metronome-volume', handleMetronomeVolumeUpdate);
    window.addEventListener('update-metronome-subdivision', handleMetronomeSubdivisionUpdate);
    return () => {
      window.removeEventListener('update-metronome-volume', handleMetronomeVolumeUpdate);
      window.removeEventListener('update-metronome-subdivision', handleMetronomeSubdivisionUpdate);
    };
  }, []);

  useEffect(() => {
    const handleTimeSignatureUpdated = (e: any) => setTimeSignature(e.detail.timeSignature);
    window.addEventListener('update-time-signature', handleTimeSignatureUpdated);
    return () => window.removeEventListener('update-time-signature', handleTimeSignatureUpdated);
  }, []);

  // Transport asks for the current time when it mounts, so its timecode shows the (lazily
  // restored) playhead instead of 00:00:00:00 until the playhead next moves. This listener is
  // registered before Transport's mount effect runs: Timeline renders first in Workspace.
  useEffect(() => {
    const handleRequestTimeUpdate = () => {
      window.dispatchEvent(new CustomEvent('time-update', { detail: { time: playheadRef.current } }));
    };
    window.addEventListener('request-time-update', handleRequestTimeUpdate);
    return () => window.removeEventListener('request-time-update', handleRequestTimeUpdate);
  }, []);

  useEffect(() => {
    const handleMasterVolume = (e: any) => {
      masterVolumeRef.current = e.detail.volume / 100;
      Object.values(customAudioRefs.current).forEach((audio) => {
        if (!audio.paused) audio.volume = masterVolumeRef.current;
      });
    };
    window.addEventListener('update-master-volume', handleMasterVolume);
    return () => window.removeEventListener('update-master-volume', handleMasterVolume);
  }, []);


  useEffect(() => {
    const handleSkipToClip = (e: any) => {
      const { direction } = e.detail as { direction: 'next' | 'previous' };
      const currentTracks = tracksRef.current;
      const currentZoom = zoomRef.current;
      const EPSILON = 0.05;

      // Collect every clip boundary (effectiveStart and effectiveEnd) across all tracks.
      const raw: number[] = [];
      for (const track of currentTracks) {
        for (const clip of track.clips) {
          if (!hasPlayedLength(clip)) continue; // a pickup cut to nothing: not on the timeline
          raw.push(clip.start);
          raw.push(clip.start + playedSpan(clip).length);
        }
      }

      if (raw.length === 0) return;

      raw.sort((a, b) => a - b);

      // Epsilon-cluster: walk sorted values and merge any consecutive pair within EPSILON
      // into one boundary, keeping the first value in each cluster. This prevents
      // float-imprecise near-identical boundaries (e.g. one clip's end == another's start
      // on a different track) from requiring a double press to cross a single musical point.
      const boundaries: number[] = [];
      let clusterStart = raw[0];
      for (let i = 1; i < raw.length; i++) {
        if (raw[i] - clusterStart > EPSILON) {
          boundaries.push(clusterStart);
          clusterStart = raw[i];
        }
      }
      boundaries.push(clusterStart);

      const currentTime = playheadRef.current;
      let targetTime: number | null = null;

      if (direction === 'next') {
        // Reset chain state: switching to forward breaks any active backward chain.
        lastSkipBackTargetRef.current = null;
        lastSkipBackTimestampRef.current = null;
        targetTime = boundaries.find((b) => b > currentTime + EPSILON) ?? null;
      } else {
        // Chained rapid-repeat: if the previous skip-back landed within 500ms, search
        // from that landing point so rapid presses walk backward one boundary at a time
        // even while the playhead keeps drifting forward between clicks during playback.
        const now = Date.now();
        const isChaining =
          lastSkipBackTimestampRef.current !== null &&
          now - lastSkipBackTimestampRef.current < 500 &&
          lastSkipBackTargetRef.current !== null;
        const referenceTime = isChaining ? lastSkipBackTargetRef.current! : currentTime;
        const earlier = boundaries.filter((b) => b < referenceTime - EPSILON);
        targetTime = earlier.length > 0 ? earlier[earlier.length - 1] : null;
      }

      if (targetTime === null) return;

      if (direction === 'previous') {
        lastSkipBackTargetRef.current = targetTime;
        lastSkipBackTimestampRef.current = Date.now();
      }

      setPlayheadTime(targetTime);
      // Seek spanning clips directly to the corrected position. Setting .currentTime
      // is synchronous and takes effect whether a play() Promise is pending or already
      // resolved — this eliminates the race where !audio.paused silently no-ops during
      // Chrome's pending-play window (0-2 frames after play() before paused flips false).
      // No pause() or pendingPlayRef changes: the clip keeps playing uninterrupted.
      // Clips newly entering or leaving range are handled by the existing rAF branches.
      for (const track of currentTracks) {
        for (const clip of track.clips) {
          const span = playedSpan(clip);
          const clipEnd = clip.start + span.length;
          const wasInRange = currentTime >= clip.start && currentTime < clipEnd;
          const isStillInRange = targetTime >= clip.start && targetTime < clipEnd;
          if (wasInRange && isStillInRange) {
            const audio = customAudioRefs.current[clip.id];
            if (audio) {
              audio.currentTime = span.inPoint + Math.max(0, targetTime - clip.start);
            }
          }
        }
      }
      window.dispatchEvent(new CustomEvent('time-update', { detail: { time: targetTime } }));

      const el = timelineRef.current;
      if (el) {
        const newPos = 256 + targetTime * currentZoom;
        const sl = el.scrollLeft;
        const cw = el.clientWidth;
        if (newPos < sl + TRACK_PANEL_WIDTH || newPos > sl + cw) {
          el.scrollLeft = Math.max(0, Math.min(newPos - cw * 0.5, el.scrollWidth - cw));
          lastAutoScrollRef.current = el.scrollLeft;
          isFollowingRef.current = true;
        }
      }
    };

    window.addEventListener('skip-to-clip', handleSkipToClip);
    return () => window.removeEventListener('skip-to-clip', handleSkipToClip);
  }, [setPlayheadTime]);

  // One-shot restore: reads all localStorage keys and seeds local state.
  // Must be declared BEFORE the mute/solo persist effect so it runs first
  // on the same [tracks, songId] dependency cycle.
  // useLayoutEffect (not useEffect) so state is committed before the browser paints —
  // prevents the flash of default playhead/zoom before restored values appear.
  useLayoutEffect(() => {
    if (uiRestored.current) return;
    if (tracks.length === 0) return;

    // Set to true BEFORE any state updates so the persist effects below
    // see true when they fire in the same commit cycle.
    uiRestored.current = true;

    // Mute / solo
    try {
      const mutedJson = localStorage.getItem(`patchbay-track-muted-${songId}`);
      const soloJson = localStorage.getItem(`patchbay-track-solo-${songId}`);
      if (mutedJson || soloJson) {
        const mutedMap: Record<string, boolean> = mutedJson ? JSON.parse(mutedJson) : {};
        const soloMap: Record<string, boolean> = soloJson ? JSON.parse(soloJson) : {};
        setTracks((prev) =>
          prev.map((t) => ({
            ...t,
            muted: mutedMap[t.id] ?? t.muted,
            solo: soloMap[t.id] ?? t.solo,
          }))
        );
      }
    } catch {}

    // Zoom
    const savedZoom = parseSavedZoom(localStorage.getItem(`patchbay-zoom-${songId}`));
    if (savedZoom !== null) setZoom(savedZoom);

    // Scroll — deferred one frame so the content has rendered at the new zoom.
    // Horizontal and vertical restore share a single rAF so both land on the same
    // tick as the track/clip pop-in, instead of vertical trailing it as a second jump.
    const savedScroll = localStorage.getItem(`patchbay-scroll-${songId}`);
    const savedVScroll = localStorage.getItem(`patchbay-vscroll-${songId}`);
    if (savedScroll || savedVScroll) {
      const s = savedScroll ? Number(savedScroll) : null;
      const vs = savedVScroll ? Number(savedVScroll) : null;
      requestAnimationFrame(() => {
        if (!timelineRef.current) return;
        if (s !== null) timelineRef.current.scrollLeft = s;
        if (vs !== null) timelineRef.current.scrollTop = vs;
      });
    }

    // Playhead — stored as time in seconds; restore directly (no pixel conversion needed)
    const savedPlayhead = localStorage.getItem(`patchbay-playhead-${songId}`);
    if (savedPlayhead) {
      const t = Number(savedPlayhead);
      if (t >= 0 && isFinite(t)) {
        setPlayheadTime(t);
        // Transport's timecode only learns the time from time-update. Its listener is already
        // registered here (tracks arrive in a later commit than mount); request-time-update
        // below covers Transport mounting without a restore ever running.
        window.dispatchEvent(new CustomEvent('time-update', { detail: { time: t } }));
      }
    }

    // Selection
    const savedTrackId = localStorage.getItem(`patchbay-selected-timeline-track-${songId}`);
    const savedClipId = localStorage.getItem(`patchbay-selected-timeline-clip-${songId}`);
    if (savedTrackId) setSelectedTimelineTrackId(savedTrackId);
    if (savedClipId) setSelectedTimelineClipId(savedClipId);
  }, [tracks, songId]);

  // Mute / solo persist — guarded by uiRestored so initial render doesn't overwrite saved values.
  useEffect(() => {
    if (!uiRestored.current) return;
    const mutedMap: Record<string, boolean> = {};
    const soloMap: Record<string, boolean> = {};
    tracks.forEach((t) => {
      mutedMap[t.id] = t.muted;
      soloMap[t.id] = t.solo;
    });
    localStorage.setItem(`patchbay-track-muted-${songId}`, JSON.stringify(mutedMap));
    localStorage.setItem(`patchbay-track-solo-${songId}`, JSON.stringify(soloMap));
  }, [tracks, songId]);

  // Zoom persist — guarded by uiRestored so the initial useState(80) doesn't overwrite a saved value.
  useEffect(() => {
    if (!uiRestored.current) return;
    localStorage.setItem(`patchbay-zoom-${songId}`, String(zoom));
  }, [zoom, songId]);

  // Loop persist — guarded by uiRestored, same pattern as zoom.
  useEffect(() => {
    if (!uiRestored.current) return;
    localStorage.setItem(`patchbay-loop-${songId}`, String(isLooping));
  }, [isLooping, songId]);

  useEffect(() => {
    localStorage.setItem(`patchbay-metronome-${songId}`, String(isMetronomeOn));
  }, [isMetronomeOn, songId]);

  // Playhead persist — stores time in seconds (not pixels) so zoom changes don't corrupt the value.
  // Debounced 200ms. During playback, clears any pending write and returns early so the rAF loop
  // doesn't cause 60 localStorage writes per second; the final position is captured when isPlaying
  // transitions to false.
  useEffect(() => {
    if (!uiRestored.current) return;
    if (isPlaying) {
      if (playheadSaveTimer.current) clearTimeout(playheadSaveTimer.current);
      return;
    }
    if (playheadSaveTimer.current) clearTimeout(playheadSaveTimer.current);
    playheadSaveTimer.current = setTimeout(() => {
      localStorage.setItem(`patchbay-playhead-${songId}`, String(playheadTimeSecs));
    }, 200);
  }, [playheadTimeSecs, isPlaying, songId]);

  // Scroll persist — DOM listener so we don't need to lift scrollLeft into React state.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
      scrollSaveTimer.current = setTimeout(() => {
        localStorage.setItem(`patchbay-scroll-${songId}`, String(el.scrollLeft));
        localStorage.setItem(`patchbay-vscroll-${songId}`, String(el.scrollTop));
      }, 200);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    };
  }, [songId]);

  // Playhead flag stacking — the flag renders above the sticky panel when its point sits at/right
  // of the panel's edge, and stays occluded by the panel once scrolling moves the point behind it
  // (see the flag-band's style below). That check is recomputed on every render already (it reads
  // playheadPx, which is state-driven), but pure scrolling with no playhead movement doesn't
  // trigger a render on its own — this listener exists only to force one when the scroll-driven
  // side of the check would flip the boolean. Compares against a ref (not state) so scrolling
  // that doesn't cross the boundary never re-renders.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const checkFlagStack = () => {
      const above = 256 + playheadRef.current * zoomRef.current - el.scrollLeft >= TRACK_PANEL_WIDTH;
      if (above !== flagAbovePanelRef.current) {
        flagAbovePanelRef.current = above;
        bumpFlagStack((n) => n + 1);
      }
    };
    el.addEventListener('scroll', checkFlagStack, { passive: true });
    return () => el.removeEventListener('scroll', checkFlagStack);
  }, []);

  // Pinch-to-zoom / Ctrl+scroll — cursor-anchored multiplicative zoom.
  // Only fires when e.ctrlKey is true (trackpad pinch or literal Ctrl+scroll).
  // Normal two-finger pan is untouched: when ctrlKey is false the event falls through.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      // Capture latest cursor position; rAF will use the most-recent value.
      wheelCursorClientXRef.current = e.clientX;
      wheelDeltaAccRef.current += e.deltaY;

      if (wheelRafRef.current !== null) return; // rAF already pending

      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const accumulated = wheelDeltaAccRef.current;
        wheelDeltaAccRef.current = 0;

        const currentZoom = zoomRef.current;
        const factor = Math.exp(-accumulated * 0.0040);
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom * factor));

        if (Math.abs(newZoom - currentZoom) < 0.01) return;

        // Cursor-anchored: keep the timestamp under the cursor fixed on screen.
        // cursorTimeSec = (content-space cursor X − panel) / oldZoom
        // newScrollLeft  = cursorTimeSec * newZoom + panel − (cursor screen X − container left)
        const containerLeft = el.getBoundingClientRect().left;
        const cursorXInContent = el.scrollLeft + (wheelCursorClientXRef.current - containerLeft);
        const cursorTimeSec = Math.max(0, (cursorXInContent - TRACK_PANEL_WIDTH) / currentZoom);
        const targetScrollLeft = cursorTimeSec * newZoom + TRACK_PANEL_WIDTH - (wheelCursorClientXRef.current - containerLeft);
        const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
        const newScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScroll));

        setZoom(newZoom);
        el.scrollLeft = newScrollLeft;
        // Seed the edge-riding refs so the rAF loop doesn't misread this as a manual scroll.
        lastAutoScrollRef.current = el.scrollLeft;
        isFollowingRef.current = true;
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      wheelDeltaAccRef.current = 0;
    };
  }, [songId]); // songId matches the scroll-persist effect's dep; setZoom is stable

  const checkAudioMuteState = React.useCallback(
    (playheadTime: number) => {
      const trackMuteStates: Record<string, boolean> = {};
      for (const track of tracks) {
        if (track.muted) { trackMuteStates[track.id] = true; continue; }
        let isOverClip = false;
        for (const clip of track.clips) {
          if (playheadTime >= clip.start && playheadTime < clip.start + playedSpan(clip).length) {
            isOverClip = true;
            break;
          }
        }
        trackMuteStates[track.id] = !isOverClip;
      }
      window.dispatchEvent(new CustomEvent('audio-mute-state', { detail: { trackMuteStates } }));
    },
    [tracks]
  );

  const handlePlayheadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const flagEl = e.currentTarget;
    const pointerId = e.pointerId;
    flagEl.setPointerCapture(pointerId);


    type EdgeZone = 'off' | 'on-left' | 'on-right';
    const edgeZoneRef = { current: 'off' as EdgeZone };
    const edgeRafRef = { current: null as number | null };
    const edgeLastTsRef = { current: null as number | null };
    // Last known pointer viewport-X — updated by every pointermove; rAF reads it each frame
    const el0 = timelineRef.current;
    const pointerViewportXRef = { current: el0 ? e.clientX - el0.getBoundingClientRect().left : 0 };
    // Fixed pointerdown origin (page coordinates) — used only to gate initial zone engagement on
    // MIN_DRAG_DISTANCE_PX; never updated after this.
    const dragOriginRef = { current: { x: e.clientX, y: e.clientY } };
    // leftDist/rightDist as of the PREVIOUS pointermove within the current zone engagement (reset
    // on every off→on transition, cleared on every on→off transition). Compared against the
    // CURRENT sample on every move to detect direction of travel frame-to-frame — see
    // zonePausedRef below. Deliberately the immediately-preceding sample, not a running minimum:
    // an earlier version paused only once the pointer had pulled some extra distance (80px) away
    // from its closest approach, which left a window right after a reversal where auto-scroll kept
    // going at full speed. Comparing consecutive samples instead means ANY outward movement,
    // however small, is visible on the very next event with no extra distance to travel first.
    const lastZoneDistRef = { current: null as number | null };
    // True when the most recent pointermove showed the pointer moving AWAY from the edge (current
    // dist > lastZoneDistRef) within the current engagement — the rAF loop reads this to freeze
    // scrollLeft in place (effectively 0 speed) without touching edgeZoneRef.current at all. See
    // the comment in handlePointerMove's hysteresis block for why this must be a separate flag
    // rather than folded into zone state.
    const zonePausedRef = { current: false };

    // Pointer speed can outrun SCROLL_SPEED_PX during a fast flick, deriving a time whose pixel
    // position is past what's currently scrolled into view (and thus clipped/invisible). While
    // the zone is active, hold the derived time at the current visible window's near edge — a
    // no-op outside the zone.
    //
    // Bound formula — a direct, undistorted linear function of scrollLeft, with no margin and no
    // taper, so the rate exactly matches normal 1:1 pointer tracking (1/zoom) at every point in
    // the drag, not just at the endpoints. Each side is simply the content-space position of that
    // edge of the currently-visible viewport, converted to time — the left edge is occluded by
    // the sticky TRACK_PANEL_WIDTH panel, the right edge is not:
    //   left:  bound = scrollLeft / zoom
    //   right: bound = (scrollLeft + clientWidth - TRACK_PANEL_WIDTH) / zoom
    // Both have d(bound)/d(scrollLeft) = 1/zoom, constant, for every scrollLeft — no case-split,
    // no anchor point, so there is no region where the rate differs from normal tracking.
    //
    // Neither formula references endOfTimeline or maxScroll, and that's deliberate, not an
    // oversight: an earlier version of this fix computed the right bound as
    // `endOfTimeline - (maxScroll - scrollLeft) / zoom` to try to land exactly on endOfTimeline
    // at scrollLeft === maxScroll. That's wrong — maxScroll is NOT simply
    // `endOfTimeline * zoom` plus the documented +15s content-width pad; the content div also
    // carries `minWidth: TRACK_PANEL_WIDTH + 100 * zoom` (see its style below), a floor that
    // guarantees ~100s of navigable canvas regardless of actual content length. For a short
    // timeline this floor dominates scrollWidth, so maxScroll can be many times larger than
    // endOfTimeline * zoom — anchoring a slope-1/zoom line at (maxScroll, endOfTimeline) then
    // gives a massively negative bound (and therefore a negative displayed time) early in the
    // drag, while scrollLeft is still small. Confirmed via live trace: dragging to the right edge
    // from a fresh session produced `time: -67` at scrollLeft 70 of 6857.
    //
    // The fix: don't try to hit the true endpoint inside this function at all. Property (a) — the
    // clamp reaching exactly 0 / endOfTimeline — is already guaranteed by the pre-existing OUTER
    // clamp at both call sites below (`Math.max(0, Math.min(..., endOfTimeline))`), which wraps
    // `time` before it ever reaches this function. Once that outer clamp saturates raw pointer
    // position at endOfTimeline, the right bound above keeps growing past it as scrollLeft
    // continues toward maxScroll, so Math.min(time, bound) just holds flat at endOfTimeline —
    // correct regardless of what governs scrollWidth (the pad, the minWidth floor, or anything
    // else added later). This function's only remaining job is preventing the fast-flick overshoot
    // into not-yet-visible territory described above, which a same-frame, undistorted viewport-
    // edge formula does correctly by construction.
    //
    // This is the ONLY clamp calculation in the file — both call sites below (the rAF edge-scroll
    // loop and the pointermove handler) route through this single function, and nothing runs on
    // release that could recompute a different value (see suppressRulerClickRef in cleanup()).
    const clampToVisibleWindow = (time: number, scrollLeft: number, clientWidth: number) => {
      const zone = edgeZoneRef.current;
      if (zone === 'off') return time;
      const isLeft = zone === 'on-left';
      const bound = isLeft
        ? scrollLeft / zoom
        : (scrollLeft + clientWidth - TRACK_PANEL_WIDTH) / zoom;
      return isLeft ? Math.max(time, bound) : Math.min(time, bound);
    };

    const stopEdgeLoop = () => {
      if (edgeRafRef.current !== null) {
        cancelAnimationFrame(edgeRafRef.current);
        edgeRafRef.current = null;
      }
      edgeLastTsRef.current = null;
    };

    const edgeScrollFrame = (timestamp: number) => {
      const el = timelineRef.current;
      if (!el || edgeZoneRef.current === 'off') {
        stopEdgeLoop();
        return;
      }
      // Seed frame: record start time, advance nothing (prevents delta spike on first real frame)
      if (edgeLastTsRef.current === null) {
        edgeLastTsRef.current = timestamp;
        edgeRafRef.current = requestAnimationFrame(edgeScrollFrame);
        return;
      }
      const delta = (timestamp - edgeLastTsRef.current) / 1000;
      edgeLastTsRef.current = timestamp;

      // rAF loop's ONLY job: advance scrollLeft. Time is derived below from pointer + scrollLeft.
      const dir = edgeZoneRef.current === 'on-left' ? -1 : 1;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      // Rightward auto-scroll is capped so the final clip's end lands centered (50%) in the
      // viewport, not at the raw DOM maxScroll. maxScroll includes the content div's
      // `minWidth: TRACK_PANEL_WIDTH + 100 * zoom` floor (~100s of always-navigable canvas — see
      // that style below), which for a short timeline is mostly empty; scrolling all the way to it
      // strands the user looking at nothing but blank track rows. Computed from endOfTimeline
      // (the real content end) rather than from scrollWidth/maxScroll, which bakes in that
      // unrelated padding. This only changes WHERE scrollLeft stops — it does not touch
      // clampToVisibleWindow or the time value it computes, which stay governed entirely by the
      // pre-existing endOfTimeline outer clamp regardless of this cap.
      //
      // "Centered" means centered in the VISIBLE TRACK AREA, not the raw container width — the
      // sticky TRACK_PANEL_WIDTH instrument panel permanently occludes the left 256px of the
      // container, so that strip isn't part of what the user actually sees as "the timeline." The
      // true visible-track midpoint (in viewport coordinates) is TRACK_PANEL_WIDTH +
      // visibleTrackWidth/2, not clientWidth/2. A first version used el.clientWidth/2 directly as
      // the target viewport position, which is 128px (TRACK_PANEL_WIDTH/2) short of that true
      // midpoint — confirmed via screenshot: the final clip's right edge stopped noticeably left
      // of the visible track area's actual center. Solving scrollLeft = contentEndPx − targetViewportX
      // for the corrected target (TRACK_PANEL_WIDTH + visibleTrackWidth/2) and substituting
      // contentEndPx = TRACK_PANEL_WIDTH + endOfTimeline*zoom cancels both TRACK_PANEL_WIDTH terms,
      // leaving the formula below — it only happens to not mention TRACK_PANEL_WIDTH explicitly
      // because it already canceled out algebraically, not because it was left out.
      const visibleTrackWidth = el.clientWidth - TRACK_PANEL_WIDTH;
      const rightScrollCap = Math.max(0, Math.min(endOfTimeline * zoom - visibleTrackWidth / 2, maxScroll));
      const scrollCeiling = dir === 1 ? rightScrollCap : maxScroll;
      // zonePausedRef freezes scrollLeft in place (0 effective speed) while the pointer is pulling
      // away from its closest approach to the edge, without changing edgeZoneRef.current or
      // stopping this loop — see the comment in handlePointerMove's hysteresis block.
      const effectiveSpeed = zonePausedRef.current ? 0 : SCROLL_SPEED_PX;
      const newScrollLeft = Math.max(0, Math.min(el.scrollLeft + dir * effectiveSpeed * delta, scrollCeiling));
      el.scrollLeft = newScrollLeft;
      lastAutoScrollRef.current = newScrollLeft; // keep playback edge-riding from misreading this

      // Single authority: time always = f(pointer viewport-X, current scrollLeft)
      const rawX = pointerViewportXRef.current + newScrollLeft;
      const newTime = clampToVisibleWindow(
        Math.max(0, Math.min((rawX - TRACK_PANEL_WIDTH) / zoom, endOfTimeline)),
        newScrollLeft,
        el.clientWidth,
      );
      setPlayheadTime(newTime);
      checkAudioMuteState(newTime);
      window.dispatchEvent(new CustomEvent('time-update', { detail: { time: newTime } }));

      // Stop when scroll hits a boundary. Also turn the zone off here (not just stop the loop):
      // auto-scroll has nowhere left to go, so there is nothing left for the rAF loop to drive.
      // Without this, edgeZoneRef.current stays 'on-left'/'on-right' and handlePointerMove's
      // `if (edgeZoneRef.current === 'off')` render gate never opens again — the playhead stops
      // responding to further pointer movement until the pointer is released, even though the
      // user is still actively holding it at the edge. Turning the zone off here lets
      // handlePointerMove immediately resume driving updates from raw pointer position next move;
      // its own hysteresis re-activates the zone (and restarts this loop) if the pointer is still
      // within EDGE_ZONE_PX, which is a harmless no-op since scrollLeft is already at its limit.
      // Uses scrollCeiling (not the raw maxScroll) so rightward auto-scroll correctly stops and
      // hands off at the 50%-centering cap above, the same way it already stops at true 0 on the
      // left.
      if (newScrollLeft <= 0 || newScrollLeft >= scrollCeiling) {
        stopEdgeLoop();
        edgeZoneRef.current = 'off';
        lastZoneDistRef.current = null;
        zonePausedRef.current = false;
        return;
      }

      edgeRafRef.current = requestAnimationFrame(edgeScrollFrame);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const el = timelineRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      const viewportX = moveEvent.clientX - rect.left;
      pointerViewportXRef.current = viewportX; // keep rAF loop's time derivation current

      const leftDist = viewportX - 256;         // px from left track edge
      const rightDist = el.clientWidth - viewportX; // px from right container edge

      const prevZone = edgeZoneRef.current;

      // Gate fresh zone engagement on actual intentional movement, not just static position.
      // Without this, a pointerdown that happens to land within EDGE_ZONE_PX of an edge (e.g. the
      // flag was already rendered there from an earlier scroll) engages full-speed auto-scroll on
      // the very next sub-pixel jitter — no real hand holds perfectly still. Only gates the OFF→ON
      // transition below; once genuinely engaged, continued/re-engaged tracking is unaffected.
      const movedEnough = Math.hypot(moveEvent.clientX - dragOriginRef.current.x, moveEvent.clientY - dragOriginRef.current.y) >= MIN_DRAG_DISTANCE_PX;

      // Hysteresis: activate at EDGE_ZONE_PX (once movedEnough), deactivate when >= EDGE_ZONE_RELEASE_PX
      // from the triggering edge. Unchanged from before — lastZoneDistRef/zonePausedRef below are a
      // SEPARATE, orthogonal mechanism layered on top (not folded into this transition),
      // specifically so a mid-zone reversal can't accidentally interact with entry/exit (an earlier
      // attempt that set edgeZoneRef.current = 'off' directly on a pull-away broke immediately:
      // landing back under EDGE_ZONE_PX re-triggered the OFF→ON branch on the very next
      // pointermove, silently undoing the exit). Pausing the rAF loop's own speed instead (see
      // edgeScrollFrame) sidesteps that: the zone state machine here is untouched by reversal
      // detection, so it can't re-arm itself against a pause.
      //
      // pausedRef itself is set from a STRICT sample-to-sample comparison (current vs. the
      // immediately preceding leftDist/rightDist), not a distance threshold — any outward movement
      // at all, even 1px, pauses on that very event. A prior version required the pointer to pull
      // 80px away from its closest approach before pausing, which left a real window right after a
      // reversal where auto-scroll kept running at full speed; confirmed via manual testing, not
      // just headless. Equal consecutive samples (e.g. pure vertical movement) leave the pause
      // state as-is rather than forcing either way.
      if (prevZone === 'off') {
        if (movedEnough && leftDist < EDGE_ZONE_PX) {
          edgeZoneRef.current = 'on-left';
          lastZoneDistRef.current = leftDist;
          zonePausedRef.current = false;
        } else if (movedEnough && rightDist < EDGE_ZONE_PX) {
          edgeZoneRef.current = 'on-right';
          lastZoneDistRef.current = rightDist;
          zonePausedRef.current = false;
        }
      } else if (prevZone === 'on-left') {
        if (leftDist >= EDGE_ZONE_RELEASE_PX) {
          edgeZoneRef.current = 'off';
          lastZoneDistRef.current = null;
          zonePausedRef.current = false;
        } else {
          if (lastZoneDistRef.current !== null) {
            if (leftDist > lastZoneDistRef.current) zonePausedRef.current = true;       // moving away — pause immediately
            else if (leftDist < lastZoneDistRef.current) zonePausedRef.current = false; // moving toward — resume immediately
          }
          lastZoneDistRef.current = leftDist;
        }
      } else {
        if (rightDist >= EDGE_ZONE_RELEASE_PX) {
          edgeZoneRef.current = 'off';
          lastZoneDistRef.current = null;
          zonePausedRef.current = false;
        } else {
          if (lastZoneDistRef.current !== null) {
            if (rightDist > lastZoneDistRef.current) zonePausedRef.current = true;
            else if (rightDist < lastZoneDistRef.current) zonePausedRef.current = false;
          }
          lastZoneDistRef.current = rightDist;
        }
      }

      // Start loop when zone just activated
      if (prevZone === 'off' && edgeZoneRef.current !== 'off' && edgeRafRef.current === null) {
        edgeLastTsRef.current = null;
        edgeRafRef.current = requestAnimationFrame(edgeScrollFrame);
      }
      // Stop loop when zone deactivated
      if (edgeZoneRef.current === 'off' && edgeRafRef.current !== null) {
        stopEdgeLoop();
      }

      // ALWAYS derive time from pointer + current scrollLeft — no "zone owns time" branch. This
      // is the single authority: the formula itself never differs by zone state.
      //
      // But WHICH caller gets to render it does differ by zone state. While the zone is active,
      // this handler skips calling setPlayheadTime entirely — the already-running rAF loop
      // (edgeScrollFrame) is the sole render driver during that phase. With both pointermove
      // (uncapped, can fire far faster than 60Hz) and the 60fps rAF loop independently calling
      // setPlayheadTime and each triggering a full re-render of this large component tree, the
      // combined volume periodically overwhelmed the main thread, producing a velocity-dependent
      // catch-up snap. Capping renders at the rAF loop's 60fps removes the second, uncapped
      // driver. pointerViewportXRef is still updated above on every pointermove regardless of
      // zone state, so the rAF loop always reads the freshest pointer position next frame.
      //
      // Note this branch also runs immediately after edgeScrollFrame's boundary-exit resets the
      // zone to 'off' (see edgeScrollFrame above) — that is what keeps the playhead responsive to
      // further pointer movement while held at scrollLeft 0/maxScroll, instead of going silent
      // until release.
      if (edgeZoneRef.current === 'off') {
        const rawX = viewportX + el.scrollLeft;
        const time = clampToVisibleWindow(
          Math.max(0, Math.min((rawX - TRACK_PANEL_WIDTH) / zoom, endOfTimeline)),
          el.scrollLeft,
          el.clientWidth,
        );
        setPlayheadTime(time);
        checkAudioMuteState(time);
        window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
      }
    };

    const cleanup = () => {
      // Pointer capture doesn't cover the synthetic `click` the browser dispatches right after
      // pointerup, which hit-tests the cursor's real screen position — very often the Ruler,
      // since it shares the flag's horizontal strip. Without this, that click's own seek handler
      // (handleRulerSeek) fires immediately after and overwrites the drag's last (possibly
      // clamped) position with an unclamped one derived from raw cursor position. No time value
      // is set here — release intentionally freezes on whatever handlePointerMove/edgeScrollFrame
      // last wrote.
      suppressRulerClickRef.current = true;
      flagEl.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      stopEdgeLoop();
      edgeZoneRef.current = 'off';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  useEffect(() => {
    const handleLoopToggle = (e: any) => setIsLooping(e.detail.isLooping);
    window.addEventListener('toggle-loop', handleLoopToggle);
    return () => window.removeEventListener('toggle-loop', handleLoopToggle);
  }, []);

  useEffect(() => {
    const handlePlayToggle = (e: any) => {
      setIsPlaying(e.detail.isPlaying);
      if (e.detail.isPlaying) lastTimeRef.current = performance.now();
    };
    window.addEventListener('toggle-play', handlePlayToggle);
    return () => window.removeEventListener('toggle-play', handlePlayToggle);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      // On fresh play: if the playhead is not currently visible, snap it to the center of the
      // viewport (50%). This is distinct from the edge-riding boundary (88%) — the snap gives
      // comfortable context on both sides; edge-riding only kicks in once the playhead reaches 88%.
      // Seed both tracking refs so the first rAF frame doesn't misread the snap as a manual scroll.
      const elOnPlay = timelineRef.current;
      if (elOnPlay) {
        const pos = 256 + playheadRef.current * zoom; // derive pixel from time
        const sl = elOnPlay.scrollLeft;
        const cw = elOnPlay.clientWidth;
        if (pos < sl || pos > sl + cw) {
          elOnPlay.scrollLeft = Math.max(0, Math.min(pos - cw * 0.5, elOnPlay.scrollWidth - cw));
        }
        lastAutoScrollRef.current = elOnPlay.scrollLeft;
        isFollowingRef.current = true;
      }

      if (!lastTimeRef.current) lastTimeRef.current = performance.now();

      // Seed lastBeatIndexRef so clicks only fire at real tick boundaries (ticks are
      // subdivision-sized — quarter note by default, or the finer 1/8 or 1/16 interval).
      // Exception: playheadTime === 0 (timeline start) seeds to -1 so tick 0's click is
      // heard immediately. Any other position seeds to the tick we're inside, so the first
      // click waits for the next boundary rather than firing spuriously.
      {
        const playheadTime = Math.max(0, playheadRef.current);
        const subdivisionFactor = METRONOME_SUBDIVISION_FACTORS[metronomeSubdivisionRef.current] ?? 1;
        const secondsPerBeat = 60 / bpm;
        const tickInterval = secondsPerBeat / subdivisionFactor;
        const currentTickIndex = Math.floor(playheadTime / tickInterval);
        lastBeatIndexRef.current = playheadTime === 0 ? -1 : currentTickIndex;
      }

      // Lazily wires a clip's audio element into the Web Audio graph so its pan can be
      // driven via a StereoPannerNode. createMediaElementSource can only ever be called
      // once per <audio> element — the panNodesRef entry is the guard against a second
      // attempt on the same element (matters across StrictMode double-invoke too).
      const ensurePanNode = (clipId: string, audio: HTMLAudioElement) => {
        if (panNodesRef.current[clipId]) return;
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        const source = ctx.createMediaElementSource(audio);
        const panner = ctx.createStereoPanner();
        source.connect(panner);
        panner.connect(ctx.destination);
        panNodesRef.current[clipId] = panner;
      };

      // The metronome is a guide click and intentionally NOT scaled by masterVolumeRef
      // so it stays audible even when the user lowers mix volume to work quietly.
      const playMetronomeClick = (accent: boolean) => {
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        // Square wave has far more harmonic content than the sine default at the same gain —
        // reads as a sharper, more piercing click that cuts through the mix better.
        osc.type = 'square';
        osc.frequency.value = accent ? 1000 : 800;
        const now = ctx.currentTime;
        // Decibel-based curve — perceived loudness is roughly logarithmic, so mapping the
        // slider linearly in dB (rather than any power curve on gain directly) makes each
        // 10% of slider movement a roughly equal step in perceived loudness across the whole
        // range. -30dB (gain ≈0.0316) at volume=0 up to 0dB (unity gain) at volume=100.
        // Floored at 0.0001 as a hard safety clamp underneath the curve.
        const t = metronomeVolumeRef.current / 100;
        const minDb = -12; // volume=0 → quiet but present (gain ≈0.25), not near-silent
        const maxDb = 0;   // volume=100 → peak gain 1.0 (unity, stays clear of clipping)
        const db = minDb + t * (maxDb - minDb);
        const peakGain = Math.max(0.0001, Math.pow(10, db / 20));
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        osc.start(now);
        osc.stop(now + 0.05);
      };

      const animate = (time: number) => {
        if (lastTimeRef.current) {
          const delta = time - lastTimeRef.current;
          const timeDelta = delta / 1000;

          // Auto-stop at the layout's end of timeline. This effect re-runs whenever the
          // layout changes, so live clip/section edits during playback are reflected.
          const frameTimelineEnd = endOfTimeline;
          if (!isLooping && playheadRef.current + timeDelta >= frameTimelineEnd) {
            setPlayheadTime(frameTimelineEnd);
            Object.values(customAudioRefs.current).forEach((audio) => audio.pause());
            pendingPlayRef.current.clear();
            // See the isPlaying-false effect above: once panNodesRef has entries, those
            // <audio> elements are permanently bound to this context — suspend, don't close.
            if (Object.keys(panNodesRef.current).length > 0) {
              audioCtxRef.current?.suspend();
            } else {
              audioCtxRef.current?.close();
              audioCtxRef.current = null;
            }
            setIsPlaying(false);
            window.dispatchEvent(new CustomEvent('playback-ended'));
            lastTimeRef.current = time;
            return;
          }

          // Metronome: fire a click whenever the playhead crosses into a new tick.
          // A "tick" is one subdivision interval (quarter/eighth/sixteenth note), not
          // necessarily a full quarter-note beat — see subdivisionFactor below.
          if (isMetronomeOnRef.current && bpm > 0) {
            const newTime = Math.max(0, playheadRef.current + timeDelta);
            const beatsPerMeasure = parseInt(timeSignature.split('/')[0], 10) || 4;
            const subdivisionFactor = METRONOME_SUBDIVISION_FACTORS[metronomeSubdivisionRef.current] ?? 1;
            const secondsPerBeat = 60 / bpm;
            const tickInterval = secondsPerBeat / subdivisionFactor;
            const currentTickIndex = Math.floor(newTime / tickInterval);
            if (currentTickIndex !== lastBeatIndexRef.current) {
              // subdivisionFactor ticks make up one quarter-note beat, so only every
              // subdivisionFactor-th tick actually lands on a true quarter-note boundary.
              // The accent (higher pitch) is reserved for beat 0 of the measure on that
              // boundary — an 1/8 or 1/16 tick that falls between quarter notes must
              // never accidentally trigger it.
              const isQuarterNoteBeat = currentTickIndex % subdivisionFactor === 0;
              const quarterNoteBeatIndex = currentTickIndex / subdivisionFactor;
              const accent = isQuarterNoteBeat && quarterNoteBeatIndex % beatsPerMeasure === 0;
              playMetronomeClick(accent);
              lastBeatIndexRef.current = currentTickIndex;
            }
          }

          // Advance playhead — pure position computation + audio scheduling only, no scroll side effects.
          setPlayheadTime((prev) => {
            const newTime = prev + timeDelta;
            const prevTime = prev;

            if (isLooping) {
              const currentSection = sectionAt(prevTime, layout.sections);
              if (currentSection) {
                if (newTime >= currentSection.end) {
                  Object.values(customAudioRefs.current).forEach((audio) => {
                    if (audio && !audio.paused) audio.currentTime = currentSection.start;
                  });
                  return currentSection.start;
                }
              }
            }

            for (const track of tracks) {
              for (const clip of track.clips) {
                const audio = customAudioRefs.current[clip.id];
                if (!audio || !clip.src) continue;

                const clipStart = clip.start;
                // In-point and out-point in the file: trim plus the layout's head cut
                // (a pickup with no room). A clip cut to nothing is never in range.
                const { inPoint: trimStart, outPoint: trimEnd, length: effectiveDuration } = playedSpan(clip);
                const clipEnd = clipStart + effectiveDuration;
                const inRange = newTime >= clipStart && newTime < clipEnd;

                if (inRange && isPlaying) {
                  // On a seek-while-playing, force-reset currentTime even if the clip wasn't
                  // paused (it stayed in-range across the seek so audio.paused never went true).
                  if (seekPendingRef.current && !audio.paused) {
                    audio.currentTime = trimStart + Math.max(0, newTime - clipStart);
                  }
                  // audioCtxReadyRef.current gates this on resume() having actually resolved
                  // to "running" (set in the toggle-play handler above) — without it, play()
                  // fires while the graph is still on a suspended context and produces no
                  // audible output despite the element reporting paused:false. When not yet
                  // ready, this simply no-ops and retries on the next rAF frame; audio.paused
                  // stays true and pendingPlayRef stays empty for this clip until it's ready.
                  if (audio.paused && !pendingPlayRef.current.has(clip.id) && audioCtxReadyRef.current) {
                    audio.currentTime = trimStart + Math.max(0, newTime - clipStart);
                    pendingPlayRef.current.add(clip.id);
                    audio.play()
                      .then(() => {
                        pendingPlayRef.current.delete(clip.id);
                      })
                      .catch((e) => {
                        pendingPlayRef.current.delete(clip.id);
                        console.warn('play failed:', e);
                      });
                  }
                  // Stop playback if audio has passed trimEnd
                  if (!audio.paused && audio.currentTime >= trimEnd) {
                    audio.pause();
                    pendingPlayRef.current.delete(clip.id);
                  }
                  // Update volume/mute every frame. playbackRate is never written: clips always
                  // play at their recorded speed (the <audio> default of 1). Tempo only drives
                  // the metronome and grid — it must never time-stretch recordings.
                  audio.volume = (track.volume / 100) * masterVolumeRef.current;
                  audio.muted = track.muted;
                  ensurePanNode(clip.id, audio);
                  if (panNodesRef.current[clip.id]) {
                    panNodesRef.current[clip.id].pan.value = track.pan / 100;
                  }
                } else {
                  if (!audio.paused) {
                    audio.pause();
                    pendingPlayRef.current.delete(clip.id);
                  }
                }
              }
            }

            seekPendingRef.current = false;
            window.dispatchEvent(new CustomEvent('time-update', { detail: { time: newTime } }));
            return newTime;
          });

          // Edge-riding scroll: runs once per frame, after setPlayheadTime has updated playheadRef.
          //
          // Two-state model:
          //   ENGAGED (isFollowingRef = true): auto-scroll is active. Any manual scroll (detected
          //     via el.scrollLeft diverging from lastAutoScrollRef by >1px) immediately disengages.
          //   DISENGAGED (isFollowingRef = false): el.scrollLeft is never touched. Re-engagement
          //     requires only that the playhead is currently visible in the viewport.
          //
          // Once engaged, the 88% boundary gates whether to actually write scrollLeft — but
          // visibility alone is what controls the engaged/disengaged state.
          const el = timelineRef.current;
          if (el) {
            const pos = 256 + playheadRef.current * zoom; // derive pixel from time
            const cw = el.clientWidth;
            const sl = el.scrollLeft;

            if (isFollowingRef.current) {
              // Detect manual scroll: el.scrollLeft moved without us writing it.
              const lastAuto = lastAutoScrollRef.current;
              if (lastAuto !== null && Math.abs(sl - lastAuto) > 1) {
                isFollowingRef.current = false;
                // Fall through to re-engagement check below (same frame).
              }
            }

            if (!isFollowingRef.current) {
              // Re-engage as soon as the playhead is visible anywhere in the viewport.
              if (pos >= sl && pos <= sl + cw) {
                isFollowingRef.current = true;
                lastAutoScrollRef.current = sl; // baseline for next frame's manual-scroll detection
              }
            }

            if (isFollowingRef.current && pos >= sl + cw * 0.88) {
              const newScrollLeft = Math.max(0, Math.min(pos - cw * 0.88, el.scrollWidth - cw));
              el.scrollLeft = newScrollLeft;
              lastAutoScrollRef.current = newScrollLeft;
            }

          }
        }
        lastTimeRef.current = time;
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      Object.values(customAudioRefs.current).forEach((audio) => {
        if (audio && !audio.paused) audio.pause();
      });
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isPlaying, tracks, bpm, timeSignature, isLooping, layout, endOfTimeline, zoom, setPlayheadTime]);


  useEffect(() => {
    const handleToggleMute = (e: any) => {
      setTracks((prev) => prev.map((t) => (t.id === e.detail.trackId ? { ...t, muted: !t.muted } : t)));
    };
    const handleToggleSolo = (e: any) => {
      setTracks((prev) => {
        const target = prev.find((t) => t.id === e.detail.trackId);
        if (!target) return prev;
        const willBeSolo = !target.solo;
        return prev.map((t) => {
          if (t.id === e.detail.trackId) return { ...t, solo: willBeSolo, muted: false };
          return willBeSolo ? { ...t, solo: false, muted: true } : { ...t, solo: false, muted: false };
        });
      });
    };
    const handleUpdateVolume = (e: any) => {
      const { trackId, volume } = e.detail as { trackId: string; volume: number };
      setTracks((prev) =>
        prev.map((t) => (t.id === trackId ? { ...t, volume } : t))
      );
      clearTimeout(volumePatchTimers.current[trackId]);
      volumePatchTimers.current[trackId] = setTimeout(() => {
        fetch(`/api/tracks/${trackId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume }),
        })
          .then(() => Promise.all([
            queryClient.invalidateQueries({ queryKey: ['songs'] }),
            queryClient.invalidateQueries({ queryKey: ['activity'] }),
          ]))
          .catch((err) => console.error('Failed to persist track volume:', err));
      }, 500);
    };
    const handleReplaceClip = (e: any) => {
      const { oldClipId, newClip } = e.detail;
      setTracks((prev) =>
        prev.map((t) => {
          if (!t.clips.some((c) => c.id === oldClipId)) return t;
          return {
            ...t,
            clips: t.clips.map((c) =>
              c.id === oldClipId
                ? { ...newClip, id: c.id, start: c.start, duration: c.duration, sectionName: c.sectionName, sectionOffset: c.sectionOffset }
                : c
            ),
          };
        })
      );
      fetch(`/api/timeline-clips/${oldClipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newClip.name, type: newClip.type, color: newClip.color, src: newClip.src ?? null }),
      }).catch((err) => console.error('Failed to update replaced clip:', err));
    };

    const handleRemoveClip = (e: any) => {
      const { clipId } = e.detail;
      setTracks((prev) => {
        const track = prev.find((t) => t.clips.some((c) => c.id === clipId));
        if (!track) return prev;

        // The removed clip leaves a gap: the clips after it keep their offsets, so
        // nothing else is saved.
        const draft = prev.map((t) =>
          t.id === track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t
        );

        fetch(`/api/timeline-clips/${clipId}`, { method: 'DELETE' })
          .then(() => Promise.all([
            queryClient.invalidateQueries({ queryKey: ['activity'] }),
            queryClient.invalidateQueries({ queryKey: ['songs'] }),
            queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] }),
            queryClient.invalidateQueries({ queryKey: ['final-clips', songId] }),
          ]))
          .catch((err) => console.error('Failed to delete timeline clip:', err));
        return draft;
      });
      // Clear selection if the deleted clip was selected.
      setSelectedTimelineClipId((prev) => {
        if (prev === clipId) {
          localStorage.removeItem(`patchbay-selected-timeline-clip-${songId}`);
          return null;
        }
        return prev;
      });
    };

    const handleTrackSelected = (e: any) => {
      if (controlInteractionRef.current) return;
      const { trackId } = e.detail;
      setSelectedTimelineTrackId(trackId);
      setSelectedTimelineClipId(null);
      localStorage.setItem(`patchbay-selected-timeline-track-${songId}`, trackId);
      localStorage.removeItem(`patchbay-selected-timeline-clip-${songId}`);
    };
    const handleClipSelected = (e: any) => {
      const { clipId, trackId: tid } = e.detail;
      setSelectedTimelineClipId(clipId);
      setSelectedTimelineTrackId(tid ?? null);
      localStorage.setItem(`patchbay-selected-timeline-clip-${songId}`, clipId);
      if (tid) localStorage.setItem(`patchbay-selected-timeline-track-${songId}`, tid);
    };

    window.addEventListener('toggle-track-mute', handleToggleMute);
    window.addEventListener('toggle-track-solo', handleToggleSolo);
    window.addEventListener('update-track-volume', handleUpdateVolume);
    window.addEventListener('replace-clip', handleReplaceClip);
    window.addEventListener('remove-clip', handleRemoveClip);
    window.addEventListener('timeline-track-selected', handleTrackSelected);
    window.addEventListener('timeline-clip-selected', handleClipSelected);
    return () => {
      window.removeEventListener('toggle-track-mute', handleToggleMute);
      window.removeEventListener('toggle-track-solo', handleToggleSolo);
      window.removeEventListener('update-track-volume', handleUpdateVolume);
      window.removeEventListener('replace-clip', handleReplaceClip);
      window.removeEventListener('remove-clip', handleRemoveClip);
      window.removeEventListener('timeline-track-selected', handleTrackSelected);
      window.removeEventListener('timeline-clip-selected', handleClipSelected);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(MouseSensor, POINTER_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS)
  );

  // ── Section-reorder handlers (separate DndContext) ─────────────────────────
  // A header drag scrolls the timeline with the playhead drag's panel-aware edge scroll
  // (createEdgeScroller) — dnd-kit's own auto-scroll is off in this DndContext — and
  // the gold line follows the pointer source (startDragPointer).
  const headerEdgeScrollerRef = useRef<EdgeScroller | null>(null);
  const grabbingCursorStyleRef = useRef<HTMLStyleElement | null>(null);
  useEffect(() => () => { grabbingCursorStyleRef.current?.remove(); }, []);
  const handleSectionDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (!id.startsWith('sec||')) return;
    const name = id.slice(5);
    draggedSectionRef.current = name;
    setActiveSectionName(name);
    const origin = getEventCoordinates(event.activatorEvent) ?? { x: 0, y: 0 };
    // Where the header was grabbed, from the section's start (content px) — the clip
    // ghost keeps this offset from the pointer.
    const grabbedEl = timelineRef.current;
    const grabbedSection = sectionLayout.find((s) => s.name === name);
    sectionDragGrabOffsetRef.current = grabbedEl && grabbedSection
      ? origin.x - grabbedEl.getBoundingClientRect().left + grabbedEl.scrollLeft - (TRACK_PANEL_WIDTH + grabbedSection.start * zoom)
      : 0;
    const scroller = createEdgeScroller({
      getEl: () => timelineRef.current,
      startInset: TRACK_PANEL_WIDTH,
      // Read live: a timeline clip drag's preview layout can grow the content mid-drag.
      endScrollCap: (el) => Math.max(0, Math.min(
        contentEndRef.current * zoomRef.current - (el.clientWidth - TRACK_PANEL_WIDTH) / 2,
        el.scrollWidth - el.clientWidth,
      )),
      onScrolled: (scrollLeft) => { lastAutoScrollRef.current = scrollLeft; },
    });
    scroller.start(origin.x, origin.y);
    headerEdgeScrollerRef.current = scroller;
    startDragPointer(origin, { onMove: (e) => scroller.onPointerMove(e) });
    recomputeDragIndicatorsRef.current();
    // Grabbing cursor everywhere for the length of the drag (elements' own cursors —
    // cursor-grab on the headers, pointer on buttons — would otherwise win).
    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = '* { cursor: grabbing !important; }';
    document.head.appendChild(cursorStyle);
    grabbingCursorStyleRef.current = cursorStyle;
  };

  const endSectionDrag = () => {
    grabbingCursorStyleRef.current?.remove();
    grabbingCursorStyleRef.current = null;
    headerEdgeScrollerRef.current?.stop();
    headerEdgeScrollerRef.current = null;
    stopDragPointer();
    draggedSectionRef.current = null;
    headerDropRef.current = null;
    setHeaderDrop(null);
    setActiveSectionName(null);
  };

  // A section reorder only changes song_sections.sort_order (the arrangement order):
  // no clip offset changes, so no clip is written. The cache takes the new order at
  // once and rolls back if the PUT fails. The filing order (ideas.sortOrder) of the
  // Media Bucket, Production and the pickers doesn't change, so nothing else refreshes.
  const sectionOrderMutation = useMutation({
    mutationKey: ['song-sections-order', songId],
    mutationFn: (move: SectionMove) =>
      apiRequest('PUT', `/api/songs/${songId}/sections/order`, move).then((r) => r.json() as Promise<SongSectionRow[]>),
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: songSectionsKey(songId) });
      const previous = queryClient.getQueryData<SongSectionRow[]>(songSectionsKey(songId));
      if (previous) queryClient.setQueryData(songSectionsKey(songId), applySectionMove(previous, move));
      return { previous };
    },
    onError: (err, _move, context) => {
      console.error('Failed to save section order:', err);
      if (context?.previous) queryClient.setQueryData(songSectionsKey(songId), context.previous);
      toast({ title: 'Failed to reorder sections', description: (err as Error).message, variant: 'destructive' });
    },
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['songs'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: songSectionsKey(songId) }),
  });

  // Sends exactly what the line showed (headerDropTarget); no line = nothing to send.
  // Orphans (clips but no song_sections row) are never in the target: they always lay
  // out after every row, so they can't be placed by sort_order.
  const handleSectionDragEnd = () => {
    const target = headerDropRef.current;
    if (target) {
      sectionOrderMutation.mutate({ section: target.section, before: target.before, after: target.after });
    }
    endSectionDrag();
  };

  // Escape or a sensor cancel: clear the line, send nothing.
  const handleSectionDragCancel = () => endSectionDrag();
  // ─────────────────────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    // The shared organize hook takes its drag-start snapshot (loose files and
    // versions) here, the same as SongHome and the Songs quick-browser.
    looseFileOrganizeDnd.handleDragStart(event);
    // Horizontal drop positions (and the new-section line) read this pointer source. A
    // file from the Media Bucket (a version or a loose file) and a timeline clip both
    // edge-scroll the timeline with createEdgeScroller, a file on both axes (dnd-kit's
    // own auto-scroll never moves the timeline — see dndAutoScroll).
    const startCoords = getEventCoordinates(event.activatorEvent) ?? { x: 0, y: 0 };
    const dragType = event.active.data.current?.type as string | undefined;
    if (dragType === BUCKET_CLIP_DRAG_TYPE) {
      // A version: also the live placement preview (startFileDropPreview), which reads
      // Shift from every pointer event, as a timeline clip drag does.
      startFileEdgeScroll({ vertical: true });
      startFileDragBlurCancel();
      const data = event.active.data.current;
      if (data?.clip) {
        startFileDropPreview(
          { ...(data.clip as Clip), isFullTake: !!(data.clip.isFullTake || data.isFullTake) },
          data.trackId as string | undefined,
        );
      }
      startDragPointer(startCoords, {
        onMove: (e) => { readClipDragKeys(e); fileEdgeScrollMove(e); },
        onScroll: nudgeDndCollision,
      });
    } else if (dragType === 'loose-file') {
      // A loose file: the same live placement preview, on whichever track and section
      // the pointer is over (startLooseDropPreview).
      startFileEdgeScroll({ vertical: true });
      startFileDragBlurCancel();
      const data = event.active.data.current;
      if (data?.clip) startLooseDropPreview(data.clip as Clip, (data.trackId as string | null | undefined) ?? null);
      startDragPointer(startCoords, {
        onMove: (e) => { readClipDragKeys(e); fileEdgeScrollMove(e); },
        onScroll: nudgeDndCollision,
      });
    } else if (dragType === 'clip' && event.active.data.current?.clip && event.active.data.current?.trackId) {
      const dragClip = event.active.data.current.clip as Clip;
      const dragClipTrackId = event.active.data.current.trackId as string;
      // Grabbing a clip selects it, the same selection a click makes.
      window.dispatchEvent(new CustomEvent('timeline-clip-selected', { detail: { clipId: dragClip.id, trackId: dragClipTrackId } }));
      startClipDrag(startCoords.x, dragClip, dragClipTrackId);
      startFileEdgeScroll();
      startDragPointer(startCoords, {
        onMove: (e) => { readClipDragKeys(e); fileEdgeScrollMove(e); },
        onScroll: nudgeDndCollision,
      });
    } else {
      startDragPointer(startCoords);
    }
    const clip = event.active.data.current?.clip as Clip;
    const type = event.active.data.current?.type as string;
    const dragTrackId = event.active.data.current?.trackId as string | undefined;
    const dragSongId = event.active.data.current?.songId as string | undefined;
    if (clip && type) {
      let enrichedClip = { ...clip };
      if (type === 'bucket-clip' && !clip.sectionName) {
        // Fallback for mock clips that don't carry sectionName: derive from MOCK_SONG idea name.
        // Real API clips always have sectionName set via apiClipToClip(), so this branch won't run for them.
        outer: for (const inst of MOCK_SONG.instruments) {
          for (const idea of inst.ideas) {
            if (idea.versions.some((v) => v.id === clip.id)) {
              enrichedClip.sectionName = idea.name.replace(inst.name + ' ', '');
              break outer;
            }
          }
        }
      }
      setActiveDragData({ clip: enrichedClip, type, trackId: dragTrackId, songId: dragSongId });
    }
  };

  // Places a full-take clip at an arbitrary start time on a track, bypassing section logic.
  const insertFreeformClip = (trackId: string, clip: Clip, startTime: number) => {
    const newId = nanoid();
    setTracks((prev) => {
      const targetTrack = prev.find((t) => t.id === trackId);
      if (!targetTrack) return prev;
      const newClip: Clip = {
        ...clip,
        id: newId,
        start: startTime,
        isFullTake: true,
        sectionName: undefined,
        trimStart: 0,
        trimEnd: null,
        bucketClipId: clip.id,
        isFinal: false,
      };
      return prev.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t
      );
    });

    fetch(`/api/tracks/${trackId}/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newId, trackId, name: clip.name, type: clip.type, color: clip.color,
        start: startTime, duration: clip.duration,
        src: clip.src ?? null, sectionName: 'Full Takes',
        trimStart: 0, trimEnd: null,
        bucketClipId: clip.id,
        isFullTake: true,
      }),
    })
      .then(async (res) => {
        const serverClip = await res.json();
        if (serverClip.isFinal) {
          setTracks((prev) => prev.map((t) =>
            t.id === trackId
              ? { ...t, clips: t.clips.map((c) => c.id === newId ? { ...c, isFinal: true } : c) }
              : t
          ));
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['activity'] }),
          queryClient.invalidateQueries({ queryKey: ['songs'] }),
        ]);
      })
      .catch((err) => console.error('Failed to persist full-take clip:', err));

    return newId;
  };

  // The arrangement position a section's first clip gets from a drop at `dropTime`
  // (seconds): between the two timeline sections whose midpoints it falls between —
  // before the first one, or null (the end rule) past the last one's midpoint. Only
  // sections with a song_sections row count; orphans always lay out last anyway.
  const firstClipHintAt = (dropTime: number): SectionPlacementHint | null => {
    const visible = rowSectionsOnTimeline();
    const i = visible.findIndex((s) => dropTime < s.start + s.length / 2);
    if (i === -1) return null;
    return { before: visible[i].name, after: visible[i - 1]?.name ?? null };
  };
  const rowSectionsOnTimeline = () => {
    const rowNames = new Set(sections.map((s) => s.name));
    return layout.sections.filter((s) => rowNames.has(s.name));
  };
  // Song time of the boundary a first-clip drop at `dropTime` lands on — read from
  // firstClipHintAt's own answer, so the insertion line and the drop can't disagree:
  // the start of `before`, or with no hint (the end rule) the end of the last section
  // on the timeline, or 0 when nothing is on it.
  const firstClipBoundaryAt = (dropTime: number): number => {
    const visible = rowSectionsOnTimeline();
    const hint = firstClipHintAt(dropTime);
    const before = hint?.before ? visible.find((s) => s.name === hint.before) : undefined;
    if (before) return before.start;
    return visible.length ? visible[visible.length - 1].end : 0;
  };
  // Song time under a viewport clientX: clientX − the timeline's left edge + scrollLeft
  // − the sticky track panel, ÷ zoom. Scroll is counted once.
  const dragPointerTime = (clientX: number): number => {
    const el = timelineRef.current;
    return (clientX - (el?.getBoundingClientRect().left ?? 0) + (el?.scrollLeft ?? 0) - TRACK_PANEL_WIDTH) / zoom;
  };

  // ── Drag pointer source ────────────────────────────────────────────────────
  // While a drag is active (a section header, or a file from the Media Bucket), the
  // pointer's horizontal position comes from a window pointermove listener (capture
  // phase), never from dnd-kit's activatorEvent.clientX + delta.x: that delta also
  // carries the scroll of the dragged node's scroll containers — for a section header,
  // the timeline itself — so adding scrollLeft on top counted the scroll twice. The
  // drag indicators are recomputed on every pointer move and every timeline scroll.
  // Started in the drag-start handlers; stopped on drag end, cancel and unmount.
  const dragClientXRef = useRef<number | null>(null);
  const dragClientYRef = useRef<number | null>(null);
  const dragPointerCleanupRef = useRef<(() => void) | null>(null);
  const recomputeDragIndicatorsRef = useRef<() => void>(() => {});
  const stopDragPointer = () => {
    dragPointerCleanupRef.current?.();
    dragPointerCleanupRef.current = null;
    dragClientXRef.current = null;
    dragClientYRef.current = null;
  };
  const startDragPointer = (
    initial: { x: number; y: number },
    hooks?: { onMove?: (e: PointerEvent) => void; onScroll?: () => void },
  ) => {
    stopDragPointer();
    dragClientXRef.current = initial.x;
    dragClientYRef.current = initial.y;
    const onPointerMove = (e: PointerEvent) => {
      dragClientXRef.current = e.clientX;
      dragClientYRef.current = e.clientY;
      hooks?.onMove?.(e);
      recomputeDragIndicatorsRef.current();
    };
    const onScroll = () => {
      recomputeDragIndicatorsRef.current();
      hooks?.onScroll?.();
    };
    const el = timelineRef.current;
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    el?.addEventListener('scroll', onScroll, { passive: true });
    dragPointerCleanupRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      el?.removeEventListener('scroll', onScroll);
    };
  };
  useEffect(() => () => stopDragPointer(), []);

  // ── Edge scroll for file and timeline clip drags ───────────────────────────
  // A file dragged from the Media Bucket (a version or a loose file), or a timeline
  // clip, scrolls the timeline horizontally with createEdgeScroller — the header drag's panel-aware edge
  // scroll, with the playhead's constants — but only while the pointer is over the
  // timeline's track area (below the ruler and header row). The minimum-drag distance
  // counts from where the pointer ENTERED the track area (the scroller restarts on
  // each entry), not from the drag's origin in the Media Bucket. Leaving the track
  // area stops it; drop, cancel and unmount stop it too.
  // A file drag (not a timeline clip drag) also scrolls vertically: a second scroller
  // on axis 'y', so both run in a corner. Its area is the whole timeline element, ruler
  // and header rows included, while its zone is still measured from the track rows'
  // top: an overshoot up into the sticky header reads as a negative distance and stays
  // engaged (like the track panel for horizontal) instead of stopping it and restarting
  // the 72 px gate on re-entry. dnd-kit's auto-scroll never moves the timeline (see
  // dndAutoScroll).
  const fileEdgeScrollerRef = useRef<EdgeScroller | null>(null);
  const fileVEdgeScrollerRef = useRef<EdgeScroller | null>(null);
  const fileDragInTrackAreaRef = useRef(false);
  const fileDragInTimelineRef = useRef(false);
  const startFileEdgeScroll = (opts?: { vertical?: boolean }) => {
    fileEdgeScrollerRef.current?.stop();
    fileVEdgeScrollerRef.current?.stop();
    fileVEdgeScrollerRef.current = opts?.vertical
      ? createEdgeScroller({ getEl: () => timelineRef.current, axis: 'y', startInset: TRACK_ROWS_TOP_PX })
      : null;
    fileDragInTrackAreaRef.current = false;
    fileDragInTimelineRef.current = false;
    fileEdgeScrollerRef.current = createEdgeScroller({
      getEl: () => timelineRef.current,
      startInset: TRACK_PANEL_WIDTH,
      // Read live: a timeline clip drag's preview layout can grow the content mid-drag.
      endScrollCap: (el) => Math.max(0, Math.min(
        contentEndRef.current * zoomRef.current - (el.clientWidth - TRACK_PANEL_WIDTH) / 2,
        el.scrollWidth - el.clientWidth,
      )),
      onScrolled: (scrollLeft) => { lastAutoScrollRef.current = scrollLeft; },
    });
  };
  // Losing focus (switching apps) during a file drag cancels it, like Esc: the
  // pointer's release may never reach this window, and the edge scrollers' rAF loops
  // keep running in a visible but unfocused window. Same mechanism as clip drags
  // (startClipDrag): dnd-kit's pointer sensor cancels on a window 'visibilitychange'
  // event, which runs handleDragCancel. Removed in stopFileEdgeScroll.
  const fileDragBlurCleanupRef = useRef<(() => void) | null>(null);
  const startFileDragBlurCancel = () => {
    fileDragBlurCleanupRef.current?.();
    const onBlur = () => window.dispatchEvent(new Event('visibilitychange'));
    window.addEventListener('blur', onBlur);
    fileDragBlurCleanupRef.current = () => window.removeEventListener('blur', onBlur);
  };
  const stopFileEdgeScroll = () => {
    fileDragBlurCleanupRef.current?.();
    fileDragBlurCleanupRef.current = null;
    fileEdgeScrollerRef.current?.stop();
    fileEdgeScrollerRef.current = null;
    fileVEdgeScrollerRef.current?.stop();
    fileVEdgeScrollerRef.current = null;
    fileDragInTrackAreaRef.current = false;
    fileDragInTimelineRef.current = false;
  };
  const fileEdgeScrollMove = (e: PointerEvent) => {
    const scroller = fileEdgeScrollerRef.current;
    const vScroller = fileVEdgeScrollerRef.current;
    const el = timelineRef.current;
    if (!scroller || !el) return;
    const rect = el.getBoundingClientRect();
    const inTimelineX = e.clientX >= rect.left && e.clientX <= rect.left + el.clientWidth;
    const inTimeline = inTimelineX
      && e.clientY >= rect.top && e.clientY <= rect.top + el.clientHeight;
    const inTrackArea = inTimelineX
      && e.clientY >= rect.top + TRACK_ROWS_TOP_PX && e.clientY <= rect.top + el.clientHeight;
    if (vScroller) {
      if (!inTimeline) {
        if (fileDragInTimelineRef.current) {
          vScroller.stop();
          fileDragInTimelineRef.current = false;
        }
      } else {
        if (!fileDragInTimelineRef.current) {
          fileDragInTimelineRef.current = true;
          vScroller.start(e.clientX, e.clientY);
        }
        vScroller.onPointerMove(e);
      }
    }
    if (!inTrackArea) {
      if (fileDragInTrackAreaRef.current) {
        scroller.stop();
        fileDragInTrackAreaRef.current = false;
      }
      return;
    }
    if (!fileDragInTrackAreaRef.current) {
      fileDragInTrackAreaRef.current = true;
      scroller.start(e.clientX, e.clientY);
    }
    scroller.onPointerMove(e);
  };
  // A timeline scroll under a still pointer moves the track rows (they're in the
  // scrolled content) but dnd-kit only re-runs collision detection when its drag state
  // changes, and the timeline isn't one of the dragged file's scroll containers, so
  // `over` — the track row a loose file's drop reads — would go stale. A
  // synthetic pointermove at the last pointer position makes the PointerSensor
  // dispatch a move (same coordinates), so collisions re-run against the re-measured
  // rects. Our own capture listener sees it too, which is harmless: same position.
  // The synthetic move carries the current Shift/Option state, so the timeline clip
  // drag's modifier tracking (which reads every pointer event) never sees it as released.
  const nudgeDndCollision = () => {
    const x = dragClientXRef.current;
    const y = dragClientYRef.current;
    if (x === null || y === null) return;
    const keys = clipDragKeysRef.current;
    document.dispatchEvent(new PointerEvent('pointermove', {
      clientX: x, clientY: y, bubbles: true, isPrimary: true,
      shiftKey: keys.shift, altKey: keys.option,
    }));
  };
  useEffect(() => () => stopFileEdgeScroll(), []);

  // ── Timeline clip drag: grab point and modifier keys ───────────────────────
  // Set at a timeline clip's drag start, cleared on drop, cancel and unmount:
  //  - grab offset: where in the clip it was grabbed, in seconds from the clip's layout
  //    start (pointer song time at drag start − clip start). clipDragDropStart() gives
  //    the clip's start time if it were dropped now.
  //  - the dragged clip and its track.
  //  - Shift / Option: read from each pointer and key event itself (e.shiftKey /
  //    e.altKey), never toggled, so switching apps mid-drag can't leave one stuck;
  //    window blur clears both. Shift places freely (no snap) for this drag.
  const clipDragRef = useRef<{ grabOffsetSec: number; clipId: string; trackId: string } | null>(null);
  // The widest content end (seconds) the drag's preview layout has reached — see
  // contentEnd in the render.
  const clipDragMaxEndRef = useRef(0);
  const clipDragKeysRef = useRef<{ shift: boolean; option: boolean }>({ shift: false, option: false });
  // Whether this drag may place the clip before its downbeat without Option (shared
  // pickupAllowed): set at drag start from its stored offset, updated by each placement.
  const clipDragPickupRef = useRef<PickupDragState>({ wasPickup: false, crossedDownbeat: false });
  const clipDragKeyCleanupRef = useRef<(() => void) | null>(null);
  const clipDragDropStart = (): number | null => {
    const drag = clipDragRef.current;
    const clientX = dragClientXRef.current;
    if (!drag || clientX === null) return null;
    return dragPointerTime(clientX) - drag.grabOffsetSec;
  };
  const clipDragModifiers = () => ({ ...clipDragKeysRef.current });
  const readClipDragKeys = (e: { shiftKey: boolean; altKey: boolean }) => {
    clipDragKeysRef.current = { shift: e.shiftKey, option: e.altKey };
  };
  // The polls' hold for one timeline clip drag: taken when the drag starts (any poll
  // response already on its way is dropped), and released exactly once — when the
  // drag ends with nothing to save (Esc, blur, a release that changes nothing), or
  // after its save and the refetch after it, whether the save worked or not.
  const clipDragHoldRef = useRef(false);
  const holdPollsForClipDrag = () => {
    if (clipDragHoldRef.current) return;
    clipDragHoldRef.current = true;
    setClipDragsBusy((n) => n + 1);
    dropPollsInFlight();
  };
  const takeClipDragHold = (): (() => void) => {
    if (!clipDragHoldRef.current) return () => {};
    clipDragHoldRef.current = false;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setClipDragsBusy((n) => Math.max(0, n - 1));
    };
  };
  const startClipDrag = (startClientX: number, clip: Clip, trackId: string) => {
    stopClipDrag();
    takeClipDragHold()();
    holdPollsForClipDrag();
    clipDragMaxEndRef.current = layout.timelineEnd;
    const startPointerTime = dragPointerTime(startClientX);
    const layoutStart = tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id)?.start;
    clipDragRef.current = {
      grabOffsetSec: startPointerTime - (layoutStart ?? startPointerTime),
      clipId: clip.id,
      trackId,
    };
    clipDragKeysRef.current = { shift: false, option: false };
    const storedClip = trackState.find((t) => t.id === trackId)?.clips.find((c) => c.id === clip.id);
    clipDragPickupRef.current = startPickupDrag(storedClip?.sectionOffset);
    // A key pressed or released under a still pointer: update the state and re-run the
    // drag's preview step at the last pointer position (the indicators, and dnd-kit's
    // collision pass via a synthetic move). Shift/Option key events stop here (capture
    // phase) so the arrow-key selection handler never sees them mid-drag.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Alt') return;
      e.stopPropagation();
      const prev = clipDragKeysRef.current;
      readClipDragKeys(e);
      const next = clipDragKeysRef.current;
      if (prev.shift === next.shift && prev.option === next.option) return;
      recomputeDragIndicatorsRef.current();
      nudgeDndCollision();
    };
    // Losing focus (switching apps) cancels the drag, like Esc: the pointer's release
    // may never reach this window. dnd-kit's pointer sensor cancels on a window
    // 'visibilitychange' event, which runs handleDragCancel.
    const onBlur = () => {
      clipDragKeysRef.current = { shift: false, option: false };
      clipDragCursorStyleRef.current?.remove();
      clipDragCursorStyleRef.current = null;
      if (clipDragRef.current) window.dispatchEvent(new Event('visibilitychange'));
    };
    // The closed grabbing hand everywhere on the page for the length of the drag
    // (elements' own cursors would otherwise win), until drop, Esc or blur.
    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = '* { cursor: grabbing !important; }';
    document.head.appendChild(cursorStyle);
    clipDragCursorStyleRef.current = cursorStyle;
    // The floating clip follows the pointer every frame (positionFloatingClip).
    const frame = () => {
      positionFloatingClipRef.current();
      floatingClipRafRef.current = requestAnimationFrame(frame);
    };
    floatingClipRafRef.current = requestAnimationFrame(frame);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('keyup', onKey, { capture: true });
    window.addEventListener('blur', onBlur);
    clipDragKeyCleanupRef.current = () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('keyup', onKey, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  };
  const stopClipDrag = () => {
    clipDragKeyCleanupRef.current?.();
    clipDragKeyCleanupRef.current = null;
    if (floatingClipRafRef.current !== null) cancelAnimationFrame(floatingClipRafRef.current);
    floatingClipRafRef.current = null;
    clipDragCursorStyleRef.current?.remove();
    clipDragCursorStyleRef.current = null;
    // Back to its React-drawn spot. Drop and Esc commit their state in the same
    // synchronous update as this, so the clip never shows at its old spot in between.
    const draggedId = clipDragRef.current?.clipId;
    if (draggedId) {
      for (const node of floatingClipNodes(draggedId)) node.style.transform = '';
    }
    clipDragRef.current = null;
    clipDragKeysRef.current = { shift: false, option: false };
    setClipDragPreview(null);
    setClipDragOffTimeline(false);
  };
  useEffect(() => () => stopClipDrag(), []);

  // ── Timeline clip drag: the floating clip ──────────────────────────────────
  // While a timeline clip is dragged, the clip itself follows the pointer: start =
  // pointer song time − grab offset, never snapped, ≥ 0, horizontal only (it stays in
  // its own row). React keeps drawing it at its stored spot; positionFloatingClip
  // writes a translateX on top of that, straight to the element on every animation
  // frame (like the section header drag ghost), so following the pointer — and edge
  // scrolling, since it's in content coordinates — never re-renders anything. The
  // same offset moves its "picked up" layer (Track.tsx, data-clip-drag-lift). React
  // never sets transform on either element, so it never overwrites this.
  const floatingClipRafRef = useRef<number | null>(null);
  const clipDragCursorStyleRef = useRef<HTMLStyleElement | null>(null);
  const floatingClipNodes = (clipId: string): HTMLElement[] => {
    const el = timelineRef.current;
    if (!el) return [];
    const id = CSS.escape(clipId);
    return Array.from(el.querySelectorAll<HTMLElement>(`[data-timeline-clip="${id}"], [data-clip-drag-lift="${id}"]`));
  };
  const positionFloatingClip = () => {
    const drag = clipDragRef.current;
    const x = dragClientXRef.current;
    if (!drag || x === null) return;
    const floatLeft = Math.max(0, dragPointerTime(x) - drag.grabOffsetSec) * zoom;
    for (const node of floatingClipNodes(drag.clipId)) {
      // Both elements sit at the clip's React-drawn left; read it live, so a commit
      // that moved it (a live-sync poll) is corrected on the same frame.
      const dx = floatLeft - (parseFloat(node.style.left) || 0);
      const transform = `translateX(${dx}px)`;
      if (node.style.transform !== transform) node.style.transform = transform;
    }
  };
  const positionFloatingClipRef = useRef(positionFloatingClip);
  positionFloatingClipRef.current = positionFloatingClip;
  // After any commit during a drag (the lift layer mounting, a poll, a zoom change),
  // place it again before the browser paints.
  useLayoutEffect(() => {
    if (clipDragRef.current) positionFloatingClip();
  });

  // ── Timeline clip drag: free placement ─────────────────────────────────────
  // A dragged clip stays in its home section; the pointer only decides where in it.
  // Its wanted start (clipDragDropStart) is snapped — to the nearest beat, its section's
  // start, flush against another clip on its track in that section, or the pickup limit
  // (snapDragStart) — unless snap is off or Shift is held, then placed among the other clips on its track in
  // that section with placeInGap (shared/timelinePlacement.ts): it goes into the gap it
  // points at (a clip's first or second half picks the gap before or after it), and
  // when that gap is too small, the clips after it move later together to make room.
  // Nothing ever moves earlier. A clip never changes track, so only the pointer's
  // horizontal position counts: anywhere over the timeline (any track row, the header
  // row, the ruler, the track names panel, the empty space below the tracks) places it
  // the same way. Off the timeline (the Media Bucket, anywhere outside it) nothing is
  // placed: a release there cancels.
  const [snap, setSnapState] = useState<SnapSetting>(readSnapSetting);
  const setSnap = (next: SnapSetting) => {
    setSnapState(next);
    writeSnapSetting(next);
  };
  interface ClipDragPlacement {
    trackId: string;
    sectionName: string;             // the home section (a loose file's: under the pointer)
    sectionStart: number;            // the home section's layout start, song seconds
    draggedId: string;
    offsets: Map<string, number>;    // the dragged clip and every clip it pushes → new sectionOffset
    changed: boolean;                // false = everything would stay where it is
    // A Media Bucket version drag: the new clip it would make (id = draggedId), added to
    // the preview layout at offsets.get(draggedId). null for a timeline clip drag.
    virtual: Clip | null;
  }
  // The other clips on a track in a section, both ways the drag placement takes them
  // (shared placeDraggedClip): as stored, and drawn (layout start + head cut, playedSpan,
  // so a cut pickup counts where it's drawn), as offsets from the section's start.
  const storedClipsInSection = (track: Track, sectionName: string, excludeId: string | null) =>
    track.clips
      .filter((c) => c.id !== excludeId && !c.isFullTake && c.sectionName === sectionName)
      .map((c) => toPlacementClip(placementInput(c)));
  const drawnSpansInSection = (trackId: string, sectionName: string, sectionStart: number, excludeId: string | null) =>
    (tracks.find((t) => t.id === trackId)?.clips ?? [])
      .filter((c) => c.id !== excludeId && !c.isFullTake && c.sectionName === sectionName && hasPlayedLength(c))
      .map((c) => ({ start: c.start - sectionStart, end: c.start - sectionStart + playedSpan(c).length }));
  // Whether the pointer is over the timeline's visible scroll area — rows, header row,
  // ruler, track names panel and the space below the last track — and not over the
  // Media Bucket.
  const isPointerOverTimeline = (x: number, y: number): boolean => {
    const el = timelineRef.current;
    if (!el || isPointerInMediaBucket(x, y)) return false;
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.left + el.clientWidth
      && y >= rect.top && y <= rect.top + el.clientHeight;
  };
  const computeClipDragPlacement = (): ClipDragPlacement | null => {
    const drag = clipDragRef.current;
    const x = dragClientXRef.current;
    const y = dragClientYRef.current;
    if (!drag || x === null || y === null) return null;
    if (!isPointerOverTimeline(x, y)) return null;
    const track = trackState.find((t) => t.id === drag.trackId);
    const clip = track?.clips.find((c) => c.id === drag.clipId);
    if (!track || !clip || clip.isFullTake || !clip.sectionName) return null;
    const section = layout.sections.find((s) => s.name === clip.sectionName);
    const dropStart = clipDragDropStart();
    if (!section || dropStart === null) return null;
    const free = !snap.on || clipDragModifiers().shift;
    const others = storedClipsInSection(track, clip.sectionName, clip.id);
    // Pickups: Option (read live, so pressing or releasing it mid-drag re-places at
    // once), or a clip that was a pickup at drag start and hasn't been on or after the
    // downbeat since, may start before the downbeat — down to its left limit (from the
    // stored layout: a clip never moves its own section); its end may stop before the
    // downbeat. Otherwise it stops at the downbeat, however fast the drag overshoots.
    const length = effectiveLength(placementInput(clip));
    const allowPickup = pickupAllowed(clipDragPickupRef.current, clipDragModifiers().option);
    const minOffset = clipDragMinOffset(
      allowPickup,
      allowPickup ? pickupLeftLimit(pickupLimitInput, layout, track.id, clip.sectionName) : 0,
    );
    // Where it's drawn now, from its section start: its stored offset + head cut (the cut
    // start for a cut pickup).
    const drawnOffset = (clip.sectionOffset ?? 0) + (layout.clipHeadCuts.get(clip.id) ?? 0);
    // Snap (on, no Shift): to the nearest beat, the section start, flush against another
    // clip on this track in this section where it's drawn, the pickup limit, or its own
    // current spot (snapDragStart), then the gaps model (shared placeDraggedClip).
    const drawnClip = tracks.find((t) => t.id === track.id)?.clips.find((c) => c.id === clip.id);
    const result = placeDraggedClip({
      freeOffset: dropStart - section.start,
      grid: free ? null : { step: snapGridSeconds(snap.unit, bpm, timeSignature), sectionStart: section.start },
      others,
      drawnOthers: drawnSpansInSection(track.id, clip.sectionName, section.start, clip.id),
      length,
      drawnLength: drawnClip ? playedSpan(drawnClip).length : length,
      minOffset,
      currentOffset: drawnOffset,
    });
    clipDragPickupRef.current = afterPickupPlacement(clipDragPickupRef.current, result.offset);
    const offsets = new Map<string, number>([[clip.id, result.offset]]);
    for (const m of result.moved) offsets.set(m.id, m.offset);
    // Released on its own drawn spot with nothing pushed: no change, nothing saved, the
    // stored offset kept.
    const changed = placementChanged(result, drawnOffset);
    return { trackId: track.id, sectionName: clip.sectionName, sectionStart: section.start, draggedId: clip.id, offsets, changed, virtual: null };
  };

  // ── Media Bucket file drag (a version or a loose file): live placement preview ──
  // A file dragged from the Media Bucket over the timeline is placed like a timeline
  // clip drag: a "virtual clip" (a new id made at drag start — the drop POSTs it under
  // that id — the file's full length, no trim, never a pickup). Its wanted start is the
  // drag chip's left edge (firstClipDropTime — there is no grab offset), then the same
  // snap and gaps model as a clip drag (shared computeFileDropPlacement): the section
  // grows live and later sections slide. Set at drag start, cleared on drop, cancel and
  // unmount. Two kinds:
  //  - 'version': on the version's own track in its own section. A clip never changes
  //    track, so only the pointer's horizontal position counts: anywhere over the
  //    timeline places it the same way, and the drop (handleDragEnd →
  //    commitVersionDrop) lands it where the preview shows it. A section's first clip
  //    (firstClip: its section isn't on the timeline yet) has no preview: the
  //    new-section line shows where the section will join, and the clip lands at the
  //    section's start. A legacy full take is unchanged (no FileDropDrag).
  //  - 'loose': a loose file has no track or section yet, so the track row and the
  //    section under the pointer are its destination (looseDropDestination); with none
  //    there is no preview, and a release does nothing. A release with a preview
  //    freezes it and asks to confirm (looseConfirm).
  type VersionFileDrop = { kind: 'version'; virtual: Clip; trackId: string; sectionName: string; firstClip: boolean };
  type LooseFileDrop = { kind: 'loose'; virtual: Clip; looseFileId: string; originTrackId: string | null };
  type FileDropDrag = VersionFileDrop | LooseFileDrop;
  const fileDropRef = useRef<FileDropDrag | null>(null);
  // File drags drop by the pointer, so the collision only ever matches the Media
  // Bucket's own targets for them, and only while the pointer is over the bucket
  // (makeTrackFirstCollision).
  const trackFirstCollision = React.useMemo(() => makeTrackFirstCollision(() => fileDropRef.current !== null), []);
  // The same, as state, for the render (contentEnd, the veils and the landing outline).
  const [fileDrop, setFileDropState] = useState<FileDropDrag | null>(null);
  const setFileDrop = (next: FileDropDrag | null) => {
    fileDropRef.current = next;
    setFileDropState(next);
  };
  const fileDropKeyCleanupRef = useRef<(() => void) | null>(null);
  // Shared start for both kinds: the poll hold, the content-width floor, and Shift.
  const beginFileDrop = (next: FileDropDrag) => {
    // Both polls pause for the whole drag, so the preview never jumps mid-drag (also
    // for a first-clip drag, whose section must stay off the timeline until the drop).
    takeClipDragHold()();
    holdPollsForClipDrag();
    clipDragMaxEndRef.current = layout.timelineEnd;
    clipDragKeysRef.current = { shift: false, option: false };
    setFileDrop(next);
    // Shift pressed or released under a still pointer: place again at once. Option is
    // ignored (a file is never a pickup). Shift key events stop here (capture phase)
    // so the arrow-key selection handler never sees them mid-drag.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      e.stopPropagation();
      const prev = clipDragKeysRef.current.shift;
      readClipDragKeys(e);
      if (prev === clipDragKeysRef.current.shift) return;
      recomputeDragIndicatorsRef.current();
      nudgeDndCollision();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('keyup', onKey, { capture: true });
    fileDropKeyCleanupRef.current = () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('keyup', onKey, { capture: true });
    };
  };
  // The new clip a file drag would make (its id is the one the drop POSTs).
  const virtualFileClip = (clip: Clip, sectionName: string | undefined, bucketClipId: string): Clip => ({
    ...clip,
    id: nanoid(),
    sectionName,
    sectionOffset: 0,
    trimStart: 0,
    trimEnd: null,
    headCut: 0,
    isFullTake: false,
    isFinal: false,
    bucketClipId,
  });
  const startFileDropPreview = (clip: Clip, trackId: string | undefined) => {
    stopFileDropPreview();
    const sectionName = clip.sectionName;
    if (clip.isFullTake || !sectionName || !trackId) return;
    if (!trackState.some((t) => t.id === trackId)) return;
    beginFileDrop({
      kind: 'version',
      virtual: virtualFileClip(clip, sectionName, clip.id),
      trackId,
      sectionName,
      firstClip: !layout.sections.some((s) => s.name === sectionName),
    });
  };
  // A loose file's clip (looseFileToClip) carries the loose file's id; the bucket
  // clip it becomes keeps that id (bucketClipId). originTrackId: its track shelf, if
  // it's Track-scoped (any track is still a valid destination).
  const startLooseDropPreview = (clip: Clip, originTrackId: string | null) => {
    stopFileDropPreview();
    beginFileDrop({
      kind: 'loose',
      virtual: virtualFileClip(clip, undefined, clip.id),
      looseFileId: clip.id,
      originTrackId,
    });
  };
  const stopFileDropPreview = () => {
    fileDropKeyCleanupRef.current?.();
    fileDropKeyCleanupRef.current = null;
    if (!fileDropRef.current) return;
    setFileDrop(null);
    clipDragKeysRef.current = { shift: false, option: false };
    setClipDragPreview(null);
    setClipDragOffTimeline(false);
  };
  useEffect(() => () => fileDropKeyCleanupRef.current?.(), []);
  // The track row under the pointer, from the pointer's Y alone: only over the track
  // rows' visible area (not the ruler or the section header row above them, which the
  // rows scroll under, and not the space below the last row). Row heights are fixed and
  // a drag preview never changes them, so a row boundary can't flicker.
  const trackRowAt = (x: number, y: number): Track | null => {
    const el = timelineRef.current;
    if (!el || !isPointerOverTimeline(x, y)) return null;
    const rect = el.getBoundingClientRect();
    if (y < rect.top + TRACK_ROWS_TOP_PX) return null;
    const row = Math.floor((y - rect.top + el.scrollTop - TRACK_ROWS_TOP_PX) / TRACK_ROW_HEIGHT_PX);
    return trackState[row] ?? null;
  };
  // Whether a track has a section: an active, non-Full-Take section folder (ideas row)
  // with that name on it — the row the server needs to make the file a version there.
  const trackHasSection = (trackId: string, sectionName: string) =>
    bucketTracksForPlacement.some((t) => t.id === trackId
      && t.ideas.some((i) => i.active && !i.isFullTake && i.sectionName === sectionName));
  // Where a loose file would land: the track row under the pointer, and the section
  // under the pointer in the stored layout — where the sections sit before the drag,
  // without the dragged file's preview. The preview still grows that section when the
  // clip sticks out past its end or pushes later clips, and later sections slide live;
  // only the choice of section ignores that growth. Past a section's stored end the
  // next section is the destination, so a clip aimed near a section's end stays in it
  // only while the pointer is before that stored end (it may still stick out and grow
  // the section), and the last bar of a section is that section, never a pickup of the
  // next one.
  // No flicker at a boundary: the destination is a function of the pointer's song time
  // and the stored layout only. The stored layout can't change mid-drag (both polls are
  // held), and the preview never feeds back into it, so each pointer position has
  // exactly one destination and a boundary is crossed exactly once.
  // null = nowhere to land: off the track rows (track names, ruler, header row, below
  // the tracks, off the timeline), past the stored end of the last section on the
  // timeline, or over a section this track doesn't have (trackHasSection).
  const looseDropDestination = (x: number, y: number): { track: Track; sectionName: string } | null => {
    const el = timelineRef.current;
    if (!el || x < el.getBoundingClientRect().left + TRACK_PANEL_WIDTH) return null;
    const track = trackRowAt(x, y);
    if (!track) return null;
    const section = sectionAt(dragPointerTime(x), layout.sections);
    if (!section) return null;
    if (!trackHasSection(track.id, section.name)) return null;
    return { track, sectionName: section.name };
  };
  // A loose file past the end: the track row under the pointer, the pointer at or past
  // the stored end of the last section on the timeline (exactly where
  // looseDropDestination finds no section — sectionAt's end is exclusive — or anywhere
  // past the track panel when nothing is on the timeline), and that track has a section
  // folder not on the timeline yet (offTimelineSectionNames). Then the gold new-section
  // line shows at the end (updateNewSectionLine), and a release asks which of those
  // sections to start (looseNewSection). null = nothing shows and a release does nothing.
  const looseNewSectionAt = (x: number, y: number): { track: Track; sectionNames: string[] } | null => {
    const el = timelineRef.current;
    if (!el || x < el.getBoundingClientRect().left + TRACK_PANEL_WIDTH) return null;
    const track = trackRowAt(x, y);
    if (!track) return null;
    const last = layout.sections[layout.sections.length - 1];
    if (dragPointerTime(x) < (last ? last.end : 0)) return null;
    const sectionNames = offTimelineSectionNames(track.id);
    return sectionNames.length ? { track, sectionNames } : null;
  };
  // A track's section folders whose section isn't on the timeline (no non-full-take
  // clip on any track), in filing order.
  const offTimelineSectionNames = (trackId: string): string[] => {
    const onTimeline = new Set(layout.sections.map((s) => s.name));
    return placeableSectionNames(trackId).filter((name) => !onTimeline.has(name));
  };
  const computeFileDragPlacement = (): ClipDragPlacement | null => {
    const drag = fileDropRef.current;
    const x = dragClientXRef.current;
    const y = dragClientYRef.current;
    if (!drag || x === null || y === null) return null;
    if (!isPointerOverTimeline(x, y)) return null;
    let track: Track | undefined;
    let sectionName: string;
    if (drag.kind === 'version') {
      if (drag.firstClip) return null;
      track = trackState.find((t) => t.id === drag.trackId);
      sectionName = drag.sectionName;
    } else {
      const dest = looseDropDestination(x, y);
      if (!dest) return null;
      track = dest.track;
      sectionName = dest.sectionName;
    }
    // The destination section's start in the stored layout — where it's drawn when
    // this placement is the preview.
    const section = layout.sections.find((s) => s.name === sectionName);
    if (!track || !section) return null;
    const free = !snap.on || clipDragModifiers().shift;
    const result = computeFileDropPlacement({
      freeOffset: firstClipDropTime(x) - section.start,
      grid: free ? null : { step: snapGridSeconds(snap.unit, bpm, timeSignature), sectionStart: section.start },
      others: storedClipsInSection(track, sectionName, null),
      drawnOthers: drawnSpansInSection(track.id, sectionName, section.start, null),
      length: clipLength(drag.virtual),
    });
    const offsets = new Map<string, number>([[drag.virtual.id, result.offset]]);
    for (const m of result.moved) offsets.set(m.id, m.offset);
    const virtual = drag.virtual.sectionName === sectionName ? drag.virtual : { ...drag.virtual, sectionName };
    return { trackId: track.id, sectionName, sectionStart: section.start, draggedId: drag.virtual.id, offsets, changed: true, virtual };
  };
  // The drag preview: the placement a release would apply now — it drives the landing
  // outline, the pushed clips' live positions (no other clip is drawn moved during the
  // drag), and the drop. Its own state, never written into the tracks, so a live-sync poll can't
  // overwrite it mid-drag. null = the pointer is off the timeline: nothing would change.
  const [clipDragPreview, setClipDragPreview] = useState<ClipDragPlacement | null>(null);
  // The pointer is outside the timeline mid-drag: the stored layout shows and the
  // landing outline is hidden, since a release there cancels.
  const [clipDragOffTimeline, setClipDragOffTimeline] = useState(false);
  // Shared by both drag kinds (a timeline clip, or a Media Bucket file — see
  // computeFileDragPlacement): only one runs at a time.
  const updateClipDragPreview = () => {
    const dragging = !!clipDragRef.current || !!fileDropRef.current;
    const next = clipDragRef.current ? computeClipDragPlacement()
      : fileDropRef.current ? computeFileDragPlacement()
      : null;
    const x = dragClientXRef.current;
    const y = dragClientYRef.current;
    setClipDragOffTimeline(dragging && x !== null && y !== null && !isPointerOverTimeline(x, y));
    setClipDragPreview((prev) => {
      if (prev === next) return prev;
      if (prev && next && prev.trackId === next.trackId && prev.sectionName === next.sectionName
          && prev.sectionStart === next.sectionStart && prev.changed === next.changed
          && prev.virtual?.id === next.virtual?.id && prev.offsets.size === next.offsets.size
          && Array.from(next.offsets).every(([id, offset]) => prev.offsets.get(id) === offset)) {
        return prev;
      }
      return next;
    });
  };
  // A live-sync poll or a tempo change under a still pointer: place again.
  useEffect(() => {
    if (clipDragRef.current || fileDropRef.current) updateClipDragPreview();
  }, [trackState, layout, snap, bpm, timeSignature]);

  // Drop: applies the placement at once (no packing) and saves the clips that moved in
  // one batch request. If the save fails, every one of them goes back where it was.
  // `releaseHold` (the drag's poll hold) runs once the save and the refetch after it
  // are done, or at once when there is nothing to save.
  const commitClipDragPlacement = (placement: ClipDragPlacement, releaseHold: () => void) => {
    const track = trackState.find((t) => t.id === placement.trackId);
    if (!track) return;
    const before = new Map(track.clips
      .filter((c) => placement.offsets.has(c.id))
      .map((c) => [c.id, c.sectionOffset ?? 0] as const));
    const changes = Array.from(placement.offsets)
      .filter(([id, offset]) => before.has(id) && Math.abs(offset - before.get(id)!) > PLACEMENT_EPSILON)
      .map(([id, sectionOffset]) => ({ id, sectionOffset }));
    if (changes.length === 0) { releaseHold(); return; }
    const applyOffsets = (offsets: Map<string, number>) => setTracks((prev) => prev.map((t) =>
      t.id !== placement.trackId ? t : {
        ...t,
        clips: sortClipsByOffset(t.clips.map((c) => offsets.has(c.id) ? { ...c, sectionOffset: offsets.get(c.id)! } : c)),
      }));
    applyOffsets(new Map(changes.map((c) => [c.id, c.sectionOffset])));
    const timelineKey = [`/api/songs/${songId}/timeline`];
    queryClient.cancelQueries({ queryKey: timelineKey });
    saveClipOffsets(songId, changes)
      .then(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['songs'] }),
        queryClient.invalidateQueries({ queryKey: ['final-clips', songId] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ]))
      .catch((err: Error) => {
        console.error('Failed to save clip positions:', err);
        applyOffsets(before);
        toast({ title: "Couldn't move the clip", description: err.message, variant: 'destructive' });
      })
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: timelineKey }).catch(() => {}).finally(releaseHold);
      });
  };
  // dnd-kit's own auto-scroll stays on for Media Bucket drags (the page relies on it)
  // but never moves the timeline itself, which file drags edge-scroll on both axes with
  // createEdgeScroller (otherwise it scrolled twice), nor the Media Bucket's columns,
  // which useColumnEdgeScroll scrolls. It's off
  // entirely for timeline clip drags. A ref, not state, so it's already off on the
  // drag's first frame.
  const dndAutoScroll = React.useMemo(() => ({
    canScroll: (el: Element) => clipDragRef.current === null && el !== timelineRef.current && !isColumnScrollElement(el),
  }), []);

  // ── New-section insertion line ─────────────────────────────────────────────
  // While a Media Bucket version whose section has no non-full-take clips on the
  // timeline (firstClip) is dragged with the pointer anywhere over the timeline, a gold
  // line marks the boundary its section will join at (firstClipBoundaryAt — the drop's
  // own rule), measured from the drag chip's left edge (pointer + CURSOR_GAP_PX, as
  // anchorBelowRightOfCursor draws it). Only the pointer's horizontal position counts.
  // A loose file past the end of the last section (looseNewSectionAt) shows the same
  // line at the end of the timeline — where the end rule puts a new section.
  const [newSectionLineX, setNewSectionLineX] = useState<number | null>(null);
  // The first-clip drop's time: the chip's left edge. Shared by the line and the drop.
  const firstClipDropTime = (pointerClientX: number) => dragPointerTime(pointerClientX + CURSOR_GAP_PX);
  const updateNewSectionLine = () => {
    const clientX = dragClientXRef.current;
    const clientY = dragClientYRef.current;
    const drag = fileDropRef.current;
    const pointerSet = clientX !== null && clientY !== null;
    const x = drag?.kind === 'version' && drag.firstClip && pointerSet && isPointerOverTimeline(clientX, clientY)
      ? TRACK_PANEL_WIDTH + firstClipBoundaryAt(firstClipDropTime(clientX)) * zoom
      : drag?.kind === 'loose' && pointerSet && looseNewSectionAt(clientX, clientY)
        ? TRACK_PANEL_WIDTH + firstClipBoundaryAt(Infinity) * zoom
        : null;
    setNewSectionLineX((prev) => (prev === x ? prev : x));
  };
  const clearNewSectionLine = () => setNewSectionLineX(null);

  // ── Section header drop target ─────────────────────────────────────────────
  // headerDropTarget (lib/section-drag.ts) is the one computation for both the gold
  // header line and what the drop sends. draggedSectionRef is set synchronously at drag
  // start, so the first pointer move already sees it.
  // The two layers every gold insertion line is drawn into (SplitInsertionLine).
  const [headerLineLayer, setHeaderLineLayer] = useState<HTMLDivElement | null>(null);
  const [rowsLineLayer, setRowsLineLayer] = useState<HTMLDivElement | null>(null);
  const insertionLineLayers = React.useMemo<InsertionLineLayers>(
    () => ({ header: headerLineLayer, rows: rowsLineLayer }),
    [headerLineLayer, rowsLineLayer],
  );
  const draggedSectionRef = useRef<string | null>(null);
  const headerDropRef = useRef<HeaderDropTarget | null>(null);
  const [headerDrop, setHeaderDrop] = useState<HeaderDropTarget | null>(null);
  const updateHeaderDrop = () => {
    const dragged = draggedSectionRef.current;
    const clientX = dragClientXRef.current;
    let target: HeaderDropTarget | null = null;
    if (dragged !== null && clientX !== null) {
      const rowNames = new Set(sections.map((s) => s.name));
      const drawn = layout.sections.filter((s) => rowNames.has(s.name)).map((s) => ({ name: s.name, start: s.start, end: s.end }));
      target = headerDropTarget(drawn, dragged, dragPointerTime(clientX));
    }
    headerDropRef.current = target;
    setHeaderDrop((prev) =>
      prev?.before === target?.before && prev?.after === target?.after && prev?.lineAt === target?.lineAt ? prev : target);
  };
  // The header drag's name tag: centred on the pointer, in the ruler strip above the
  // header row, clamped to the visible track area (never over the track panel).
  // Positioned directly on the element — no React state, so no re-render per move.
  const sectionDragTagElRef = useRef<HTMLDivElement | null>(null);
  const positionSectionDragTag = () => {
    const tag = sectionDragTagElRef.current;
    const el = timelineRef.current;
    const clientX = dragClientXRef.current;
    if (!tag || !el || clientX === null) return;
    const rect = el.getBoundingClientRect();
    const w = tag.offsetWidth;
    const minX = rect.left + TRACK_PANEL_WIDTH;
    const maxX = Math.max(minX, rect.left + el.clientWidth - w);
    const x = Math.min(Math.max(clientX - w / 2, minX), maxX);
    const y = rect.top + RULER_TOP_PX + (RULER_HEIGHT_PX - tag.offsetHeight) / 2;
    tag.style.transform = `translate(${x}px, ${y}px)`;
    tag.style.visibility = 'visible';
  };
  const sectionDragTagRef = useCallback((node: HTMLDivElement | null) => {
    sectionDragTagElRef.current = node;
    if (node) positionSectionDragTagRef.current();
  }, []);
  const positionSectionDragTagRef = useRef(positionSectionDragTag);
  positionSectionDragTagRef.current = positionSectionDragTag;

  // The header drag's clip ghost: its left edge = the pointer − where the header was
  // grabbed (measured from the section's start, set at drag start), in content
  // coordinates, so it stays put under the pointer while the timeline edge-scrolls.
  // Set directly on the element, like the tag.
  const sectionDragGrabOffsetRef = useRef(0);
  const sectionDragGhostElRef = useRef<HTMLDivElement | null>(null);
  const positionSectionDragGhost = () => {
    const ghost = sectionDragGhostElRef.current;
    const el = timelineRef.current;
    const clientX = dragClientXRef.current;
    if (!ghost || !el || clientX === null) return;
    const left = clientX - el.getBoundingClientRect().left + el.scrollLeft - sectionDragGrabOffsetRef.current;
    ghost.style.transform = `translateX(${left}px)`;
    ghost.style.visibility = 'visible';
  };
  const positionSectionDragGhostRef = useRef(positionSectionDragGhost);
  positionSectionDragGhostRef.current = positionSectionDragGhost;
  const sectionDragGhostRef = useCallback((node: HTMLDivElement | null) => {
    sectionDragGhostElRef.current = node;
    if (node) positionSectionDragGhostRef.current();
  }, []);

  // ── Section-end handle (step 4g2) ──────────────────────────────────────────
  // Dragging a section's gold end handle sets its base length (song_sections.base_length,
  // whole beats). Own pointer handling like the trim handles (no dnd-kit): window
  // pointermove (the shared drag pointer source) / pointerup, Esc and window blur cancel.
  // The preview is the drag-preview layout (clipDragLayout), so later sections slide
  // live; the polls are held from pointerdown until the save and the refetch after it.
  const sectionEndDragRef = useRef<SectionEndDrag | null>(null);
  const sectionEndCleanupRef = useRef<(() => void) | null>(null);
  const sectionEndShiftRef = useRef(false);
  useEffect(() => () => sectionEndCleanupRef.current?.(), []);
  // Picks the stop nearest the pointer (shared nearestSectionEndStop): Bar steps while
  // snap is on at Bar and Shift isn't held, otherwise whole beats. State changes only
  // when the stop does.
  const updateSectionEndDrag = () => {
    const drag = sectionEndDragRef.current;
    const clientX = dragClientXRef.current;
    if (!drag || clientX === null) return;
    if (!drag.moved && Math.abs(clientX - drag.originX) < SECTION_END_DRAG_THRESHOLD_PX) return;
    const pointerBeat = (dragPointerTime(clientX) - drag.grabOffsetSec) / secondsPerBeat(bpm);
    const barSteps = snap.on && snap.unit === 'bar' && !sectionEndShiftRef.current;
    const endBeat = nearestSectionEndStop(drag.range, pointerBeat, barSteps, parseTimeSignature(timeSignature).beatsPerBar);
    if (drag.moved && endBeat === drag.endBeat) return;
    const next = { ...drag, endBeat, moved: true };
    sectionEndDragRef.current = next;
    if (endBeat !== drag.endBeat) setSectionEndDrag(next);
  };
  // The readout: in the ruler strip, centred on the handle, clamped to the visible
  // track area. Positioned directly on the element, like the header drag's tag.
  const sectionEndTagElRef = useRef<HTMLDivElement | null>(null);
  const positionSectionEndTag = () => {
    const tag = sectionEndTagElRef.current;
    const el = timelineRef.current;
    const drag = sectionEndDragRef.current;
    if (!tag || !el || !drag) return;
    const rect = el.getBoundingClientRect();
    const handleX = rect.left + TRACK_PANEL_WIDTH + drag.endBeat * secondsPerBeat(bpm) * zoom - el.scrollLeft;
    const w = tag.offsetWidth;
    const minX = rect.left + TRACK_PANEL_WIDTH;
    const maxX = Math.max(minX, rect.left + el.clientWidth - w);
    const x = Math.min(Math.max(handleX - w / 2, minX), maxX);
    const y = rect.top + RULER_TOP_PX + (RULER_HEIGHT_PX - tag.offsetHeight) / 2;
    tag.style.transform = `translate(${x}px, ${y}px)`;
    tag.style.visibility = 'visible';
  };
  const positionSectionEndTagRef = useRef(positionSectionEndTag);
  positionSectionEndTagRef.current = positionSectionEndTag;
  const sectionEndTagRef = useCallback((node: HTMLDivElement | null) => {
    sectionEndTagElRef.current = node;
    if (node) positionSectionEndTagRef.current();
  }, []);
  // The readout's text changes width: re-place it after every picked stop.
  useLayoutEffect(() => { if (sectionEndDrag) positionSectionEndTagRef.current(); }, [sectionEndDrag, zoom]);

  // Saves a section's base length. The cache already holds the new value (written
  // synchronously on release, so the section never flickers back for a frame); a
  // failure puts `previous` back and toasts the server's message (409: the section left
  // the timeline). The section poll pauses while it's pending (sectionBaseLengthSaving).
  const sectionBaseLengthMutation = useMutation({
    mutationKey: ['song-sections-base-length', songId],
    mutationFn: async ({ section, baseLength }: { section: string; baseLength: number | null; previous?: SongSectionRow[] }) => {
      const res = await fetch(`/api/songs/${songId}/sections/base-length`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ section, baseLength }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Saving the section length failed (${res.status})`);
      }
      return res.json() as Promise<SongSectionRow[]>;
    },
    onError: (err, vars) => {
      console.error('Failed to save section length:', err);
      if (vars.previous) queryClient.setQueryData(songSectionsKey(songId), vars.previous);
      toast({ title: "Couldn't change the section length", description: (err as Error).message, variant: 'destructive' });
    },
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['songs'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: songSectionsKey(songId) }),
  });

  // Ends the handle drag. commit: send what sectionEndRelease decides — the picked
  // length when the end changed; null at fit whenever a base length is stored (even one
  // hidden under the content, with no drawn change); otherwise nothing.
  // Cancel (Esc, blur, pointercancel): back to the stored layout, nothing sent.
  const finishSectionEndDrag = (commit: boolean) => {
    const drag = sectionEndDragRef.current;
    if (!drag) return;
    sectionEndCleanupRef.current?.();
    sectionEndCleanupRef.current = null;
    sectionEndDragRef.current = null;
    const releaseHold = takeClipDragHold();
    const release = commit ? sectionEndRelease(drag.range, drag.storedEndBeat, drag.storedBaseLength, drag.endBeat) : null;
    if (release) {
      const { baseLength } = release;
      const previous = queryClient.getQueryData<SongSectionRow[]>(songSectionsKey(songId));
      if (previous) setSectionRowsCache(previous.map((r) => (r.name === drag.name ? { ...r, baseLength } : r)));
      // mutateAsync, not mutate's own callbacks: those fire only for the latest call,
      // and a second handle drag saved before this one settles must not strand its hold.
      sectionBaseLengthMutation.mutateAsync({ section: drag.name, baseLength, previous })
        .catch(() => { /* rolled back and toasted in onError */ })
        .finally(releaseHold);
    } else {
      releaseHold();
    }
    setSectionEndDrag(null);
  };
  const finishSectionEndDragRef = useRef(finishSectionEndDrag);
  finishSectionEndDragRef.current = finishSectionEndDrag;

  const startSectionEndDrag = useCallback((e: React.PointerEvent, name: string) => {
    if (e.button !== 0) return;
    // Never a header drag (dnd-kit) or any other pointerdown handler.
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    e.preventDefault();
    startSectionEndDragRef.current(e.clientX, e.clientY, e.shiftKey, name);
  }, []);
  const startSectionEndDragImpl = (clientX: number, clientY: number, shiftKey: boolean, name: string) => {
    if (sectionEndDragRef.current || !sectionEndInteractiveRef.current) return;
    const sec = layout.sections.find((s) => s.name === name);
    if (!sec) return;
    const storedEndBeat = sec.startBeat + sec.lengthBeats;
    const drag: SectionEndDrag = {
      name,
      range: sectionEndRange(sec.startBeat, contentNeedBeats(sec.contentNeed, bpm)),
      storedEndBeat,
      storedBaseLength: sec.baseLength,
      endBeat: storedEndBeat,
      grabOffsetSec: dragPointerTime(clientX) - sec.end,
      originX: clientX,
      moved: false,
    };
    takeClipDragHold()();
    holdPollsForClipDrag();
    clipDragMaxEndRef.current = layout.timelineEnd;
    sectionEndShiftRef.current = shiftKey;
    sectionEndDragRef.current = drag;

    // Edge scroll like the header drag. The cap reads the content end live; the
    // preview's end can't pass the 4096-beat maximum (nearestSectionEndStop), so
    // neither can the scroll.
    const scroller = createEdgeScroller({
      getEl: () => timelineRef.current,
      startInset: TRACK_PANEL_WIDTH,
      endScrollCap: (el) => Math.max(0, Math.min(
        contentEndRef.current * zoomRef.current - (el.clientWidth - TRACK_PANEL_WIDTH) / 2,
        el.scrollWidth - el.clientWidth,
      )),
      onScrolled: (scrollLeft) => { lastAutoScrollRef.current = scrollLeft; },
    });
    scroller.start(clientX, clientY);
    startDragPointer({ x: clientX, y: clientY }, {
      onMove: (ev) => {
        sectionEndShiftRef.current = ev.shiftKey;
        scroller.onPointerMove(ev);
      },
    });
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      finishSectionEndDragRef.current(true);
    };
    const onCancel = () => finishSectionEndDragRef.current(false);
    // Capture phase: Esc and Shift never reach the timeline's own key handlers mid-drag.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && ev.type === 'keydown') {
        ev.preventDefault();
        ev.stopPropagation();
        finishSectionEndDragRef.current(false);
        return;
      }
      if (ev.key !== 'Shift') return;
      ev.stopPropagation();
      if (sectionEndShiftRef.current === ev.shiftKey) return;
      sectionEndShiftRef.current = ev.shiftKey;
      recomputeDragIndicatorsRef.current();
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onCancel);
    // col-resize everywhere for the whole drag (the headers' own cursor-grab would
    // otherwise win), the same way the header drag sets grabbing.
    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = '* { cursor: col-resize !important; }';
    document.head.appendChild(cursorStyle);
    sectionEndCleanupRef.current = () => {
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onCancel);
      cursorStyle.remove();
      scroller.stop();
      stopDragPointer();
    };
    setSectionEndDrag(drag);
  };
  const startSectionEndDragRef = useRef(startSectionEndDragImpl);
  startSectionEndDragRef.current = startSectionEndDragImpl;
  // Whether a handle may start now (no other drag or trim running) — read at
  // pointerdown; set in the render below.
  const sectionEndInteractiveRef = useRef(true);

  recomputeDragIndicatorsRef.current = () => {
    updateHeaderDrop();
    updateNewSectionLine();
    if (clipDragRef.current || fileDropRef.current) updateClipDragPreview();
    if (draggedSectionRef.current !== null) {
      positionSectionDragTag();
      positionSectionDragGhost();
    }
    if (sectionEndDragRef.current) {
      updateSectionEndDrag();
      positionSectionEndTag();
    }
  };

  // Appends a clip to the end of one track's section (Media Bucket "Add to Timeline"):
  // after the furthest clip end on that track in that section (appendOffset); gaps stay
  // and nothing else moves. No sectionOffset is sent: the server appends by the same
  // rule against what it holds, so a browser a poll behind can't send a spot another
  // clip has taken meanwhile (every new clip is checked for overlap), and the offset it
  // answers with is kept.
  const insertClipInSection = (trackId: string, sectionName: string, clip: Clip) => {
    const newId = nanoid();
    // A section with no non-full-take clips on the timeline has no position: its first
    // clip places it (shared placeFirstClipSection, the end rule — the server applies
    // the same rule when the clip is POSTed, creating the row if needed). The cache
    // takes the new order at once and is refreshed once the POST lands. A later clip
    // moves nothing. The section-order poll is paused until the POST settles; a failed
    // POST puts the order back as it was before.
    let layoutSections = sections;
    let sectionsBeforeDrop: SongSectionRow[] | undefined;
    const isFirstClip = !trackState.some((t) => t.clips.some((c) => c.sectionName === sectionName && !c.isFullTake));
    if (isFirstClip) {
      const placed = firstClipSectionRows(sectionName, null);
      layoutSections = placed;
      sectionsBeforeDrop = queryClient.getQueryData<SongSectionRow[]>(songSectionsKey(songId));
      setFirstClipPostsInFlight((n) => n + 1);
      setSectionRowsCache(placed);
    }

    const targetTrack = trackState.find((t) => t.id === trackId);
    if (!targetTrack) return newId;
    const sectionClips = targetTrack.clips.filter((c) => c.sectionName === sectionName && !c.isFullTake);
    const added: Clip = {
      ...clip, id: newId, sectionName, trimStart: 0, trimEnd: null, bucketClipId: clip.id, isFullTake: false,
      sectionOffset: appendOffset(sectionClips.map((c) => toPlacementClip(placementInput(c)))),
    };
    const withClip = (t: Track): Track => (t.id === trackId ? { ...t, clips: [...t.clips, added] } : t);
    const start = deriveLayout(trackState.map(withClip), layoutSections, bpm, timeSignature).clipStarts.get(newId) ?? 0;
    setTracks((prev) => prev.map(withClip));

    fetch(`/api/tracks/${trackId}/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newId, trackId, name: clip.name, type: clip.type, color: clip.color,
        // start: a cache value; the server takes it from the layout.
        start, duration: clip.duration,
        src: clip.src ?? null, sectionName,
        trimStart: 0, trimEnd: null,
        bucketClipId: clip.id,
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`POST /api/tracks/${trackId}/clips answered ${res.status}`);
        const saved = await res.json().catch(() => null) as { sectionOffset?: number | null } | null;
        const savedOffset = saved?.sectionOffset;
        if (typeof savedOffset === 'number' && Math.abs(savedOffset - (added.sectionOffset ?? 0)) > PLACEMENT_EPSILON) {
          setTracks((prev) => prev.map((t) => t.id !== trackId ? t : {
            ...t,
            clips: sortClipsByOffset(t.clips.map((c) => c.id === newId ? { ...c, sectionOffset: savedOffset } : c)),
          }));
        }
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: ['activity'] }),
          queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] }),
          queryClient.invalidateQueries({ queryKey: ['songs'] }),
          isFirstClip && queryClient.invalidateQueries({ queryKey: songSectionsKey(songId) }),
        ]);
      })
      .catch((err) => {
        console.error('Failed to persist timeline clip:', err);
        if (isFirstClip) {
          if (sectionsBeforeDrop) queryClient.setQueryData(songSectionsKey(songId), sectionsBeforeDrop);
          queryClient.invalidateQueries({ queryKey: songSectionsKey(songId) });
        }
      })
      .finally(() => { if (isFirstClip) setFirstClipPostsInFlight((n) => n - 1); });

    return newId;
  };

  // The song_sections rows once `sectionName` (not on the timeline yet) joins it — between
  // the sections `hint` names, or at the end with no hint (shared placeFirstClipSection,
  // the rule the server applies to a section's first clip).
  const firstClipSectionRows = (sectionName: string, hint: SectionPlacementHint | null): SongSectionRow[] => {
    const byName = new Map(sections.map((s) => [s.name, s]));
    const onTimeline = new Set(layout.sections.map((s) => s.name).filter((n) => byName.has(n) && n !== sectionName));
    // The section coming back starts at fit to content, as the server resets its
    // base_length when it gets its first clip again.
    return placeFirstClipSection(sections.map((s) => s.name), onTimeline, sectionName, hint)
      .map((name, i) => ({
        ...(byName.get(name) ?? { name, baseLength: null }),
        ...(name === sectionName ? { baseLength: null } : {}),
        sortOrder: i,
      }));
  };
  // Puts `rows` in the song-sections cache. A poll already in flight is cancelled, which
  // reverts the cache to its pre-fetch data — so the rows are set again once the cancel
  // has finished.
  const setSectionRowsCache = (rows: SongSectionRow[]) => {
    queryClient.setQueryData<SongSectionRow[]>(songSectionsKey(songId), rows);
    queryClient.cancelQueries({ queryKey: songSectionsKey(songId) })
      .then(() => queryClient.setQueryData<SongSectionRow[]>(songSectionsKey(songId), rows));
  };

  // Where a version drop lands, from the release pointer position, the current scroll
  // and live Shift — the same computation as the last preview (computeFileDragPlacement)
  // or new-section line (firstClipHintAt). offset: the new clip's sectionOffset (a
  // section's first clip: 0, the section's start). pushed: the clips it pushes later,
  // only those whose offset actually changes. hint: where a first clip's section joins
  // the timeline (null = the end). null = the pointer isn't over the timeline: a
  // release there changes nothing.
  interface VersionDrop { offset: number; pushed: { id: string; sectionOffset: number }[]; hint: SectionPlacementHint | null }
  const computeVersionDrop = (drag: VersionFileDrop): VersionDrop | null => {
    const x = dragClientXRef.current;
    const y = dragClientYRef.current;
    if (x === null || y === null || !isPointerOverTimeline(x, y)) return null;
    if (drag.firstClip) return { offset: 0, pushed: [], hint: firstClipHintAt(firstClipDropTime(x)) };
    const placement = computeFileDragPlacement();
    const offset = placement?.offsets.get(drag.virtual.id);
    const track = trackState.find((t) => t.id === drag.trackId);
    if (!placement || offset === undefined || !track) return null;
    return { offset, pushed: pushedByPlacement(track, placement), hint: null };
  };

  // Lands a version drop: the virtual clip at its offset and the clips it pushes at
  // their pushed spots show at once (for a section's first clip, the section also takes
  // its arrangement place in the cache), so nothing jumps on release; then one POST
  // /api/tracks/:trackId/clips with `pushed` saves it all in one transaction. On success
  // the new clip glows like menu "Add to Timeline". On any failure (network, 400, 404,
  // 409) the clip comes off, the pushed clips and the section order go back, and a
  // toast says nothing was changed. `releaseHold` (the drag's poll hold) runs once the
  // save and the refetch after it are done, after any rollback.
  // A file drop on one track as track-state updaters (version and loose-file drops):
  // `landed` adds the new clip and moves the pushed clips to their pushed spots;
  // `rolledBack` takes the clip off and puts the pushed clips back.
  const fileLandingUpdaters = (track: Track, added: Clip, pushed: { id: string; sectionOffset: number }[]) => {
    const pushedTo = new Map(pushed.map((p) => [p.id, p.sectionOffset] as const));
    const pushedFrom = new Map(track.clips.filter((c) => pushedTo.has(c.id)).map((c) => [c.id, c.sectionOffset ?? 0] as const));
    const landed = (t: Track): Track => t.id !== track.id ? t : {
      ...t,
      clips: sortClipsByOffset([...t.clips.map((c) => pushedTo.has(c.id) ? { ...c, sectionOffset: pushedTo.get(c.id)! } : c), added]),
    };
    const rolledBack = (t: Track): Track => t.id !== track.id ? t : {
      ...t,
      clips: sortClipsByOffset(t.clips
        .filter((c) => c.id !== added.id)
        .map((c) => pushedFrom.has(c.id) ? { ...c, sectionOffset: pushedFrom.get(c.id)! } : c)),
    };
    return { landed, rolledBack };
  };
  // The clips a placement pushes, only those whose offset actually changes from what's
  // stored.
  const pushedByPlacement = (track: Track, placement: ClipDragPlacement) => {
    const stored = new Map(track.clips.map((c) => [c.id, c.sectionOffset ?? 0] as const));
    return Array.from(placement.offsets)
      .filter(([id, o]) => id !== placement.draggedId && stored.has(id) && Math.abs(o - stored.get(id)!) > PLACEMENT_EPSILON)
      .map(([id, sectionOffset]) => ({ id, sectionOffset }));
  };

  const commitVersionDrop = (drag: VersionFileDrop, drop: VersionDrop, releaseHold: () => void) => {
    const { virtual, trackId, sectionName, firstClip } = drag;
    const track = trackState.find((t) => t.id === trackId);
    if (!track) { releaseHold(); return; }
    const added: Clip = { ...virtual, sectionOffset: drop.offset };
    const { landed, rolledBack } = fileLandingUpdaters(track, added, drop.pushed);

    let layoutSections = sections;
    const sectionsBefore = firstClip ? queryClient.getQueryData<SongSectionRow[]>(songSectionsKey(songId)) : undefined;
    if (firstClip) {
      layoutSections = firstClipSectionRows(sectionName, drop.hint);
      setSectionRowsCache(layoutSections);
    }
    const start = deriveLayout(trackState.map(landed), layoutSections, bpm, timeSignature).clipStarts.get(added.id) ?? 0;
    setTracks((prev) => prev.map(landed));

    const timelineKey = [`/api/songs/${songId}/timeline`];
    queryClient.cancelQueries({ queryKey: timelineKey });
    fetch(`/api/tracks/${trackId}/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: added.id, trackId, name: added.name, type: added.type, color: added.color,
        // start: a cache value; the server takes it from the layout.
        start, duration: added.duration,
        sectionOffset: drop.offset,
        src: added.src ?? null, sectionName,
        trimStart: 0, trimEnd: null,
        bucketClipId: virtual.bucketClipId,
        pushed: drop.pushed,
        placement: firstClip && drop.hint ? drop.hint : undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw Object.assign(new Error(body.message ?? `POST /api/tracks/${trackId}/clips answered ${res.status}`), { status: res.status });
        }
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        setFlashClipId(added.id);
        flashTimerRef.current = setTimeout(() => setFlashClipId(null), 1800);
        return Promise.all([
          queryClient.invalidateQueries({ queryKey: ['activity'] }),
          queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] }),
          queryClient.invalidateQueries({ queryKey: ['songs'] }),
          queryClient.invalidateQueries({ queryKey: ['final-clips', songId] }),
        ]);
      })
      .catch((err: Error & { status?: number }) => {
        console.error('Failed to place version on the timeline:', err);
        setTracks((prev) => prev.map(rolledBack));
        if (firstClip && sectionsBefore) queryClient.setQueryData(songSectionsKey(songId), sectionsBefore);
        toast({
          title: `Couldn't place ${added.name}.`,
          description: err.status === 409
            ? 'Someone changed this section meanwhile. Nothing was changed — try again.'
            : 'Nothing was changed.',
          variant: 'destructive',
        });
      })
      .finally(() => {
        Promise.all([
          queryClient.invalidateQueries({ queryKey: timelineKey }),
          firstClip && queryClient.invalidateQueries({ queryKey: songSectionsKey(songId) }),
        ]).catch(() => {}).finally(releaseHold);
      });
  };

  // ── Loose-file timeline drop: confirm, then save ──────────────────────────
  // A loose file released with a landing spot doesn't land yet: the preview is frozen
  // exactly as drawn (the layout, the outline, the pushed clips — the render reads
  // looseConfirm.placement as the preview), the drag itself ends, and a dialog asks to
  // confirm. The polls stay held (releaseHold) until Cancel, or until the save and the
  // refetch after it. While it's open the dialog is modal, so nothing else on the
  // timeline can be dragged.
  interface LooseConfirm {
    drag: LooseFileDrop;
    placement: ClipDragPlacement;
    trackName: string;
    releaseHold: () => void;
  }
  const looseConfirmRef = useRef<LooseConfirm | null>(null);
  const looseConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const [looseConfirm, setLooseConfirmState] = useState<LooseConfirm | null>(null);
  const setLooseConfirm = (next: LooseConfirm | null) => {
    looseConfirmRef.current = next;
    setLooseConfirmState(next);
  };
  const freezeLoosePlacement = (drag: LooseFileDrop, placement: ClipDragPlacement, releaseHold: () => void, activeId: UniqueIdentifier) => {
    const row = trackState.findIndex((t) => t.id === placement.trackId);
    // The file doesn't move until the dialog confirms — a spring-opened Track stays
    // selected while it's open (resolveDeferredLooseFileDrop below).
    reportLooseFileDrop(activeId, 'deferred');
    setLooseConfirm({
      drag,
      placement,
      trackName: trackState[row]?.name ?? '',
      releaseHold,
    });
  };
  // Cancel or Esc: the frozen preview goes (the pushed clips back, the section back to
  // its size), nothing is saved, the polls resume.
  const cancelLoosePlacement = () => {
    const confirm = looseConfirmRef.current;
    if (!confirm) return;
    setLooseConfirm(null);
    confirm.releaseHold();
    resolveDeferredLooseFileDrop(false);
  };
  const confirmLoosePlacement = () => {
    const confirm = looseConfirmRef.current;
    if (!confirm) return;
    setLooseConfirm(null);
    resolveDeferredLooseFileDrop(true);
    commitLoosePlacement(confirm);
  };
  useEffect(() => () => { looseConfirmRef.current?.releaseHold(); }, []);

  // On screen at once, the loose file leaves the loose-file lists and joins its track
  // and section as a version (named as the server will name it only after the
  // refetch). Set again once any list fetch in flight has been cancelled (a cancel
  // puts back the data from before that fetch). Returns the undo.
  const moveLooseFileIntoBucketCache = (drag: LooseFileDrop, trackId: string, sectionName: string): (() => void) => {
    const listKey = looseFileKeys.list(songId);
    const trackKey = drag.originTrackId ? looseFileKeys.byTrack(drag.originTrackId) : null;
    const bucketKey = bucketKeys.bucket(songId);
    const before = {
      list: queryClient.getQueryData<ApiLooseFile[]>(listKey),
      track: trackKey ? queryClient.getQueryData<ApiLooseFile[]>(trackKey) : undefined,
      bucket: queryClient.getQueryData<ApiBucketTrack[]>(bucketKey),
    };
    const file = before.list?.find((f) => f.id === drag.looseFileId) ?? before.track?.find((f) => f.id === drag.looseFileId);
    let undone = false;
    const apply = () => {
      if (undone) return;
      const without = (files: ApiLooseFile[] | undefined) => files?.filter((f) => f.id !== drag.looseFileId);
      queryClient.setQueryData<ApiLooseFile[]>(listKey, without);
      if (trackKey) queryClient.setQueryData<ApiLooseFile[]>(trackKey, without);
      if (!file) return;
      queryClient.setQueryData<ApiBucketTrack[]>(bucketKey, (tracks) => tracks?.map((t) => t.id !== trackId ? t : {
        ...t,
        ideas: t.ideas.map((i) => !i.active || i.isFullTake || i.sectionName !== sectionName || i.clips.some((c) => c.id === file.id) ? i : {
          ...i,
          clips: [...i.clips, {
            id: file.id, ideaId: i.id, name: file.name, type: file.type, color: file.color, start: 0,
            duration: file.duration, src: file.src, isFinal: false, isFullTake: false, sectionName,
            metadata: file.metadata, createdAt: file.createdAt, addedToSongs: file.addedToSongs ?? null,
          }],
        }),
      }));
    };
    apply();
    Promise.all([listKey, trackKey, bucketKey].filter((k) => k !== null).map((queryKey) => queryClient.cancelQueries({ queryKey })))
      .then(apply);
    return () => {
      undone = true;
      if (before.list) queryClient.setQueryData(listKey, before.list);
      if (trackKey && before.track) queryClient.setQueryData(trackKey, before.track);
      if (before.bucket) queryClient.setQueryData(bucketKey, before.bucket);
    };
  };

  // Lands a confirmed loose-file drop where the frozen preview showed it: the new clip
  // at the outline and the clips it pushes at their pushed spots, at once (the same
  // commit as the frozen preview's removal, so nothing jumps), and the file shown as a
  // version in the Media Bucket. Then one POST place-on-timeline with the clip's id,
  // sectionOffset and `pushed` (only clips whose offset changes) saves it all in one
  // transaction. Success: the gold landing glow (onLooseFilePlaced). Any failure
  // (network, 400, 404, 409): everything on screen goes back — the clip, the pushes,
  // the file in the loose-file lists — and a toast says nothing was changed. The polls
  // resume once the save and the refetch after it are done, after any rollback.
  const commitLoosePlacement = ({ drag, placement, releaseHold }: LooseConfirm) => {
    const track = trackState.find((t) => t.id === placement.trackId);
    const offset = placement.offsets.get(drag.virtual.id);
    if (!track || offset === undefined) { releaseHold(); return; }
    commitLooseLanding(drag, track, placement.sectionName, { offset, pushed: pushedByPlacement(track, placement) }, releaseHold);
  };
  // Shared by a confirmed drop (position: its offset and the clips it pushes) and a new
  // section (position null: the place-on-timeline append path, so the section joins at
  // the end of the timeline by the server's end rule and the clip lands at its start).
  // A new section also takes its place in the song-sections cache at once (the same
  // end rule, firstClipSectionRows), and goes back on failure.
  const commitLooseLanding = (
    drag: LooseFileDrop,
    track: Track,
    sectionName: string,
    position: { offset: number; pushed: { id: string; sectionOffset: number }[] } | null,
    releaseHold: () => void,
  ) => {
    const added: Clip = { ...drag.virtual, sectionName, sectionOffset: position?.offset ?? 0 };
    const { landed, rolledBack } = fileLandingUpdaters(track, added, position?.pushed ?? []);
    const sectionsBefore = position ? undefined : queryClient.getQueryData<SongSectionRow[]>(songSectionsKey(songId));
    if (!position) setSectionRowsCache(firstClipSectionRows(sectionName, null));
    setTracks((prev) => prev.map(landed));
    const undoBucket = moveLooseFileIntoBucketCache(drag, track.id, sectionName);
    const timelineKey = [`/api/songs/${songId}/timeline`];
    queryClient.cancelQueries({ queryKey: timelineKey });
    placeLooseFileAtPositionMutation.mutate({
      looseFileId: drag.looseFileId,
      trackId: track.id,
      sectionName,
      id: added.id,
      ...(position ? { sectionOffset: position.offset, pushed: position.pushed } : {}),
    }, {
      onError: (err: Error & { status?: number }) => {
        setTracks((prev) => prev.map(rolledBack));
        if (sectionsBefore) queryClient.setQueryData(songSectionsKey(songId), sectionsBefore);
        undoBucket();
        toast({
          title: `Couldn't place ${drag.virtual.name}.`,
          description: err.status === 409
            ? 'Someone changed this section meanwhile. Nothing was changed — try again.'
            : 'Nothing was changed.',
          variant: 'destructive',
        });
      },
      onSettled: () => {
        Promise.all([
          queryClient.invalidateQueries({ queryKey: timelineKey }),
          queryClient.invalidateQueries({ queryKey: looseFileKeys.all() }),
          queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) }),
          !position && queryClient.invalidateQueries({ queryKey: songSectionsKey(songId) }),
        ]).catch(() => {}).finally(releaseHold);
      },
    });
  };

  // ── Loose-file drop past the end: start a new section ─────────────────────
  // A release where the gold new-section line showed (looseNewSectionAt) asks which of
  // the track's sections not on the timeline yet to start: the track is the row the
  // pointer was on (not editable), the section one Select, the first one preselected.
  // The polls stay held (releaseHold) until Cancel, or until the save and the refetch
  // after it. Place: commitLooseLanding with no position. Cancel / Esc / outside click:
  // nothing changes.
  interface LooseNewSection {
    drag: LooseFileDrop;
    trackId: string;
    trackName: string;
    sectionNames: string[];
    sectionName: string;
    releaseHold: () => void;
  }
  const looseNewSectionRef = useRef<LooseNewSection | null>(null);
  const looseNewSectionButtonRef = useRef<HTMLButtonElement>(null);
  const [looseNewSection, setLooseNewSectionState] = useState<LooseNewSection | null>(null);
  const setLooseNewSection = (next: LooseNewSection | null) => {
    looseNewSectionRef.current = next;
    setLooseNewSectionState(next);
  };
  const openLooseNewSection = (
    drag: LooseFileDrop,
    target: { track: Track; sectionNames: string[] },
    releaseHold: () => void,
    activeId: UniqueIdentifier,
  ) => {
    // The file doesn't move until the dialog places it (resolveDeferredLooseFileDrop).
    reportLooseFileDrop(activeId, 'deferred');
    setLooseNewSection({
      drag,
      trackId: target.track.id,
      trackName: target.track.name,
      sectionNames: target.sectionNames,
      sectionName: target.sectionNames[0],
      releaseHold,
    });
  };
  const cancelLooseNewSection = () => {
    const pending = looseNewSectionRef.current;
    if (!pending) return;
    setLooseNewSection(null);
    pending.releaseHold();
    resolveDeferredLooseFileDrop(false);
  };
  const placeLooseNewSection = () => {
    const pending = looseNewSectionRef.current;
    if (!pending) return;
    setLooseNewSection(null);
    resolveDeferredLooseFileDrop(true);
    const track = trackState.find((t) => t.id === pending.trackId);
    if (!track) { pending.releaseHold(); return; }
    commitLooseLanding(pending.drag, track, pending.sectionName, null, pending.releaseHold);
  };
  useEffect(() => () => { looseNewSectionRef.current?.releaseHold(); }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Capture before clearing — activeDragData holds the enriched clip (with sectionName derived at drag-start)
    const dragData = activeDragData;

    setActiveDragData(null);
    clearNewSectionLine();
    // The pointer's clientX at release, for every horizontal drop position below
    // (read before stopping the pointer source).
    const pointerClientX = dragClientXRef.current ?? getEventCoordinates(event.activatorEvent)?.x ?? 0;
    // A timeline clip drag lands where its preview showed it: placed again from the
    // release position, before the drag state clears. null = released off its own
    // track row (or nothing to place), so nothing moves.
    const clipPlacement = clipDragRef.current ? computeClipDragPlacement() : null;
    // A Media Bucket version drag likewise (computeVersionDrop), read before the drag
    // state, the pointer source and the live Shift state clear. null = released off the
    // timeline.
    const fileDrag = fileDropRef.current;
    const versionDrag = fileDrag?.kind === 'version' ? fileDrag : null;
    const versionDrop = versionDrag ? computeVersionDrop(versionDrag) : null;
    // A loose file likewise: its placement at release (null = nowhere to land), or with
    // none, a new section past the end (looseNewSectionAt).
    const looseDrag = fileDrag?.kind === 'loose' ? fileDrag : null;
    const loosePlacement = looseDrag ? computeFileDragPlacement() : null;
    const releaseY = dragClientYRef.current;
    const looseNewSectionTarget = looseDrag && !loosePlacement && releaseY !== null
      ? looseNewSectionAt(pointerClientX, releaseY)
      : null;
    const releaseClipDragHold = takeClipDragHold();
    stopClipDrag();
    stopFileDropPreview();
    stopFileEdgeScroll();
    stopDragPointer();

    // The organize drag (loose file or version), live or from the hook's drag-start
    // snapshot — read before handleDragEnd below clears that snapshot.
    const organizeDrag = looseFileOrganizeDnd.resolveDrag(event);
    // Runs on every drop so the hook always clears its snapshot. It acts only on a
    // loose file released over a bucket target, and returns true when it did.
    const looseFileHandled = looseFileOrganizeDnd.handleDragEnd(event);

    // dragData (captured at drag start) covers a source row that unmounted mid-drag —
    // e.g. a shelf loose file whose Sections column a spring-loaded Track replaced.
    const activeType = active.data.current?.type ?? dragData?.type;

    // ── Timeline clip: free placement in its own section. Decided by the pointer, not
    // by `over`, so the drop always matches the preview. No change → nothing is saved.
    if (activeType === 'clip') {
      if (clipPlacement?.changed) commitClipDragPlacement(clipPlacement, releaseClipDragHold);
      else releaseClipDragHold();
      return;
    }

    // ── Media Bucket version (not a legacy full take): decided by the pointer, not by
    // `over`, so the drop always matches the preview or new-section line. Over the
    // timeline it lands; over a Media Bucket target (`over` only ever matches those for
    // it) that target's move; anywhere else nothing changes. The drag's poll hold runs
    // through the save (commitVersionDrop).
    if (versionDrag) {
      if (versionDrop) {
        commitVersionDrop(versionDrag, versionDrop, releaseClipDragHold);
        return;
      }
      releaseClipDragHold();
      if (over && isBucketOrganizeDropId(String(over.id))) versionMoveDnd.handleDragEnd(event, organizeDrag);
      return;
    }

    // ── Loose file: decided by the pointer, not by `over` (which only ever matches
    // Media Bucket targets for it, and only over the bucket). With a landing spot the
    // preview freezes and a dialog asks to confirm (the poll hold goes with it). Over a
    // Media Bucket target: that target's organize (the shared hook, above). Anywhere
    // else — no outline: the header row, the ruler, the track names, below the tracks,
    // past the last section, a section the track doesn't have, off the timeline —
    // nothing happens, the same as Esc: the preview is already cleared above, the polls
    // resume, nothing is reported (so a spring-opened selection is restored). One
    // exception: past the last section on a track with a section not on the timeline yet
    // (the gold new-section line showed), a dialog asks which section to start.
    if (looseDrag) {
      if (loosePlacement) {
        freezeLoosePlacement(looseDrag, loosePlacement, releaseClipDragHold, active.id);
        return;
      }
      if (looseNewSectionTarget) {
        openLooseNewSection(looseDrag, looseNewSectionTarget, releaseClipDragHold, active.id);
        return;
      }
      releaseClipDragHold();
      return;
    }
    // No other drag takes a poll hold.
    releaseClipDragHold();

    if (!over) return;
    const clip = (active.data.current?.clip ?? dragData?.clip) as Clip;
    const overId = over.id as string;

    // ── MediaBucket drop (Section row, Track row, Files column, column backgrounds).
    // Checked ahead of every timeline branch. Two handlers chained, as on the Ideas
    // shelf: the shared hook (use-loose-file-organize-dnd) organizes a loose file
    // directly (no confirmation — only place-on-timeline requires one); a version
    // goes to the bucket-clip branch below. ─────────────────────────────────────
    if (isBucketOrganizeDropId(overId)) {
      if (looseFileHandled) return;
      // ── Version (bucket-clip) → bucket target: Move A (a Section row, or the Files
      // column showing another section). Any other bucket target does nothing yet.
      versionMoveDnd.handleDragEnd(event, organizeDrag);
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Track-level drop (overId is the trackId) ──────────────────────────────
    const trackId = overId;
    const targetTrack = tracks.find((t) => t.id === trackId);
    if (!targetTrack || !clip) return;

    if (activeType === 'bucket-clip') {
      // Only a legacy full take gets here (a sectioned version dropped above), or a
      // version whose track isn't on the timeline, which places nothing.
      const draggedTrackId = dragData?.trackId;
      const wrongTrack = draggedTrackId
        ? draggedTrackId !== targetTrack.id
        : (() => {
            const sourceInstrument = MOCK_SONG.instruments.find((inst) =>
              inst.ideas.some((idea) => idea.versions.some((v) => v.id === clip.id))
            );
            return !!(sourceInstrument && sourceInstrument.name !== targetTrack.name);
          })();
      if (wrongTrack || !clip.isFullTake) return;

      // ── Full-take path: freeform placement at drop position ──────────────────
      const dropTime = Math.max(0, dragPointerTime(pointerClientX));
      const newClipId = insertFreeformClip(targetTrack.id, clip, dropTime);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      setFlashClipId(newClipId);
      flashTimerRef.current = setTimeout(() => setFlashClipId(null), 1800);
    }
  };

  // Escape / sensor cancel. Without this, activeDragData outlived the drag: the
  // track overlays stayed up and the Delete shortcut stayed blocked until the next
  // drag. The spring-loaded restore runs from its own useDndMonitor (MediaBucket).
  const handleDragCancel = () => {
    setActiveDragData(null);
    clearNewSectionLine();
    takeClipDragHold()();
    stopClipDrag();
    stopFileDropPreview();
    stopFileEdgeScroll();
    stopDragPointer();
    looseFileOrganizeDnd.handleDragCancel();
  };

  // useCallback so the memoized track rows don't re-render on every Timeline render.
  const handleDeleteTrack = useCallback((trackId: string) => {
    fetch(`/api/tracks/${trackId}`, { method: 'DELETE' }).catch(console.error);
    setTracks(prev => prev.filter(t => t.id !== trackId));
    queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
    queryClient.invalidateQueries({ queryKey: ['hidden-tracks', songId] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
    queryClient.invalidateQueries({ queryKey: ['songs'] });
  }, [queryClient, songId]);

  const handleRulerSeek = (pos: number) => {
    if (suppressRulerClickRef.current) {
      suppressRulerClickRef.current = false;
      return;
    }
    const time = Math.max(0, pos / zoom);
    setPlayheadTime(time);
    window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
  };

  const [location] = useLocation();
  const hasAutoScrolled = React.useRef<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const section = searchParams.get('section');
    const currentSearch = window.location.search;

    if (section && sectionLayout.length > 0 && hasAutoScrolled.current !== currentSearch) {
      const targetSection = sectionLayout.find(
        (s) => s.name.toLowerCase() === section.toLowerCase()
      );
      if (targetSection && timelineRef.current) {
        const scrollX =
          targetSection.start * zoom -
          timelineRef.current.clientWidth / 2 +
          (targetSection.duration * zoom) / 2;
        timelineRef.current.scrollTo({ left: Math.max(0, scrollX), behavior: 'smooth' });
        const time = Math.max(0, targetSection.start);
        setPlayheadTime(time);
        checkAudioMuteState(time);
        window.dispatchEvent(new CustomEvent('time-update', { detail: { time } }));
        hasAutoScrolled.current = currentSearch;
      }
    }
  }, [location, sectionLayout, zoom, setPlayheadTime, checkAudioMuteState]);

  const [timelineHeight, setTimelineHeight] = useState(
    typeof window !== 'undefined' ? (window.innerHeight - 136) / 2 : 400
  );
  const resizeRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [clearDialogState, setClearDialogState] = useState<'none' | 'checking' | 'simple' | 'enhanced'>('none');
  const clearSimpleButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearLeaveFinalButtonRef = useRef<HTMLButtonElement | null>(null);
  const [flashClipId, setFlashClipId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, []);

  // Dismiss context menu on click-outside or Escape.
  useEffect(() => {
    if (!contextMenuPos) return;
    const dismiss = () => setContextMenuPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenuPos(null); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenuPos]);

  // Return key → reposition playhead to time 0.
  useEffect(() => {
    const onReturnKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (document.querySelector('[data-state="open"]')) return;
      e.preventDefault();
      seekPendingRef.current = true;
      setPlayheadTime(0);
      window.dispatchEvent(new CustomEvent('time-update', { detail: { time: 0 } }));
      const el = timelineRef.current;
      if (el) {
        const newPos = 256 + 0 * zoomRef.current;
        const sl = el.scrollLeft;
        const cw = el.clientWidth;
        if (newPos < sl + TRACK_PANEL_WIDTH || newPos > sl + cw) {
          el.scrollLeft = Math.max(0, Math.min(newPos - cw * 0.5, el.scrollWidth - cw));
          lastAutoScrollRef.current = el.scrollLeft;
          isFollowingRef.current = true;
        }
      }
    };
    document.addEventListener('keydown', onReturnKey);
    return () => document.removeEventListener('keydown', onReturnKey);
  }, [setPlayheadTime]);

  // Delete/Backspace → remove the selected timeline clip (same path as right-click Remove Clip).
  // Non-final: dispatches remove-clip immediately. Final: dispatches keyboard-remove-clip, which
  // causes the clip's own showRemoveConfirm AlertDialog to open (exact same component as right-click).
  useEffect(() => {
    const onDeleteKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.repeat) return;
      if (!selectedTimelineClipId) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (document.querySelector('[data-state="open"]')) return;
      if (activeDragData) return;
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('keyboard-remove-clip', { detail: { clipId: selectedTimelineClipId } }));
    };
    document.addEventListener('keydown', onDeleteKey);
    return () => document.removeEventListener('keydown', onDeleteKey);
  }, [selectedTimelineClipId, activeDragData]);

  // Arrow keys → navigate selection between clips and tracks.
  useEffect(() => {
    // The clips arrow keys move between: every clip that is drawn (a pickup cut to
    // nothing isn't).
    const navTracks = tracks.map((t) => (t.clips.every(hasPlayedLength) ? t : { ...t, clips: t.clips.filter(hasPlayedLength) }));
    // Scrolls the timeline to bring a clip into view when keyboard nav moves selection off-screen.
    // Only fires when the clip is not already fully visible. Applies a directional overscroll margin
    // so the user can see a preview of what's next. Clamped to actual scrollable bounds.
    const scrollClipIntoView = (
      clip: Pick<Clip, 'start' | 'duration' | 'trimStart' | 'trimEnd' | 'headCut'>,
      direction: 'left' | 'right' | 'vertical',
    ) => {
      const el = timelineRef.current;
      if (!el) return;
      const z = zoomRef.current;
      const effectiveDuration = playedSpan(clip).length;
      const clipLeft = TRACK_PANEL_WIDTH + clip.start * z;
      const clipRight = clipLeft + effectiveDuration * z;
      const { scrollLeft, clientWidth, scrollWidth } = el;
      const maxScroll = scrollWidth - clientWidth;
      // The sticky 256px panel always covers the leftmost TRACK_PANEL_WIDTH pixels of the
      // viewport, so visible content begins at scrollLeft + TRACK_PANEL_WIDTH, not scrollLeft.
      const fullyVisible = clipLeft >= scrollLeft + TRACK_PANEL_WIDTH && clipRight <= scrollLeft + clientWidth;
      if (fullyVisible) return;
      let newScrollLeft: number;
      if (direction === 'left') {
        // Align clip's left edge just past the panel, then back off by the overscroll margin.
        newScrollLeft = clipLeft - TRACK_PANEL_WIDTH - KEYBOARD_NAV_OVERSCROLL_PX;
      } else if (direction === 'right') {
        newScrollLeft = clipRight - clientWidth + KEYBOARD_NAV_OVERSCROLL_PX;
      } else {
        // vertical: scroll minimum with overscroll in whichever direction is needed
        newScrollLeft = clipLeft < scrollLeft + TRACK_PANEL_WIDTH
          ? clipLeft - TRACK_PANEL_WIDTH - KEYBOARD_NAV_OVERSCROLL_PX
          : clipRight - clientWidth + KEYBOARD_NAV_OVERSCROLL_PX;
      }
      el.scrollLeft = Math.max(0, Math.min(newScrollLeft, maxScroll));
    };

    const selectClipOnTrack = (track: (typeof tracks)[0], clipId: string) => {
      setSelectedTimelineTrackId(track.id);
      setSelectedTimelineClipId(clipId);
      localStorage.setItem(`patchbay-selected-timeline-track-${songId}`, track.id);
      localStorage.setItem(`patchbay-selected-timeline-clip-${songId}`, clipId);
    };

    const firstClipOf = (track: (typeof tracks)[0]) =>
      [...track.clips].sort((a, b) => a.start - b.start)[0];


    const onArrowKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (document.querySelector('[data-state="open"]')) return;
      if (activeDragData) return;

      // Nothing selected → find the first track in render order that has at least one clip
      // and select its first clip. No-op if every track is empty.
      if (!selectedTimelineTrackId) {
        const firstNonEmpty = navTracks.find((t) => t.clips.length > 0);
        if (!firstNonEmpty) return;
        const initialClip = firstClipOf(firstNonEmpty);
        selectClipOnTrack(firstNonEmpty, initialClip.id);
        const initialDir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : 'vertical';
        scrollClipIntoView(initialClip, initialDir);
        return;
      }

      const trackIndex = navTracks.findIndex((t) => t.id === selectedTimelineTrackId);
      if (trackIndex === -1) return;
      const currentTrack = navTracks[trackIndex];

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const sorted = [...currentTrack.clips].sort((a, b) => a.start - b.start);

        // No clips on this track — nothing to navigate to.
        if (sorted.length === 0) return;

        // Track-only selection: select first clip in time order regardless of direction.
        if (!selectedTimelineClipId) {
          selectClipOnTrack(currentTrack, sorted[0].id);
          scrollClipIntoView(sorted[0], e.key === 'ArrowLeft' ? 'left' : 'right');
          return;
        }

        const clipIndex = sorted.findIndex((c) => c.id === selectedTimelineClipId);
        if (clipIndex === -1) return;

        const refStart = sorted[clipIndex].start;

        if (e.key === 'ArrowLeft') {
          if (clipIndex > 0) {
            selectClipOnTrack(currentTrack, sorted[clipIndex - 1].id);
            scrollClipIntoView(sorted[clipIndex - 1], 'left');
          } else {
            // First clip on this track — fall through upward, picking the latest clip on each
            // candidate track whose start is strictly less than the reference clip's start.
            for (let i = trackIndex - 1; i >= 0; i--) {
              const candidateSorted = [...navTracks[i].clips].sort((a, b) => a.start - b.start);
              const match = [...candidateSorted].reverse().find((c) => c.start < refStart);
              if (match) {
                selectClipOnTrack(navTracks[i], match.id);
                scrollClipIntoView(match, 'left');
                return;
              }
            }
            // No qualifying clip above — true start of the timeline.
          }
        } else {
          if (clipIndex < sorted.length - 1) {
            selectClipOnTrack(currentTrack, sorted[clipIndex + 1].id);
            scrollClipIntoView(sorted[clipIndex + 1], 'right');
          } else {
            // Last clip on this track — fall through downward, picking the earliest clip on each
            // candidate track whose start is strictly greater than the reference clip's start.
            for (let i = trackIndex + 1; i < navTracks.length; i++) {
              const candidateSorted = [...navTracks[i].clips].sort((a, b) => a.start - b.start);
              const match = candidateSorted.find((c) => c.start > refStart);
              if (match) {
                selectClipOnTrack(navTracks[i], match.id);
                scrollClipIntoView(match, 'right');
                return;
              }
            }
            // No qualifying clip below — true end of the timeline.
          }
        }
        return;
      }

      // ArrowUp / ArrowDown — walk tracks in the given direction until a suitable clip is found.
      const step = e.key === 'ArrowUp' ? -1 : 1;

      if (selectedTimelineClipId) {
        // Clip selected: keep stepping until a track has a clip whose audible range contains
        // the reference clip's start time. No-op if no such track exists before the boundary.
        const currentClip = currentTrack.clips.find((c) => c.id === selectedTimelineClipId);
        if (!currentClip) return;

        for (let i = trackIndex + step; i >= 0 && i < navTracks.length; i += step) {
          const candidate = navTracks[i];
          const match = candidate.clips.find((c) => {
            const effectiveDuration = playedSpan(c).length;
            return currentClip.start >= c.start && currentClip.start < c.start + effectiveDuration;
          });
          if (match) {
            selectClipOnTrack(candidate, match.id);
            scrollClipIntoView(match, 'vertical');
            return;
          }
        }
        // No matching clip found before the boundary — stay put.
        return;
      }

      // Track-only selected: step until a track with at least one clip is found, then select
      // its first clip in time order. No-op if no non-empty track exists before the boundary.
      for (let i = trackIndex + step; i >= 0 && i < navTracks.length; i += step) {
        const candidate = navTracks[i];
        if (candidate.clips.length > 0) {
          const clip = firstClipOf(candidate);
          selectClipOnTrack(candidate, clip.id);
          scrollClipIntoView(clip, 'vertical');
          return;
        }
      }
      // No non-empty track found before the boundary — stay put.
    };

    document.addEventListener('keydown', onArrowKey);
    return () => document.removeEventListener('keydown', onArrowKey);
  }, [tracks, selectedTimelineTrackId, selectedTimelineClipId, songId, activeDragData]);

  const handleTimelineContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Suppress on clips and draggable section header labels (all carry cursor-grab).
    if (target.closest('.cursor-grab')) return;
    // Suppress in the 256px sticky track-header zone.
    const containerRect = timelineRef.current?.getBoundingClientRect();
    if (containerRect && e.clientX - containerRect.left < 256) return;
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const clearTimelineSelection = useCallback(() => {
    setSelectedTimelineTrackId(null);
    setSelectedTimelineClipId(null);
    localStorage.removeItem(`patchbay-selected-timeline-track-${songId}`);
    localStorage.removeItem(`patchbay-selected-timeline-clip-${songId}`);
  }, [songId]);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (controlInteractionRef.current) return;
    const target = e.target as HTMLElement;
    // React propagates portal clicks up through the React tree (not the DOM tree), so e.target
    // may be a Radix overlay element (dialog, menu, popover) that is not a DOM descendant of
    // this div. Bail if the click didn't originate inside our own DOM subtree — covers all
    // current and future Radix overlays without needing per-primitive attribute checks.
    if (!e.currentTarget.contains(target)) return;
    // cursor-grab doubles as a hit-test sentinel: clips, section headers, and the playhead flag
    // all carry it. If that class is ever renamed during a visual pass, this guard breaks silently
    // — consider switching to data-timeline-interactive if this area is touched again.
    if (target.closest('.cursor-grab')) return;
    const containerRect = timelineRef.current?.getBoundingClientRect();
    if (containerRect && e.clientX - containerRect.left < 256) return;
    clearTimelineSelection();
  };

  // Escape → deselect the currently selected clip/track.
  // Registered with capture:true so our guard runs before Radix's capture-phase DismissableLayer
  // handler, which closes dialogs/menus synchronously in capture phase and removes data-state="open"
  // before any bubble-phase listener can see it. We must NOT call stopPropagation/preventDefault
  // when bailing — Radix still needs to receive this event to close the overlay normally.
  useEffect(() => {
    const onEscapeKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      if (document.querySelector('[data-state="open"]')) return;
      if (!selectedTimelineTrackId && !selectedTimelineClipId) return;
      clearTimelineSelection();
    };
    document.addEventListener('keydown', onEscapeKey, { capture: true });
    return () => document.removeEventListener('keydown', onEscapeKey, { capture: true });
  }, [selectedTimelineTrackId, selectedTimelineClipId, clearTimelineSelection]);

  const handleClearAll = () => {
    const allClips = tracks.flatMap((t) => t.clips);
    setTracks((prev) => prev.map((t) => ({ ...t, clips: [] })));
    allClips.forEach((clip) => {
      fetch(`/api/timeline-clips/${clip.id}`, { method: 'DELETE' }).catch(console.error);
    });
    setClearDialogState('none');
  };

  const handleLeaveFinalClips = () => {
    fetch(`/api/songs/${songId}/timeline-clips/non-final`, { method: 'DELETE' })
      .then(() => Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] }),
        queryClient.invalidateQueries({ queryKey: ['songs'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ]))
      .catch(console.error);
    setClearDialogState('none');
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current) return;
    const startY = e.clientY;
    const startHeight = timelineHeight;
    const containerHeight = containerRef.current.clientHeight;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(144, Math.min(startHeight + deltaY, containerHeight - 56));
      setTimelineHeight(newHeight);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // ── Render inputs for the memoized track rows ───────────────────────────────
  // While a timeline clip is dragged, the clip floats with the pointer
  // (positionFloatingClip) and the timeline is drawn from the drag's preview layout:
  // the shared layoutTimeline run on the stored clips plus the preview's offsets (the
  // dragged clip's landing offset and every clip it pushes). So the home section grows
  // or shrinks live, and every later section slides with everything in it, on all
  // tracks together. It lives only in drag-preview state, never in the tracks, and is
  // recomputed only when the placement changes (clipDragPreview is replaced only then).
  // null = the stored layout: no drag, the pointer off the clip's row (a release there
  // changes nothing), or a placement that changes nothing.
  // A Media Bucket file drag uses the same preview: its virtual clip is added to its
  // track at its landing offset, so its section grows live too (computeFileDragPlacement).
  // A loose file's frozen preview (looseConfirm, while its confirm dialog is open) is
  // drawn the same way.
  const activeDragPreview = looseConfirm?.placement ?? clipDragPreview;
  // A section-end handle drag is drawn the same way: the stored clips with that
  // section's base length set to the picked end (null = fit, at the minimum), so every
  // later section slides with its clips on every track and cut pickups update live.
  const clipDragLayout = React.useMemo(() => {
    if (sectionEndDrag) {
      if (sectionEndDrag.endBeat === sectionEndDrag.storedEndBeat) return null;
      const baseLength = baseLengthForEnd(sectionEndDrag.range, sectionEndDrag.endBeat);
      const previewSections = sections.map((s) => (s.name === sectionEndDrag.name ? { ...s, baseLength } : s));
      return deriveLayout(trackState, previewSections, bpm, timeSignature);
    }
    const preview = activeDragPreview;
    if (!preview || !preview.changed) return null;
    const previewTracks = trackState.map((t) => {
      if (t.id !== preview.trackId) return t;
      const clips = t.clips.map((c) => preview.offsets.has(c.id) ? { ...c, sectionOffset: preview.offsets.get(c.id)! } : c);
      if (preview.virtual) clips.push({ ...preview.virtual, sectionOffset: preview.offsets.get(preview.virtual.id) ?? 0 });
      return { ...t, clips };
    });
    return deriveLayout(previewTracks, sections, bpm, timeSignature);
  }, [sectionEndDrag, activeDragPreview, trackState, sections, bpm, timeSignature]);
  const displayLayout = clipDragLayout ?? layout;
  // The tracks as drawn: every clip at its preview-layout start and head cut (a push can
  // take a later pickup's room away, or give it back), except the dragged
  // clip (it floats). A track none of whose clips move keeps its object, so its
  // memoized row re-renders only if the sections themselves change; a clip that doesn't
  // move keeps its object too.
  const draggedClipId = activeDragData?.type === 'clip' ? activeDragData.clip.id : null;
  const displayTracks = React.useMemo(() => {
    if (!clipDragLayout) return tracks;
    return tracks.map((track) => {
      let moved = false;
      const clips = track.clips.map((c) => {
        if (c.id === draggedClipId) return c;
        const next = withLayoutPosition(c, clipDragLayout);
        if (next !== c) moved = true;
        return next;
      });
      return moved ? { ...track, clips } : track;
    });
  }, [tracks, clipDragLayout, draggedClipId]);
  // Section geometry as drawn (headers, section cells). Kept as the same array while
  // nothing about it changes, so the rows' `sections` prop stays stable.
  const displaySectionsRef = useRef<SectionInfo[]>(sectionLayout);
  const displaySectionLayout = React.useMemo<SectionInfo[]>(() => {
    if (!clipDragLayout) return sectionLayout;
    const next = clipDragLayout.sections.map((sec) => ({ name: sec.name, start: sec.start, duration: sec.length }));
    const prev = displaySectionsRef.current;
    const same = prev.length === next.length
      && prev.every((p, i) => p.name === next[i].name && p.start === next[i].start && p.duration === next[i].duration);
    return same ? prev : next;
  }, [clipDragLayout, sectionLayout]);
  displaySectionsRef.current = displaySectionLayout;
  // The content's right end (seconds) for the scrollable width, the ruler and the
  // edge-scroll cap. During a timeline clip drag or a previewed version drag it follows
  // the preview layout but never shrinks (the widest seen since the drag started), so
  // the browser never clamps scrollLeft and nothing jumps under the pointer; after the
  // drag it is the stored layout's end again. The same during a section-end handle drag.
  let contentEnd = endOfTimeline;
  if (draggedClipId || fileDrop || looseConfirm || sectionEndDrag) {
    clipDragMaxEndRef.current = Math.max(clipDragMaxEndRef.current, displayLayout.timelineEnd, endOfTimeline);
    contentEnd = clipDragMaxEndRef.current;
  }
  contentEndRef.current = contentEnd;
  // Section-end handles (SectionEndHandles): sections on the timeline with a
  // song_sections row (never orphans or full takes), at their drawn end. A handle can
  // start only while nothing else is dragged or trimmed.
  const sectionEndInteractive = activeSectionName === null && activeDragData === null
    && fileDrop === null && looseConfirm === null && trimsBusy === 0;
  sectionEndInteractiveRef.current = sectionEndInteractive;
  const sectionEndMarks = React.useMemo<SectionEndMark[]>(() => {
    const rowNames = new Set(sections.map((s) => s.name));
    return displayLayout.sections
      .filter((sec) => rowNames.has(sec.name))
      .map((sec) => ({
        name: sec.name,
        endPx: TRACK_PANEL_WIDTH + sec.end * zoom,
        addsSpace: sec.lengthBeats > contentNeedBeats(sec.contentNeed, bpm),
      }));
  }, [displayLayout, sections, zoom, bpm]);
  // Which header the pointer is over, from its x against the drawn sections.
  const handleHeaderRowPointerMove = (e: React.PointerEvent) => {
    const t = dragPointerTime(e.clientX);
    const name = t >= 0 ? sectionAt(t, displayLayout.sections)?.name ?? null : null;
    if (name !== hoveredHeader) setHoveredHeader(name);
  };
  // The dashed landing outline: where the dragged clip lands if released now, or its
  // own spot when nothing would change; trimmed length wide. Hidden while the pointer
  // is off the timeline (clipDragOffTimeline).
  // For a file drag: the virtual clip's spot in the preview layout, on its destination
  // track, only while there is a preview (the pointer over the timeline, and for a loose
  // file somewhere it can land) or while a loose file's preview is frozen.
  const clipDragLanding = React.useMemo(() => {
    if (fileDrop || looseConfirm) {
      const preview = activeDragPreview;
      const virtual = preview?.virtual;
      if (!preview || !virtual || !clipDragLayout) return null;
      const start = clipDragLayout.clipStarts.get(virtual.id);
      if (start === undefined) return null;
      return {
        trackId: preview.trackId,
        clipId: null,
        rect: { left: start * zoom, width: clipLength(virtual) * zoom },
      };
    }
    if (!draggedClipId) return null;
    const track = tracks.find((t) => t.clips.some((c) => c.id === draggedClipId));
    const clip = track?.clips.find((c) => c.id === draggedClipId);
    if (!track || !clip) return null;
    // Its drawn span in the layout it lands in: cut start and played length.
    const landed = clipDragLayout ? withLayoutPosition(clip, clipDragLayout) : clip;
    return {
      trackId: track.id,
      clipId: clip.id,
      rect: { left: landed.start * zoom, width: playedSpan(landed).length * zoom },
    };
  }, [fileDrop, looseConfirm, activeDragPreview, draggedClipId, tracks, clipDragLayout, zoom]);
  // Where the loose-file confirm dialog sits (confirmDialogTop): centred over the Media
  // Bucket, between the bottom of the app header and the top of the timeline, and never
  // over the frozen landing outline. Measured once the dialog's element mounts (it's
  // portaled, so it mounts a render after looseConfirm is set) and again on window
  // resize.
  const [looseConfirmEl, setLooseConfirmEl] = useState<HTMLDivElement | null>(null);
  const [looseConfirmTop, setLooseConfirmTop] = useState<number | null>(null);
  const looseConfirmOutline = looseConfirm ? clipDragLanding : null;
  useLayoutEffect(() => {
    if (!looseConfirm || !looseConfirmEl) { setLooseConfirmTop(null); return; }
    const place = () => {
      const el = timelineRef.current;
      if (!el) return;
      const timelineRect = el.getBoundingClientRect();
      const header = document.querySelector('header');
      const row = trackState.findIndex((t) => t.id === looseConfirm.placement.trackId);
      const rowTop = timelineRect.top + TRACK_ROWS_TOP_PX + row * TRACK_ROW_HEIGHT_PX - el.scrollTop;
      const outlineLeft = timelineRect.left + TRACK_PANEL_WIDTH - el.scrollLeft + (looseConfirmOutline?.rect.left ?? 0);
      setLooseConfirmTop(confirmDialogTop({
        dialogWidth: looseConfirmEl.offsetWidth,
        dialogHeight: looseConfirmEl.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gapTop: header?.getBoundingClientRect().bottom ?? 0,
        gapBottom: timelineRect.top,
        outline: row >= 0 && looseConfirmOutline
          ? { top: rowTop, bottom: rowTop + TRACK_ROW_HEIGHT_PX, left: outlineLeft, right: outlineLeft + looseConfirmOutline.rect.width }
          : null,
      }));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [looseConfirm, looseConfirmEl, looseConfirmOutline, trackState]);
  // Focus during a timeline clip drag: the home section (at its live length) and the
  // one bar before it (pickup reach) stay bright; everything else in the track rows and
  // the section header row is dimmed by a veil (ClipDragFocusVeil). Song seconds.
  // The same for a previewed file drag (its destination section), only while there is a
  // preview, and for a loose file's frozen preview.
  const clipDragFocus = React.useMemo(() => {
    let homeName: string | undefined;
    if (fileDrop || looseConfirm) {
      if (!activeDragPreview) return null;
      homeName = activeDragPreview.sectionName;
    } else {
      if (!draggedClipId) return null;
      const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === draggedClipId);
      if (!clip || clip.isFullTake || !clip.sectionName) return null;
      homeName = clip.sectionName;
    }
    const home = displayLayout.sections.find((sec) => sec.name === homeName);
    if (!home) return null;
    const bar = snapGridSeconds('bar', bpm, timeSignature);
    return { litStart: Math.max(0, home.start - bar), litEnd: home.end };
  }, [fileDrop, looseConfirm, activeDragPreview, draggedClipId, tracks, displayLayout, bpm, timeSignature]);
  // Sections a drag's clip can't land in — the same for every row, so one shared set.
  const draggedSectionName = activeDragData?.clip?.sectionName;
  // Keyed on the names only, so a drag that just changes section lengths keeps the set.
  const sectionNamesKey = sectionLayout.map((s) => s.name).join('\u0000');
  const invalidSectionsDuringDrag = React.useMemo(() => {
    const set = new Set<string>();
    if (draggedSectionName) {
      sectionLayout.forEach(({ name }) => { if (name !== draggedSectionName) set.add(name); });
    }
    return set;
  }, [draggedSectionName, sectionNamesKey]);

  // During a timeline clip drag or a Media Bucket file drag (a version or a loose file), the Media Bucket keeps
  // the element from the drag's start: React skips a subtree whose element is the
  // same object, so the bucket isn't re-rendered by each drag-preview change. Its own
  // state, queries and dnd-kit hooks still update it — everything a version drag needs
  // mid-drag lives there: spring-loaded tracks and sections, drop highlights
  // (useActiveOrganizeDrag), the dimmed source card or row (its own useDraggable),
  // column edge scroll and the landing flash; a loose file's drop onto a bucket folder
  // is handled here in handleDragEnd (the shared organize hook), not by the element. Its callbacks (Add to Timeline, Place on Timeline,
  // Remove from Section) can't be used mid-drag, and the element is rebuilt on the
  // first render after the drag.
  const mediaBucketElementRef = useRef<React.ReactNode>(null);
  const bucketFrozen = activeDragData?.type === 'clip' || activeDragData?.type === BUCKET_CLIP_DRAG_TYPE
    || activeDragData?.type === 'loose-file';
  if (!bucketFrozen || mediaBucketElementRef.current === null) {
    mediaBucketElementRef.current = (
    <LooseFilePlacementProvider value={openLooseFilePlacement}>
    <VersionMoveOutContext.Provider value={songInfo?.type === 'song' ? versionMoveDnd.moveOutOfSection : null}>
    <MediaBucket
      songId={songId}
      modeTabs={modeTabs}
      onAddToTimeline={(clip, trackId) => {
        const targetTrack = tracks.find((t) => t.id === trackId);
        if (!targetTrack) {
          console.warn('[AddToTimeline] missing trackId', { trackId });
          return;
        }

        // ── Full-take: append after the last full-take clip on this track ──
        if (clip.isFullTake) {
          const existing = targetTrack.clips.filter((c) => c.isFullTake);
          const dropTime = existing.length > 0
            ? Math.max(...existing.map((c) => c.start + (c.trimEnd ?? c.duration) - (c.trimStart ?? 0)))
            : 0;
          const newClipId = insertFreeformClip(targetTrack.id, clip, dropTime);
          toast({
            className: 'border-primary/50 bg-[#161410] shadow-[0_0_24px_rgba(234,179,8,0.25)]',
            title: (
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
                <CheckCircle2 size={14} /> Added to timeline
              </span>
            ),
            description: (
              <span className="text-sm text-white/80">
                <span className="text-white font-semibold">{targetTrack.name}</span>
                <span className="text-white/40"> · </span>
                <span className="text-white font-semibold">Full Take</span>
              </span>
            ),
          });
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          setFlashClipId(newClipId);
          flashTimerRef.current = setTimeout(() => setFlashClipId(null), 1800);
          return;
        }
        // ─────────────────────────────────────────────────────────────────

        if (!clip.sectionName) {
          console.warn('[AddToTimeline] missing sectionName', { trackId, sectionName: clip.sectionName });
          return;
        }
        const newClipId = insertClipInSection(targetTrack.id, clip.sectionName, clip);
        toast({
          className: 'border-primary/50 bg-[#161410] shadow-[0_0_24px_rgba(234,179,8,0.25)]',
          title: (
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              <CheckCircle2 size={14} /> Added to timeline
            </span>
          ),
          description: (
            <span className="text-sm text-white/80">
              <span className="text-white font-semibold">{targetTrack.name}</span>
              <span className="text-white/40"> · </span>
              <span className="text-white font-semibold">{clip.sectionName}</span>
            </span>
          ),
        });
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        setFlashClipId(newClipId);
        flashTimerRef.current = setTimeout(() => setFlashClipId(null), 1800);
      }}
    />
    </VersionMoveOutContext.Provider>
    </LooseFilePlacementProvider>
    );
  }
  const mediaBucketElement = mediaBucketElementRef.current;

  const playheadPx = 256 + playheadTimeSecs * zoom;
  // Whether the flag's point is at/right of the sticky panel's edge — read live from the DOM so
  // this is correct on the very next render regardless of whether that render was triggered by a
  // playhead change or by the scroll listener above. See the flag-band's style for how this is used.
  const flagAbovePanel = playheadPx - (timelineRef.current?.scrollLeft ?? 0) >= TRACK_PANEL_WIDTH;
  useEffect(() => { flagAbovePanelRef.current = flagAbovePanel; }, [flagAbovePanel]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={trackFirstCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={dndAutoScroll}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" ref={containerRef}>
        {mediaBucketElement}

        <div
          className="flex flex-col min-w-0 bg-[#09090b] relative isolate overflow-hidden select-none shrink-0"
          style={{ height: `${timelineHeight}px` }}
        >
          <div
            ref={resizeRef}
            className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-[25]"
            onPointerDown={handleResizePointerDown}
          />
          {/* Rubber-band backing — sits at z-30 (below playhead z-40) and fills the left column.
              Its only job is providing an opaque background during Safari elastic overscroll when
              the scroller content shifts and briefly exposes the viewport gap above the ruler.
              It is NOT an occluder: sticky-left elements inside the scroller (z-50) own that role. */}
          <div className="absolute top-0 bottom-0 left-0 w-64 bg-card z-30 pointer-events-none" />
          <div
            className="flex-1 overflow-y-auto overflow-x-auto relative [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            ref={timelineRef}
          >
            <div
              className="relative"
              style={{
                width: `${Math.max(contentEnd + 15, 0) * zoom + 256}px`,
                minWidth: `${TRACK_PANEL_WIDTH + 100 * zoom}px`,
              }}
              onContextMenu={handleTimelineContextMenu}
              onClick={handleTimelineClick}
            >
              {/* Flag-band: thin sticky strip that holds the draggable playhead handle.
                  The flag overflows this 6px band downward — that is intentional.
                  z is dynamic, not the static 35 in the z-map: when the flag's point is at/right
                  of the panel edge (flagAbovePanel), the whole band — and thus the flag riding
                  inside it — is bumped above the z-50 panel spacers so the flag's overhang past
                  the boundary (near/at t=0) renders on top instead of tucked behind the panel.
                  This is safe because the band's own bg-card fill is pixel-identical to the
                  spacer's in the strip they share, so raising it doesn't reveal anything new —
                  only the flag itself becomes visible there. Once scrolling moves the flag's
                  point behind the panel (flagAbovePanel false), z drops back to 35 and the z-50
                  spacers correctly occlude it again, per the original design. */}
              <div
                className="h-1.5 sticky top-0 relative bg-card pointer-events-none"
                style={{ zIndex: flagAbovePanel ? 51 : 35 }}
              >
                <div
                  className="absolute top-0 z-10 flex flex-col items-center cursor-grab active:cursor-grabbing pointer-events-auto before:absolute before:-inset-2 before:content-['']"
                  style={{
                    // No clamp: must match the playhead line's x-position exactly, including at
                    // time=0. At time=0 (playheadPx=256), half the flag body sits left of the
                    // panel boundary — see flagAbovePanel/the flag-band's style above for why
                    // that overhang renders on top of the panel instead of being clipped by it.
                    left: `${playheadPx}px`,
                    transform: 'translateX(-50%)',
                  }}
                  onPointerDown={handlePlayheadPointerDown}
                >
                  <div className="w-[13px] h-[14px] bg-primary rounded-sm shadow-sm flex items-center justify-center">
                    <div className="w-[1px] h-[8px] bg-black/50" />
                  </div>
                  <div className="w-0 h-0 border-l-[6.5px] border-l-transparent border-r-[6.5px] border-r-transparent border-t-[6px] border-t-primary" />
                </div>
              </div>
              {/* Flag-band spacer — content-root sibling, no sticky ancestor, z-50 holds globally.
                  Negative margin overlaps the flag-band without adding vertical space. */}
              <div className="-mt-1.5 sticky left-0 top-0 z-50 w-64 h-1.5 bg-card pointer-events-none" />

              <Ruler
                onSeek={handleRulerSeek}
                zoom={zoom}
                bpm={bpm}
                timeSignature={timeSignature}
                // Same span as the content div's width/minWidth below, minus the track panel.
                contentSeconds={Math.max(contentEnd + 15, 100)}
              />
              {/* Ruler spacer — same pattern: content-root sibling, overlaps the 32px ruler.
                  It also holds the snap controls, in the corner above the track names
                  (pointer-events only on the controls themselves). */}
              <div className="-mt-8 sticky left-0 top-[6px] z-50 w-64 h-8 bg-card pointer-events-none flex items-center pl-3">
                <div className="pointer-events-auto">
                  <SnapControls value={snap} onChange={setSnap} />
                </div>
              </div>

              {/* Track-row layer for every gold insertion line (SplitInsertionLine): the
                  rows only, z-29 — above clips, the veil (22) and the clip ghost (24),
                  below the sticky ruler and header row (30), so a line never shows in the
                  ruler, even when the rows are scrolled up under it. */}
              <div
                ref={setRowsLineLayer}
                className="absolute left-0 right-0 z-[29] pointer-events-none"
                style={{ top: TRACK_ROWS_TOP_PX, height: TRACK_ROW_HEIGHT_PX * tracks.length }}
              />

              {/* New-section insertion line — where a dragged version's section will join
                  the timeline when it has no clips there yet (updateNewSectionLine). */}
              {newSectionLineX !== null && (
                <SplitInsertionLine left={newSectionLineX} layers={insertionLineLayers} />
              )}

              {/* Section header drag: the destination line, and a veil dimming the dragged
                  section's column. The veil is its own element so SectionCell and
                  TimelineClip keep no drag-aware styling. */}
              {headerDrop !== null && (
                <SplitInsertionLine left={TRACK_PANEL_WIDTH + headerDrop.lineAt * zoom} layers={insertionLineLayers} />
              )}
              {activeSectionName !== null && (() => {
                const sec = sectionLayout.find((s) => s.name === activeSectionName);
                if (!sec) return null;
                return (
                  <div
                    className="absolute z-[22] bg-[#09090b]/60 pointer-events-none"
                    style={{
                      left: TRACK_PANEL_WIDTH + sec.start * zoom,
                      width: sec.duration * zoom,
                      top: TRACK_ROWS_TOP_PX,
                      height: TRACK_ROW_HEIGHT_PX * tracks.length,
                    }}
                  />
                );
              })()}
              {activeSectionName !== null && <SectionDragTag name={activeSectionName} tagRef={sectionDragTagRef} />}
              {sectionEndDrag !== null && (
                <SectionDragTag
                  name={sectionEndReadout(sectionEndDrag.name, sectionEndDrag.range, sectionEndDrag.endBeat, parseTimeSignature(timeSignature).beatsPerBar)}
                  tagRef={sectionEndTagRef}
                />
              )}
              {/* Section header drag: a ghost of the dragged section's clips that travels
                  with the pointer (positionSectionDragGhost), across the track rows only.
                  Its own layer in the content root, so it scrolls vertically with the rows;
                  the strip clips it to the content (a ghost pushed past the edge can't grow
                  the scroll area), the sticky track panel (z-50) covers it over the panel,
                  and the insertion line (z-30) draws above it. */}
              {activeSectionName !== null && (() => {
                const sec = sectionLayout.find((s) => s.name === activeSectionName);
                if (!sec) return null;
                return (
                  <div
                    className="absolute left-0 right-0 z-[24] overflow-hidden pointer-events-none"
                    style={{ top: TRACK_ROWS_TOP_PX, height: TRACK_ROW_HEIGHT_PX * tracks.length }}
                  >
                    <div
                      ref={sectionDragGhostRef}
                      className="absolute left-0 top-0 rounded-sm border border-primary/40"
                      style={{ width: sec.duration * zoom, opacity: 0.55, visibility: 'hidden' }}
                    >
                      {/* One bar per track row that has clips in this section — the old
                          DragOverlay's shapes, without its header label — plus its pickups,
                          hanging before the ghost's start at their stored offset, uncut
                          (the ghost shows the stored arrangement, not the layout's head cut). */}
                      {tracks.map((track) => {
                        const sectionClips = track.clips.filter((c) => c.sectionName === activeSectionName && !c.isFullTake);
                        const pickups = sectionClips.filter(isPickupClip);
                        return (
                          <div key={track.id} className="relative h-16 flex items-center px-1.5">
                            {sectionClips.some((c) => !isPickupClip(c)) && (
                              <div className="h-8 rounded flex-1" style={{ backgroundColor: trackDisplayColor(track) }} />
                            )}
                            {pickups.map((c) => (
                              <div
                                key={c.id}
                                className="absolute top-4 h-8 rounded"
                                style={{
                                  left: c.sectionOffset! * zoom,
                                  width: clipLength(c) * zoom,
                                  backgroundColor: trackDisplayColor(track),
                                }}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Section column headers — own DndContext for section reordering */}
              <DndContext
                sensors={sensors}
                autoScroll={false}
                onDragStart={handleSectionDragStart}
                onDragEnd={handleSectionDragEnd}
                onDragCancel={handleSectionDragCancel}
              >
                <div
                  className="flex w-full h-6 border-b border-border/50 bg-[#09090b] sticky top-[38px] z-30"
                  onPointerMove={handleHeaderRowPointerMove}
                  onPointerLeave={() => setHoveredHeader(null)}
                >
                  {/* Header-row layer for every gold insertion line (SplitInsertionLine).
                      Content px like the rows layer; runs 1px past the row (-bottom-px) to
                      cover its border-b, which otherwise left a 1px gap at y 62. Over the
                      track panel it sits under the z-50 section-band spacer. */}
                  <div ref={setHeaderLineLayer} className="absolute inset-x-0 top-0 -bottom-px z-10 pointer-events-none" />
                  {/* Timeline clip drag focus: dims every header but the home section's
                      (and the bar before it). Below the line layer; over the track
                      panel the z-50 section-band spacer covers it. */}
                  {clipDragFocus && (
                    <ClipDragFocusVeil
                      litLeft={TRACK_PANEL_WIDTH + clipDragFocus.litStart * zoom}
                      litRight={TRACK_PANEL_WIDTH + clipDragFocus.litEnd * zoom}
                      top={0}
                      height="100%"
                      zIndex={5}
                    />
                  )}
                  {/* Layout placeholder — z-50 cover provided by content-root sibling spacer below */}
                  <div className="w-64 shrink-0 bg-card border-r border-border h-full" />
                  <div className="flex relative">
                    {displaySectionLayout.map((sec) => (
                      <DraggableSectionHeader
                        key={sec.name}
                        name={sec.name}
                        width={sec.duration * zoom}
                        isLooped={sec.name === loopedSectionName}
                      />
                    ))}
                  </div>
                  {/* Section-end handles: their own layer over the headers (z-20, above
                      the looped header's border); over the track panel the z-50
                      section-band spacer covers them. */}
                  <SectionEndHandles
                    marks={sectionEndMarks}
                    hoveredName={hoveredHeader}
                    draggingName={sectionEndDrag?.name ?? null}
                    interactive={sectionEndInteractive}
                    onPointerDown={startSectionEndDrag}
                  />
                </div>

              </DndContext>
              {/* Section-band spacer — content-root sibling, overlaps the 24px section band. */}
              <div className="-mt-6 sticky left-0 top-[38px] z-50 w-64 h-6 bg-card pointer-events-none" />

              {/* Timeline clip drag focus, track rows: z-9 — above the clips (1–2), below
                  the valid-track border (10), the floating clip (11–12), the landing
                  outline (13), the wrong-track veil (20), insertion lines (29), the sticky
                  ruler/header row (30), the playhead (40) and the track panel (50). */}
              {clipDragFocus && (
                <ClipDragFocusVeil
                  litLeft={TRACK_PANEL_WIDTH + clipDragFocus.litStart * zoom}
                  litRight={TRACK_PANEL_WIDTH + clipDragFocus.litEnd * zoom}
                  top={TRACK_ROWS_TOP_PX}
                  height={TRACK_ROW_HEIGHT_PX * tracks.length}
                  zIndex={9}
                />
              )}

              {displayTracks.map((track) => {
                let isInvalidDrop = false;

                if (activeDragData) {
                  const { clip, type, trackId: draggedTrackId } = activeDragData;

                  // Track-level invalidity — disables the droppable entirely. Only for a
                  // legacy full take: a sectioned version (fileDrop) is dropped by the
                  // pointer anywhere over the timeline, never by a track row.
                  if (type === 'bucket-clip' && !fileDrop) {
                    if (draggedTrackId) {
                      // Real API clip: match by trackId directly.
                      if (draggedTrackId !== track.id) isInvalidDrop = true;
                    } else {
                      // Mock clip fallback: look up instrument by clip ID in MOCK_SONG.
                      const sourceInstrument = MOCK_SONG.instruments.find((inst) =>
                        inst.ideas.some((idea) => idea.versions.some((v) => v.id === clip.id))
                      );
                      if (sourceInstrument && sourceInstrument.name !== track.name) isInvalidDrop = true;
                    }
                  }
                  // A timeline clip drag has no wrong track: the clip always stays on its
                  // own (computeClipDragPlacement), so no row is disabled or veiled. A
                  // loose file may land on any track (looseDropDestination).
                }

                // TimelineTrack is memoized: every prop below is stable from render to
                // render unless what it describes changed (displayTracks, the shared
                // displaySectionLayout and invalidSectionsDuringDrag, clipDragLanding,
                // the useCallback'd handleDeleteTrack). A drag preview change that
                // moves no section re-renders only the dragged clip's row; one that
                // does re-renders every row (their cells and later clips move).
                const isDragRow = clipDragLanding?.trackId === track.id;
                return (
                  <TimelineTrack
                    key={track.id}
                    track={track}
                    raisedClipId={isDragRow ? clipDragLanding.clipId : null}
                    landing={isDragRow && !clipDragOffTimeline ? clipDragLanding.rect : null}
                    sections={displaySectionLayout}
                    trimLimits={trimLimitsByTrack.get(track.id) ?? NO_TRIM_LIMITS}
                    invalidSections={invalidSectionsDuringDrag}
                    isInvalidDrop={isInvalidDrop}
                    // The valid-track border and wrong-track veil are for Media Bucket
                    // drags that drop on a track row (legacy full takes) — not a
                    // sectioned version or a loose file (fileDrop), which land by the
                    // pointer (the focus veil and landing outline instead).
                    isDragging={activeDragData !== null && activeDragData.type !== 'clip' && !fileDrop}
                    zoom={zoom}
                    onDeleteTrack={handleDeleteTrack}
                    songId={songId}
                    flashClipId={flashClipId}
                    selectedTrackId={selectedTimelineTrackId}
                    selectedClipId={selectedTimelineClipId}
                    controlInteractionRef={controlInteractionRef}
                    bpm={bpm}
                    timeSignature={timeSignature}
                  />
                );
              })}

              {/* Playhead line — inside the scroller so it moves natively with content (zero lag).
                  Starts below all sticky header bands (6px flag + 32px ruler + 24px section = 62px).
                  left is in content coordinates; no scrollLeft math needed. */}
              <div
                className="absolute bottom-0 w-[1px] z-40 pointer-events-none bg-primary shadow-[0_0_15px_rgba(212,175,55,0.6)]"
                style={{ left: `${playheadPx}px`, top: 0, transform: 'translateX(-50%)' }}
              />

              {/* Bottom spacer: replaces pb-32 — sticky-left panel (z-50) covers the playhead
                  line in the empty zone below the last track row. */}
              <div className="h-32 pointer-events-none">
                <div className="w-64 h-full bg-card sticky left-0 z-50" />
              </div>

            </div>
          </div>


          <DawScrollbar
            timelineRef={timelineRef}
            zoom={zoom}
            setZoom={setZoom}
            projectDuration={Math.max(30, endOfTimeline + 5)}
          />
        </div>
      </div>

      {/* At most one DragOverlay is mounted. dnd-kit renders an overlay's wrapper box
          (sized to the dragged source) whenever ANY drag is active, even with no
          children, so a second one would leave an empty box following the cursor.
          File-browser drags (a version or a loose file) get the small
          LooseFileDragOverlay chip below-right of the pointer. A timeline clip drag has
          no overlay at all: the clip itself floats with the pointer in its own row
          (positionFloatingClip), over a gold landing outline. activeDragData is set in onDragStart, which dnd-kit batches
          with the drag start itself, so the overlay is already in place on the drag's
          first frame. Nothing reads the overlay's rect: collisions and the loose-file
          Place on Timeline pre-fill use the pointer (see handleDragEnd). */}
      {activeDragData?.type === BUCKET_CLIP_DRAG_TYPE || activeDragData?.type === 'loose-file' ? (
        <LooseFileDragOverlay clip={activeDragData.clip} />
      ) : null}

      <VersionMoveInUseDialog dialogProps={versionMoveDnd.dialogProps} vars={versionMoveDnd.pendingVars} />

      {/* Timeline background right-click context menu */}
      {contextMenuPos && (
        <div
          className="fixed z-[9999] bg-popover border border-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-red-400 hover:bg-red-400/10 transition-colors"
            onClick={() => {
              setContextMenuPos(null);
              setClearDialogState('checking');
              fetch(`/api/songs/${songId}/timeline-has-finals`)
                .then((r) => r.json())
                .then(({ hasFinals }: { hasFinals: boolean }) =>
                  setClearDialogState(hasFinals ? 'enhanced' : 'simple')
                )
                .catch(() => setClearDialogState('simple'));
            }}
          >
            Clear Timeline
          </button>
        </div>
      )}

      {/* Simple clear dialog — no finals on the timeline */}
      <AlertDialog
        open={clearDialogState === 'simple'}
        onOpenChange={(open) => { if (!open) setClearDialogState('none'); }}
      >
        <AlertDialogContent
          className="bg-[#0c0c0e] border-border"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            clearSimpleButtonRef.current?.focus();
          }}
          onKeyDown={trapDialogTab}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Clear Timeline</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove all clips from the timeline? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={clearSimpleButtonRef}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearAll}
            >
              Clear Timeline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enhanced clear dialog — finals exist on the timeline */}
      <AlertDialog
        open={clearDialogState === 'enhanced'}
        onOpenChange={(open) => { if (!open) setClearDialogState('none'); }}
      >
        <AlertDialogContent
          className="bg-[#0c0c0e] border-border"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            clearLeaveFinalButtonRef.current?.focus();
          }}
          onKeyDown={trapDialogTab}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Clear Timeline</AlertDialogTitle>
            <AlertDialogDescription>
              Some clips on the timeline are marked as final. You can keep only the final clips or clear everything.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={clearLeaveFinalButtonRef}
              className="bg-card text-foreground border border-border hover:bg-muted"
              onClick={handleLeaveFinalClips}
            >
              Leave Final Clips
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearAll}
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Loose-file timeline drop: confirm (looseConfirm). The app's standard Dialog,
          styled exactly like the Place on Timeline picker below (panel, title, buttons,
          spacing). Two differences, this dialog only: a lighter backdrop
          (data-light-backdrop, see index.css) so the timeline, the frozen outline and
          the pushed clips stay visible — it still blocks the page, so nothing else can
          be dragged meanwhile — and its position (confirmDialogTop: centred over the
          Media Bucket, never over the outline). Enter places (focus starts on Place);
          Esc, Cancel, the X and a click outside cancel. */}
      <Dialog
        open={looseConfirm !== null}
        onOpenChange={(open) => { if (!open) cancelLoosePlacement(); }}
      >
        <DialogContent
          ref={setLooseConfirmEl}
          data-light-backdrop=""
          className="bg-[#0c0c0e] border-primary/20 max-w-sm"
          // Never hidden while unmeasured: focus can't land on Place inside a hidden
          // element (dnd-kit then puts it back on the dragged row). The measure runs in
          // the same commit, before paint, so the default spot never shows.
          style={looseConfirmTop !== null ? { top: looseConfirmTop, translate: '-50% 0' } : undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            looseConfirmButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white break-words">
              Place {looseConfirm?.drag.virtual.name} here?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <DialogDescription>
              It will be moved into{' '}
              <span className="text-white font-semibold">{looseConfirm?.trackName}</span>
              <span className="text-white/40"> › </span>
              <span className="text-white font-semibold">{looseConfirm?.placement.sectionName}</span>
              {' '}in the Media Bucket.
            </DialogDescription>
          </div>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs"
              onClick={cancelLoosePlacement}
            >
              Cancel
            </Button>
            <Button
              ref={looseConfirmButtonRef}
              type="button"
              className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
              onClick={confirmLoosePlacement}
            >
              Place
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loose-file drop past the end: start a new section — the confirm dialog's and
          picker's panel, title and buttons. Focus starts on Place; Enter places from
          anywhere in the dialog except a button (which acts itself) or the Section
          select (Enter picks an option there); Esc / outside click cancel. */}
      <Dialog
        open={looseNewSection !== null}
        onOpenChange={(open) => { if (!open) cancelLooseNewSection(); }}
      >
        <DialogContent
          className="bg-[#0c0c0e] border-primary/20 max-w-sm"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            looseNewSectionButtonRef.current?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.defaultPrevented) return;
            const target = e.target as HTMLElement;
            if (target.closest('button, [role="combobox"], [role="listbox"], [role="option"]')) return;
            e.preventDefault();
            placeLooseNewSection();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white break-words">
              Start a new section with {looseNewSection?.drag.virtual.name}?
            </DialogTitle>
            <DialogDescription>
              The section is added at the end of the timeline and the file lands at its start.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Track</Label>
              <p className="text-xs text-white font-semibold h-9 flex items-center">{looseNewSection?.trackName}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Section</Label>
              <Select
                value={looseNewSection?.sectionName ?? ''}
                onValueChange={(v) => {
                  const pending = looseNewSectionRef.current;
                  if (pending) setLooseNewSection({ ...pending, sectionName: v });
                }}
              >
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {(looseNewSection?.sectionNames ?? []).map((name) => (
                    <SelectItem key={name} value={name} className="text-xs focus:bg-white/8 focus:text-white">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs"
              onClick={cancelLooseNewSection}
            >
              Cancel
            </Button>
            <Button
              ref={looseNewSectionButtonRef}
              type="button"
              className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
              onClick={placeLooseNewSection}
            >
              Place
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loose-file → timeline placement picker — cascading Track → Section, same
          interaction shape as Dashboard's "Add to Song" modal (own component, own
          data sourcing: this targets place-on-timeline, not the ideas/clips copy flow). */}
      <Dialog
        open={loosePlacementModal !== null}
        onOpenChange={(open) => {
          if (!open) setLoosePlacementModal(null);
        }}
      >
        <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white">
              Place on Timeline
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Track</Label>
              <Select
                value={loosePlacementModal?.trackId ?? ''}
                onValueChange={(v) => setLoosePlacementModal((prev) => {
                  if (!prev) return prev;
                  // Clear a section the new track doesn't have.
                  const nextTrack = bucketTracksForPlacement.find((t) => t.id === v);
                  const stillValid = nextTrack?.ideas.some((i) => i.active && !i.isFullTake && i.sectionName === prev.sectionName);
                  return { ...prev, trackId: v, sectionName: stillValid ? prev.sectionName : '' };
                })}
              >
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder="Select a track…" />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {bucketTracksForPlacement.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs focus:bg-white/8 focus:text-white">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Section</Label>
              <Select
                value={placementSectionName}
                onValueChange={(v) => setLoosePlacementModal((prev) => prev ? { ...prev, sectionName: v } : prev)}
                disabled={!loosePlacementModal?.trackId}
              >
                <SelectTrigger className="bg-black/40 border-white/10 text-xs h-9 focus:ring-primary/50">
                  <SelectValue placeholder={loosePlacementModal?.trackId ? 'Select a section…' : 'Select a track first'} />
                </SelectTrigger>
                <SelectContent className="bg-[#0c0c0e] border-white/10">
                  {placementSectionNames.map((name) => (
                    <SelectItem key={name} value={name} className="text-xs focus:bg-white/8 focus:text-white">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs"
              onClick={() => setLoosePlacementModal(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!loosePlacementModal?.trackId || !placementSectionName) return;
                placeLooseFileOnTimelineMutation.mutate({
                  looseFileId: loosePlacementModal.looseFileId,
                  trackId: loosePlacementModal.trackId,
                  sectionName: placementSectionName,
                  id: nanoid(),
                });
                setLoosePlacementModal(null);
              }}
              disabled={!loosePlacementModal?.trackId || !placementSectionName || placeLooseFileOnTimelineMutation.isPending}
              className="bg-primary text-black hover:bg-primary/90 font-bold text-xs"
            >
              {placeLooseFileOnTimelineMutation.isPending ? 'Placing…' : 'Place Clip'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
