// A file's display color always comes from the track it currently sits on, worked
// out at render time: a file on a track shows the track's color; a loose file with
// no track shows an empty ring (null here), never a color — gold would read as the
// Drums track or any user-added track. clips.color, timeline_clips.color and
// loose_files.color are still written (they're NOT NULL) but are never read for
// display: they're a copy taken at creation time and don't follow the file when it
// moves to another track.

const TRACK_COLOR_FALLBACK = 'hsl(var(--chart-1))';

/** A track's display color — its own color, or chart-1 (same as the timeline track header). */
export function trackDisplayColor(track: { color: string | null } | null | undefined): string {
  return track?.color ?? TRACK_COLOR_FALLBACK;
}

/**
 * A loose file's display color: its track's color when it's Track-scoped and that
 * track is found. null (shown as an empty ring) for a song-level or band-wide file,
 * or a Track-scoped one whose track isn't found (only a hidden track).
 */
export function looseFileDisplayColor(
  looseFile: { trackId: string | null },
  findTrack: (trackId: string) => { color: string | null } | null | undefined,
): string | null {
  if (!looseFile.trackId) return null;
  const track = findTrack(looseFile.trackId);
  return track ? trackDisplayColor(track) : null;
}
