import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { eq, asc, desc, inArray, count, and, isNull, max } from "drizzle-orm";
import { db } from "./db";
import {
  type User, type InsertUser,
  type Song, type InsertSong,
  type InstrumentTrack, type InsertInstrumentTrack,
  type Idea, type InsertIdea,
  type Clip, type InsertClip,
  type TimelineClip, type InsertTimelineClip,
  type ProductionTask, type InsertProductionTask,
  type TaskComment, type InsertTaskComment,
  type ClipComment, type InsertClipComment,
  type SongReview, type InsertSongReview,
  type SongReviewComment, type InsertSongReviewComment,
  type Album,
  type Band,
  type InsertActivityLog,
  users, songs, instrumentTracks, ideas, clips, timelineClips, deletedSections,
  productionTasks, taskComments, clipComments, songReviews, songReviewComments,
  activityLog, globalSettings, albums, albumSongs, bands,
} from "@shared/schema";

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
  sections: DEFAULT_SECTIONS,
  type: "song",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  bandId: null,
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
  ideas: (Idea & { clips: Clip[] })[];
};

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ActivityEvent {
  type: 'file-added' | 'marked-final' | 'clip-comment' | 'task-comment' | 'status-change' | 'review-shared' | 'clip-unmarked-final' | 'clip-replaced' | 'clip-added-to-timeline' | 'clip-removed-from-timeline' | 'section-added' | 'section-deleted' | 'track-added' | 'track-deleted' | 'review-comment' | 'review-reply' | 'song-created' | 'idea-created';
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
}

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  seedUsers(): Promise<void>;

  // Songs
  getSongs(bandId: string): Promise<Song[]>;
  getSongById(id: string): Promise<SongWithTracks | undefined>;
  createSong(data: InsertSong, bandId: string): Promise<Song>;
  updateSong(id: string, updates: Partial<InsertSong>): Promise<Song | undefined>;
  deleteSong(id: string): Promise<void>;
  seedSong(songId: string, instruments: string[], sections: string[]): Promise<void>;

  // Bootstrap
  bootstrapDefaultSong(): Promise<void>;

  // Timeline
  getTimelineTracks(songId: string): Promise<TrackWithTimelineClips[]>;
  addTimelineClip(trackId: string, data: InsertTimelineClip): Promise<TimelineClip>;
  updateTimelineClip(id: string, updates: Partial<InsertTimelineClip>): Promise<TimelineClip | undefined>;
  deleteTimelineClip(id: string): Promise<void>;

  // Bucket
  getBucket(songId: string): Promise<BucketTrack[]>;

  // Tracks
  createTrack(data: InsertInstrumentTrack): Promise<InstrumentTrack>;
  updateTrack(trackId: string, updates: { volume: number }): Promise<InstrumentTrack | undefined>;
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

  // Bands
  getBands(): Promise<Band[]>;
  createBand(name: string): Promise<Band>;
  getUsersByBand(bandId: string): Promise<User[]>;
  backfillBands(): Promise<void>;

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
export type TaskCommentWithReplies = TaskComment & { replies: TaskComment[] };
export type AlbumWithCount = Album & { songCount: number };
export type AlbumMembership = { albumId: string; albumName: string; songId: string };

// ─── Implementation ───────────────────────────────────────────────────────────

