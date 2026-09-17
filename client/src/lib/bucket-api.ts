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
  isFullTake?: boolean;
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
  active: boolean;
  isFullTake?: boolean;
  clips: ApiClip[];
  hasNew: boolean;
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

// File uploaded before being assigned to a Track/Section. songId is null for a
// band-wide, unassigned file (Ideas shelf Column 1's "Upload Files") — otherwise
// it's scoped to the song/Idea it was uploaded into (Column 2's "Add Files" and
// every other loose-file upload entry point in the app).
export interface ApiLooseFile {
  id: string;
  songId: string | null;
  name: string;
  type: string;
  color: string;
  duration: number;
  src: string | null;
  metadata: DawClip['metadata'] | null;
  uploadedBy: string | null;
  createdAt: string;
}

// Returned by POST /api/loose-files/:id/place-on-timeline alongside the clip.
export interface ApiTimelineClip {
  id: string;
  trackId: string;
  name: string;
  type: string;
  color: string;
  start: number;
  duration: number;
  src: string | null;
  sectionName: string | null;
  isFinal: boolean;
  trimStart: number;
  trimEnd: number | null;
  bucketClipId: string | null;
  isFullTake: boolean;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function fetchBucket(songId: string): Promise<ApiTrack[]> {
  const res = await fetch(`/api/songs/${songId}/bucket`);
  if (!res.ok) throw new Error('Failed to load bucket');
  return res.json();
}

export async function fetchLooseFiles(songId: string): Promise<ApiLooseFile[]> {
  const res = await fetch(`/api/songs/${songId}/loose-files`);
  if (!res.ok) throw new Error('Failed to load loose files');
  return res.json();
}

// Band-wide, unassigned loose files — Ideas shelf Column 1's "Upload Files".
export async function fetchUnassignedLooseFiles(): Promise<ApiLooseFile[]> {
  const res = await fetch('/api/loose-files/unassigned');
  if (!res.ok) throw new Error('Failed to load unassigned loose files');
  return res.json();
}

// ─── Query key factories ──────────────────────────────────────────────────────
// Invalidation keys must exactly match fetch keys (CLAUDE.md rule). Using these
// factories everywhere makes drift impossible.

export const bucketKeys = {
  bucket: (songId: string | undefined) => ['bucket', songId] as const,
  hiddenIdeas: (trackId: string | undefined) => ['hidden-ideas', trackId] as const,
  hiddenTracks: (songId: string | undefined) => ['hidden-tracks', songId] as const,
};

export const looseFileKeys = {
  list: (songId: string | undefined) => ['loose-files', songId] as const,
  unassigned: () => ['loose-files', 'unassigned'] as const,
};
