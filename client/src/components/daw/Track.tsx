import React, { useState, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn, trapDialogTab } from '@/lib/utils';
import { Track, Clip } from '@/lib/daw-data';
import { TimelineClip } from './Clip';
import { BeatGrid } from './BeatGrid';
import { trackDisplayColor } from '@/lib/track-color';
import { trimNeighbours } from '@shared/timelinePlacement';
import { Mic, Headphones, Activity } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
} from '@/components/ui/context-menu';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

export interface SectionInfo {
  name: string;
  start: number;
  duration: number;
}

interface SectionCellProps {
  sectionDuration: number;
  zoom: number;
  insertionX?: number;
}

// One section's width on a track row: the background behind the clips, with its
// divider. The clips themselves are drawn at row level (TimelineTrack), not in here.
function SectionCell({ sectionDuration, zoom, insertionX }: SectionCellProps) {
  return (
    <div
      // Divider is an inset shadow, not border-r: a border would take the cell's last
      // pixel column.
      className="relative h-full shadow-[inset_-1px_0_0_hsl(var(--border)/0.2)]"
      style={{ width: sectionDuration * zoom, minWidth: sectionDuration * zoom }}
    >
      {insertionX !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(212,175,55,0.8)] z-20 pointer-events-none"
          style={{ left: insertionX }}
        />
      )}
    </div>
  );
}

interface TrackHeaderProps {
  trackId: string;
  name: string;
  type: Track['type'];
  color: string;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  songId: string;
  controlInteractionRef: React.RefObject<boolean>;
  onDeleteTrack?: (trackId: string) => void;
}