export class SQLiteStorage implements IStorage {

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUsers(): Promise<User[]> {
    return db.select().from(users).all();
  }

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
    const song: Song = { bpm: null, type: "song", ...data, bandId, id: randomUUID(), createdAt: now, updatedAt: now };
    db.insert(songs).values(song).run();
    return song;
  }

  async updateSong(id: string, updates: Partial<InsertSong>): Promise<Song | undefined> {
    const existing = db.select().from(songs).where(eq(songs.id, id)).get();
    if (!existing) return undefined;
    db.update(songs).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(songs.id, id)).run();
    return db.select().from(songs).where(eq(songs.id, id)).get();
  }

  async deleteSong(id: string): Promise<void> {
    db.delete(songs).where(eq(songs.id, id)).run();
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
        db.insert(productionTasks).values({
          id: randomUUID(),
          songId,
          title: `${trackName} – ${sections[si]}`,
          instrument: trackName,
          sectionName: sections[si],
          status: "todo",
          priority: "medium",
          assignee: "",
        }).run();
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
          db.insert(productionTasks).values({
            id: `task-${track.id}-${i}`,
            songId: DEFAULT_SONG_ID,
            title: `${track.name} – ${section}`,
            instrument: track.name,
            sectionName: section,
            status: "todo",
            priority: "medium",
            assignee: "",
          }).onConflictDoNothing().run();
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

  async getBucket(songId: string): Promise<BucketTrack[]> {
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

    return tracks.map((track) => ({
      ...track,
      ideas: allIdeas
        .filter((idea) => idea.trackId === track.id)
        .map((idea) => ({
          ...idea,
          clips: allClips.filter((clip) => clip.ideaId === idea.id),
        })),
    }));
  }

  // ── Tracks ─────────────────────────────────────────────────────────────────

  async createTrack(data: InsertInstrumentTrack): Promise<InstrumentTrack> {
    db.insert(instrumentTracks).values(data).run();
    const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, data.id)).get()!;
    // Create one idea and one production task per default section
    for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
      await this.createIdea({
        id: randomUUID(),
        trackId: track.id,
        name: `${track.name} ${DEFAULT_SECTIONS[i]}`,
        sectionName: DEFAULT_SECTIONS[i],
        sortOrder: i,
      });
      db.insert(productionTasks).values({
        id: `task-${track.id}-${i}`,
        songId: track.songId,
        title: `${track.name} – ${DEFAULT_SECTIONS[i]}`,
        instrument: track.name,
        sectionName: DEFAULT_SECTIONS[i],
        status: "todo",
        priority: "medium",
        assignee: "",
      }).run();
    }
    return track;
  }

  async updateTrack(trackId: string, updates: { volume: number }): Promise<InstrumentTrack | undefined> {
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
        eq(ideas.active, false)
      )).all();
  }

  async createIdea(data: InsertIdea): Promise<Idea> {
    const idea: Idea = { sortOrder: 0, active: true, ...data, id: data.id ?? randomUUID() };
    db.insert(ideas).values(idea).run();
    return db.select().from(ideas).where(eq(ideas.id, idea.id)).get()!;
  }

  // ── Clips (bucket versions) ────────────────────────────────────────────────

  async createClip(data: InsertClip): Promise<Clip> {
    const now = new Date().toISOString();
    const clip: Clip = {
      start: 0,
      isFinal: false,
      active: true,
      src: null,
      sectionName: null,
      metadata: null,
      addedToSongs: null,
      ...data,
      id: data.id ?? randomUUID(),
      createdAt: now,
    };
    db.insert(clips).values(clip).run();
    return db.select().from(clips).where(eq(clips.id, clip.id)).get()!;
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
      // Clear isFinal on all clips for this idea first
      db.update(clips).set({ isFinal: false }).where(eq(clips.ideaId, idea.id)).run();
      // Find exact name match, fall back to most recently created
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
        metadata: clips.metadata,
      })
      .from(clips)
      .innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .innerJoin(songs, eq(instrumentTracks.songId, songs.id))
      .where(clipSongCond)
      .all();

    for (const row of clipRows) {
      const ts = new Date(row.createdAt).getTime();
      const uploader = row.metadata?.uploadedBy || 'Someone';
      events.push({
        type: 'file-added',
        description: `${uploader} added ${row.clipName} to ${row.trackName}${row.sectionName ? ` — ${row.sectionName}` : ''}`,
        timestamp: ts,
        songId: row.songId,
        songName: row.songName,
        instrument: row.trackName,
        sectionName: row.sectionName ?? undefined,
      });
    }

    // Clip comments (top-level only)
    const clipCommentCond = songId
      ? and(eq(songs.id, songId), bandCond, isNull(clipComments.parentId))
      : and(bandCond, isNull(clipComments.parentId));
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
        const statusLabel = row.text.replace(/^Status changed to /, '');
        const actor = (!row.author || row.author === 'System' || row.author === 'Unknown') ? 'Someone' : row.author;
        events.push({
          type: 'status-change',
          description: `${actor} changed status to ${statusLabel} — ${row.instrument} · ${row.sectionName}`,
          timestamp: row.timestamp,
          songId: row.songId,
          songName: row.songName,
          taskId: row.taskId,
          instrument: row.instrument,
          sectionName: row.sectionName,
        });
      } else if (row.text.startsWith('Clip marked as final:')) {
        const clipName = row.text.slice('Clip marked as final: '.length).replace(/^"|"$/g, '');
        const actor = (!row.author || row.author === 'System' || row.author === 'Unknown') ? 'Someone' : row.author;
        events.push({
          type: 'marked-final',
          description: `${actor} marked ${clipName} as final`,
          timestamp: row.timestamp,
          songId: row.songId,
          songName: row.songName,
          taskId: row.taskId,
          instrument: row.instrument,
          sectionName: row.sectionName,
        });
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
    const logCond = songId ? and(eq(activityLog.songId, songId), bandCond) : bandCond;
    const logRows = db
      .select({
        type: activityLog.type,
        description: activityLog.description,
        timestamp: activityLog.timestamp,
        instrument: activityLog.instrument,
        sectionName: activityLog.sectionName,
        reviewId: activityLog.reviewId,
        commentId: activityLog.commentId,
        songId: songs.id,
        songName: songs.name,
      })
      .from(activityLog)
      .innerJoin(songs, eq(activityLog.songId, songs.id))
      .where(logCond)
      .all();

    for (const row of logRows) {
      events.push({
        type: row.type as ActivityEvent['type'],
        description: row.description,
        timestamp: row.timestamp,
        songId: row.songId,
        songName: row.songName,
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
      .all();
    return rows.map(r => ({ ...r.task, songName: r.songName }));
  }

  async getTasksForSong(songId: string): Promise<ProductionTask[]> {
    return db.select().from(productionTasks).where(eq(productionTasks.songId, songId)).all();
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
    const comment: ClipComment = { ...data, id: data.id ?? randomUUID(), parentId: data.parentId ?? null, createdAt: now };
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
    return db.select().from(users).where(eq(users.bandId, bandId)).all();
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
