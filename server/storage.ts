import { randomUUID } from "crypto";
import { eq, asc, inArray, count, and } from "drizzle-orm";
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
  users, songs, instrumentTracks, ideas, clips, timelineClips, deletedSections,
  productionTasks, taskComments,
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

function defaultIdeaId(trackId: string, sectionIndex: number): string {
  return `idea-${trackId}-${sectionIndex}`;
}

const DEFAULT_SONG: Song = {
  id: DEFAULT_SONG_ID,
  name: "Midnight Horizon",
  bpm: 120,
  sections: DEFAULT_SECTIONS,
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

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Songs
  getSongs(): Promise<Song[]>;
  getSongById(id: string): Promise<SongWithTracks | undefined>;
  createSong(data: InsertSong): Promise<Song>;
  updateSong(id: string, updates: Partial<InsertSong>): Promise<Song | undefined>;

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

  // Production Tasks
  getTasksForSong(songId: string): Promise<ProductionTask[]>;
  getTaskByInstrumentSection(songId: string, instrument: string, sectionName: string): Promise<ProductionTask | undefined>;
  getFinalClipForTask(instrument: string, sectionName: string, songId: string): Promise<Clip | undefined>;
  upsertTask(data: InsertProductionTask): Promise<ProductionTask>;
  updateTask(id: string, updates: Partial<InsertProductionTask>): Promise<ProductionTask | undefined>;
  getTaskComments(taskId: string): Promise<TaskComment[]>;
  addTaskComment(data: InsertTaskComment): Promise<TaskComment>;
  updateTaskComment(id: string, text: string): Promise<TaskComment | undefined>;
  deleteTaskComment(id: string): Promise<void>;
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
    const user: User = { ...insertUser, id: randomUUID() };
    db.insert(users).values(user).run();
    return user;
  }

  // ── Songs ──────────────────────────────────────────────────────────────────

  async getSongs(): Promise<Song[]> {
    return db.select().from(songs).orderBy(asc(songs.createdAt)).all();
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
    const song: Song = { bpm: null, ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    db.insert(songs).values(song).run();
    return song;
  }

  async updateSong(id: string, updates: Partial<InsertSong>): Promise<Song | undefined> {
    const existing = db.select().from(songs).where(eq(songs.id, id)).get();
    if (!existing) return undefined;
    db.update(songs).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(songs.id, id)).run();
    return db.select().from(songs).where(eq(songs.id, id)).get();
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
          .where(inArray(clips.ideaId, allIdeas.map((i) => i.id)))
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
    const songTracks = db.select().from(instrumentTracks)
      .where(eq(instrumentTracks.songId, songId)).all();
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
      src: null,
      sectionName: null,
      metadata: null,
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

  // ── Production Tasks ───────────────────────────────────────────────────────

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

  async getTaskComments(taskId: string): Promise<TaskComment[]> {
    return db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(asc(taskComments.createdAt)).all();
  }

  async addTaskComment(data: InsertTaskComment): Promise<TaskComment> {
    const now = new Date().toISOString();
    const comment: TaskComment = { ...data, id: data.id ?? randomUUID(), createdAt: now };
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
    db.delete(taskComments).where(eq(taskComments.id, id)).run();
  }
}

export const storage = new SQLiteStorage();
