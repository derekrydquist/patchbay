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
  // True if any Track-scoped loose file (loose_files.trackId = this track) is
  // resting below this track's Section list, even if it hasn't been organized
  // into a clip yet. Counts toward "this track has content" alongside ideas[].clips.
  hasLooseFiles: boolean;
}

// File uploaded before being assigned to a Track/Section. songId is null for a
// band-wide, unassigned file (Ideas shelf Column 1's "Upload Files") — otherwise
// it's scoped to the song/Idea it was uploaded into (Column 2's "Add Files" and
// every other loose-file upload entry point in the app).
export interface ApiLooseFile {
  id: string;
  songId: string | null;
  // Set once a song-scoped loose file has been dragged onto a Track row (not a
  // Section row) in the Tracks column — the Track-scoped resting tier. Null for
  // both the Tracks-column tier and the band-wide/unassigned tier.
  trackId: string | null;
  name: string;
  type: string;
  color: string;
  duration: number;
  src: string | null;
  metadata: DawClip['metadata'] | null;
  uploadedBy: string | null;
  // Same shape as ApiClip.addedToSongs — non-null only for a file that was an
  // organized clip before being made loose (POST /api/clips/:clipId/make-loose).
  addedToSongs?: AddedToSong[] | null;
  createdAt: string;
  // Comment aggregate from the three list routes (unassigned, by song, by track) —
  // same shape as /api/songs/:songId/clip-comment-summary entries. Optional because
  // single-file responses (create, assign-track) don't carry it. latestCommentAt is
  // null when the file has no comments.
  commentCount?: number;
  latestCommentAt?: string | null;
  // Newest comment NOT written by the session user — what the unread check uses,
  // so your own notes never light the badge for you. Null when there are none.
  latestOthersCommentAt?: string | null;
}

// GET /api/songs/:songId/clip-comment-summary — per bucket clip id. Cached under
// ['clip-comment-summary', songId] by every surface that renders clip badges.
// latestOthersCommentAt has the same meaning as on ApiLooseFile.
export type ClipCommentSummary = Record<string, {
  count: number;
  latestCommentAt: string;
  latestOthersCommentAt: string | null;
}>;

// Refresh policy for queries that carry OTHER people's comment activity — the
// clip comment summary and the loose-file lists (their commentCount /
// latestOthersCommentAt drive the unread badges). Without it, a teammate's new
// note only appears after a reload. Note 'always', not true: the global default is
// staleTime: Infinity, and refetchOnWindowFocus: true only refetches stale data,
// so it would never fire. The interval pauses while the tab is hidden
// (refetchIntervalInBackground: false). Apply to ONE observer per query per
// surface — every observer runs its own interval timer.
export const liveCommentRefetch = {
  refetchOnWindowFocus: 'always',
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;

export async function fetchClipCommentSummary(songId: string): Promise<ClipCommentSummary> {
  const res = await fetch(`/api/songs/${songId}/clip-comment-summary`);
  if (!res.ok) throw new Error('Failed to fetch comment summary');
  return res.json();
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

// Track-scoped loose files — the "I know the track, not yet the section" resting
// tier. Rendered in that Track's own Sections column in MediaBucket.
export async function fetchTrackLooseFiles(trackId: string): Promise<ApiLooseFile[]> {
  const res = await fetch(`/api/tracks/${trackId}/loose-files`);
  if (!res.ok) throw new Error('Failed to load track loose files');
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
  // Prefix of every key below — invalidates all loose-file lists at once.
  all: () => ['loose-files'] as const,
  list: (songId: string | undefined) => ['loose-files', songId] as const,
  unassigned: () => ['loose-files', 'unassigned'] as const,
  byTrack: (trackId: string | undefined) => ['loose-files', 'track', trackId] as const,
};
