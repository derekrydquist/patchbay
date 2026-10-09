import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { FileAudio, Info, MessageCircle, MessageSquare, Plus, Trash2 } from 'lucide-react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ClipInfoWindow, hasUnreadComments, markCommentsViewed, useLastViewedComments } from './Clip';
import { useDeleteLooseFile } from '@/hooks/use-bucket-mutations';
import { type ApiLooseFile, bucketKeys, looseFileKeys } from '@/lib/bucket-api';
import { type Clip } from '@/lib/daw-data';
import { cn } from '@/lib/utils';

// Converts a loose file into the same Clip shape BucketClip drag payloads use,
// so the DragOverlay ghost and generic clip-shaped drag logic in Timeline.tsx
// work unmodified. sectionName is deliberately omitted — a loose file has none
// until it's organized.
export function looseFileToClip(lf: ApiLooseFile): Clip {
  return {
    id: lf.id,
    name: lf.name,
    type: lf.type as Clip['type'],
    color: lf.color,
    start: 0,
    duration: lf.duration,
    src: lf.src ?? undefined,
    isFinal: false,
    metadata: lf.metadata as unknown as Clip['metadata'],
  };
}

// ─── More Info / Add Note for loose files ────────────────────────────────────
// Each surface that renders loose files (MediaBucket, the Dashboard's Songs
// quick-browser and Ideas shelf) owns ONE ClipInfoWindow for them via
// useLooseFileInfoWindow(), and exposes its `open` through LooseFileInfoProvider so
// every LooseFileRow menu below it can reach it without prop threading. The window
// is mounted outside the rows on purpose: a dialog portaled from inside a row would
// still bubble React click/pointer events up into the row's own onClick and
// dnd-kit listeners.

export type OpenLooseFileInfo = (looseFile: ApiLooseFile, opts?: { focusNotes?: boolean; focusComments?: boolean }) => void;

const LooseFileInfoContext = createContext<OpenLooseFileInfo | null>(null);
export const LooseFileInfoProvider = LooseFileInfoContext.Provider;

