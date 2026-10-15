// A file's display color always comes from the track it currently sits on, worked
// out at render time. clips.color, timeline_clips.color and loose_files.color are
// still written (they're NOT NULL) but are never read for display: they're a copy
// taken at creation time and don't follow the file when it moves to another track.

const TRACK_COLOR_FALLBACK = 'hsl(var(--chart-1))';
const NO_TRACK_COLOR = 'hsl(var(--primary))';

/** A track's display color — its own color, or chart-1 (same as the timeline track header). */
export function trackDisplayColor(track: { color: string | null } | null | undefined): string {
  return track?.color ?? TRACK_COLOR_FALLBACK;
}

/**
 * A loose file's display color: its track's color when it's Track-scoped and that
 * track is found, otherwise gold (song-level and band-wide files have no track).
 */
export function looseFileDisplayColor(
  looseFile: { trackId: string | null },
  findTrack: (trackId: string) => { color: string | null } | null | undefined,
): string {
  if (!looseFile.trackId) return NO_TRACK_COLOR;
  const track = findTrack(looseFile.trackId);
  return track ? trackDisplayColor(track) : NO_TRACK_COLOR;
}
