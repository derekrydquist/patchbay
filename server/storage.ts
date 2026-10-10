import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import { eq, ne, asc, desc, inArray, notInArray, count, and, or, gte, isNull, max, min, getTableColumns, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "./db";
import {
  type User, type InsertUser,
  type Song, type InsertSong,
  type InstrumentTrack, type InsertInstrumentTrack,
  type Idea, type InsertIdea,
  type Clip, type InsertClip,
  type LooseFile, type InsertLooseFile,
  type TimelineClip, type InsertTimelineClip,
  type ProductionTask, type InsertProductionTask,
  type TaskComment, type InsertTaskComment,
  type ClipComment, type InsertClipComment,
  type LooseFileComment, type InsertLooseFileComment,
  type SongReview, type InsertSongReview,
  type SongReviewComment, type InsertSongReviewComment,
  type LyricsComment, type InsertLyricsComment,
  type Album,
  type Band,
  type InsertActivityLog,
  users, songs, instrumentTracks, ideas, clips, looseFiles, timelineClips, deletedSections,
  productionTasks, taskComments, clipComments, looseFileComments, songReviews, songReviewComments,
  lyricsComments, activityLog, globalSettings, albums, albumSongs, bands, bucketFolderViews,
} from "@shared/schema";
import { type ClipDependents, type TaskStatus, taskStatusAfterVersionLeaves } from "@shared/clip-dependents";

// Thrown by materializeLooseFile / materializeLooseFileToTimeline when the loose file
// id doesn't resolve — callers translate this to a 404, as distinct from the
// "idea missing" case below, which is a genuine invariant violation (500).
export class LooseFileNotFoundError extends Error {
  constructor(id: string) {
    super(`Loose file not found: ${id}`);
    this.name = "LooseFileNotFoundError";
  }
}

// Thrown by dematerializeClipToBandLoose when the clip can't be turned back into a
// loose file (not in an Idea, removed, final, or placed on a timeline) — the route
// translates this to a 409 with the message as-is.
export class ClipNotLooseableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipNotLooseableError";
  }
}

// Thrown by storage.deleteIdeaClip when the clip can't be deleted (not in an Idea,
// final, or placed on a timeline) — the route translates this to a 409.
export class ClipNotDeletableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipNotDeletableError";
  }
}

// Unlink an uploaded file once its last DB row is gone. Must run after the caller's
// own row is deleted. Guards against deleting a file another row still needs. New
// uploads get a unique physical name (buildFilename's token), but older uploads
// collided — loose uploads all computed loose_unplaced_v1.*, and section uploads
// reused {instrument}_{section}_v{n} across songs — so existing data still has many
// independent rows sharing one src, left unrepaired. A file can also be shared
// legitimately: a loose file or clip keeps its src when it's organized, made loose,
// or placed on the timeline (materializeLooseFileCore copies `src` as-is). So check
// for other referents first and skip the unlink if any exist. Best-effort: a missing
// file or failed unlink is logged, never thrown.
function unlinkUploadIfUnreferenced(src: string, logTag: string): void {
  const otherLooseFile = db.select({ id: looseFiles.id }).from(looseFiles)
    .where(eq(looseFiles.src, src)).get();
  const clipRef = db.select({ id: clips.id }).from(clips)
    .where(eq(clips.src, src)).get();
  const timelineClipRef = db.select({ id: timelineClips.id }).from(timelineClips)
    .where(eq(timelineClips.src, src)).get();
  if (otherLooseFile || clipRef || timelineClipRef) return;

  const filePath = path.join(UPLOADS_DIR, path.basename(src));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error(`${logTag} failed to remove uploaded file:`, err);
    }
  });
}

// Mirrors routes.ts's UPLOADS_DIR resolution exactly (same env override) — kept
// as a separate constant rather than importing from routes.ts to avoid a
// circular import (routes.ts imports `storage` from this file).
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("uploads");

export const DEFAULT_SONG_ID = "patchbay-default";

export const DEFAULT_SECTIONS = [
  "Intro",
  "Verse 1",
  "Chorus 1",
  "Verse 2",
  "Chorus 2",
  "Bridge",
  "Outro",
];

export const DEFAULT_INSTRUMENTS = [
  "Drums",
  "Bass",
  "Guitar 1",
  "Guitar 2",
  "Vocals",
];

function defaultIdeaId(trackId: string, sectionIndex: number): string {
  return `idea-${trackId}-${sectionIndex}`;
}

const DEFAULT_SONG: Song = {
  id: DEFAULT_SONG_ID,
  name: "Midnight Horizon",
  bpm: 120,
  timeSignature: "4/4",
  sections: DEFAULT_SECTIONS,
  type: "song",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  bandId: null,
  lyrics: null,
};

const DEFAULT_TRACKS: (typeof instrumentTracks.$inferInsert)[] = [
  { id: "track-drums",    songId: DEFAULT_SONG_ID, name: "Drums",    type: "audio",  color: "hsl(var(--chart-1))", sortOrder: 0 },
  { id: "track-bass",     songId: DEFAULT_SONG_ID, name: "Bass",     type: "audio",  color: "hsl(var(--chart-2))", sortOrder: 1 },
  { id: "track-guitar-1", songId: DEFAULT_SONG_ID, name: "Guitar 1", type: "audio",  color: "hsl(var(--chart-3))", sortOrder: 2 },
  { id: "track-guitar-2", songId: DEFAULT_SONG_ID, name: "Guitar 2", type: "audio",  color: "hsl(var(--chart-5))", sortOrder: 3 },
  { id: "track-vocals",   songId: DEFAULT_SONG_ID, name: "Vocals",   type: "vocal",  color: "hsl(var(--chart-4))", sortOrder: 4 },
];

// ─── Shared types ─────────────────────────────────────────────────────────────

export type SongWithTracks = Song & {
  tracks: (InstrumentTrack & {
    ideas: (Idea & { clips: Clip[] })[];
  })[];
};

export type TrackWithTimelineClips = InstrumentTrack & { timelineClips: TimelineClip[] };

/** The shape returned by GET /api/songs/:id/bucket */
export type BucketTrack = InstrumentTrack & {
  ideas: (Idea & { clips: Clip[]; hasNew: boolean })[];
  // True if this track has any content at all beneath it — an organized clip in
  // any of its ideas, OR a Track-scoped loose file resting in loose_files (trackId
  // set, not yet organized into a Section). Drives the Tracks-column folder icon's
  // filled-vs-outline state; a track with only loose files still counts as "has
  // content" even though `ideas[].clips` alone would be empty.
  hasLooseFiles: boolean;
};

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ActivityEvent {
  // Tier 1 (synthesized at read time):
  type: 'file-added' | 'marked-final' | 'clip-comment' | 'task-comment' | 'status-change'
      | 'review-shared' | 'clip-unmarked-final' | 'clip-replaced' | 'clip-added-to-timeline'
      | 'clip-removed-from-timeline' | 'section-added' | 'section-deleted'
      | 'track-added' | 'track-deleted' | 'review-comment' | 'review-reply'
      | 'song-created' | 'idea-created'
      // Tier 2 (written verbatim via logActivity()) — kept in sync with the
      // "Tier 2 event types — full reference" table in .claude/skills/activity-feed/SKILL.md;
      // last audited 2026-08-12:
      | 'song-deleted' | 'idea-deleted' | 'track-restored' | 'volume-changed' | 'pan-changed'
      | 'section-restored' | 'timeline-reordered' | 'clip-trim-adjusted'
      | 'clip-trim-applied-to-instances' | 'timeline-cleared' | 'idea-hidden'
      | 'idea-restored' | 'clip-metadata-edited' | 'clip-removed' | 'file-uploaded'
      | 'clip-comment-added' | 'clip-comment-reply' | 'clip-comment-edited'
      | 'clip-comment-deleted' | 'task-status-change' | 'task-comment-added'
      | 'task-comment-reply' | 'task-comment-edited' | 'task-comment-deleted'
      | 'review-comment-edited' | 'review-comment-deleted' | 'review-comment-resolved'
      | 'review-comment-unresolved' | 'song-added-to-album' | 'song-removed-from-album'
      | 'lyrics-edited' | 'lyrics-comment-added' | 'lyrics-comment-reply'
      | 'lyrics-comment-edited' | 'lyrics-comment-deleted' | 'lyrics-comment-resolved'
      | 'lyrics-comment-unresolved' | 'loose-file-comment-added' | 'loose-file-comment-reply'
      | 'loose-file-comment-edited' | 'loose-file-comment-deleted' | 'clip-moved-to-idea'
      | 'clip-made-loose' | 'clip-deleted' | 'clip-final-set' | 'clip-final-cleared'
      // Sort-only: a task outcome whose cause already has its own feed row.
      | 'task-auto-completed' | 'task-auto-reverted';
  description: string;
  timestamp: number; // ms since epoch
  songId: string;
  songName: string;
  instrument?: string;
  sectionName?: string;
  taskId?: string;
  // comment source routing — present on clip-comment and task-comment events
  source?: 'clip' | 'task';
  clipId?: string;
  // review deep-link routing — present on review-shared, review-comment, review-reply events
  reviewId?: string;
  commentId?: string;
  // the song no longer exists — the feed renders the row as plain text with no link
  songDeleted?: boolean;
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  seedUsers(): Promise<void>;

  // Songs
  getSongs(bandId: string): Promise<Song[]>;
  getSongsWithLastActive(bandId: string, username: string): Promise<Song[]>;
  getSongById(id: string): Promise<SongWithTracks | undefined>;
  createSong(data: InsertSong, bandId: string): Promise<Song>;
  updateSong(id: string, updates: Partial<InsertSong>): Promise<Song | undefined>;
  deleteSong(id: string, actor: string): Promise<void>;
  seedSong(songId: string, instruments: string[], sections: string[]): Promise<void>;

  // Bootstrap
  bootstrapDefaultSong(): Promise<void>;

  // Timeline
  getTimelineTracks(songId: string): Promise<TrackWithTimelineClips[]>;
  addTimelineClip(trackId: string, data: InsertTimelineClip): Promise<TimelineClip>;
  updateTimelineClip(id: string, updates: Partial<InsertTimelineClip>): Promise<TimelineClip | undefined>;
  deleteTimelineClip(id: string): Promise<void>;

  // Bucket
  getBucket(songId: string, userId?: string): Promise<BucketTrack[]>;
  upsertFolderView(userId: string, ideaId: string): void;
  ensureIdeaDefaultFolder(songId: string): Promise<{ trackId: string; sectionName: string } | undefined>;

  // Tracks
  createTrack(data: InsertInstrumentTrack): Promise<InstrumentTrack>;
  updateTrack(trackId: string, updates: { volume?: number; pan?: number }): Promise<InstrumentTrack | undefined>;
  deleteTrack(trackId: string): Promise<void>;
  hideTrack(trackId: string): Promise<void>;
  restoreTrack(trackId: string): Promise<void>;
  getHiddenTracks(songId: string): Promise<InstrumentTrack[]>;
  deleteSection(songId: string, sectionName: string): Promise<void>;

  // Ideas
  createIdea(data: InsertIdea): Promise<Idea>;
  hideIdea(ideaId: string): Promise<void>;
  restoreIdea(ideaId: string): Promise<void>;
  getHiddenIdeas(trackId: string): Promise<Idea[]>;

  // Clips (bucket versions)
  createClip(data: InsertClip): Promise<Clip>;
  countClipsForIdea(ideaId: string): Promise<number>;
  updateClip(clipId: string, updates: Partial<InsertClip>): Promise<Clip | undefined>;
  syncFinalClipFromTimeline(trackId: string, sectionName: string, clipName: string, isFinal: boolean): Promise<void>;
  timelineHasFinals(songId: string): Promise<boolean>;
  deleteNonFinalTimelineClips(songId: string): Promise<void>;

  // Loose Files (song-scoped, unplaced uploads)
  createLooseFile(data: InsertLooseFile): Promise<LooseFile>;
  // viewerUsername: the session user — their own comments are excluded from
  // latestOthersCommentAt (null counts every comment as someone else's).
  getLooseFilesBySong(songId: string, viewerUsername: string | null): Promise<LooseFileWithCommentCount[]>;
  getLooseFilesByBand(bandId: string, viewerUsername: string | null): Promise<LooseFileWithCommentCount[]>;
  getLooseFilesByTrack(trackId: string, viewerUsername: string | null): Promise<LooseFileWithCommentCount[]>;
  assignLooseFileTrack(id: string, trackId: string | null): Promise<LooseFile>;
  updateLooseFileMetadata(id: string, metadata: LooseFile['metadata']): Promise<LooseFile>;
  getLooseFile(id: string): Promise<LooseFile | undefined>;
  deleteLooseFile(id: string): Promise<void>;
  deleteIdeaClip(clipId: string): Promise<Clip>;
  materializeLooseFile(looseFileId: string, trackId: string, sectionName: string): Promise<Clip>;
  moveClipToIdea(clipId: string, destSongId: string): Promise<Clip>;
  makeClipLoose(clipId: string, bandId: string): Promise<LooseFile>;
  // A version leaving its section (Remove today, moves later). See releaseClipDependencies.
  getClipDependents(clipId: string): Promise<ClipDependents | undefined>;
  removeClip(clipId: string): Promise<Clip | undefined>;
  getTaskByTrackSection(trackId: string, sectionName: string): Promise<ProductionTask | undefined>;
  countActiveClipsForIdea(ideaId: string): Promise<number>;
  hasActiveFinalClipInIdea(ideaId: string, excludeClipId?: string): Promise<boolean>;
  countClipsCreatedSince(bandId: string, sinceIso: string): Promise<number>;
  materializeLooseFileToTimeline(
    looseFileId: string,
    trackId: string,
    sectionName: string
  ): Promise<{ clip: Clip; timelineClip: TimelineClip }>;

  // Activity
  getActivity(bandId: string, songId?: string): Promise<ActivityEvent[]>;
  logActivity(entry: InsertActivityLog): Promise<void>;

  // Production Tasks
  getAllTasks(bandId: string): Promise<(ProductionTask & { songName: string })[]>;
  getTasksForSong(songId: string): Promise<ProductionTask[]>;
  getTaskByInstrumentSection(songId: string, instrument: string, sectionName: string): Promise<ProductionTask | undefined>;
  getFinalClipForTask(instrument: string, sectionName: string, songId: string): Promise<Clip | undefined>;
  getTimelineClipForTask(instrument: string, sectionName: string, songId: string): Promise<TimelineClip | undefined>;
  upsertTask(data: InsertProductionTask): Promise<ProductionTask>;
  updateTask(id: string, updates: Partial<InsertProductionTask>): Promise<ProductionTask | undefined>;
  getTaskComments(taskId: string): Promise<TaskCommentWithReplies[]>;
  addTaskComment(data: InsertTaskComment): Promise<TaskComment>;
  updateTaskComment(id: string, text: string): Promise<TaskComment | undefined>;
  deleteTaskComment(id: string): Promise<void>;

  // Clip Comments
  getClipComments(clipId: string): Promise<ClipCommentWithReplies[]>;
  addClipComment(data: InsertClipComment): Promise<ClipComment>;
  updateClipComment(id: string, text: string): Promise<ClipComment | undefined>;
  deleteClipComment(id: string): Promise<void>;
  copyCommentsToClip(destClipId: string, source: { kind: 'clip' | 'loose'; id: string }): Promise<ClipComment[]>;

  // Loose File Comments
  getLooseFileComments(looseFileId: string): Promise<LooseFileCommentWithReplies[]>;
  getLooseFileComment(id: string): Promise<LooseFileComment | undefined>;
  addLooseFileComment(data: InsertLooseFileComment): Promise<LooseFileComment>;
  updateLooseFileComment(id: string, text: string): Promise<LooseFileComment | undefined>;
  deleteLooseFileComment(id: string): Promise<void>;

  // Reviews
  getReviewsForSong(songId: string): Promise<SongReview[]>;
  countReviewsForSong(songId: string): Promise<number>;
  createReview(data: InsertSongReview): Promise<SongReview>;
  deleteReview(id: string): Promise<void>;

  // Review Comments
  getReviewComments(reviewId: string): Promise<ReviewCommentWithReplies[]>;
  addReviewComment(data: InsertSongReviewComment): Promise<SongReviewComment>;
  updateReviewComment(id: string, updates: { text?: string; resolved?: boolean; editedAt?: string | null }): Promise<SongReviewComment | undefined>;
  deleteReviewComment(id: string): Promise<void>;

  // Lyrics Comments
  getLyricsComments(songId: string): Promise<LyricsCommentWithReplies[]>;
  addLyricsComment(data: InsertLyricsComment): Promise<LyricsComment>;
  updateLyricsComment(id: string, updates: { text?: string; resolved?: boolean }): Promise<LyricsComment | undefined>;
  deleteLyricsComment(id: string): Promise<void>;

  // Bands
  getBands(): Promise<Band[]>;
  createBand(name: string): Promise<Band>;
  getUsersByBand(bandId: string): Promise<User[]>;
  backfillBands(): Promise<void>;
  relinkNullTaskTracks(): Promise<void>;

  // Albums
  getAlbums(bandId: string): Promise<AlbumWithCount[]>;
  createAlbum(name: string, bandId: string): Promise<Album>;
  renameAlbum(id: string, name: string): Promise<Album | undefined>;
  deleteAlbum(id: string): Promise<void>;
  getAlbumSongs(albumId: string): Promise<Song[]>;
  addSongToAlbum(albumId: string, songId: string): Promise<{ added: boolean }>;
  removeSongFromAlbum(albumId: string, songId: string): Promise<void>;
  moveAlbumSong(albumId: string, songId: string, direction: 'up' | 'down'): Promise<void>;
  getAllAlbumMemberships(bandId: string): Promise<AlbumMembership[]>;

  // Settings
  getSettings(bandId: string): Promise<{ defaultInstruments: string[]; defaultSections: string[]; defaultBpm: number }>;
  updateSettings(bandId: string, data: { defaultInstruments?: string[]; defaultSections?: string[]; defaultBpm?: number }): Promise<void>;
}

