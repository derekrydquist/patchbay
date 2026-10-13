import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ApiIdea, type ApiTrack, type ApiClip, type ApiTimelineClip, type ApiLooseFile,
  bucketKeys, looseFileKeys,
} from '@/lib/bucket-api';
import { useToast } from '@/hooks/use-toast';
import { postClipLeave, useClipInUseAction } from '@/components/daw/ClipInUseDialog';
import { requestLandingFlash, clipLandingZone, looseLandingZone } from '@/hooks/use-landing-flash';

// Shared by organize/place-on-timeline: invalidate the same set the loose-file
// upload flow also invalidates, so all three actions keep every surface in sync.
// `trackId` is optional and only relevant when the organized/placed file had
// moved through the Track-scoped resting tier — passing it drops the file from
// that Track's Sections-column list too (harmless no-op invalidation otherwise).
//
// `destSongId` is the song the file landed in when that can differ from `songId`
// (the caller's selected song) — an Ideas shelf drop onto a different Idea's row.
// With staleTime: Infinity, refreshing only the selected song left the destination
// serving its old cached list. Its bucket is refetched even with no observer
// (refetchType 'all'), so the list shown when the view follows the file is fresh.
// `clipId` is the new clip's id, which is the loose file's id reused — both comment
// threads cached under it are dropped so neither side can serve a stale list.
function invalidateAfterLooseFilePlacement(
  queryClient: ReturnType<typeof useQueryClient>,
  songId: string | undefined,
  trackId?: string,
  extra?: { destSongId?: string; clipId?: string }
) {
  const destSongId = extra?.destSongId;
  if (destSongId && destSongId !== songId) {
    queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(destSongId), refetchType: 'all' });
    queryClient.invalidateQueries({ queryKey: looseFileKeys.list(destSongId) });
    queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', destSongId] });
  }
  if (extra?.clipId) {
    queryClient.invalidateQueries({ queryKey: ['clip-comments', extra.clipId] });
    queryClient.invalidateQueries({ queryKey: ['loose-file-comments', extra.clipId] });
  }
  queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
  queryClient.invalidateQueries({ queryKey: looseFileKeys.list(songId) });
  // Always invalidated, regardless of songId: the organized file may have come
  // from the band-wide unassigned list (Ideas shelf Column 1), which needs to
  // drop it the same way a song-scoped list drops an organized file.
  queryClient.invalidateQueries({ queryKey: looseFileKeys.unassigned() });
  if (trackId) {
    queryClient.invalidateQueries({ queryKey: looseFileKeys.byTrack(trackId) });
  }
  queryClient.invalidateQueries({ queryKey: ['activity'] });
  queryClient.invalidateQueries({ queryKey: ['songs'] });
  queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
  queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
  // The file's notes move into clip_comments under the same id — refresh the clip
  // comment badges (BucketClip / TimelineClip) so they show up without a reload.
  queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', songId] });
}

