import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ApiIdea, type ApiTrack, type ApiClip, type ApiTimelineClip,
  bucketKeys, looseFileKeys,
} from '@/lib/bucket-api';

// Shared by organize/place-on-timeline: invalidate the same set the loose-file
// upload flow also invalidates, so all three actions keep every surface in sync.
function invalidateAfterLooseFilePlacement(
  queryClient: ReturnType<typeof useQueryClient>,
  songId: string | undefined
) {
  queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
  queryClient.invalidateQueries({ queryKey: looseFileKeys.list(songId) });
  // Always invalidated, regardless of songId: the organized file may have come
  // from the band-wide unassigned list (Ideas shelf Column 1), which needs to
  // drop it the same way a song-scoped list drops an organized file.
  queryClient.invalidateQueries({ queryKey: looseFileKeys.unassigned() });
  queryClient.invalidateQueries({ queryKey: ['activity'] });
  queryClient.invalidateQueries({ queryKey: ['songs'] });
  queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
  queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
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
    mutationFn: async (vars: { looseFileId: string; trackId: string; sectionName: string }) => {
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
    onSuccess: (clip) => {
      invalidateAfterLooseFilePlacement(queryClient, songId);
      opts?.onSuccess?.(clip);
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
    onSuccess: (result) => {
      invalidateAfterLooseFilePlacement(queryClient, songId);
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      opts?.onSuccess?.(result);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}