export type ReviewCommentWithReplies = SongReviewComment & {
  replies: SongReviewComment[];
};

export type ClipCommentWithReplies = ClipComment & { replies: ClipComment[] };
export type LooseFileCommentWithReplies = LooseFileComment & { replies: LooseFileComment[] };
// Loose-file list rows carry a comment aggregate for the row badge — same shape as
// /api/songs/:songId/clip-comment-summary entries. commentCount is the total;
// latestOthersCommentAt ignores the viewer's own comments (it drives "unread", so
// your own notes never light the badge). Both timestamps are null when absent.
export type LooseFileWithCommentCount = LooseFile & {
  commentCount: number;
  latestCommentAt: string | null;
  latestOthersCommentAt: string | null;
};
export type TaskCommentWithReplies = TaskComment & { replies: TaskComment[] };
export type LyricsCommentWithReplies = LyricsComment & { replies: LyricsComment[] };
export type AlbumWithCount = Album & { songCount: number };
export type AlbumMembership = { albumId: string; albumName: string; songId: string };

// ─── Shared task-creation helper ─────────────────────────────────────────────
// Single source of truth for "create the production_tasks row for a given
// instrument × section pair." Every call site that creates ideas must call
// this alongside the ideas insert so the invariant "every active idea has a
// matching task" stays structurally enforced.
//
// sectionIndex — when provided, produces the deterministic id
//   `task-${trackId}-${sectionIndex}` used by bootstrapDefaultSong and
//   createTrack so those rows are stable across server restarts and can
//   safely use onConflictDoNothing. When omitted, a random UUID is used
//   (seedSong, the createIdea route) — appropriate for user-created entities
//   that will never need to be upserted.
//
// onConflictDoNothing is always applied — safe for all callers and makes
// the function fully idempotent regardless of ID scheme.
// Shared core for materializeLooseFile / materializeLooseFileToTimeline — the single
// write path for turning a loose file into a real `clips` row. Runs inside the caller's
// transaction so the clip-insert and loose-file-delete are always atomic together, and
// (for the timeline variant) atomic with the timeline_clips insert too.
type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The one naming rule for a clip landing in a section of a real song (type 'song'):
// whatever its current name, it becomes "{dest track} {dest section} V{m}", m = the
// highest V among the destination idea's clips with that prefix (inactive clips
// included) + 1, V1 if none. Gaps stay; no other clip is renamed or renumbered. Idea
// clips and Full Take sections (their clips store sectionName null) keep the name as
// given. Plain string comparison, not a regex, so names with special characters need
// no escaping. Call inside the transaction that inserts or moves the clip, and before
// it lands — the clip itself must not count toward m.
//
// The pre-rename name is kept as metadata.originalFileName when that's empty, so a
// raw filename ("drums_chorus.mp3") isn't lost. An existing originalFileName is never
// overwritten. Returns the metadata unchanged when nothing needs filling.
function landingClipName(
  tx: DrizzleTx,
  ideaId: string,
  name: string,
  metadata: Clip['metadata'],
): { name: string; metadata: Clip['metadata'] } {
  const dest = tx.select({ idea: ideas, trackName: instrumentTracks.name, songType: songs.type })
    .from(ideas)
    .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
    .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
    .where(eq(ideas.id, ideaId))
    .get();
  if (!dest || dest.songType !== 'song' || dest.idea.isFullTake) return { name, metadata };

  const destPrefix = `${dest.trackName} ${dest.idea.sectionName} V`;
  let highest = 0;
  for (const { name: existing } of tx.select({ name: clips.name }).from(clips).where(eq(clips.ideaId, ideaId)).all()) {
    if (!existing.startsWith(destPrefix)) continue;
    const rest = existing.slice(destPrefix.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  const finalName = `${destPrefix}${highest + 1}`;
  if (finalName === name || metadata?.originalFileName) return { name: finalName, metadata };
  return { name: finalName, metadata: { ...(metadata ?? {}), originalFileName: name } as NonNullable<Clip["metadata"]> };
}

function materializeLooseFileCore(
  tx: DrizzleTx,
  looseFileId: string,
  trackId: string,
  sectionName: string
): Clip {
  const looseFile = tx.select().from(looseFiles).where(eq(looseFiles.id, looseFileId)).get();
  if (!looseFile) throw new LooseFileNotFoundError(looseFileId);

  // This idea row is expected to always exist (default bootstrap or a prior section-add)
  // — if it's missing, that's a genuine invariant violation, not a normal 404. Error loudly
  // rather than silently creating one, per the loose-files spec.
  const idea = tx.select().from(ideas)
    .where(and(eq(ideas.trackId, trackId), eq(ideas.sectionName, sectionName)))
    .get();
  if (!idea) {
    const msg = `[materializeLooseFile] No idea found for trackId=${trackId} sectionName=${JSON.stringify(sectionName)} — expected to always exist from bootstrap or section-add.`;
    console.error(msg);
    throw new Error(msg);
  }

  // The clip reuses the loose file's id — the file keeps one identity across the move,
  // so client-side state keyed by id (e.g. the comment badge's last-viewed map) carries
  // over. Safe: the loose_files row is deleted below in the same transaction.
  const landed = landingClipName(tx, idea.id, looseFile.name, looseFile.metadata);
  const clip: Clip = {
    id: looseFile.id,
    ideaId: idea.id,
    name: landed.name,
    type: looseFile.type,
    color: looseFile.color,
    start: 0,
    duration: looseFile.duration,
    src: looseFile.src,
    isFinal: false,
    active: true,
    sectionName,
    metadata: landed.metadata,
    // Non-null only for a file that was an organized clip before being made loose
    // (dematerializeClipToBandLoose) — its "added to song" pills come back with it.
    addedToSongs: looseFile.addedToSongs,
    createdAt: new Date().toISOString(),
  };
  tx.insert(clips).values(clip).run();

  // Notes travel with the file. Move them into clip_comments with the SAME ids, so
  // reply parentIds stay valid without remapping, and mark them as carried so
  // getActivity doesn't re-surface them as new feed rows. Must run before the
  // loose_files delete below — its ON DELETE CASCADE would remove these rows.
  const carried = tx.select().from(looseFileComments)
    .where(eq(looseFileComments.looseFileId, looseFileId)).all();
  if (carried.length) {
    tx.insert(clipComments).values(carried.map((c) => ({
      id: c.id,
      clipId: clip.id,
      parentId: c.parentId,
      author: c.author,
      text: c.text,
      timestamp: c.timestamp,
      createdAt: c.createdAt,
      carriedFromCommentId: c.id,
    }))).run();
  }

  tx.delete(looseFiles).where(eq(looseFiles.id, looseFileId)).run();
  return clip;
}

// The mirror of materializeLooseFileCore: turn an organized Ideas-shelf clip back into
// a band-wide, unassigned loose file (Ideas shelf Column 1). A Finder-style move — the
// loose file reuses the clip's id and src, and the clip's notes move into
// loose_file_comments with the same ids, so nothing is duplicated and nothing is lost.
// Never touches the physical file: the new loose_files row points at the same src.
//
// Only idea-type, active, non-final clips with no timeline_clips instances qualify —
// a real-song clip is tied into the isFinal/timeline/task sync, which this must never
// touch. bandId comes from the caller's session, never from the request.
function dematerializeClipToBandLoose(tx: DrizzleTx, clipId: string, bandId: string): LooseFile {
  const row = tx.select({ clip: clips, songType: songs.type })
    .from(clips)
    .innerJoin(ideas, eq(clips.ideaId, ideas.id))
    .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
    .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
    .where(eq(clips.id, clipId))
    .get();
  if (!row) throw new ClipNotLooseableError("File not found.");
  const { clip } = row;
  if (row.songType !== 'idea') throw new ClipNotLooseableError("Only files in an Idea can be moved out to the Ideas list.");
  if (!clip.active) throw new ClipNotLooseableError("This file has been removed.");
  if (clip.isFinal) throw new ClipNotLooseableError("A file marked final can't be moved out.");
  const placed = tx.select({ id: timelineClips.id }).from(timelineClips)
    .where(eq(timelineClips.bucketClipId, clipId)).get();
  if (placed) throw new ClipNotLooseableError("This file is placed on a timeline and can't be moved out.");

  const looseFile: LooseFile = {
    id: clip.id,
    songId: null,
    bandId,
    trackId: null,
    name: clip.name,
    type: clip.type,
    color: clip.color,
    duration: clip.duration,
    src: clip.src,
    metadata: clip.metadata,
    uploadedBy: clip.metadata?.uploadedBy ?? null,
    addedToSongs: clip.addedToSongs,
    createdAt: new Date().toISOString(),
  };
  tx.insert(looseFiles).values(looseFile).run();

  // Notes travel with the file, same ids (reply parentIds stay valid). Must run
  // before the clip delete below — clip_comments cascades on it.
  // carriedFromCommentId has no loose_file_comments column; it's dropped here.
  const carried = tx.select().from(clipComments).where(eq(clipComments.clipId, clipId)).all();
  if (carried.length) {
    tx.insert(looseFileComments).values(carried.map((c) => ({
      id: c.id,
      looseFileId: looseFile.id,
      parentId: c.parentId,
      author: c.author,
      text: c.text,
      timestamp: c.timestamp,
      createdAt: c.createdAt,
    }))).run();
  }

  tx.delete(clips).where(eq(clips.id, clipId)).run();
  return looseFile;
}

// What falls off when a real-song version leaves its section (Remove today, moves
// later): its placed timeline copies, Final on this one row, and any task's
// relatedClipId link. Matched by bucketClipId, never by track + section, which would
// also catch other versions' copies. This is the approved fourth isFinal write path:
// it writes isFinal = false on this row only — no same-name cascade, which would
// un-final other clips on the track. Runs inside the caller's transaction; the
// caller recomputes the section's task after commit (taskStatusAfterVersionLeaves).
// Audio, notes, metadata and addedToSongs are untouched.
export function releaseClipDependencies(tx: DrizzleTx, clipId: string): void {
  tx.delete(timelineClips).where(eq(timelineClips.bucketClipId, clipId)).run();
  tx.update(clips).set({ isFinal: false }).where(eq(clips.id, clipId)).run();
  tx.update(productionTasks).set({ relatedClipId: null }).where(eq(productionTasks.relatedClipId, clipId)).run();
}

// Shared by the three loose-file list methods: the filtered loose_files rows, each with a
// LEFT JOIN aggregate over loose_file_comments (top-level comments and replies alike,
// same as the clip-comment-summary endpoint counts them).
function selectLooseFilesWithCommentCounts(where: SQL | undefined, viewerUsername: string | null): LooseFileWithCommentCount[] {
  const rows = db
    .select({
      ...getTableColumns(looseFiles),
      commentCount: count(looseFileComments.id),
      latestTimestamp: max(looseFileComments.timestamp),
      latestOthersTimestamp: max(othersCommentTimestamp(looseFileComments.author, looseFileComments.timestamp, viewerUsername)),
    })
    .from(looseFiles)
    .leftJoin(looseFileComments, eq(looseFileComments.looseFileId, looseFiles.id))
    .where(where)
    .groupBy(looseFiles.id)
    .orderBy(asc(looseFiles.name))
    .all();
  return rows.map(({ latestTimestamp, latestOthersTimestamp, ...row }) => ({
    ...row,
    latestCommentAt: latestTimestamp != null ? new Date(latestTimestamp).toISOString() : null,
    // max() over a raw SQL expression comes back as a string — coerce before Date().
    latestOthersCommentAt: latestOthersTimestamp != null ? new Date(Number(latestOthersTimestamp)).toISOString() : null,
  }));
}

// A comment's timestamp if someone other than the viewer wrote it, else NULL —
// wrap in max() for "newest comment by anyone else". Author match is
// case-insensitive, same as the author-only edit/delete check.
export function othersCommentTimestamp(
  authorCol: SQLWrapper, timestampCol: SQLWrapper, viewerUsername: string | null,
): SQL<number | null> {
  if (!viewerUsername) return sql<number | null>`${timestampCol}`;
  return sql<number | null>`CASE WHEN lower(${authorCol}) <> lower(${viewerUsername}) THEN ${timestampCol} END`;
}

export function insertProductionTaskForSection({
  songId,
  trackId,
  instrument,
  sectionName,
  sectionIndex,
}: {
  songId: string;
  trackId: string;
  instrument: string;
  sectionName: string;
  sectionIndex?: number;
}): void {
  const id = sectionIndex !== undefined ? `task-${trackId}-${sectionIndex}` : randomUUID();
  db.insert(productionTasks).values({
    id,
    songId,
    trackId,
    title: `${instrument} – ${sectionName}`,
    instrument,
    sectionName,
    status: "todo",
    priority: "medium",
    assignee: "",
  }).onConflictDoNothing().run();
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class SQLiteStorage implements IStorage {

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUser(id: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = { bandId: null, ...insertUser, id: randomUUID() };
    db.insert(users).values(user).run();
    return user;
  }

  async seedUsers(): Promise<void> {
    const SEED_USERS = ["jordan", "alex", "jamie", "sam", "taylor", "riley"];
    for (const username of SEED_USERS) {
      const existing = db.select().from(users).where(eq(users.username, username)).get();
      if (!existing) {
        const hashed = await bcrypt.hash("password", 10);
        db.insert(users).values({ id: randomUUID(), username, password: hashed }).run();
      }
    }
  }

  // ── Songs ──────────────────────────────────────────────────────────────────

  async getSongs(bandId: string): Promise<Song[]> {
    return db.select().from(songs).where(eq(songs.bandId, bandId)).orderBy(desc(songs.updatedAt)).all();
  }

  async getSongsWithLastActive(bandId: string, username: string): Promise<Song[]> {
    const songRows = db.select().from(songs).where(eq(songs.bandId, bandId)).all();
    const activityRows = db
      .select({ songId: activityLog.songId, maxTs: max(activityLog.timestamp) })
      .from(activityLog)
      .where(and(eq(activityLog.bandId, bandId), eq(activityLog.author, username)))
      .groupBy(activityLog.songId)
      .all();
    const activityMap = new Map(activityRows.map(r => [r.songId, r.maxTs ?? 0]));
    return songRows.sort((a, b) => {
      const tsA = activityMap.get(a.id) ?? new Date(a.createdAt).getTime();
      const tsB = activityMap.get(b.id) ?? new Date(b.createdAt).getTime();
      return tsB - tsA;
    });
  }

  async getSongById(id: string): Promise<SongWithTracks | undefined> {
    const song = db.select().from(songs).where(eq(songs.id, id)).get();
    if (!song) return undefined;

    const tracks = db
      .select()
      .from(instrumentTracks)
      .where(eq(instrumentTracks.songId, id))
      .orderBy(asc(instrumentTracks.sortOrder))
      .all();

    const allIdeas = tracks.length
      ? db
          .select()
          .from(ideas)
          .where(inArray(ideas.trackId, tracks.map((t) => t.id)))
          .orderBy(asc(ideas.sortOrder))
          .all()
      : [];

    const allClips = allIdeas.length
      ? db
          .select()
          .from(clips)
          .where(inArray(clips.ideaId, allIdeas.map((i) => i.id)))
          .all()
      : [];

    return {
      ...song,
      tracks: tracks.map((track) => ({
        ...track,
        ideas: allIdeas
          .filter((idea) => idea.trackId === track.id)
          .map((idea) => ({
            ...idea,
            clips: allClips.filter((clip) => clip.ideaId === idea.id),
          })),
      })),
    };
  }

  async createSong(data: InsertSong, bandId: string): Promise<Song> {
    const now = new Date().toISOString();
    const song: Song = { bpm: null, timeSignature: "4/4", type: "song", lyrics: null, ...data, bandId, id: randomUUID(), createdAt: now, updatedAt: now };
    db.insert(songs).values(song).run();
    return song;
  }

  async updateSong(id: string, updates: Partial<InsertSong>): Promise<Song | undefined> {
    const existing = db.select().from(songs).where(eq(songs.id, id)).get();
    if (!existing) return undefined;
    db.update(songs).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(songs.id, id)).run();
    return db.select().from(songs).where(eq(songs.id, id)).get();
  }

  // Most of a song's rows go by ON DELETE CASCADE from songs → instrument_tracks →
  // ideas → clips (and their children), but two FKs into those rows have no cascade
  // and would fail the whole delete: loose_files.track_id and
  // bucket_folder_views.idea_id. Clear those first, in the same transaction. A loose
  // file that belongs to a different song (or is band-wide) but points at one of
  // this song's tracks only loses its trackId — it is never deleted with this song.
  // Audio files are unlinked after commit, and only if no other row still uses them.
  // The song-deleted / idea-deleted feed row is written in the same transaction, so a
  // failed delete leaves no row; the name lives only in its text, since the song is gone.
  async deleteSong(id: string, actor: string): Promise<void> {
    const srcs = db.transaction((tx) => {
      const song = tx.select({ name: songs.name, type: songs.type, bandId: songs.bandId })
        .from(songs).where(eq(songs.id, id)).get();
      const trackIds = tx.select({ id: instrumentTracks.id }).from(instrumentTracks)
        .where(eq(instrumentTracks.songId, id)).all().map((t) => t.id);
      const ideaIds = trackIds.length
        ? tx.select({ id: ideas.id }).from(ideas)
            .where(inArray(ideas.trackId, trackIds)).all().map((i) => i.id)
        : [];

      const srcs = new Set<string | null>();
      if (ideaIds.length) {
        for (const c of tx.select({ src: clips.src }).from(clips).where(inArray(clips.ideaId, ideaIds)).all()) srcs.add(c.src);
      }
      if (trackIds.length) {
        for (const c of tx.select({ src: timelineClips.src }).from(timelineClips).where(inArray(timelineClips.trackId, trackIds)).all()) srcs.add(c.src);
      }
      for (const f of tx.select({ src: looseFiles.src }).from(looseFiles).where(eq(looseFiles.songId, id)).all()) srcs.add(f.src);

      if (trackIds.length) {
        tx.delete(looseFiles)
          .where(and(eq(looseFiles.songId, id), inArray(looseFiles.trackId, trackIds))).run();
        tx.update(looseFiles).set({ trackId: null })
          .where(inArray(looseFiles.trackId, trackIds)).run();
      }
      if (ideaIds.length) {
        tx.delete(bucketFolderViews).where(inArray(bucketFolderViews.ideaId, ideaIds)).run();
      }
      tx.delete(songs).where(eq(songs.id, id)).run();
      if (song) {
        const isIdea = song.type === 'idea';
        tx.insert(activityLog).values({
          id: randomUUID(),
          songId: id,
          bandId: song.bandId,
          type: isIdea ? 'idea-deleted' : 'song-deleted',
          description: `${actor} deleted the ${isIdea ? 'Idea' : 'song'} ${song.name}`,
          timestamp: Date.now(),
          author: actor,
        }).run();
      }
      return srcs;
    });
    // Only /uploads/ files — the helper resolves by basename into uploads/, so a
    // /demo/... src must never reach it.
    for (const src of Array.from(srcs)) {
      if (src?.startsWith('/uploads/')) unlinkUploadIfUnreferenced(src, '[deleteSong]');
    }
  }

  async seedSong(songId: string, instruments: string[], sections: string[]): Promise<void> {
    const TRACK_COLORS = [
      "hsl(var(--chart-1))",
      "hsl(var(--chart-2))",
      "hsl(var(--chart-3))",
      "hsl(var(--chart-5))",
      "hsl(var(--chart-4))",
    ];
    for (let ti = 0; ti < instruments.length; ti++) {
      const trackId = randomUUID();
      const trackName = instruments[ti];
      db.insert(instrumentTracks).values({
        id: trackId,
        songId,
        name: trackName,
        type: "audio",
        color: TRACK_COLORS[ti % TRACK_COLORS.length],
        sortOrder: ti,
        active: true,
      }).run();
      for (let si = 0; si < sections.length; si++) {
        db.insert(ideas).values({
          id: randomUUID(),
          trackId,
          name: `${trackName} ${sections[si]}`,
          sectionName: sections[si],
          sortOrder: si,
          active: true,
        }).run();
        insertProductionTaskForSection({ songId, trackId, instrument: trackName, sectionName: sections[si] });
      }
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async bootstrapDefaultSong(): Promise<void> {
    const zenithBand = db.select({ id: bands.id }).from(bands).where(eq(bands.name, "The Zenith Passage")).get();
    const bootstrapBandId = zenithBand?.id ?? null;
    db.insert(songs).values({ ...DEFAULT_SONG, bandId: bootstrapBandId }).onConflictDoNothing().run();
    if (bootstrapBandId) {
      db.update(songs).set({ bandId: bootstrapBandId }).where(and(eq(songs.id, DEFAULT_SONG_ID), isNull(songs.bandId))).run();
    }
    for (const track of DEFAULT_TRACKS) {
      const existing = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, track.id)).get();
      if (!existing) {
        db.insert(instrumentTracks).values(track).run();
      } else if (!existing.active) {
        continue;
      }
      DEFAULT_SECTIONS.forEach((section, i) => {
        const deleted = db.select().from(deletedSections)
          .where(and(
            eq(deletedSections.songId, DEFAULT_SONG_ID),
            eq(deletedSections.sectionName, section)
          )).get();
        if (!deleted) {
          db.insert(ideas).values({
            id: defaultIdeaId(track.id, i),
            trackId: track.id,
            name: `${track.name} ${section}`,
            sectionName: section,
            sortOrder: i,
          }).onConflictDoNothing().run();
          insertProductionTaskForSection({ songId: DEFAULT_SONG_ID, trackId: track.id, instrument: track.name, sectionName: section, sectionIndex: i });
        }
      });
    }
  }

  // ── Timeline ───────────────────────────────────────────────────────────────

  async getTimelineTracks(songId: string): Promise<TrackWithTimelineClips[]> {
    const tracks = db
      .select()
      .from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .orderBy(asc(instrumentTracks.sortOrder))
      .all();

    if (!tracks.length) return [];

    const allClips = db
      .select()
      .from(timelineClips)
      .where(inArray(timelineClips.trackId, tracks.map((t) => t.id)))
      .all();

    return tracks.map((track) => ({
      ...track,
      timelineClips: allClips.filter((c) => c.trackId === track.id),
    }));
  }

  async addTimelineClip(trackId: string, data: InsertTimelineClip): Promise<TimelineClip> {
    db.insert(timelineClips).values({ ...data, trackId }).run();
    return db.select().from(timelineClips).where(eq(timelineClips.id, data.id)).get()!;
  }

  async updateTimelineClip(id: string, updates: Partial<InsertTimelineClip>): Promise<TimelineClip | undefined> {
    const existing = db.select().from(timelineClips).where(eq(timelineClips.id, id)).get();
    if (!existing) return undefined;
    db.update(timelineClips).set(updates).where(eq(timelineClips.id, id)).run();
    return db.select().from(timelineClips).where(eq(timelineClips.id, id)).get();
  }

  async deleteTimelineClip(id: string): Promise<void> {
    db.delete(timelineClips).where(eq(timelineClips.id, id)).run();
  }

  // ── Bucket ─────────────────────────────────────────────────────────────────

  async getBucket(songId: string, userId?: string): Promise<BucketTrack[]> {
    const tracks = db
      .select()
      .from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .orderBy(asc(instrumentTracks.sortOrder))
      .all();

    if (!tracks.length) return [];

    const allIdeas = db
      .select()
      .from(ideas)
      .where(and(
        inArray(ideas.trackId, tracks.map((t) => t.id)),
        eq(ideas.active, true)
      ))
      .orderBy(asc(ideas.sortOrder))
      .all();

    const allClips = allIdeas.length
      ? db
          .select()
          .from(clips)
          .where(and(inArray(clips.ideaId, allIdeas.map((i) => i.id)), eq(clips.active, true)))
          .all()
      : [];

    // Build a viewedAt map for this user so we can compute hasNew per idea.
    const viewMap = new Map<string, string>(); // ideaId → viewedAt ISO string
    if (userId && allIdeas.length) {
      const viewRows = db
        .select({ ideaId: bucketFolderViews.ideaId, viewedAt: bucketFolderViews.viewedAt })
        .from(bucketFolderViews)
        .where(and(
          eq(bucketFolderViews.userId, userId),
          inArray(bucketFolderViews.ideaId, allIdeas.map((i) => i.id))
        ))
        .all();
      for (const row of viewRows) viewMap.set(row.ideaId, row.viewedAt);
    }

    // Track-scoped loose files (trackId set, resting below the Section list — see
    // loose_files in root CLAUDE.md) count toward "this track has content" for the
    // Tracks-column folder icon, same as an organized clip does.
    const trackIdsWithLooseFiles = new Set(
      db.select({ trackId: looseFiles.trackId })
        .from(looseFiles)
        .where(inArray(looseFiles.trackId, tracks.map((t) => t.id)))
        .all()
        .map((row) => row.trackId)
    );

    return tracks.map((track) => ({
      ...track,
      hasLooseFiles: trackIdsWithLooseFiles.has(track.id),
      ideas: allIdeas
        .filter((idea) => idea.trackId === track.id)
        .map((idea) => {
          const ideaClips = allClips.filter((clip) => clip.ideaId === idea.id);
          let hasNew = false;
          if (userId) {
            const viewedAt = viewMap.get(idea.id);
            if (!viewedAt) {
              // No view row — treat as epoch: new if any clips exist.
              hasNew = ideaClips.length > 0;
            } else {
              hasNew = ideaClips.some((clip) => clip.createdAt > viewedAt);
            }
          }
          return { ...idea, clips: ideaClips, hasNew };
        }),
    }));
  }

  upsertFolderView(userId: string, ideaId: string): void {
    db.insert(bucketFolderViews)
      .values({ id: randomUUID(), userId, ideaId, viewedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [bucketFolderViews.userId, bucketFolderViews.ideaId],
        set: { viewedAt: new Date().toISOString() },
      })
      .run();
  }

  // Idea-type songs have no Folder/Instrument concept in the UI — every Idea
  // gets exactly one instrument_tracks + ideas row, created automatically and
  // never surfaced, so its clips have somewhere to live. Called at idea
  // creation and defensively on every bucket fetch so a legacy idea (created
  // before this existed) is backfilled lazily rather than needing a migration.
  async ensureIdeaDefaultFolder(songId: string): Promise<{ trackId: string; sectionName: string } | undefined> {
    const song = db.select().from(songs).where(eq(songs.id, songId)).get();
    if (!song || song.type !== 'idea') return undefined;

    let track = db.select().from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .orderBy(asc(instrumentTracks.sortOrder))
      .get();
    if (!track) {
      const trackId = randomUUID();
      db.insert(instrumentTracks).values({
        id: trackId,
        songId,
        name: 'Files',
        type: 'audio',
        color: 'hsl(var(--chart-1))',
        sortOrder: 0,
        active: true,
      }).run();
      track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, trackId)).get()!;
    }

    let idea = db.select().from(ideas)
      .where(and(eq(ideas.trackId, track.id), eq(ideas.active, true)))
      .orderBy(asc(ideas.sortOrder))
      .get();
    if (!idea) {
      const ideaId = randomUUID();
      db.insert(ideas).values({
        id: ideaId,
        trackId: track.id,
        name: 'Files',
        sectionName: 'Files',
        sortOrder: 0,
        active: true,
      }).run();
      idea = db.select().from(ideas).where(eq(ideas.id, ideaId)).get()!;
    }

    return { trackId: track.id, sectionName: idea.sectionName };
  }

  // ── Tracks ─────────────────────────────────────────────────────────────────

  async createTrack(data: InsertInstrumentTrack): Promise<InstrumentTrack> {
    db.insert(instrumentTracks).values(data).run();
    const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, data.id)).get()!;
    // Create one idea and one production task per section that currently exists in
    // the song — derived from active ideas on other active tracks rather than the
    // hardcoded DEFAULT_SECTIONS list, so user-added sections are included.
    const activeSections = db
      .select({
        sectionName: ideas.sectionName,
        minOrder: min(ideas.sortOrder),
      })
      .from(ideas)
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .where(and(
        eq(instrumentTracks.songId, track.songId),
        eq(instrumentTracks.active, true),
        eq(ideas.active, true),
        eq(ideas.isFullTake, false),
      ))
      .groupBy(ideas.sectionName)
      .orderBy(asc(min(ideas.sortOrder)))
      .all();

    for (let i = 0; i < activeSections.length; i++) {
      const { sectionName } = activeSections[i];
      if (!sectionName) continue;
      await this.createIdea({
        id: randomUUID(),
        trackId: track.id,
        name: `${track.name} ${sectionName}`,
        sectionName,
        sortOrder: i,
      });
      insertProductionTaskForSection({ songId: track.songId, trackId: track.id, instrument: track.name, sectionName, sectionIndex: i });
    }
    return track;
  }

  async updateTrack(trackId: string, updates: { volume?: number; pan?: number }): Promise<InstrumentTrack | undefined> {
    db.update(instrumentTracks).set(updates).where(eq(instrumentTracks.id, trackId)).run();
    return db.select().from(instrumentTracks).where(eq(instrumentTracks.id, trackId)).get();
  }

  async deleteTrack(trackId: string): Promise<void> {
    db.delete(instrumentTracks).where(eq(instrumentTracks.id, trackId)).run();
  }

  async hideTrack(trackId: string): Promise<void> {
    db.delete(timelineClips).where(eq(timelineClips.trackId, trackId)).run();
    db.update(instrumentTracks).set({ active: false }).where(eq(instrumentTracks.id, trackId)).run();
  }

  async restoreTrack(trackId: string): Promise<void> {
    db.update(instrumentTracks).set({ active: true }).where(eq(instrumentTracks.id, trackId)).run();
  }

  async getHiddenTracks(songId: string): Promise<InstrumentTrack[]> {
    return db.select().from(instrumentTracks)
      .where(and(
        eq(instrumentTracks.songId, songId),
        eq(instrumentTracks.active, false)
      )).all();
  }

  async deleteSection(songId: string, sectionName: string): Promise<void> {
    console.log('[storage deleteSection] songId:', songId, 'sectionName:', sectionName);
    const songTracks = db.select().from(instrumentTracks)
      .where(eq(instrumentTracks.songId, songId)).all();
    console.log('[storage deleteSection] songTracks.length:', songTracks.length);
    if (!songTracks.length) return;
    const trackIds = songTracks.map(t => t.id);
    db.delete(ideas)
      .where(and(
        inArray(ideas.trackId, trackIds),
        eq(ideas.sectionName, sectionName)
      )).run();
    db.insert(deletedSections)
      .values({ songId, sectionName })
      .onConflictDoNothing().run();
  }

  // ── Ideas ──────────────────────────────────────────────────────────────────

  async hideIdea(ideaId: string): Promise<void> {
    const idea = db.select().from(ideas).where(eq(ideas.id, ideaId)).get();
    if (!idea) return;
    db.delete(timelineClips)
      .where(and(
        eq(timelineClips.trackId, idea.trackId),
        eq(timelineClips.sectionName, idea.sectionName)
      )).run();
    db.update(ideas).set({ active: false }).where(eq(ideas.id, ideaId)).run();
  }

  async restoreIdea(ideaId: string): Promise<void> {
    db.update(ideas).set({ active: true }).where(eq(ideas.id, ideaId)).run();
  }

  async getHiddenIdeas(trackId: string): Promise<Idea[]> {
    return db.select().from(ideas)
      .where(and(
        eq(ideas.trackId, trackId),
        eq(ideas.active, false),
        eq(ideas.isFullTake, false),
      )).all();
  }

  async createIdea(data: InsertIdea): Promise<Idea> {
    const idea: Idea = { sortOrder: 0, active: true, isFullTake: false, ...data, id: data.id ?? randomUUID() };
    db.insert(ideas).values(idea).run();
    return db.select().from(ideas).where(eq(ideas.id, idea.id)).get()!;
  }

  // ── Clips (bucket versions) ────────────────────────────────────────────────

  // A real-song upload is named by landingClipName in the same transaction as the
  // insert, whatever name the client sent.
  async createClip(data: InsertClip): Promise<Clip> {
    const now = new Date().toISOString();
    return db.transaction((tx) => {
      const landed = landingClipName(tx, data.ideaId, data.name, data.metadata ?? null);
      const clip: Clip = {
        start: 0,
        isFinal: false,
        active: true,
        src: null,
        sectionName: null,
        addedToSongs: null,
        ...data,
        id: data.id ?? randomUUID(),
        name: landed.name,
        metadata: landed.metadata,
        createdAt: now,
      };
      tx.insert(clips).values(clip).run();
      return tx.select().from(clips).where(eq(clips.id, clip.id)).get()!;
    });
  }

  async countClipsForIdea(ideaId: string): Promise<number> {
    const result = db
      .select({ value: count() })
      .from(clips)
      .where(eq(clips.ideaId, ideaId))
      .get();
    return result?.value ?? 0;
  }

  async updateClip(clipId: string, updates: Partial<InsertClip>): Promise<Clip | undefined> {
    const existing = db.select().from(clips).where(eq(clips.id, clipId)).get();
    if (!existing) return undefined;
    db.update(clips).set(updates).where(eq(clips.id, clipId)).run();
    return db.select().from(clips).where(eq(clips.id, clipId)).get();
  }

  async syncFinalClipFromTimeline(trackId: string, sectionName: string, clipName: string, isFinal: boolean): Promise<void> {
    const idea = db.select().from(ideas)
      .where(and(eq(ideas.trackId, trackId), eq(ideas.sectionName, sectionName)))
      .get();
    if (!idea) return;

    const ideaClips = db.select().from(clips).where(eq(clips.ideaId, idea.id)).all();
    if (!ideaClips.length) return;

    if (isFinal) {
      // Set isFinal on the clip whose name matches clipName, fall back to most recently created.
      // No blanket clearing — multiple differently-named clips in the same idea can all be final.
      const matchedClip = ideaClips.find(c => c.name === clipName)
        ?? ideaClips.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      db.update(clips).set({ isFinal: true }).where(eq(clips.id, matchedClip.id)).run();
    } else {
      // Only clear the bucket clip matching clipName — don't clear clips with different names.
      // Prevents wiping a legitimately-final clip when a stale timeline clip is unmarked.
      const clipToUnmark = ideaClips.find(c => c.name === clipName && c.isFinal);
      if (clipToUnmark) {
        db.update(clips).set({ isFinal: false }).where(eq(clips.id, clipToUnmark.id)).run();
      }
    }
  }

  async timelineHasFinals(songId: string): Promise<boolean> {
    const songTracks = db.select().from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .all();
    if (!songTracks.length) return false;
    const trackIds = songTracks.map(t => t.id);
    const finalClip = db.select().from(timelineClips)
      .where(and(inArray(timelineClips.trackId, trackIds), eq(timelineClips.isFinal, true)))
      .get();
    return !!finalClip;
  }

  async deleteNonFinalTimelineClips(songId: string): Promise<void> {
    const songTracks = db.select().from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .all();
    if (!songTracks.length) return;
    const trackIds = songTracks.map(t => t.id);

    const allClips = db.select().from(timelineClips)
      .where(inArray(timelineClips.trackId, trackIds))
      .all();

    db.delete(timelineClips)
      .where(and(inArray(timelineClips.trackId, trackIds), eq(timelineClips.isFinal, false)))
      .run();

    const finals = allClips.filter(c => c.isFinal);
    if (!finals.length) return;

    // Infer section order from existing start values (smallest clip start per section).
    const sectionMinStart: Record<string, number> = {};
    for (const clip of finals) {
      if (!clip.sectionName) continue;
      if (!(clip.sectionName in sectionMinStart) || clip.start < sectionMinStart[clip.sectionName]) {
        sectionMinStart[clip.sectionName] = clip.start;
      }
    }
    const sections = Object.keys(sectionMinStart).sort((a, b) => sectionMinStart[a] - sectionMinStart[b]);

    // Section width = max total final-clip duration across all tracks for that section.
    const MIN_SECTION_WIDTH = 4;
    const sectionWidths: Record<string, number> = {};
    for (const section of sections) {
      sectionWidths[section] = MIN_SECTION_WIDTH;
      for (const trackId of trackIds) {
        const total = finals
          .filter(c => c.trackId === trackId && c.sectionName === section)
          .reduce((sum, c) => sum + c.duration, 0);
        if (total > sectionWidths[section]) sectionWidths[section] = total;
      }
    }

    // Compute absolute section starts.
    const sectionStarts: Record<string, number> = {};
    let cursor = 0;
    for (const section of sections) {
      sectionStarts[section] = cursor;
      cursor += sectionWidths[section];
    }

    // Recompute each final clip's start and write to DB.
    for (const trackId of trackIds) {
      for (const section of sections) {
        const trackSectionClips = finals
          .filter(c => c.trackId === trackId && c.sectionName === section)
          .sort((a, b) => a.start - b.start);
        let pos = sectionStarts[section];
        for (const clip of trackSectionClips) {
          if (clip.start !== pos) {
            db.update(timelineClips).set({ start: pos }).where(eq(timelineClips.id, clip.id)).run();
          }
          pos += clip.duration;
        }
      }
    }
  }

  // ── Loose Files (song-scoped, unplaced uploads) ──────────────────────────────

  async createLooseFile(data: InsertLooseFile): Promise<LooseFile> {
    const now = new Date().toISOString();
    const looseFile: LooseFile = {
      songId: null,
      bandId: null,
      trackId: null,
      src: null,
      metadata: null,
      uploadedBy: null,
      addedToSongs: null,
      ...data,
      id: data.id ?? randomUUID(),
      createdAt: now,
    };
    db.insert(looseFiles).values(looseFile).run();
    return db.select().from(looseFiles).where(eq(looseFiles.id, looseFile.id)).get()!;
  }

  // Excludes files that have moved to the Track-scoped tier (trackId set) — those
  // display only in that Track's Sections column now, via getLooseFilesByTrack.
  async getLooseFilesBySong(songId: string, viewerUsername: string | null): Promise<LooseFileWithCommentCount[]> {
    return selectLooseFilesWithCommentCounts(and(eq(looseFiles.songId, songId), isNull(looseFiles.trackId)), viewerUsername);
  }

  // Band-wide, unassigned loose files (songId IS NULL) — Ideas shelf Column 1's
  // "Upload Files". Never assigned to a song until a user drags one onto an Idea.
  async getLooseFilesByBand(bandId: string, viewerUsername: string | null): Promise<LooseFileWithCommentCount[]> {
    return selectLooseFilesWithCommentCounts(and(isNull(looseFiles.songId), eq(looseFiles.bandId, bandId)), viewerUsername);
  }

  // Track-scoped loose files — the "I know the track, not yet the section" resting
  // state. Rendered in that Track's own Sections column, sorted below the Section
  // list, until organized into a real clip (which clears the row entirely).
  async getLooseFilesByTrack(trackId: string, viewerUsername: string | null): Promise<LooseFileWithCommentCount[]> {
    return selectLooseFilesWithCommentCounts(eq(looseFiles.trackId, trackId), viewerUsername);
  }

  // Moves a song-scoped loose file into the Track-scoped tier — drag onto a Track
  // row (not a Section row) in MediaBucket's Tracks column. Does not materialize
  // anything; the row stays in loose_files, just with trackId now set. A null
  // trackId un-assigns — the file drops back to the plain song-scoped tier.
  async assignLooseFileTrack(id: string, trackId: string | null): Promise<LooseFile> {
    db.update(looseFiles).set({ trackId }).where(eq(looseFiles.id, id)).run();
    return db.select().from(looseFiles).where(eq(looseFiles.id, id)).get()!;
  }

  async updateLooseFileMetadata(id: string, metadata: LooseFile['metadata']): Promise<LooseFile> {
    db.update(looseFiles).set({ metadata }).where(eq(looseFiles.id, id)).run();
    return db.select().from(looseFiles).where(eq(looseFiles.id, id)).get()!;
  }

  async getLooseFile(id: string): Promise<LooseFile | undefined> {
    return db.select().from(looseFiles).where(eq(looseFiles.id, id)).get();
  }

  async deleteLooseFile(id: string): Promise<void> {
    const looseFile = db.select().from(looseFiles).where(eq(looseFiles.id, id)).get();
    db.delete(looseFiles).where(eq(looseFiles.id, id)).run();
    // Best-effort: the DB row is the source of truth and is already gone above.
    if (looseFile?.src) unlinkUploadIfUnreferenced(looseFile.src, '[deleteLooseFile]');
  }

  // Ideas shelf "Delete": permanently remove an organized clip from an idea-type song.
  // One transaction deletes the row (clip_comments cascade); the physical file is
  // unlinked after commit, and only if nothing else still references its src.
  async deleteIdeaClip(clipId: string): Promise<Clip> {
    const deleted = db.transaction((tx) => {
      const row = tx.select({ clip: clips, songType: songs.type })
        .from(clips)
        .innerJoin(ideas, eq(clips.ideaId, ideas.id))
        .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
        .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
        .where(eq(clips.id, clipId))
        .get();
      if (!row) throw new ClipNotDeletableError("File not found.");
      if (row.songType !== 'idea') throw new ClipNotDeletableError("Files in a song can't be deleted. Use Remove instead.");
      // Idea clips never carry these today; refuse rather than bypass the isFinal/timeline sync.
      if (row.clip.isFinal) throw new ClipNotDeletableError("A file marked final can't be deleted.");
      const placed = tx.select({ id: timelineClips.id }).from(timelineClips)
        .where(eq(timelineClips.bucketClipId, clipId)).get();
      if (placed) throw new ClipNotDeletableError("This file is placed on a timeline and can't be deleted.");
      tx.delete(clips).where(eq(clips.id, clipId)).run();
      return row.clip;
    });
    if (deleted.src) unlinkUploadIfUnreferenced(deleted.src, '[deleteIdeaClip]');
    return deleted;
  }

  async materializeLooseFile(looseFileId: string, trackId: string, sectionName: string): Promise<Clip> {
    return db.transaction((tx) => materializeLooseFileCore(tx, looseFileId, trackId, sectionName));
  }

  // Ideas shelf: move an organized clip from one idea-type song to another. A pure
  // re-parent — only ideaId/sectionName change; id, name, src, metadata, createdAt and
  // addedToSongs stay, so notes (keyed on clips.id) and the physical file come along
  // untouched. Idea-type clips never have timeline_clips, production tasks or isFinal
  // (enforced by the route, which only accepts idea-type songs on both ends), so there
  // is nothing in the isFinal/timeline/task sync to reconcile.
  async moveClipToIdea(clipId: string, destSongId: string): Promise<Clip> {
    const dest = await this.ensureIdeaDefaultFolder(destSongId);
    if (!dest) throw new Error(`[moveClipToIdea] destination ${destSongId} is not an idea-type song`);
    return db.transaction((tx) => {
      const destIdea = tx.select().from(ideas)
        .where(and(eq(ideas.trackId, dest.trackId), eq(ideas.sectionName, dest.sectionName)))
        .get();
      if (!destIdea) {
        throw new Error(`[moveClipToIdea] no idea row for trackId=${dest.trackId} sectionName=${JSON.stringify(dest.sectionName)}`);
      }
      tx.update(clips)
        .set({ ideaId: destIdea.id, sectionName: destIdea.sectionName })
        .where(eq(clips.id, clipId))
        .run();
      const moved = tx.select().from(clips).where(eq(clips.id, clipId)).get();
      if (!moved) throw new Error(`[moveClipToIdea] clip ${clipId} not found`);
      return moved;
    });
  }

  // Ideas shelf: drop an organized clip on Column 1's empty space — it becomes a
  // band-wide loose file again. See dematerializeClipToBandLoose.
  async makeClipLoose(clipId: string, bandId: string): Promise<LooseFile> {
    return db.transaction((tx) => dematerializeClipToBandLoose(tx, clipId, bandId));
  }

  // What would fall off if this version left its section — see ClipDependents.
  // The task entry uses the same rule the route applies afterwards, counting the
  // section's other active versions.
  async getClipDependents(clipId: string): Promise<ClipDependents | undefined> {
    const row = db.select({ clip: clips, idea: ideas })
      .from(clips).innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .where(eq(clips.id, clipId)).get();
    if (!row) return undefined;
    const timelineCopies = db.select({
      id: timelineClips.id, trackName: instrumentTracks.name,
      sectionName: timelineClips.sectionName, start: timelineClips.start,
    })
      .from(timelineClips).innerJoin(instrumentTracks, eq(timelineClips.trackId, instrumentTracks.id))
      .where(eq(timelineClips.bucketClipId, clipId))
      .orderBy(asc(timelineClips.start)).all();
    const tasks: ClipDependents['tasks'] = [];
    const task = await this.getTaskByTrackSection(row.idea.trackId, row.idea.sectionName);
    if (task) {
      const othersLeft = db.select({ value: count() }).from(clips)
        .where(and(eq(clips.ideaId, row.idea.id), eq(clips.active, true), ne(clips.id, clipId)))
        .get()?.value ?? 0;
      const anyRemainingFinal = await this.hasActiveFinalClipInIdea(row.idea.id, clipId);
      tasks.push({
        taskId: task.id,
        sectionName: task.sectionName,
        status: task.status as TaskStatus,
        willChangeTo: taskStatusAfterVersionLeaves(task.status as TaskStatus, othersLeft, row.clip.isFinal, anyRemainingFinal),
      });
    }
    return { timelineCopies, isFinal: row.clip.isFinal, tasks };
  }

  // Bucket Remove: release what depends on the version, then soft-remove it
  // (active = false), in one transaction. The task recompute is the caller's.
  async removeClip(clipId: string): Promise<Clip | undefined> {
    return db.transaction((tx) => {
      if (!tx.select({ id: clips.id }).from(clips).where(eq(clips.id, clipId)).get()) return undefined;
      releaseClipDependencies(tx, clipId);
      tx.update(clips).set({ active: false }).where(eq(clips.id, clipId)).run();
      return tx.select().from(clips).where(eq(clips.id, clipId)).get();
    });
  }

  // production_tasks is unique per (trackId, sectionName) — keyed by id, not track name.
  async getTaskByTrackSection(trackId: string, sectionName: string): Promise<ProductionTask | undefined> {
    return db.select().from(productionTasks)
      .where(and(eq(productionTasks.trackId, trackId), eq(productionTasks.sectionName, sectionName)))
      .get();
  }

  // Whether any active version in the section (other than excludeClipId) is Final.
  async hasActiveFinalClipInIdea(ideaId: string, excludeClipId?: string): Promise<boolean> {
    return !!db.select({ id: clips.id }).from(clips)
      .where(and(
        eq(clips.ideaId, ideaId),
        eq(clips.active, true),
        eq(clips.isFinal, true),
        excludeClipId ? ne(clips.id, excludeClipId) : undefined,
      ))
      .get();
  }

  // Active clips created at or after sinceIso, across the band's songs and Ideas.
  // createdAt is an ISO 8601 UTC string, so string comparison orders correctly.
  async countClipsCreatedSince(bandId: string, sinceIso: string): Promise<number> {
    return db.select({ value: count() }).from(clips)
      .innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
      .where(and(eq(songs.bandId, bandId), eq(clips.active, true), gte(clips.createdAt, sinceIso)))
      .get()?.value ?? 0;
  }

  async countActiveClipsForIdea(ideaId: string): Promise<number> {
    return db.select({ value: count() }).from(clips)
      .where(and(eq(clips.ideaId, ideaId), eq(clips.active, true)))
      .get()?.value ?? 0;
  }

  async materializeLooseFileToTimeline(
    looseFileId: string,
    trackId: string,
    sectionName: string
  ): Promise<{ clip: Clip; timelineClip: TimelineClip }> {
    return db.transaction((tx) => {
      const clip = materializeLooseFileCore(tx, looseFileId, trackId, sectionName);

      // Append after the last existing clip in this track's section — mirrors the
      // client's insertClipInSection append behavior, scoped to this one track/section
      // (not a full cross-track recalcAllStarts, which is a client-side concern).
      const sectionClips = tx.select().from(timelineClips)
        .where(and(eq(timelineClips.trackId, trackId), eq(timelineClips.sectionName, sectionName)))
        .all();
      const start = sectionClips.length
        ? Math.max(...sectionClips.map((c) => c.start + (c.trimEnd ?? c.duration) - c.trimStart))
        : 0;

      const timelineClip: TimelineClip = {
        id: randomUUID(),
        trackId,
        name: clip.name,
        type: clip.type,
        color: clip.color,
        start,
        duration: clip.duration,
        src: clip.src,
        sectionName,
        isFinal: false,
        trimStart: 0,
        trimEnd: null,
        bucketClipId: clip.id,
        isFullTake: false,
      };
      tx.insert(timelineClips).values(timelineClip).run();

      return { clip, timelineClip };
    });
  }

  // ── Production Tasks ───────────────────────────────────────────────────────

  async getActivity(bandId: string, songId?: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    const bandCond = eq(songs.bandId, bandId);
    const clipSongCond = songId ? and(eq(songs.id, songId), bandCond) : bandCond;

    // Clips: file-added
    const clipRows = db
      .select({
        clipId: clips.id,
        clipName: clips.name,
        isFinal: clips.isFinal,
        createdAt: clips.createdAt,
        sectionName: clips.sectionName,
        trackName: instrumentTracks.name,
        songId: songs.id,
        songName: songs.name,
        songType: songs.type,
        metadata: clips.metadata,
      })
      .from(clips)
      .innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
      .where(clipSongCond)
      .all();

    // A clip created by organizing or placing a loose file already has its own row
    // ('loose-file-organized' / 'loose-file-placed'); the clip-built "added" row would
    // repeat it. Newer log rows carry the clip id. Older ones don't, so they're matched
    // strictly: same song, track and section, the clip's own name in the text, and
    // logged within 2s of the clip's createdAt (both are written in the same request —
    // existing data matches 1:1, at most 8ms apart).
    const looseLandingRows = db
      .select({
        clipId: activityLog.clipId,
        type: activityLog.type,
        description: activityLog.description,
        timestamp: activityLog.timestamp,
        instrument: activityLog.instrument,
        sectionName: activityLog.sectionName,
        songId: activityLog.songId,
      })
      .from(activityLog)
      .innerJoin(songs, eq(activityLog.songId, songs.id))
      .where(and(clipSongCond, inArray(activityLog.type, ['loose-file-organized', 'loose-file-placed'])))
      .all();
    const clipsWithOwnRow = new Set(looseLandingRows.flatMap((r) => (r.clipId ? [r.clipId] : [])));
    const legacyLandingRows = new Map<string, typeof looseLandingRows>();
    for (const r of looseLandingRows) {
      if (r.clipId) continue;
      const key = `${r.songId}|${r.instrument}|${r.sectionName}`;
      legacyLandingRows.set(key, [...(legacyLandingRows.get(key) ?? []), r]);
    }
    const hasOwnLandingRow = (clipId: string, songId: string, track: string, section: string | null, name: string, ts: number) =>
      clipsWithOwnRow.has(clipId) ||
      (legacyLandingRows.get(`${songId}|${track}|${section}`) ?? []).some((r) =>
        Math.abs(r.timestamp - ts) <= 2000 &&
        (r.description.includes(` organized ${name} into `) || r.description.includes(` placed ${name} on the timeline `))
      );

    for (const row of clipRows) {
      const ts = new Date(row.createdAt).getTime();
      if (hasOwnLandingRow(row.clipId, row.songId, row.trackName, row.sectionName, row.clipName, ts)) continue;
      const uploader = row.metadata?.uploadedBy || 'Someone';
      // Idea-type songs have exactly one hidden, auto-created track/section (both
      // literally named "Files" — see ensureIdeaDefaultFolder). Naming it here would
      // just read as "added X to Files — Files", which is meaningless to the user.
      const description = row.songType === 'idea'
        ? `${uploader} added ${row.clipName} to ${row.songName}`
        : `${uploader} added ${row.clipName} to ${row.trackName}${row.sectionName ? ` — ${row.sectionName}` : ''}`;
      events.push({
        type: 'file-added',
        description,
        timestamp: ts,
        songId: row.songId,
        songName: row.songName,
        instrument: row.trackName,
        sectionName: row.sectionName ?? undefined,
      });
    }

    // Clip comments (top-level only). Carried rows (moved in on organize, or copied by
    // copy-from) are skipped — they were already surfaced when first posted, and a copy
    // would otherwise produce a duplicate "commented on" row per destination.
    const clipCommentBaseCond = and(isNull(clipComments.parentId), isNull(clipComments.carriedFromCommentId));
    const clipCommentCond = songId
      ? and(eq(songs.id, songId), bandCond, clipCommentBaseCond)
      : and(bandCond, clipCommentBaseCond);
    const clipCommentRows = db
      .select({
        clipId: clipComments.clipId,
        author: clipComments.author,
        timestamp: clipComments.timestamp,
        sectionName: clips.sectionName,
        trackName: instrumentTracks.name,
        songId: songs.id,
        songName: songs.name,
      })
      .from(clipComments)
      .innerJoin(clips, eq(clipComments.clipId, clips.id))
      .innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
      .where(clipCommentCond)
      .all();

    for (const row of clipCommentRows) {
      const displayAuthor = row.author === 'Unknown' ? 'You' : row.author;
      events.push({
        type: 'clip-comment',
        description: `${displayAuthor} commented on ${row.trackName} · ${row.sectionName ?? ''}`,
        timestamp: row.timestamp,
        songId: row.songId,
        songName: row.songName,
        instrument: row.trackName,
        sectionName: row.sectionName ?? undefined,
        source: 'clip',
        clipId: row.clipId,
      });
    }

    // Task comments (human comments + system status-change events)
    const taskCommentCond = songId
      ? and(eq(songs.id, songId), bandCond, isNull(taskComments.parentId))
      : and(bandCond, isNull(taskComments.parentId));
    const taskCommentRows = db
      .select({
        author: taskComments.author,
        text: taskComments.text,
        timestamp: taskComments.timestamp,
        taskId: productionTasks.id,
        instrument: productionTasks.instrument,
        sectionName: productionTasks.sectionName,
        songId: songs.id,
        songName: songs.name,
      })
      .from(taskComments)
      .innerJoin(productionTasks, eq(taskComments.taskId, productionTasks.id))
      .innerJoin(songs, eq(productionTasks.songId, songs.id))
      .where(taskCommentCond)
      .all();

    for (const row of taskCommentRows) {
      if (row.text.startsWith('Status changed to ')) {
        // Now covered by a real activity_log row ('task-status-change') written at mutation time.
        continue;
      } else if (row.text.startsWith('Clip marked as final:')) {
        // Now covered by a real activity_log row ('marked-final') written at mutation time.
        continue;
      } else if (
        row.text.startsWith('All clips marked final') ||
        row.text.startsWith('Clip state changed') ||
        row.text.startsWith('Clips unmarked as final')
      ) {
        // Automatic comments: reconcileSectionTaskStatus's complete/revert notes and the
        // Production tab's Complete / revert-from-Complete notes. The status change itself
        // already has an activity_log row. Now authored 'System', but older rows carry a
        // user's name and would otherwise read as "{user} commented on … task".
        continue;
      } else if (row.text.startsWith('Clip unmarked as final:')) {
        const unmatchResult = row.text.match(/^Clip unmarked as final: "([^"]+)"/);
        const unmarkName = unmatchResult ? unmatchResult[1] : 'clip';
        const actor = (!row.author || row.author === 'System' || row.author === 'Unknown') ? 'Someone' : row.author;
        events.push({
          type: 'clip-unmarked-final',
          description: `${actor} unmarked ${unmarkName} as final`,
          timestamp: row.timestamp,
          songId: row.songId,
          songName: row.songName,
          taskId: row.taskId,
          instrument: row.instrument,
          sectionName: row.sectionName,
        });
      } else if (row.text.startsWith('Clip replaced:')) {
        const replaceMatch = row.text.match(/^Clip replaced: "(.+)" → "(.+)"$/);
        if (replaceMatch) {
          const [, oldName, newName] = replaceMatch;
          const actor = (!row.author || row.author === 'System' || row.author === 'Unknown') ? 'Someone' : row.author;
          events.push({
            type: 'clip-replaced',
            description: `${actor} replaced ${oldName} with ${newName} in ${row.instrument} — ${row.sectionName}`,
            timestamp: row.timestamp,
            songId: row.songId,
            songName: row.songName,
            taskId: row.taskId,
            instrument: row.instrument,
            sectionName: row.sectionName,
          });
        }
      } else if (row.text.startsWith('Clip added to timeline:')) {
        const addMatch = row.text.match(/^Clip added to timeline: "([^"]+)"$/);
        const addName = addMatch ? addMatch[1] : 'clip';
        const actor = (!row.author || row.author === 'System' || row.author === 'Unknown') ? 'Someone' : row.author;
        events.push({
          type: 'clip-added-to-timeline',
          description: `${actor} added ${addName} to ${row.instrument} — ${row.sectionName}`,
          timestamp: row.timestamp,
          songId: row.songId,
          songName: row.songName,
          taskId: row.taskId,
          instrument: row.instrument,
          sectionName: row.sectionName,
        });
      } else if (row.author === 'System') {
        continue;
      } else if (/^(Due date set to |Due date removed$|Assignee set to |Assignee removed$)/.test(row.text)) {
        // Task edits recorded as comments by PATCH /api/production-tasks/:id — shown as
        // the action, not as "commented on". Mapped here so existing rows read the same.
        const who = row.author === 'Unknown' ? 'You' : row.author;
        const where = `${row.instrument} · ${row.sectionName}`;
        const description =
          row.text.startsWith('Due date set to ') ? `${who} set the due date for ${where} to ${row.text.slice('Due date set to '.length)}`
          : row.text === 'Due date removed' ? `${who} cleared the due date for ${where}`
          : row.text.startsWith('Assignee set to ') ? `${who} assigned ${where} to ${row.text.slice('Assignee set to '.length)}`
          : `${who} unassigned ${where}`;
        events.push({
          type: 'task-comment',
          description,
          timestamp: row.timestamp,
          songId: row.songId,
          songName: row.songName,
          taskId: row.taskId,
          instrument: row.instrument,
          sectionName: row.sectionName,
          source: 'task',
        });
      } else if (!row.text.startsWith('Clip unmarked as final')) {
        const displayAuthor = row.author === 'Unknown' ? 'You' : row.author;
        events.push({
          type: 'task-comment',
          description: `${displayAuthor} commented on ${row.instrument} · ${row.sectionName} task`,
          timestamp: row.timestamp,
          songId: row.songId,
          songName: row.songName,
          taskId: row.taskId,
          instrument: row.instrument,
          sectionName: row.sectionName,
          source: 'task',
        });
      }
    }

    // Reviews: review-shared
    const reviewCond = songId ? and(eq(songReviews.songId, songId), bandCond) : bandCond;
    const reviewRows = db
      .select({
        reviewId: songReviews.id,
        name: songReviews.name,
        createdBy: songReviews.createdBy,
        createdAt: songReviews.createdAt,
        songId: songs.id,
        songName: songs.name,
      })
      .from(songReviews)
      .innerJoin(songs, eq(songReviews.songId, songs.id))
      .where(reviewCond)
      .all();

    for (const row of reviewRows) {
      events.push({
        type: 'review-shared',
        description: `${row.createdBy} exported ${row.name} to Review`,
        timestamp: new Date(row.createdAt).getTime(),
        songId: row.songId,
        songName: row.songName,
        reviewId: row.reviewId,
      });
    }

    // Activity log: song-structure events
    // Sort-only types are still written by logActivity() (getSongsWithLastActive depends on
    // seeing all of them) but must never render as a feed row. Filtered here, at the read path,
    // not at write time.
    const sortOnlyCond = notInArray(activityLog.type, [
      'volume-changed',
      'pan-changed',
      'clip-trim-adjusted',
      'timeline-reordered',
      'clip-metadata-edited',
      'idea-hidden',
      'clip-comment-edited',
      'clip-comment-deleted',
      'clip-comment-reply',
      'task-comment-edited',
      'task-comment-deleted',
      'task-comment-reply',
      'review-comment-edited',
      'review-comment-deleted',
      'album-song-reordered',
      'lyrics-edited',
      'lyrics-comment-reply',
      'lyrics-comment-edited',
      'lyrics-comment-deleted',
      'loose-file-comment-reply',
      'loose-file-comment-edited',
      'loose-file-comment-deleted',
      // Top-level clip and task comments are already shown by rows built from
      // clip_comments / task_comments below, which name the track and section
      // ("X commented on Bass · Chorus 2 task"). These generic rows ("X commented on a
      // task") duplicated them. Skipped here rather than no longer logged, so existing
      // rows disappear too and the Your Songs sort still counts the activity.
      'clip-comment-added',
      'task-comment-added',
      // An upload already appears as the clip-built "added {clip} to {track} — {section}"
      // row; this "uploaded {clip}" row repeated it.
      'file-uploaded',
      // Task outcomes of a clip marked/unmarked Final — that action has its own row.
      'task-auto-completed',
      'task-auto-reverted',
    ]);
    // activity_log has no FK to songs, so a deleted song's rows stay. LEFT JOIN keeps
    // them in the feed, scoped by the row's own band_id (rows from before band_id was
    // stamped fall back to the song's band, so they still need the song to exist).
    const logBandCond = or(
      eq(activityLog.bandId, bandId),
      and(isNull(activityLog.bandId), eq(songs.bandId, bandId)),
    );
    const logCond = songId
      ? and(eq(activityLog.songId, songId), logBandCond, sortOnlyCond)
      : and(logBandCond, sortOnlyCond);
    const logRows = db
      .select({
        type: activityLog.type,
        description: activityLog.description,
        timestamp: activityLog.timestamp,
        instrument: activityLog.instrument,
        sectionName: activityLog.sectionName,
        reviewId: activityLog.reviewId,
        commentId: activityLog.commentId,
        songId: activityLog.songId,
        songName: songs.name,
      })
      .from(activityLog)
      .leftJoin(songs, eq(activityLog.songId, songs.id))
      .where(logCond)
      .all();

    // A deleted song has no songs row to name it. Recover the name from the text of
    // its own deletion row (the name at deletion time), else its creation row. Stored
    // rows are never edited.
    const goneSongIds = Array.from(new Set(logRows.filter((r) => r.songName === null).map((r) => r.songId)));
    const goneSongNames = new Map<string, string>();
    if (goneSongIds.length) {
      const nameMarkers: Record<string, string[]> = {
        'song-deleted': [' deleted the song ', ' deleted song — '],
        'idea-deleted': [' deleted the Idea '],
        'song-created': [' created a new song — '],
        'idea-created': [' created a new idea — '],
      };
      const nameRows = db
        .select({ songId: activityLog.songId, type: activityLog.type, description: activityLog.description })
        .from(activityLog)
        .where(and(inArray(activityLog.songId, goneSongIds), inArray(activityLog.type, Object.keys(nameMarkers))))
        .all()
        .sort((a, b) => Number(!a.type.endsWith('-deleted')) - Number(!b.type.endsWith('-deleted')));
      for (const r of nameRows) {
        if (goneSongNames.has(r.songId)) continue;
        for (const marker of nameMarkers[r.type]) {
          const at = r.description.indexOf(marker);
          if (at > 0) { goneSongNames.set(r.songId, r.description.slice(at + marker.length)); break; }
        }
      }
    }

    for (const row of logRows) {
      // Older placement rows read "{user} added {clip} to {track} — {section}", the same
      // words as the upload row. Reworded to the current text by stripping the exact
      // suffix the route wrote (from the row's own instrument/section columns).
      let description = row.description;
      const oldPlacementSuffix = ` to ${row.instrument} — ${row.sectionName}`;
      const addedAt = description.indexOf(' added ');
      if (row.type === 'clip-added-to-timeline' && addedAt > 0 && description.endsWith(oldPlacementSuffix)) {
        const who = description.slice(0, addedAt);
        const name = description.slice(addedAt + ' added '.length, description.length - oldPlacementSuffix.length);
        description = `${who} placed ${name} on the timeline in ${row.instrument} — ${row.sectionName}`;
      }
      // Older timeline-copy removals read "{user} removed {clip} from {track} — {section}",
      // too close to the file removal ("… from {track} → {section}"). Same suffix strip.
      const oldTimelineRemovalSuffix = ` from ${row.instrument} — ${row.sectionName}`;
      const removedAt = description.indexOf(' removed ');
      if (row.type === 'clip-removed-from-timeline' && removedAt > 0 && description.endsWith(oldTimelineRemovalSuffix)) {
        const who = description.slice(0, removedAt);
        const name = description.slice(removedAt + ' removed '.length, description.length - oldTimelineRemovalSuffix.length);
        description = `${who} removed ${name} from the timeline in ${row.instrument} — ${row.sectionName}`;
      }
      events.push({
        type: row.type as ActivityEvent['type'],
        description,
        timestamp: row.timestamp,
        songId: row.songId,
        songName: row.songName ?? goneSongNames.get(row.songId) ?? 'Deleted song',
        songDeleted: row.songName === null ? true : undefined,
        instrument: row.instrument ?? undefined,
        sectionName: row.sectionName ?? undefined,
        reviewId: row.reviewId ?? undefined,
        commentId: row.commentId ?? undefined,
      });
    }

    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  async logActivity(entry: InsertActivityLog): Promise<void> {
    if (!entry.bandId && entry.songId) {
      const song = db.select({ bandId: songs.bandId }).from(songs).where(eq(songs.id, entry.songId)).get();
      entry = { ...entry, bandId: song?.bandId ?? null };
    }
    db.insert(activityLog).values(entry).run();
  }

  async getAllTasks(bandId: string): Promise<(ProductionTask & { songName: string })[]> {
    const rows = db
      .select({ task: productionTasks, songName: songs.name })
      .from(productionTasks)
      .innerJoin(songs, and(eq(productionTasks.songId, songs.id), eq(songs.bandId, bandId)))
      .innerJoin(instrumentTracks, and(
        eq(instrumentTracks.id, productionTasks.trackId),
        eq(instrumentTracks.active, true),
      ))
      .all();
    return rows.map(r => ({ ...r.task, songName: r.songName }));
  }

  async getTasksForSong(songId: string): Promise<ProductionTask[]> {
    const rows = db
      .select({ task: productionTasks })
      .from(productionTasks)
      .innerJoin(instrumentTracks, and(
        eq(instrumentTracks.id, productionTasks.trackId),
        eq(instrumentTracks.active, true),
      ))
      .where(eq(productionTasks.songId, songId))
      .all();
    return rows.map(r => r.task);
  }

  async getFinalClipForTask(instrument: string, sectionName: string, songId: string): Promise<Clip | undefined> {
    const track = db.select().from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.name, instrument)))
      .get();
    if (!track) return undefined;
    const idea = db.select().from(ideas)
      .where(and(eq(ideas.trackId, track.id), eq(ideas.sectionName, sectionName)))
      .get();
    if (!idea) return undefined;
    return db.select().from(clips)
      .where(and(eq(clips.ideaId, idea.id), eq(clips.isFinal, true)))
      .get();
  }

  async getTimelineClipForTask(instrument: string, sectionName: string, songId: string): Promise<TimelineClip | undefined> {
    const track = db.select().from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.name, instrument)))
      .get();
    if (!track) return undefined;
    return db.select().from(timelineClips)
      .where(and(eq(timelineClips.trackId, track.id), eq(timelineClips.sectionName, sectionName)))
      .get();
  }

  async getTaskByInstrumentSection(songId: string, instrument: string, sectionName: string): Promise<ProductionTask | undefined> {
    return db.select().from(productionTasks).where(
      and(
        eq(productionTasks.songId, songId),
        eq(productionTasks.instrument, instrument),
        eq(productionTasks.sectionName, sectionName),
      )
    ).get();
  }

  async upsertTask(data: InsertProductionTask): Promise<ProductionTask> {
    db.insert(productionTasks).values(data).onConflictDoUpdate({
      target: productionTasks.id,
      set: data,
    }).run();
    return db.select().from(productionTasks).where(eq(productionTasks.id, data.id)).get()!;
  }

  async updateTask(id: string, updates: Partial<InsertProductionTask>): Promise<ProductionTask | undefined> {
    const existing = db.select().from(productionTasks).where(eq(productionTasks.id, id)).get();
    if (!existing) return undefined;
    db.update(productionTasks).set(updates).where(eq(productionTasks.id, id)).run();
    return db.select().from(productionTasks).where(eq(productionTasks.id, id)).get();
  }

  async getTaskComments(taskId: string): Promise<TaskCommentWithReplies[]> {
    const all = db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(asc(taskComments.createdAt)).all();
    const topLevel = all.filter(c => !c.parentId);
    const replyMap = new Map<string, TaskComment[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const bucket = replyMap.get(c.parentId) ?? [];
      bucket.push(c);
      replyMap.set(c.parentId, bucket);
    }
    return topLevel.map(c => ({
      ...c,
      replies: (replyMap.get(c.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }));
  }

  async addTaskComment(data: InsertTaskComment): Promise<TaskComment> {
    const now = new Date().toISOString();
    const comment: TaskComment = { ...data, id: data.id ?? randomUUID(), parentId: data.parentId ?? null, createdAt: now };
    db.insert(taskComments).values(comment).run();
    return db.select().from(taskComments).where(eq(taskComments.id, comment.id)).get()!;
  }

  async updateTaskComment(id: string, text: string): Promise<TaskComment | undefined> {
    const existing = db.select().from(taskComments).where(eq(taskComments.id, id)).get();
    if (!existing) return undefined;
    db.update(taskComments).set({ text }).where(eq(taskComments.id, id)).run();
    return db.select().from(taskComments).where(eq(taskComments.id, id)).get();
  }

  async deleteTaskComment(id: string): Promise<void> {
    db.delete(taskComments).where(eq(taskComments.parentId, id)).run();
    db.delete(taskComments).where(eq(taskComments.id, id)).run();
  }

  // ── Clip Comments ──────────────────────────────────────────────────────────

  async getClipComments(clipId: string): Promise<ClipCommentWithReplies[]> {
    const all = db.select().from(clipComments).where(eq(clipComments.clipId, clipId)).orderBy(asc(clipComments.timestamp)).all();
    const topLevel = all.filter(c => !c.parentId);
    const replyMap = new Map<string, ClipComment[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const bucket = replyMap.get(c.parentId) ?? [];
      bucket.push(c);
      replyMap.set(c.parentId, bucket);
    }
    return topLevel.map(c => ({
      ...c,
      replies: (replyMap.get(c.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }));
  }

  async addClipComment(data: InsertClipComment): Promise<ClipComment> {
    const now = new Date().toISOString();
    const comment: ClipComment = {
      ...data,
      id: data.id ?? randomUUID(),
      parentId: data.parentId ?? null,
      carriedFromCommentId: data.carriedFromCommentId ?? null,
      createdAt: now,
    };
    db.insert(clipComments).values(comment).run();
    return db.select().from(clipComments).where(eq(clipComments.id, comment.id)).get()!;
  }

  async updateClipComment(id: string, text: string): Promise<ClipComment | undefined> {
    const existing = db.select().from(clipComments).where(eq(clipComments.id, id)).get();
    if (!existing) return undefined;
    db.update(clipComments).set({ text }).where(eq(clipComments.id, id)).run();
    return db.select().from(clipComments).where(eq(clipComments.id, id)).get();
  }

  async deleteClipComment(id: string): Promise<void> {
    db.delete(clipComments).where(eq(clipComments.parentId, id)).run();
    db.delete(clipComments).where(eq(clipComments.id, id)).run();
  }

  // Copies a source clip's or loose file's comments onto a destination clip — used after
  // Add to Song / Promote to Song creates the copy's clip. New ids throughout, so
  // top-level comments go first to build the old -> new id map, then replies are
  // remapped onto it. Original author and timestamp are kept (it's the note's history);
  // createdAt is the copy time. The source rows are only read, never changed.
  async copyCommentsToClip(destClipId: string, source: { kind: 'clip' | 'loose'; id: string }): Promise<ClipComment[]> {
    return db.transaction((tx) => {
      const sourceRows: { id: string; parentId: string | null; author: string; text: string; timestamp: number }[] =
        source.kind === 'clip'
          ? tx.select().from(clipComments).where(eq(clipComments.clipId, source.id)).orderBy(asc(clipComments.timestamp)).all()
          : tx.select().from(looseFileComments).where(eq(looseFileComments.looseFileId, source.id)).orderBy(asc(looseFileComments.timestamp)).all();
      const now = new Date().toISOString();
      const idMap = new Map<string, string>();
      const copied: ClipComment[] = [];
      const copyRow = (row: (typeof sourceRows)[number], parentId: string | null) => {
        const newRow: ClipComment = {
          id: randomUUID(),
          clipId: destClipId,
          parentId,
          author: row.author,
          text: row.text,
          timestamp: row.timestamp,
          createdAt: now,
          carriedFromCommentId: row.id,
        };
        tx.insert(clipComments).values(newRow).run();
        copied.push(newRow);
        return newRow.id;
      };
      for (const row of sourceRows) {
        if (!row.parentId) idMap.set(row.id, copyRow(row, null));
      }
      for (const row of sourceRows) {
        if (!row.parentId) continue;
        const newParentId = idMap.get(row.parentId);
        // A reply whose parent is gone is already orphaned at the source — don't carry it.
        if (newParentId) copyRow(row, newParentId);
      }
      return copied;
    });
  }

  // ── Loose File Comments ──────────────────────────────────────────────────────

  async getLooseFileComments(looseFileId: string): Promise<LooseFileCommentWithReplies[]> {
    const all = db.select().from(looseFileComments)
      .where(eq(looseFileComments.looseFileId, looseFileId))
      .orderBy(asc(looseFileComments.timestamp)).all();
    const topLevel = all.filter(c => !c.parentId);
    const replyMap = new Map<string, LooseFileComment[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const bucket = replyMap.get(c.parentId) ?? [];
      bucket.push(c);
      replyMap.set(c.parentId, bucket);
    }
    return topLevel.map(c => ({
      ...c,
      replies: (replyMap.get(c.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }));
  }

  async getLooseFileComment(id: string): Promise<LooseFileComment | undefined> {
    return db.select().from(looseFileComments).where(eq(looseFileComments.id, id)).get();
  }

  async addLooseFileComment(data: InsertLooseFileComment): Promise<LooseFileComment> {
    const comment: LooseFileComment = {
      ...data,
      id: data.id ?? randomUUID(),
      parentId: data.parentId ?? null,
      createdAt: new Date().toISOString(),
    };
    db.insert(looseFileComments).values(comment).run();
    return db.select().from(looseFileComments).where(eq(looseFileComments.id, comment.id)).get()!;
  }

  async updateLooseFileComment(id: string, text: string): Promise<LooseFileComment | undefined> {
    const existing = db.select().from(looseFileComments).where(eq(looseFileComments.id, id)).get();
    if (!existing) return undefined;
    db.update(looseFileComments).set({ text }).where(eq(looseFileComments.id, id)).run();
    return db.select().from(looseFileComments).where(eq(looseFileComments.id, id)).get();
  }

  async deleteLooseFileComment(id: string): Promise<void> {
    db.delete(looseFileComments).where(eq(looseFileComments.parentId, id)).run();
    db.delete(looseFileComments).where(eq(looseFileComments.id, id)).run();
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  async getReviewsForSong(songId: string): Promise<SongReview[]> {
    return db.select().from(songReviews).where(eq(songReviews.songId, songId)).orderBy(desc(songReviews.createdAt)).all();
  }

  async countReviewsForSong(songId: string): Promise<number> {
    const result = db.select({ value: count() }).from(songReviews).where(eq(songReviews.songId, songId)).get();
    return result?.value ?? 0;
  }

  async createReview(data: InsertSongReview): Promise<SongReview> {
    const now = new Date().toISOString();
    const review: SongReview = { ...data, id: data.id ?? randomUUID(), createdAt: now };
    db.insert(songReviews).values(review).run();
    return db.select().from(songReviews).where(eq(songReviews.id, review.id)).get()!;
  }

  async deleteReview(id: string): Promise<void> {
    db.delete(songReviews).where(eq(songReviews.id, id)).run();
  }

  // ── Review Comments ────────────────────────────────────────────────────────

  async getReviewComments(reviewId: string): Promise<ReviewCommentWithReplies[]> {
    const all = db.select().from(songReviewComments)
      .where(eq(songReviewComments.reviewId, reviewId))
      .all();
    const topLevel = all
      .filter(c => !c.parentId)
      .sort((a, b) => a.timestamp - b.timestamp);
    const replyMap = new Map<string, SongReviewComment[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const bucket = replyMap.get(c.parentId) ?? [];
      bucket.push(c);
      replyMap.set(c.parentId, bucket);
    }
    return topLevel.map(c => ({
      ...c,
      replies: (replyMap.get(c.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }));
  }

  async addReviewComment(data: InsertSongReviewComment): Promise<SongReviewComment> {
    const now = new Date().toISOString();
    const comment: SongReviewComment = {
      ...data,
      id: data.id ?? randomUUID(),
      parentId: data.parentId ?? null,
      resolved: false,
      editedAt: null,
      createdAt: now,
    };
    db.insert(songReviewComments).values(comment).run();
    return db.select().from(songReviewComments).where(eq(songReviewComments.id, comment.id)).get()!;
  }

  async updateReviewComment(id: string, updates: { text?: string; resolved?: boolean; editedAt?: string | null }): Promise<SongReviewComment | undefined> {
    const existing = db.select().from(songReviewComments).where(eq(songReviewComments.id, id)).get();
    if (!existing) return undefined;
    db.update(songReviewComments).set(updates).where(eq(songReviewComments.id, id)).run();
    return db.select().from(songReviewComments).where(eq(songReviewComments.id, id)).get();
  }

  async deleteReviewComment(id: string): Promise<void> {
    // Delete replies first (no cascade FK since parentId has no .references())
    db.delete(songReviewComments).where(eq(songReviewComments.parentId, id)).run();
    db.delete(songReviewComments).where(eq(songReviewComments.id, id)).run();
  }

  // ── Lyrics Comments ────────────────────────────────────────────────────────

  async getLyricsComments(songId: string): Promise<LyricsCommentWithReplies[]> {
    const all = db.select().from(lyricsComments).where(eq(lyricsComments.songId, songId)).orderBy(asc(lyricsComments.createdAt)).all();
    const topLevel = all.filter(c => !c.parentId);
    const replyMap = new Map<string, LyricsComment[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const bucket = replyMap.get(c.parentId) ?? [];
      bucket.push(c);
      replyMap.set(c.parentId, bucket);
    }
    return topLevel.map(c => ({
      ...c,
      replies: (replyMap.get(c.id) ?? []).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }));
  }

  async addLyricsComment(data: InsertLyricsComment): Promise<LyricsComment> {
    const now = new Date().toISOString();
    const comment: LyricsComment = { ...data, id: data.id ?? randomUUID(), parentId: data.parentId ?? null, resolved: false, createdAt: now };
    db.insert(lyricsComments).values(comment).run();
    return db.select().from(lyricsComments).where(eq(lyricsComments.id, comment.id)).get()!;
  }

  async updateLyricsComment(id: string, updates: { text?: string; resolved?: boolean }): Promise<LyricsComment | undefined> {
    const existing = db.select().from(lyricsComments).where(eq(lyricsComments.id, id)).get();
    if (!existing) return undefined;
    db.update(lyricsComments).set(updates).where(eq(lyricsComments.id, id)).run();
    return db.select().from(lyricsComments).where(eq(lyricsComments.id, id)).get();
  }

  async deleteLyricsComment(id: string): Promise<void> {
    db.delete(lyricsComments).where(eq(lyricsComments.parentId, id)).run();
    db.delete(lyricsComments).where(eq(lyricsComments.id, id)).run();
  }

  // ── Albums ─────────────────────────────────────────────────────────────────

  async getAlbums(bandId: string): Promise<AlbumWithCount[]> {
    const allAlbums = db.select().from(albums).where(eq(albums.bandId, bandId)).orderBy(asc(albums.createdAt)).all();
    if (!allAlbums.length) return [];
    const albumIds = allAlbums.map(a => a.id);
    const counts = db
      .select({ albumId: albumSongs.albumId, total: count() })
      .from(albumSongs)
      .where(inArray(albumSongs.albumId, albumIds))
      .groupBy(albumSongs.albumId)
      .all();
    const countMap = new Map(counts.map(r => [r.albumId, r.total]));
    return allAlbums.map(a => ({ ...a, songCount: countMap.get(a.id) ?? 0 }));
  }

  async createAlbum(name: string, bandId: string): Promise<Album> {
    const album: Album = { id: randomUUID(), name, createdAt: new Date().toISOString(), bandId };
    db.insert(albums).values(album).run();
    return album;
  }

  async renameAlbum(id: string, name: string): Promise<Album | undefined> {
    const existing = db.select().from(albums).where(eq(albums.id, id)).get();
    if (!existing) return undefined;
    db.update(albums).set({ name }).where(eq(albums.id, id)).run();
    return db.select().from(albums).where(eq(albums.id, id)).get();
  }

  async deleteAlbum(id: string): Promise<void> {
    db.delete(albums).where(eq(albums.id, id)).run();
  }

  async getAlbumSongs(albumId: string): Promise<Song[]> {
    const rows = db
      .select({ song: songs, sortOrder: albumSongs.sortOrder })
      .from(albumSongs)
      .innerJoin(songs, eq(albumSongs.songId, songs.id))
      .where(eq(albumSongs.albumId, albumId))
      .orderBy(asc(albumSongs.sortOrder))
      .all();
    return rows.map(r => r.song);
  }

  async addSongToAlbum(albumId: string, songId: string): Promise<{ added: boolean }> {
    const existing = db.select().from(albumSongs)
      .where(and(eq(albumSongs.albumId, albumId), eq(albumSongs.songId, songId)))
      .get();
    if (existing) return { added: false };
    const maxRow = db
      .select({ maxOrder: max(albumSongs.sortOrder) })
      .from(albumSongs)
      .where(eq(albumSongs.albumId, albumId))
      .get();
    const nextOrder = (maxRow?.maxOrder ?? -1) + 1;
    db.insert(albumSongs).values({ albumId, songId, sortOrder: nextOrder }).run();
    return { added: true };
  }

  async removeSongFromAlbum(albumId: string, songId: string): Promise<void> {
    db.delete(albumSongs)
      .where(and(eq(albumSongs.albumId, albumId), eq(albumSongs.songId, songId)))
      .run();
  }

  async moveAlbumSong(albumId: string, songId: string, direction: 'up' | 'down'): Promise<void> {
    const rows = db.select().from(albumSongs)
      .where(eq(albumSongs.albumId, albumId))
      .orderBy(asc(albumSongs.sortOrder))
      .all();
    const idx = rows.findIndex(r => r.songId === songId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return;
    const curr = rows[idx];
    const swap = rows[swapIdx];
    db.update(albumSongs).set({ sortOrder: swap.sortOrder })
      .where(and(eq(albumSongs.albumId, albumId), eq(albumSongs.songId, curr.songId))).run();
    db.update(albumSongs).set({ sortOrder: curr.sortOrder })
      .where(and(eq(albumSongs.albumId, albumId), eq(albumSongs.songId, swap.songId))).run();
  }

  async getAllAlbumMemberships(bandId: string): Promise<AlbumMembership[]> {
    return db
      .select({ albumId: albumSongs.albumId, albumName: albums.name, songId: albumSongs.songId })
      .from(albumSongs)
      .innerJoin(albums, and(eq(albumSongs.albumId, albums.id), eq(albums.bandId, bandId)))
      .all();
  }

  // ── Bands ──────────────────────────────────────────────────────────────────

  async getBands(): Promise<Band[]> {
    return db.select().from(bands).all();
  }

  async createBand(name: string): Promise<Band> {
    const band: Band = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    db.insert(bands).values(band).run();
    return band;
  }

  async getUsersByBand(bandId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.bandId, bandId)).orderBy(asc(users.username)).all();
  }

  // Startup self-heal for production_tasks rows with a NULL track_id. The track_id
  // fill-in in db.ts only runs when the column is missing, so a drizzle-kit push that
  // added the column first left every existing task unlinked (213 rows on production,
  // repaired by hand Oct 2026). getTasksForSong inner-joins on track_id, so those tasks
  // vanish from the Production tab. Match: same song, track name = task instrument
  // (case-insensitive); the single active candidate, else the single candidate if none
  // are active. Anything else stays NULL and is logged. Writes only track_id, only where
  // it is NULL, in one transaction — safe on every boot.
  async relinkNullTaskTracks(): Promise<void> {
    const result = db.transaction((tx) => {
      const nullTasks = tx
        .select({ id: productionTasks.id, songId: productionTasks.songId, instrument: productionTasks.instrument })
        .from(productionTasks)
        .where(isNull(productionTasks.trackId))
        .orderBy(asc(productionTasks.id))
        .all();
      let relinked = 0;
      const unmatched: string[] = [];
      for (const task of nullTasks) {
        const candidates = tx
          .select({ id: instrumentTracks.id, active: instrumentTracks.active })
          .from(instrumentTracks)
          .where(and(
            eq(instrumentTracks.songId, task.songId),
            sql`lower(${instrumentTracks.name}) = lower(${task.instrument})`,
          ))
          .all();
        const active = candidates.filter((t) => t.active);
        const trackId = active.length === 1 ? active[0].id
          : active.length === 0 && candidates.length === 1 ? candidates[0].id
          : null;
        if (!trackId) {
          unmatched.push(task.id);
          continue;
        }
        relinked += tx
          .update(productionTasks).set({ trackId })
          .where(and(eq(productionTasks.id, task.id), isNull(productionTasks.trackId)))
          .run().changes;
      }
      return { relinked, unmatched };
    });
    if (result.relinked > 0 || result.unmatched.length > 0) {
      const left = result.unmatched.length > 0 ? ` (${result.unmatched.join(", ")})` : "";
      console.log(`[tasks] Relinked ${result.relinked} task(s) with a NULL track_id; ${result.unmatched.length} left unmatched${left}`);
    }
  }

  async backfillBands(): Promise<void> {
    const DEFAULT_BAND_NAME = "The Zenith Passage";

    let band = db.select().from(bands).where(eq(bands.name, DEFAULT_BAND_NAME)).get();
    if (!band) {
      band = { id: randomUUID(), name: DEFAULT_BAND_NAME, createdAt: new Date().toISOString() };
      db.insert(bands).values(band).run();
      console.log(`[bands] Created default band "${DEFAULT_BAND_NAME}" (${band.id})`);
    }

    const bandId = band.id;

    const userCount = db
      .update(users).set({ bandId })
      .where(isNull(users.bandId))
      .run().changes;
    if (userCount > 0) console.log(`[bands] Backfilled bandId on ${userCount} user(s)`);

    const songCount = db
      .update(songs).set({ bandId })
      .where(isNull(songs.bandId))
      .run().changes;
    if (songCount > 0) console.log(`[bands] Backfilled bandId on ${songCount} song(s)`);

    const albumCount = db
      .update(albums).set({ bandId })
      .where(isNull(albums.bandId))
      .run().changes;
    if (albumCount > 0) console.log(`[bands] Backfilled bandId on ${albumCount} album(s)`);

    const logCount = db
      .update(activityLog).set({ bandId })
      .where(isNull(activityLog.bandId))
      .run().changes;
    if (logCount > 0) console.log(`[bands] Backfilled bandId on ${logCount} activity_log row(s)`);

    // Migrate the legacy 'global' settings row to be keyed by this band's id
    const globalRow = db.select().from(globalSettings).where(eq(globalSettings.id, 'global')).get();
    if (globalRow) {
      const zenithRow = db.select().from(globalSettings).where(eq(globalSettings.id, bandId)).get();
      if (!zenithRow) {
        db.insert(globalSettings).values({ ...globalRow, id: bandId }).run();
        console.log(`[bands] Migrated global settings row to bandId ${bandId}`);
      }
      db.delete(globalSettings).where(eq(globalSettings.id, 'global')).run();
    }

    if (userCount === 0 && songCount === 0 && albumCount === 0 && logCount === 0) {
      console.log(`[bands] Backfill is a no-op — all rows already have bandId`);
    }

    // Seed Band B + zed (demo fixture)
    const BAND_B_NAME = "Band B";
    let bandB = db.select().from(bands).where(eq(bands.name, BAND_B_NAME)).get();
    if (!bandB) {
      bandB = { id: randomUUID(), name: BAND_B_NAME, createdAt: new Date().toISOString() };
      db.insert(bands).values(bandB).run();
      console.log(`[bands] Created band "${BAND_B_NAME}" (${bandB.id})`);
    }

    const existingZed = db.select().from(users).where(eq(users.username, "zed")).get();
    if (!existingZed) {
      const hashed = await bcrypt.hash("password", 10);
      db.insert(users).values({ id: randomUUID(), username: "zed", password: hashed, bandId: bandB.id }).run();
      console.log(`[bands] Created user "zed" in band "${BAND_B_NAME}"`);
    }
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async getSettings(bandId: string): Promise<{ defaultInstruments: string[]; defaultSections: string[]; defaultBpm: number }> {
    const row = db.select().from(globalSettings).where(eq(globalSettings.id, bandId)).get();
    if (!row) {
      db.insert(globalSettings).values({
        id: bandId,
        defaultInstruments: DEFAULT_INSTRUMENTS,
        defaultSections: DEFAULT_SECTIONS,
        defaultBpm: 120,
      }).run();
      return { defaultInstruments: DEFAULT_INSTRUMENTS, defaultSections: DEFAULT_SECTIONS, defaultBpm: 120 };
    }
    return { defaultInstruments: row.defaultInstruments, defaultSections: row.defaultSections, defaultBpm: row.defaultBpm };
  }

  async updateSettings(bandId: string, data: { defaultInstruments?: string[]; defaultSections?: string[]; defaultBpm?: number }): Promise<void> {
    const current = await this.getSettings(bandId);
    const safe: Record<string, unknown> = {};
    if (data.defaultInstruments !== undefined) safe.defaultInstruments = data.defaultInstruments;
    if (data.defaultSections !== undefined) safe.defaultSections = data.defaultSections;
    if (data.defaultBpm !== undefined) safe.defaultBpm = data.defaultBpm;
    db.insert(globalSettings)
      .values({ id: bandId, ...current, ...safe })
      .onConflictDoUpdate({ target: globalSettings.id, set: safe })
      .run();
  }
}

export const storage = new SQLiteStorage();
