import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiIdea, type ApiTrack, bucketKeys } from '@/lib/bucket-api';

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
        const err = await res.json().catch(() => ({ message: 'Failed to create instrument' }));
        throw new Error(err.message ?? 'Failed to create instrument');
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
        const err = await res.json().catch(() => ({ message: 'Failed to restore instrument' }));
        throw new Error(err.message ?? 'Failed to restore instrument');
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
