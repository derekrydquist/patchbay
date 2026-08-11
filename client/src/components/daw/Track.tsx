import React, { useState, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn, trapDialogTab } from '@/lib/utils';
import { Track, Clip } from '@/lib/daw-data';
import { TimelineClip } from './Clip';
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
  sectionStart: number;
  sectionDuration: number;
  clips: Clip[];
  allTrackClips: Clip[];
  zoom: number;
  isInvalid: boolean;
  insertionX?: number;
  trackId: string;
  songId: string;
  flashClipId?: string | null;
  selectedClipId?: string | null;
}

// Renders full-take clips at their absolute timeline positions. Used instead of the
// section-cell grid when a track has at least one full-take clip on it.
function FullTakeLane({ clips, zoom, trackId, songId, flashClipId, selectedClipId }: {
  clips: Clip[];
  zoom: number;
  trackId: string;
  songId: string;
  flashClipId?: string | null;
  selectedClipId?: string | null;
}) {
  const fullTakeClips = clips.filter((c) => c.isFullTake);
  return (
    <div className="relative h-full w-full">
      {fullTakeClips.map((clip) => (
        <TimelineClip
          key={clip.id}
          clip={clip}
          zoom={zoom}
          sectionStart={0}
          trackId={trackId}
          songId={songId}
          instanceCount={1}
          isFlash={flashClipId === clip.id}
          isSelected={selectedClipId === clip.id}
        />
      ))}
    </div>
  );
}

function SectionCell({
  sectionStart,
  sectionDuration,
  clips,
  allTrackClips,
  zoom,
  isInvalid,
  insertionX,
  trackId,
  songId,
  flashClipId,
  selectedClipId,
}: SectionCellProps) {
  return (
    <div
      className="relative h-full border-r border-border/20 overflow-hidden"
      style={{ width: sectionDuration * zoom, minWidth: sectionDuration * zoom }}
    >
      {clips.map((clip) => {
        const instanceCount = allTrackClips.filter((c) => c.name === clip.name).length;
        return (
          <TimelineClip key={clip.id} clip={clip} zoom={zoom} sectionStart={sectionStart} trackId={trackId} songId={songId} instanceCount={instanceCount} isFlash={flashClipId === clip.id} isSelected={selectedClipId === clip.id} />
        );
      })}
      {insertionX !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_8px_rgba(212,175,55,0.8)] z-20 pointer-events-none"
          style={{ left: insertionX }}
        />
      )}
    </div>
  );
}

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
}

