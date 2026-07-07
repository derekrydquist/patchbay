import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiTrack, bucketKeys } from '@/lib/bucket-api';

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
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      opts?.onCreated?.(track);
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useAddSection(
  songId: string | undefined,
  tracks: ApiTrack[],
  opts?: { onCreated?: (sectionName: string) => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sectionName: string) => {
      await Promise.all(
        tracks.map((track, i) =>
          fetch(`/api/tracks/${track.id}/ideas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${track.name} ${sectionName}`,
              sectionName,
              sortOrder: track.ideas.length + i,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const err = await res.json().catch(() => ({ message: 'Failed to create section' }));
              throw new Error(err.message ?? 'Failed to create section');
            }
            return res.json();
          })
        )
      );
    },
    onSuccess: (_, sectionName) => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      opts?.onCreated?.(sectionName);
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
      opts?.onSuccess?.();
    },
    onError: (err: Error) => opts?.onError?.(err.message),
  });
}

export function useRestoreTrack(
  songId: string,
  opts?: { onSuccess?: () => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) =>
      fetch(`/api/tracks/${trackId}/restore`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: bucketKeys.hiddenTracks(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      opts?.onSuccess?.();
    },
  });
}

export function useDeleteSection(
  songId: string,
  opts?: { onSuccess?: () => void; onError?: (message: string) => void }
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sectionName }: { sectionName: string }) => {
      const res = await fetch(`/api/songs/${songId}/sections/${encodeURIComponent(sectionName)}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Failed' }));
        throw new Error(err.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: [`/api/songs/${songId}/timeline`] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      opts?.onSuccess?.();
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
      opts?.onSuccess?.();
    },
  });
}
