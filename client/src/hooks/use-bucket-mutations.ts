import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ApiIdea, type ApiTrack, type ApiClip, type ApiTimelineClip, type ApiLooseFile,
  bucketKeys, looseFileKeys,
} from '@/lib/bucket-api';

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
    mutationFn: (ideaId: string) =>
      fetch(`/api/ideas/${ideaId}`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenIdeas(trackId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
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
