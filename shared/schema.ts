import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Songs ────────────────────────────────────────────────────────────────────

export const songs = sqliteTable("songs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bpm: integer("bpm"),
  sections: text("sections", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const insertSongSchema = createInsertSchema(songs, {
  sections: z.array(z.string()),
}).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSong = z.infer<typeof insertSongSchema>;
export type Song = typeof songs.$inferSelect;

// ─── Instrument Tracks (InstrumentFolder) ────────────────────────────────────

export const instrumentTracks = sqliteTable("instrument_tracks", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["instrument", "audio", "vocal"] }).notNull(),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const insertInstrumentTrackSchema = createInsertSchema(instrumentTracks);
export type InsertInstrumentTrack = z.infer<typeof insertInstrumentTrackSchema>;
export type InstrumentTrack = typeof instrumentTracks.$inferSelect;

// ─── Ideas ────────────────────────────────────────────────────────────────────

export const ideas = sqliteTable("ideas", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull().references(() => instrumentTracks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sectionName: text("section_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const insertIdeaSchema = createInsertSchema(ideas);
export type InsertIdea = z.infer<typeof insertIdeaSchema>;
export type Idea = typeof ideas.$inferSelect;

// ─── Clip metadata type ───────────────────────────────────────────────────────

export interface ClipMetadata {
  format: string;
  sampleRate: string;
  bitDepth: string;
  description: string;
  tags: string[];
  originalFileName: string;
  uploadedBy: string;
  uploadedDate: string;
  timeSignature: string;
  key: string;
  bpm: number;
  channels: "Mono" | "Stereo" | "5.1";
  peakLevel: string;
}

// ─── Clips (Versions) ─────────────────────────────────────────────────────────

export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  ideaId: text("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["audio", "midi", "drums", "vocal", "custom-audio"] }).notNull(),
  color: text("color").notNull(),
  start: real("start").notNull().default(0),
  duration: real("duration").notNull(),
  src: text("src"),
  isFinal: integer("is_final", { mode: "boolean" }).notNull().default(false),
  sectionName: text("section_name"),
  metadata: text("metadata", { mode: "json" }).$type<ClipMetadata>(),
  createdAt: text("created_at").notNull(),
});

export const insertClipSchema = createInsertSchema(clips).omit({ createdAt: true });
export type InsertClip = z.infer<typeof insertClipSchema>;
export type Clip = typeof clips.$inferSelect;

// ─── Clip Comments ────────────────────────────────────────────────────────────

export const clipComments = sqliteTable("clip_comments", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id, { onDelete: "cascade" }),
  author: text("author").notNull(),
  text: text("text").notNull(),
  timestamp: real("timestamp").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertClipCommentSchema = createInsertSchema(clipComments).omit({ createdAt: true });
export type InsertClipComment = z.infer<typeof insertClipCommentSchema>;
export type ClipComment = typeof clipComments.$inferSelect;

// ─── Production Tasks ─────────────────────────────────────────────────────────

export const productionTasks = sqliteTable("production_tasks", {
  id: text("id").primaryKey(),
  songId: text("song_id").notNull().references(() => songs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  instrument: text("instrument").notNull(),
  status: text("status", { enum: ["todo", "in-progress", "review", "done"] }).notNull().default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
  assignee: text("assignee").notNull(),
  dueDate: text("due_date"),
  description: text("description"),
  relatedClipId: text("related_clip_id").references(() => clips.id, { onDelete: "set null" }),
});

export const insertProductionTaskSchema = createInsertSchema(productionTasks);
export type InsertProductionTask = z.infer<typeof insertProductionTaskSchema>;
export type ProductionTask = typeof productionTasks.$inferSelect;

// ─── Task Subtasks ────────────────────────────────────────────────────────────

export const taskSubtasks = sqliteTable("task_subtasks", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => productionTasks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
});

export const insertTaskSubtaskSchema = createInsertSchema(taskSubtasks);
export type InsertTaskSubtask = z.infer<typeof insertTaskSubtaskSchema>;
export type TaskSubtask = typeof taskSubtasks.$inferSelect;

// ─── Timeline Clips ───────────────────────────────────────────────────────────
// Clips placed on the arrangement timeline, keyed directly to an instrument track.

export const timelineClips = sqliteTable("timeline_clips", {
  id: text("id").primaryKey(),
  trackId: text("track_id").notNull().references(() => instrumentTracks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["audio", "midi", "drums", "vocal", "custom-audio"] }).notNull(),
  color: text("color").notNull(),
  start: real("start").notNull().default(0),
  duration: real("duration").notNull(),
  src: text("src"),
  sectionName: text("section_name"),
});

export const insertTimelineClipSchema = createInsertSchema(timelineClips);
export type InsertTimelineClip = z.infer<typeof insertTimelineClipSchema>;
export type TimelineClip = typeof timelineClips.$inferSelect;

// ─── Deleted Sections ─────────────────────────────────────────────────────────

export const deletedSections = sqliteTable("deleted_sections", {
  songId: text("song_id").notNull(),
  sectionName: text("section_name").notNull(),
});

// ─── Task Comments ────────────────────────────────────────────────────────────

export const taskComments = sqliteTable("task_comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => productionTasks.id, { onDelete: "cascade" }),
  author: text("author").notNull(),
  text: text("text").notNull(),
  timestamp: real("timestamp").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertTaskCommentSchema = createInsertSchema(taskComments).omit({ createdAt: true });
export type InsertTaskComment = z.infer<typeof insertTaskCommentSchema>;
export type TaskComment = typeof taskComments.$inferSelect;
