import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { eq, asc, desc, inArray, count, and, isNull } from "drizzle-orm";
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
  type InsertActivityLog,
  users, songs, instrumentTracks, ideas, clips, timelineClips, deletedSections,
  productionTasks, taskComments, clipComments, songReviews, songReviewComments,
  activityLog,
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
  getSongs(): Promise<Song[]>;
  getSongById(id: string): Promise<SongWithTracks | undefined>;
  createSong(data: InsertSong): Promise<Song>;
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
  getActivity(songId?: string): Promise<ActivityEvent[]>;
  logActivity(entry: InsertActivityLog): Promise<void>;

  // Production Tasks
  getAllTasks(): Promise<(ProductionTask & { songName: string })[]>;
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
}

export type ReviewCommentWithReplies = SongReviewComment & {
  replies: SongReviewComment[];
};

export type ClipCommentWithReplies = ClipComment & { replies: ClipComment[] };
export type TaskCommentWithReplies = TaskComment & { replies: TaskComment[] };

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
    const user: User = { ...insertUser, id: randomUUID() };
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

  async getSongs(): Promise<Song[]> {
    return db.select().from(songs).orderBy(desc(songs.updatedAt)).all();
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

  async createSong(data: InsertSong): Promise<Song> {
    const now = new Date().toISOString();
    const song: Song = { bpm: null, type: "song", ...data, id: randomUUID(), createdAt: now, updatedAt: now };
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
    db.insert(songs).values(DEFAULT_SONG).onConflictDoNothing().run();
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
    // Create one idea per default section so the new instrument is immediately usable
    for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
      await this.createIdea({
        id: randomUUID(),
        trackId: track.id,
        name: `${track.name} ${DEFAULT_SECTIONS[i]}`,
        sectionName: DEFAULT_SECTIONS[i],
        sortOrder: i,
      });
    }
    return track;
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

  async getActivity(songId?: string): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];
    const songFilter = songId ? eq(songs.id, songId) : undefined;

    // Clips: file-added and marked-final
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
      .where(songFilter)
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
      // marked-final events are generated from task_comments (with accurate timestamps),
      // not from clips.isFinal here — which would only have the upload timestamp.
    }

    // Clip comments (top-level only — replies don't generate separate activity events)
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
      .where(songFilter ? and(songFilter, isNull(clipComments.parentId)) : isNull(clipComments.parentId))
      .all();

    for (const row of clipCommentRows) {
      // TODO: replace with real auth user — show 'Unknown' as 'You' until auth is built
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
      .where(songFilter ? and(songFilter, isNull(taskComments.parentId)) : isNull(taskComments.parentId))
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
        // Extract clip name from text: 'Clip marked as final: "Guitar 2 Verse 1 V2"'
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
        // Other system comments (assignee changes, due date changes, clip unmarked) —
        // not surfaced in the activity feed
        continue;
      } else if (!row.text.startsWith('Clip unmarked as final')) {
        // Human task comment — 'Unknown' means current user before auth is built
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
    const reviewFilter = songId ? eq(songReviews.songId, songId) : undefined;
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
      .where(reviewFilter)
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

    // Activity log: song-structure events (section-added, section-deleted, track-added)
    const logFilter = songId ? eq(activityLog.songId, songId) : undefined;
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
      .where(logFilter)
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
    db.insert(activityLog).values(entry).run();
  }

  async getAllTasks(): Promise<(ProductionTask & { songName: string })[]> {
    const rows = db
      .select({ task: productionTasks, songName: songs.name })
      .from(productionTasks)
      .innerJoin(songs, eq(productionTasks.songId, songs.id))
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
}

export const storage = new SQLiteStorage();
