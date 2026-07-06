import type { Clip as DawClip } from '@/lib/daw-data';

// ─── Wire types for GET /api/songs/:id/bucket ────────────────────────────────
// Single source of truth. Union of all fields the API returns; both Dashboard
// and MediaBucket previously declared partial local copies of these.

export interface AddedToSong {
  songId: string;
  songName: string;
  instrument: string;
  section: string;
}

export interface ApiClip {
  id: string;
  ideaId: string;
  name: string;
  type: string;
  color: string;
  start: number;
  duration: number;
  src: string | null;
  isFinal: boolean;
  sectionName: string | null;
  metadata: DawClip['metadata'] | null;
  createdAt: string;
  addedToSongs?: AddedToSong[] | null;
}

export interface ApiIdea {
  id: string;
  trackId: string;
  name: string;
  sectionName: string;
  sortOrder: number;
  clips: ApiClip[];
}

export interface ApiTrack {
  id: string;
  songId: string;
  name: string;
  type: string;
  color: string | null;
  sortOrder: number;
  ideas: ApiIdea[];
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

export async function fetchBucket(songId: string): Promise<ApiTrack[]> {
  const res = await fetch(`/api/songs/${songId}/bucket`);
  if (!res.ok) throw new Error('Failed to load bucket');
  return res.json();
}

// ─── Query key factory ────────────────────────────────────────────────────────
// Invalidation keys must exactly match fetch keys (CLAUDE.md rule). Using this
// factory everywhere makes drift impossible.

export const bucketKeys = {
  bucket: (songId: string | undefined) => ['bucket', songId] as const,
  hiddenIdeas: (trackId: string | undefined) => ['hidden-ideas', trackId] as const,
  hiddenTracks: (songId: string | undefined) => ['hidden-tracks', songId] as const,
};