export function useLooseFileInfoWindow(): { open: OpenLooseFileInfo; infoWindow: ReactNode } {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ looseFile: ApiLooseFile; focusNotes: boolean; focusComments: boolean } | null>(null);
  const open = useCallback<OpenLooseFileInfo>((looseFile, opts) => {
    // Opening the thread marks it read — same shared map the clip badges use.
    markCommentsViewed(looseFile.id, queryClient);
    setState({ looseFile, focusNotes: !!opts?.focusNotes, focusComments: !!opts?.focusComments });
  }, [queryClient]);
  // Sends only the changed field(s) — the route merges them server-side. Throws on
  // failure so ClipInfoWindow rolls the field back and toasts.
  const writeMetadata = useCallback(async (looseFile: ApiLooseFile, updates: Partial<NonNullable<Clip['metadata']>>) => {
    const res = await fetch(`/api/loose-files/${looseFile.id}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `Save failed (${res.status})`);
    }
    const updated = await res.json() as { metadata: ApiLooseFile['metadata'] };
    // The open window renders from this snapshot, not the list query — keep it at
    // the last saved value so a later failed edit rolls back to the right thing.
    setState(prev => prev && prev.looseFile.id === looseFile.id
      ? { ...prev, looseFile: { ...prev.looseFile, metadata: updated.metadata } }
      : prev);
    queryClient.invalidateQueries({ queryKey: looseFileKeys.all() });
    queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(looseFile.songId ?? undefined) });
  }, [queryClient]);
  const infoWindow = state && (
    <ClipInfoWindow
      clip={looseFileToClip(state.looseFile)}
      open
      onOpenChange={o => { if (!o) setState(null); }}
      focusNotes={state.focusNotes}
      focusComments={state.focusComments}
      target={{ kind: 'loose', id: state.looseFile.id }}
      songId={state.looseFile.songId ?? undefined}
      metadataWriter={(_merged, updates) => writeMetadata(state.looseFile, updates)}
    />
  );
  return { open, infoWindow };
}

// ─── Add to Timeline for loose files ─────────────────────────────────────────
// Only Timeline.tsx (Workspace) provides this: it opens Timeline's own
// Place-on-Timeline dialog for the file. Surfaces with no timeline (SongHome's
// Song Files tab, the Songs quick-browser, the Ideas shelf) mount no provider, so
// the menu item is omitted there — same opt-in shape as LooseFileInfoProvider.
export type PlaceLooseFileOnTimeline = (looseFile: ApiLooseFile) => void;

const LooseFilePlacementContext = createContext<PlaceLooseFileOnTimeline | null>(null);
export const LooseFilePlacementProvider = LooseFilePlacementContext.Provider;

interface LooseFileRowProps {
  looseFile: ApiLooseFile;
  // null for a band-wide, unassigned file (Ideas shelf Column 1) — carried in drag
  // data for informational purposes only; the organize/place-on-timeline handlers
  // resolve destination entirely from the drop target's own data, never from this.
  songId: string | null;
  // Optional — when provided, the row is also clickable (not just draggable). The
  // Ideas shelf uses this to load the file's preview into the Files column, since a
  // loose file has no bucket-clip card of its own until it's organized. Omitted at
  // every other call site (MediaBucket, Songs quick-browser), which have no
  // equivalent preview surface and keep the original drag-only behavior.
  onClick?: () => void;
  // Whether this file is the one currently previewed — same gold-highlight
  // treatment as every other "this row is the active selection" row in the app
  // (IdeaListRow, SongsSectionRow, etc.). Selection is mutually exclusive with
  // any Idea highlight; the Ideas shelf clears the Idea's isSelected whenever a
  // loose file is being previewed. Meaningless (and omitted) without `onClick`.
  isSelected?: boolean;
  // Fired after a successful delete, in addition to the hook's own list-query
  // invalidation. Surfaces with local state referencing this specific file (the
  // Ideas shelf's one-off preview) use this to clear that state; every other
  // call site omits it since the row simply disappearing is enough.
  onDeleted?: () => void;
}

interface LooseFileContextMenuProps {
  looseFile: ApiLooseFile;
  songId: string | null;
  onDeleted?: () => void;
  children: ReactNode;
}

// The right-click menu on every LooseFileRow: More Info, Add Note, Add to Timeline,
// Delete. More Info / Add Note open the surface's shared ClipInfoWindow (see
// useLooseFileInfoWindow above) and are omitted if no provider is mounted; Add to
// Timeline likewise needs LooseFilePlacementProvider (Workspace only). The Ideas
// shelf's one-off preview card isn't a LooseFileRow — it uses IdeaFileContextMenu,
// which carries the same items plus Add to Song / Promote to Song.
export function LooseFileContextMenu({ looseFile, songId, onDeleted, children }: LooseFileContextMenuProps) {
  const openInfo = useContext(LooseFileInfoContext);
  const placeOnTimeline = useContext(LooseFilePlacementContext);
  const deleteMutation = useDeleteLooseFile({
    onSuccess: () => onDeleted?.(),
    onError: (msg) => console.error('[deleteLooseFile] error:', msg),
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="bg-[#0c0c0e] border-white/10 min-w-[140px]">
        {(openInfo || placeOnTimeline) && (
          <>
            {openInfo && (
              <>
                <ContextMenuItem
                  className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2"
                  onClick={() => openInfo(looseFile)}
                >
                  <Info size={13} className="text-white/50" /> More Info
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2"
                  onClick={() => openInfo(looseFile, { focusNotes: true })}
                >
                  <MessageSquare size={13} className="text-white/50" /> Add Note
                </ContextMenuItem>
              </>
            )}
            {placeOnTimeline && (
              <ContextMenuItem
                className="text-xs text-white/80 focus:bg-white/8 focus:text-white cursor-pointer flex items-center gap-2"
                onClick={() => placeOnTimeline(looseFile)}
              >
                <Plus size={13} className="text-white/50" /> Add to Timeline
              </ContextMenuItem>
            )}
            <ContextMenuSeparator className="bg-white/5" />
          </>
        )}
        <ContextMenuItem
          className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer text-xs flex items-center gap-2"
          onClick={() => deleteMutation.mutate({ looseFileId: looseFile.id, songId, trackId: looseFile.trackId })}
        >
          <Trash2 size={13} /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// A song-scoped or band-wide upload with no Track/Section yet. Draggable onto a
// Section (organize) or onto the Timeline (place-on-timeline) — see Timeline.tsx /
// MediaBucket.tsx for the drop handling. Clickable only where `onClick` is passed;
// otherwise it carries no folder-browser navigation state. Right-click offers a
// More Info / Add Note / Delete via LooseFileContextMenu; Delete is unconfirmed —
// its only dependents are its own notes, which cascade with it.
export function LooseFileRow({ looseFile, songId, onClick, isSelected, onDeleted }: LooseFileRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `loose-${looseFile.id}`,
    // trackId is carried alongside `clip` (not inside it — looseFileToClip's Clip
    // shape has no such field) so drop targets can tell an already Track-scoped
    // file apart from a plain Tracks-column one. See TrackFolderRow in
    // MediaBucket.tsx, which suppresses its highlight (and handleDragEnd cancels the
    // drop) when this equals its own track.
    data: { clip: looseFileToClip(looseFile), type: 'loose-file', songId, trackId: looseFile.trackId },
  });
  // No transform on the source row — every surface renders a floating DragOverlay
  // ghost (LooseFileDragOverlay, or Timeline's own), so the row just stays in place
  // as a dimmed placeholder. Translating it made the row slide inside its column's
  // Radix ScrollArea, growing the column's scroll width; dnd-kit's default auto-scroll
  // (which treats overflow-y: scroll as scrollable on both axes) then scrolled the
  // column sideways, clipping the track names.

  const { data: viewedMap = {} } = useLastViewedComments();
  const commentCount = looseFile.commentCount ?? 0;
  const hasUnread = hasUnreadComments(looseFile.latestOthersCommentAt, viewedMap[looseFile.id]);

  return (
    <LooseFileContextMenu looseFile={looseFile} songId={songId} onDeleted={onDeleted}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-2 p-2 rounded text-xs select-none touch-none cursor-grab active:cursor-grabbing transition-opacity',
          isSelected
            ? 'bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]'
            : 'text-muted-foreground/80',
          // Hover is suppressed inside the Ideas shelf's Column 1 while a drag is
          // active (group/ideas-list[data-dnd-active], set in Dashboard.tsx) — a row
          // is never a drop target. Outside that group this is a plain hover.
          onClick && !isSelected && 'not-group-data-[dnd-active]/ideas-list:hover:bg-white/5 not-group-data-[dnd-active]/ideas-list:hover:text-white',
          isDragging && 'opacity-40'
        )}
        title={looseFile.name}
      >
        <FileAudio size={14} className={cn('shrink-0', isSelected ? 'text-primary' : 'text-primary/50')} />
        <span className="font-bold tracking-tight truncate">{looseFile.name}</span>
        {/* Notes indicator — inline counterpart of CornerBadge's comment variant
            (gold when there are notes newer than this browser's last view). */}
        {commentCount > 0 && (
          <span
            className="ml-auto shrink-0 flex items-center"
            title={`${commentCount} ${commentCount === 1 ? 'note' : 'notes'}${hasUnread ? ' (new)' : ''}`}
          >
            <MessageCircle size={11} className={hasUnread ? 'text-primary fill-primary/30' : 'text-white/30'} />
          </span>
        )}
      </div>
    </LooseFileContextMenu>
  );
}