export function TimelineTrack({
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
}: TrackProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const removeTrackButtonRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();

  const patchPan = useMutation({
    mutationFn: async (pan: number) => {
      const r = await fetch(`/api/tracks/${track.id}`, {
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
    },
    onError: (err) => console.error('Failed to persist track pan:', err),
  });

  const { setNodeRef } = useDroppable({
    id: track.id,
    data: { trackId: track.id, type: 'track' },
    disabled: isInvalidDrop,
  });

  const isValidTarget = isDragging && !isInvalidDrop;
  const isInvalidTarget = isDragging && isInvalidDrop;

  // Set the ref on pointerdown for any control that could produce a stray native click
  // on the track header after drag-release. Cleared after the next rAF post-pointerup so
  // the flag is still true when the resulting click event (wherever its target lands) fires.
  const handleControlPointerDown = () => { controlInteractionRef.current = true; };
  const handleControlPointerUp = () => { requestAnimationFrame(() => { controlInteractionRef.current = false; }); };

  return (
    <div className="relative flex w-full h-16 bg-card/20 group">
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

      {/* Track Header */}
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <div
        className="w-64 shrink-0 bg-card border-r border-b border-border px-3 flex items-center gap-3 sticky left-0 z-50"
        onClick={() =>
          window.dispatchEvent(new CustomEvent('timeline-track-selected', { detail: { trackId: track.id } }))
        }
      >
        <div className="w-1 h-full absolute left-0 top-0 bottom-0" style={{ backgroundColor: track.color }} />

        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
          {track.type === 'vocal' ? (
            <Mic size={14} className="text-muted-foreground" />
          ) : track.type === 'instrument' ? (
            <Activity size={14} className="text-muted-foreground" />
          ) : (
            <Headphones size={14} className="text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span className="font-heading font-bold uppercase tracking-wider text-[11px] truncate text-foreground block">
            {track.name}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex gap-0.5">
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('toggle-track-mute', { detail: { trackId: track.id } }));
                }}
                className={cn(
                  'text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  track.muted && 'bg-destructive text-destructive-foreground border-destructive'
                )}
              >
                M
              </button>
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('toggle-track-solo', { detail: { trackId: track.id } }));
                }}
                className={cn(
                  'text-[9px] w-4 h-4 rounded border border-border flex items-center justify-center font-bold hover:border-primary hover:text-primary transition-colors',
                  track.solo && 'bg-primary text-primary-foreground border-primary'
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
                value={[track.volume ?? 80]}
                onValueChange={([val]) =>
                  window.dispatchEvent(
                    new CustomEvent('update-track-volume', { detail: { trackId: track.id, volume: val } })
                  )
                }
                max={100}
                step={1}
                className="w-16 h-1"
                title={`Volume: ${track.volume ?? 80}`}
              />
            </div>
            <div className="flex rounded border border-border overflow-hidden">
              <button
                onPointerDown={handleControlPointerDown}
                onPointerUp={handleControlPointerUp}
                onClick={(e) => { e.stopPropagation(); patchPan.mutate(-65); }}
                className={cn(
                  'text-[9px] w-4 h-4 flex items-center justify-center font-bold border-r border-border hover:border-primary hover:text-primary transition-colors',
                  track.pan === -65 && 'bg-primary text-primary-foreground border-primary'
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
                  track.pan === 0 && 'bg-primary text-primary-foreground border-primary'
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
                  track.pan === 65 && 'bg-primary text-primary-foreground border-primary'
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
          Remove Instrument
        </ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>

      {/* Section cells — full row is the droppable target.
          For tracks that have full-take clips, FullTakeLane replaces the section grid. */}
      {(() => {
        const hasFullTake = track.clips.some((c) => c.isFullTake);
        return (
          <div
            ref={setNodeRef}
            className="flex-1 relative h-full border-b border-border bg-[linear-gradient(90deg,transparent_19px,rgba(255,255,255,0.02)_20px)]"
            style={{ backgroundSize: `${zoom / 4}px 100%` }}
          >
            {hasFullTake ? (
              <FullTakeLane
                clips={track.clips}
                zoom={zoom}
                trackId={track.id}
                songId={songId}
                flashClipId={flashClipId}
                selectedClipId={selectedClipId}
              />
            ) : (
              <div className="flex h-full">
                {sections.map((section) => {
                  const sectionClips = track.clips.filter((c) => c.sectionName === section.name);
                  return (
                    <SectionCell
                      key={section.name}
                      sectionStart={section.start}
                      sectionDuration={section.duration}
                      clips={sectionClips}
                      allTrackClips={track.clips}
                      zoom={zoom}
                      isInvalid={invalidSections.has(section.name)}
                      trackId={track.id}
                      songId={songId}
                      insertionX={
                        insertionPoint?.sectionName === section.name ? insertionPoint.x : undefined
                      }
                      flashClipId={flashClipId}
                      selectedClipId={selectedClipId}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

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
            <AlertDialogTitle className="font-heading uppercase tracking-wider">Remove Instrument</AlertDialogTitle>
            <AlertDialogDescription>
              Removing this instrument will delete it from the project and permanently delete any files uploaded to it. Would you like to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={removeTrackButtonRef}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { onDeleteTrack?.(track.id); setShowDeleteConfirm(false); }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