// The sticky track header (name, mute/solo, volume, pan, Remove Track). Its own memoized
// component with primitive props, so it doesn't re-render when only the lane changes —
// e.g. every row's section cells during a timeline clip drag that grows a section.
const TrackHeader = React.memo(function TrackHeader({
  trackId, name, type, color, muted, solo, volume, pan, songId, controlInteractionRef, onDeleteTrack,
}: TrackHeaderProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const removeTrackButtonRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();

  const patchPan = useMutation({
    mutationFn: async (pan: number) => {
      const r = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pan }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to update pan');
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: (err) => console.error('Failed to persist track pan:', err),
  });

  // Set the ref on pointerdown for any control that could produce a stray native click
  // on the track header after drag-release. Cleared after the next rAF post-pointerup so
  // the flag is still true when the resulting click event (wherever its target lands) fires.
  const handleControlPointerDown = () => { controlInteractionRef.current = true; };
  const handleControlPointerUp = () => { requestAnimationFrame(() => { controlInteractionRef.current = false; }); };

  return (
    <>
      {/* Track Header */}
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <div
        className="w-64 shrink-0 bg-card border-r border-b border-border px-3 flex items-center gap-3 sticky left-0 z-50"
        onClick={() =>
          window.dispatchEvent(new CustomEvent('timeline-track-selected', { detail: { trackId } }))
        }
      >
        <div className="w-1 h-full absolute left-0 top-0 bottom-0" style={{ backgroundColor: color }} />

        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
          {type === 'vocal' ? (
            <Mic size={14} className="text-muted-foreground" />
          ) : type === 'instrument' ? (
            <Activity size={14} className="text-muted-foreground" />
          ) : (
            <Headphones size={14} className="text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-heading font-bold uppercase tracking-wider text-[11px] truncate text-foreground block">
            {name}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex gap-0.5">
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('toggle-track-mute', { detail: { trackId } }));
                }}
                className={cn(
                  'text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  muted && 'bg-destructive text-destructive-foreground border-destructive'
                )}
              >
                M
              </button>
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('toggle-track-solo', { detail: { trackId } }));
                }}
                className={cn(
                  'text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  solo && 'bg-primary text-primary-foreground border-primary'
                )}
              >
                S
              </button>
            </div>
            <div
              onPointerDown={handleControlPointerDown}
              onPointerUp={handleControlPointerUp}
              onClick={(e) => e.stopPropagation()}
            >
              <Slider
                value={[volume ?? 80]}
                onValueChange={([val]) =>
                  window.dispatchEvent(
                    new CustomEvent('update-track-volume', { detail: { trackId: trackId, volume: val } })
                  )
                }
                max={100}
                step={1}
                className="w-16 h-1"
                title={`Volume: ${volume ?? 80}`}
              />
            </div>
            <div className="flex rounded border border-border overflow-hidden">
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => { e.stopPropagation(); patchPan.mutate(-65); }}
                className={cn(
                  'text-[9px] w-4 h-4 flex items-center justify-center font-bold border-r border-border hover:border-primary hover:text-primary transition-colors',
                  pan === -65 && 'bg-primary text-primary-foreground border-primary'
                )}
              >
                L
              </button>
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => { e.stopPropagation(); patchPan.mutate(0); }}
                className={cn(
                  'text-[9px] w-4 h-4 flex items-center justify-center font-bold border-r border-border hover:border-primary hover:text-primary transition-colors',
                  pan === 0 && 'bg-primary text-primary-foreground border-primary'
                )}
              >
                C
              </button>
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => { e.stopPropagation(); patchPan.mutate(65); }}
                className={cn(
                  'text-[9px] w-4 h-4 flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  pan === 65 && 'bg-primary text-primary-foreground border-primary'
                )}
              >
                R
              </button>
            </div>
          </div>
        </div>
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="bg-popover border-border">
        <ContextMenuItem
          className="text-red-400 focus:text-red-400 focus:bg-red-400/10 text-xs"
          onClick={() => setShowDeleteConfirm(true)}
        >
          Remove Track
        </ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent
          className="bg-[#0c0c0e] border-border"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            removeTrackButtonRef.current?.focus();
          }}
          onKeyDown={trapDialogTab}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Remove Track</AlertDialogTitle>
            <AlertDialogDescription>
              Removing this track will delete it from the project and permanently delete any files uploaded to it. Would you like to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={removeTrackButtonRef}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { onDeleteTrack?.(trackId); setShowDeleteConfirm(false); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

interface TrackProps {
  track: Track;
  sections: SectionInfo[];
  invalidSections: Set<string>;
  isInvalidDrop: boolean;
  isDragging: boolean;
  zoom: number;
  insertionPoint?: { sectionName: string; index: number; x: number };
  onDeleteTrack?: (trackId: string) => void;
  songId: string;
  flashClipId?: string | null;
  selectedTrackId?: string | null;
  selectedClipId?: string | null;
  controlInteractionRef: React.RefObject<boolean>;
  bpm: number;
  timeSignature: string;
  // The clip being dragged — drawn above the other clips on its row, "picked up".
  raisedClipId?: string | null;
  // Where the dragged clip will land (content px within the lane), for the gold
  // landing outline. Only the dragged clip's row gets one.
  landing?: { left: number; width: number } | null;
}

// Memoized: Timeline re-renders often during a drag (every change of the drag
// preview), and only the dragged clip's row has new props then. Shallow prop
// comparison — Timeline keeps every prop stable unless what it describes changed.
export const TimelineTrack = React.memo(function TimelineTrack({
  track,
  sections,
  invalidSections,
  isInvalidDrop,
  isDragging,
  zoom,
  insertionPoint,
  onDeleteTrack,
  songId,
  flashClipId,
  selectedTrackId,
  selectedClipId,
  controlInteractionRef,
  bpm,
  timeSignature,
  raisedClipId,
  landing,
}: TrackProps) {
  const { setNodeRef } = useDroppable({
    id: track.id,
    data: { trackId: track.id, type: 'track' },
    disabled: isInvalidDrop,
  });

  const trackColor = trackDisplayColor(track);
  const raisedClip = raisedClipId ? track.clips.find((c) => c.id === raisedClipId) : undefined;
  const isValidTarget = isDragging && !isInvalidDrop;
  const isInvalidTarget = isDragging && isInvalidDrop;

  return (
    <div
      data-timeline-track={track.id}
      className={cn('relative flex w-full h-16 bg-card/20 group', isInvalidTarget && 'cursor-not-allowed')}
    >
      {/* Gold border on the valid drop target — explicit inline positioning for scrollable container reliability */}
      {isValidTarget && (
        <div
          className="pointer-events-none z-10"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
            border: '1px solid rgba(212,175,55,0.6)',
          }}
        />
      )}
      {/* Dark veil on invalid tracks — sits above clips, does not change row opacity */}
      {isInvalidTarget && (
        <div
          className="pointer-events-none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
            zIndex: 20,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      <TrackHeader
        trackId={track.id}
        name={track.name}
        type={track.type}
        color={track.color}
        muted={track.muted}
        solo={track.solo}
        volume={track.volume}
        pan={track.pan}
        songId={songId}
        controlInteractionRef={controlInteractionRef}
        onDeleteTrack={onDeleteTrack}
      />

      {/* Lane — the full row is the droppable target. Section cells are the background;
          clips are drawn on top at row level, each at its layout start (clip.start, from
          layoutTimeline via Timeline's positionTracks), so a clip isn't confined to its
          section's cell. Legacy full takes sit on the same row at their stored start. */}
      <div
        ref={setNodeRef}
        className="flex-1 relative h-full border-b border-border"
      >
        <BeatGrid zoom={zoom} bpm={bpm} timeSignature={timeSignature} />
        <div className="flex h-full">
          {sections.map((section) => (
            <SectionCell
              key={section.name}
              sectionDuration={section.duration}
              zoom={zoom}
              insertionX={
                insertionPoint?.sectionName === section.name ? insertionPoint.x : undefined
              }
            />
          ))}
        </div>
        {/* Timeline clip drag: the landing outline — a dashed gold border, no fill, so it
            can't be mistaken for the solid gold selection box. Drawn above everything
            on the row, the floating clip (12) included, so it stays visible when the
            landing spot is right under the clip; still below other rows' veils (20),
            insertion lines (29), the playhead (40) and the sticky panels (50). No text;
            the same rectangle the clip takes on drop. */}
        {landing && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 h-full rounded-md border-2 border-dashed border-primary"
            style={{ left: landing.left, width: landing.width, zIndex: 13 }}
          />
        )}
        {/* The floating clip's "picked up" look — a soft drop shadow. Its own layer,
            never on the clip's root (flashGold animates the root's box-shadow; the
            selection overlay sits inside it), drawn at the clip's stored spot and moved
            with it every frame by Timeline (positionFloatingClip, data-clip-drag-lift),
            right under the clip. No gold ring: it hid the landing outline. */}
        {raisedClip && (
          <div
            aria-hidden
            data-clip-drag-lift={raisedClip.id}
            className="pointer-events-none absolute top-0 h-full rounded-md"
            style={{
              left: raisedClip.start * zoom,
              width: ((raisedClip.trimEnd ?? raisedClip.duration) - (raisedClip.trimStart ?? 0)) * zoom,
              zIndex: 11,
              boxShadow: '0 10px 22px rgba(0,0,0,0.6)',
            }}
          />
        )}
        {sections.flatMap((section) =>
          track.clips.filter((c) => !c.isFullTake && c.sectionName === section.name)
        ).map((clip) => {
          // What stops this clip's trim edges: the clips around it on this track in
          // its section (passed as two numbers so the memoized clip doesn't re-render).
          const nb = trimNeighbours(
            { offset: clip.sectionOffset ?? 0 },
            track.clips
              .filter((c) => c.id !== clip.id && !c.isFullTake && c.sectionName === clip.sectionName)
              .map((c) => ({ id: c.id, offset: c.sectionOffset ?? 0, length: (c.trimEnd ?? c.duration) - (c.trimStart ?? 0) })),
          );
          return (
          <TimelineClip
            key={clip.id}
            clip={clip}
            zoom={zoom}
            trackId={track.id}
            trackColor={trackColor}
            songId={songId}
            trimPrevEnd={nb.prevEnd}
            trimNextStart={nb.nextStart}
            instanceCount={track.clips.filter((c) => c.name === clip.name).length}
            isFlash={flashClipId === clip.id}
            isSelected={selectedClipId === clip.id}
            isRaised={raisedClipId === clip.id}
          />
          );
        })}
        {track.clips.filter((c) => c.isFullTake).map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            zoom={zoom}
            trackId={track.id}
            trackColor={trackColor}
            songId={songId}
            instanceCount={1}
            isFlash={flashClipId === clip.id}
            isSelected={selectedClipId === clip.id}
          />
        ))}
      </div>

    </div>
  );
});