export function useAddInstrument(
  songId: string | undefined,
  opts?: { onCreated?: (track: ApiTrack) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/songs/${songId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to create track' }));
        throw new Error(err.message ?? 'Failed to create track');
      }
      return res.json() as Promise<ApiTrack>;
    },
    onSuccess: (track) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onCreated?.(track);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useAddSection(
  songId: string | undefined,
  _tracks: ApiTrack[],
  opts?: { onCreated?: (sectionName: string) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sectionName: string) => {
      const res = await fetch(`/api/songs/${songId}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to create section' }));
        throw new Error(err.message ?? 'Failed to create section');
      }
      return res.json() as Promise<{ sectionName: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onCreated?.(data.sectionName);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useRestoreSectionSongWide(
  songId: string,
  opts?: { onSuccess?: () => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sectionName: string) => {
      const res = await fetch(`/api/songs/${songId}/sections/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to restore section' }));
        throw new Error(err.message ?? 'Failed to restore section');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      // Song-wide: the section may have been hidden on any of the song's tracks, so
      // drop every track's hidden-sections list (Add Section's restore list).
      queryClient.invalidateQueries({ queryKey: bucketKeys.allHiddenIdeas() });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onSuccess?.();
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useDeleteTrack(
  songId: string,
  opts?: { onSuccess?: () => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (trackId: string) => {
      const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        throw new Error(err.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenTracks(songId) });
      // Hiding a track hard-deletes its timeline_clips, which can include Final
      // copies — the task status, final list and comment badges can all change.
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onSuccess?.();
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useRestoreTrack(
  songId: string,
  opts?: { onSuccess?: () => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (trackId: string) => {
      const res = await fetch(`/api/tracks/${trackId}/restore`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to restore track' }));
        throw new Error(err.message ?? 'Failed to restore track');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenTracks(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onSuccess?.();
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useHideIdea(
  songId: string,
  trackId: string | undefined,
  opts?: { onSuccess?: () => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ideaId: string) => {
      const res = await fetch(`/api/ideas/${ideaId}`, { method: 'PATCH' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to remove section' }));
        throw new Error(err.message ?? 'Failed to remove section');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenIdeas(trackId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      // Hiding a section hard-deletes its timeline_clips on this track, which can
      // include Final copies — same knock-on refreshes as useDeleteTrack.
      queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onSuccess?.();
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useAddFullTake(
  songId: string | undefined,
  opts?: { onCreated?: (idea: ApiIdea) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (trackId: string) => {
      const res = await fetch(`/api/tracks/${trackId}/full-take`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to create Full Takes section' }));
        throw new Error(err.message ?? 'Failed to create Full Takes section');
      }
      return res.json() as Promise<ApiIdea>;
    },
    onSuccess: (idea) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onCreated?.(idea);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useRestoreSection(
  trackId: string | undefined,
  songId: string,
  opts?: { onSuccess?: () => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ideaId: string) =>
      fetch(`/api/ideas/${ideaId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenIdeas(trackId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      opts?.onSuccess?.();
    },
  });
}

// ─── Loose files (song-scoped, unplaced uploads) ─────────────────────────────

export function useOrganizeLooseFile(
  songId: string | undefined,
  opts?: { onSuccess?: (clip: ApiClip) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    // destSongId is client-only bookkeeping for cache invalidation (the song the
    // file lands in, when it isn't the hook's songId) — the server resolves the
    // destination from trackId + sectionName.
    mutationFn: async (vars: { looseFileId: string; trackId: string; sectionName: string; destSongId?: string }) => {
      const res = await fetch(`/api/loose-files/${vars.looseFileId}/organize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: vars.trackId, sectionName: vars.sectionName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to organize file' }));
        throw new Error(err.message ?? 'Failed to organize file');
      }
      return res.json() as Promise<ApiClip>;
    },
    onSuccess: (clip, vars) => {
      // The loose file is now a clip card (same id) in its destination section.
      requestLandingFlash([{ id: clip.id, zone: clipLandingZone(clip.ideaId) }]);
      invalidateAfterLooseFilePlacement(queryClient, songId, vars.trackId, { destSongId: vars.destSongId, clipId: clip.id });
      opts?.onSuccess?.(clip);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// Moves a song-scoped loose file into the Track-scoped resting tier — drag onto a
// Track row (not a Section row) in the Tracks column. Does not materialize
// anything; the file simply moves from the Tracks-column list to that Track's
// own Sections-column list.
export function useAssignLooseFileTrack(
  songId: string | undefined,
  opts?: { onSuccess?: (looseFile: ApiLooseFile) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    // originTrackId (null for a plain Tracks-column file) is client-only bookkeeping
    // for cache invalidation below — the server only needs the destination trackId.
    mutationFn: async (vars: { looseFileId: string; trackId: string; originTrackId?: string | null }) => {
      const res = await fetch(`/api/loose-files/${vars.looseFileId}/assign-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: vars.trackId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to move file to track' }));
        throw new Error(err.message ?? 'Failed to move file to track');
      }
      return res.json() as Promise<ApiLooseFile>;
    },
    onSuccess: (looseFile, vars) => {
      // Lands on the destination track's shelf (track:<trackId>).
      requestLandingFlash([{ id: looseFile.id, zone: looseLandingZone(looseFile) }]);
      queryClient.invalidateQueries({ queryKey: looseFileKeys.list(songId) });
      queryClient.invalidateQueries({ queryKey: looseFileKeys.unassigned() });
      queryClient.invalidateQueries({ queryKey: looseFileKeys.byTrack(vars.trackId) });
      // A cross-track move must also clear the ORIGIN track's Sections-column list —
      // otherwise the view the user just dragged out of keeps showing the file from
      // its stale cache even though it moved. Only relevant when the origin was a
      // real (different) track; a plain Tracks-column origin (null) has no
      // byTrack query to invalidate, and a same-track Track-row drop never reaches
      // this mutation (handleDragEnd cancels it) but is harmless here either way.
      if (vars.originTrackId && vars.originTrackId !== vars.trackId) {
        queryClient.invalidateQueries({ queryKey: looseFileKeys.byTrack(vars.originTrackId) });
      }
      // Newly assigning a loose file to a track can flip that track's hasLooseFiles
      // to true (getBucket computes it fresh from loose_files) — without this, the
      // Tracks-column folder icon stays outline until a manual reload.
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      opts?.onSuccess?.(looseFile);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// The reverse of useAssignLooseFileTrack — moves a Track-scoped loose file back to
// the plain song-scoped shelf in the Tracks column (drag from a Track's Sections
// column onto the Tracks column's open background). Same route, explicit
// `trackId: null` body. Still a plain field update — nothing is materialized.
export function useUnassignLooseFileTrack(
  songId: string | undefined,
  opts?: { onSuccess?: (looseFile: ApiLooseFile) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    // originTrackId is client-only bookkeeping for cache invalidation — the
    // server just clears whatever trackId the row currently has.
    mutationFn: async (vars: { looseFileId: string; originTrackId: string }) => {
      const res = await fetch(`/api/loose-files/${vars.looseFileId}/assign-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to move file to Tracks' }));
        throw new Error(err.message ?? 'Failed to move file to Tracks');
      }
      return res.json() as Promise<ApiLooseFile>;
    },
    onSuccess: (looseFile, vars) => {
      // Destination: the Tracks-column list. Origin: that track's Sections-column
      // list. Bucket: the origin track's hasLooseFiles may flip back to false.
      requestLandingFlash([{ id: looseFile.id, zone: looseLandingZone(looseFile) }]);
      queryClient.invalidateQueries({ queryKey: looseFileKeys.list(songId) });
      queryClient.invalidateQueries({ queryKey: looseFileKeys.byTrack(vars.originTrackId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      opts?.onSuccess?.(looseFile);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// Deletes a loose file that hasn't been organized/placed yet (no dependent rows
// to worry about — see the file-organizer delete audit). `songId` comes from
// the loose file itself (null for band-wide/unassigned), not an external param,
// so one hook covers every surface regardless of which list the row lives in.
// `trackId` is optional — pass it when deleting a file from the Track-scoped
// Sections-column list so that list is invalidated too.
export function useDeleteLooseFile(
  opts?: { onSuccess?: () => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { looseFileId: string; songId: string | null; trackId?: string | null }) => {
      const res = await fetch(`/api/loose-files/${vars.looseFileId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to delete file' }));
        throw new Error(err.message ?? 'Failed to delete file');
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: looseFileKeys.list(vars.songId ?? undefined) });
      queryClient.invalidateQueries({ queryKey: looseFileKeys.unassigned() });
      if (vars.trackId) {
        queryClient.invalidateQueries({ queryKey: looseFileKeys.byTrack(vars.trackId) });
      }
      // Deleting a Track-scoped file can flip that track's hasLooseFiles back to
      // false (getBucket computes it fresh from loose_files) — without this, the
      // Tracks-column folder icon stays filled until a manual reload.
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.songId ?? undefined) });
      opts?.onSuccess?.();
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function usePlaceLooseFileOnTimeline(
  songId: string | undefined,
  opts?: { onSuccess?: (result: { clip: ApiClip; timelineClip: ApiTimelineClip }) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { looseFileId: string; trackId: string; sectionName: string }) => {
      const res = await fetch(`/api/loose-files/${vars.looseFileId}/place-on-timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: vars.trackId, sectionName: vars.sectionName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to place file on the timeline' }));
        throw new Error(err.message ?? 'Failed to place file on the timeline');
      }
      return res.json() as Promise<{ clip: ApiClip; timelineClip: ApiTimelineClip }>;
    },
    onSuccess: (result, vars) => {
      invalidateAfterLooseFilePlacement(queryClient, songId, vars.trackId, { clipId: result.clip.id });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      opts?.onSuccess?.(result);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// Ideas shelf: move an organized clip from one Idea (idea-type song) to another.
// A Finder-style move — same clip id, so notes, metadata and last-viewed state
// follow it. Both songs' buckets and comment summaries change (the file leaves
// one flat list and joins the other), and ['songs'] carries hasFiles for the
// Column 1 folder-fill icon on both rows.
export function useMoveClipToIdea(
  opts?: { onSuccess?: (clip: ApiClip, vars: { clipId: string; sourceSongId: string; destSongId: string }) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { clipId: string; sourceSongId: string; destSongId: string }) => {
      const res = await fetch(`/api/clips/${vars.clipId}/move-to-idea`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: vars.destSongId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to move file' }));
        throw new Error(err.message ?? 'Failed to move file');
      }
      return res.json() as Promise<ApiClip>;
    },
    onSuccess: (clip, vars) => {
      // The response carries the destination Idea's ideas-row id.
      requestLandingFlash([{ id: clip.id, zone: clipLandingZone(clip.ideaId) }]);
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.sourceSongId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.destSongId) });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', vars.sourceSongId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', vars.destSongId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      opts?.onSuccess?.(clip, vars);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// Ideas shelf: drop an organized clip on Column 1's empty space to turn it back into
// a band-wide loose file. A Finder-style move — the loose file keeps the clip's id,
// so notes (now under loose-file-comments) and last-viewed state follow it. The
// source Idea's bucket, comment summary and hasFiles fill all change; the
// unassigned list gains the file. Both comment-thread keys for this id are dropped
// so an open thread never shows the stale side.
export function useMakeClipLoose(
  opts?: { onSuccess?: (looseFile: ApiLooseFile, vars: { clipId: string; sourceSongId: string }) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { clipId: string; sourceSongId: string }) => {
      const res = await fetch(`/api/clips/${vars.clipId}/make-loose`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to move file out' }));
        throw new Error(err.message ?? 'Failed to move file out');
      }
      return res.json() as Promise<ApiLooseFile>;
    },
    onSuccess: (looseFile, vars) => {
      // Flashes the Column 1 row ('band'). The Column 2 preview card for the same file
      // doesn't take landing flashes at all.
      requestLandingFlash([{ id: looseFile.id, zone: looseLandingZone(looseFile) }]);
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.sourceSongId) });
      queryClient.invalidateQueries({ queryKey: looseFileKeys.all() });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', vars.sourceSongId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comments', vars.clipId] });
      queryClient.invalidateQueries({ queryKey: ['loose-file-comments', vars.clipId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      opts?.onSuccess?.(looseFile, vars);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// Ideas shelf: permanently delete an organized clip (POST /api/clips/:clipId/delete).
// The Idea's bucket, comment summary and hasFiles fill change; ['activity'] covers
// the feed row and the greeting's new-files count (['activity', 'new-files-count']).
export function useDeleteIdeaClip(
  opts?: { onSuccess?: (vars: { clipId: string; songId: string }) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { clipId: string; songId: string }) => {
      const res = await fetch(`/api/clips/${vars.clipId}/delete`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed to delete file' }));
        throw new Error(err.message ?? 'Failed to delete file');
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.songId) });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comments', vars.clipId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      opts?.onSuccess?.(vars);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

// ─── Real-song versions ──────────────────────────────────────────────────────

// Moving a real-song version (one clips row) out of its section — two kinds, one
// action, so each surface hosts a single in-use dialog:
//   'section' — Move A: to another section of the same song
//               (POST /api/clips/:clipId/move-to-section).
//   'loose'   — Moves B/C/D and "Remove from Section": back to a loose file of the
//               same song, song-level (destTrackId null) or on a track's shelf
//               (POST /api/clips/:clipId/move-to-loose).
// Built on useClipInUseAction, so a version with timeline copies or Final first opens
// the in-use dialog (render it at the surface level with this action's
// dialogProps/pendingVars) and confirming repeats the request with confirm: true.
// The name fields are for the dialog's wording and the caller's "view follows the
// file"; the server reads only ideaId / trackId.
interface MoveVersionBase {
  clipId: string;
  clipName: string;
  songId: string;
  // Where the version is now — named in the dialog (intro for 'loose', task line).
  sourceTrackName: string;
  sourceSectionName: string;
}

export type MoveVersionVars =
  | (MoveVersionBase & {
      kind: 'section';
      destIdeaId: string;
      destTrackId: string;
      destTrackName: string;
      destSectionName: string;
    })
  | (MoveVersionBase & {
      kind: 'loose';
      destTrackId: string | null;
    });

export function useMoveVersion(opts?: {
  onSuccess?: (vars: MoveVersionVars) => void;
  onError?: (message: string, vars: MoveVersionVars) => void;
  onCancel?: (vars: MoveVersionVars) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useClipInUseAction<ApiClip | ApiLooseFile, MoveVersionVars>({
    request: (confirm, vars) => vars.kind === 'section'
      ? postClipLeave<ApiClip>(`/api/clips/${vars.clipId}/move-to-section`, { ideaId: vars.destIdeaId }, confirm)
      : postClipLeave<ApiLooseFile>(`/api/clips/${vars.clipId}/move-to-loose`, { trackId: vars.destTrackId }, confirm),
    onSuccess: (_result, vars) => {
      // Same id afterwards. Move A: a card in the destination section. Moves C/D: the
      // destination track's shelf. Move B / "Remove from Section": song-level.
      requestLandingFlash([{
        id: vars.clipId,
        zone: vars.kind === 'section'
          ? clipLandingZone(vars.destIdeaId)
          : looseLandingZone({ trackId: vars.destTrackId, songId: vars.songId }),
      }]);
      // The bucket key is also the Songs quick-browser's file list (fileBucket), and
      // carries hasLooseFiles for the Tracks-column folder icons.
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${vars.songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      if (vars.kind === 'loose') {
        // The clip is now a loose file under the same id: both lists it can land in,
        // and both comment threads cached under that id.
        queryClient.invalidateQueries({ queryKey: looseFileKeys.list(vars.songId) });
        if (vars.destTrackId) queryClient.invalidateQueries({ queryKey: looseFileKeys.byTrack(vars.destTrackId) });
        queryClient.invalidateQueries({ queryKey: ['clip-comments', vars.clipId] });
        queryClient.invalidateQueries({ queryKey: ['loose-file-comments', vars.clipId] });
      }
      opts?.onSuccess?.(vars);
    },
    onError: (message, vars) => {
      console.error('[moveVersion] error:', message);
      toast({ title: 'Failed to move file', description: message, variant: 'destructive' });
      opts?.onError?.(message, vars);
    },
    onCancel: opts?.onCancel,
  });
}

// Remove (soft) a version through POST /api/clips/:clipId/remove. If it's in use
// (timeline copies or Final) the server answers clip-in-use; render ClipInUseDialog
// with dialogProps, and confirming repeats the request with confirm: true. run(vars)
// takes the version, so one surface-level instance can serve every card (the Songs
// quick-browser); BucketClip keeps its own instance, dialog inside the card.
// clipName / trackName are only for the dialog's wording.
export interface RemoveVersionVars {
  clipId: string;
  clipName: string;
  songId: string;
  trackName: string | null;
}

export function useRemoveVersion() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useClipInUseAction<unknown, RemoveVersionVars>({
    request: (confirm, vars) => postClipLeave(`/api/clips/${vars.clipId}/remove`, {}, confirm),
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(vars.songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${vars.songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['final-clips', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['production-tasks', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['clip-comment-summary', vars.songId] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: (message) => {
      console.error('[removeClip] error:', message);
      toast({ title: 'Failed to remove file', description: message, variant: 'destructive' });
    },
  });
}
