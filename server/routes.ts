import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import multer from "multer";
import { parseBuffer } from "music-metadata";
import { eq, and, ne, count, asc, gte } from "drizzle-orm";
import { db } from "./db";
import { storage, DEFAULT_INSTRUMENTS, DEFAULT_SECTIONS } from "./storage";
import {
  insertSongSchema,
  insertInstrumentTrackSchema,
  insertTimelineClipSchema,
  insertIdeaSchema,
  insertClipSchema,
  insertProductionTaskSchema,
  insertTaskCommentSchema,
  ideas,
  clips,
  timelineClips,
  instrumentTracks,
  productionTasks,
  taskComments,
  songReviewComments,
  songReviews,
  activityLog,
} from "@shared/schema";

const STATUS_LABELS: Record<string, string> = {
  "todo": "Status changed to To Do",
  "in-progress": "Status changed to In Progress",
  "complete": "Status changed to Complete",
  "will-not-play": "Status changed to Will Not Play",
};

const updateSongBody = insertSongSchema.partial();

// ─── Multer setup ─────────────────────────────────────────────────────────────

const UPLOADS_DIR = path.resolve("uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const multerStorage = multer.memoryStorage(); // buffer in memory so music-metadata can read it
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav", "audio/aiff", "audio/x-aiff", "audio/flac", "audio/ogg", "audio/mp4", "audio/x-m4a"];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a PatchBay-convention filename: {instrument}_{section}_v{n}.{ext} */
function buildFilename(
  instrument: string,
  section: string,
  versionNum: number,
  originalName: string
): string {
  const ext = path.extname(originalName).toLowerCase() || ".wav";
  const inst = instrument.toLowerCase().replace(/\s+/g, "-");
  const sec = section.toLowerCase().replace(/\s+/g, "-");
  return `${inst}_${sec}_v${versionNum}${ext}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Users ──────────────────────────────────────────────────────────────────

  app.get("/api/users", async (_req, res) => {
    const allUsers = await storage.getUsers();
    res.json(allUsers.map(u => ({ id: u.id, username: u.username })));
  });

  // ─── Auth ───────────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req, res) => {
    const { username: rawUsername, password } = req.body as { username?: string; password?: string };
    if (!rawUsername || !password) {
      return res.status(400).json({ message: "Username and password are required." });
    }
    const username = rawUsername.toLowerCase();
    const user = await storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password." });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid username or password." });
    }
    req.session.userId = user.id;
    const { password: _pw, ...safeUser } = user;
    return res.json(safeUser);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not logged in." });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "Not logged in." });
    const { password: _pw, ...safeUser } = user;
    return res.json(safeUser);
  });

  // ─── Songs ──────────────────────────────────────────────────────────────────

  app.get("/api/tasks", async (_req, res) => {
    const tasks = await storage.getAllTasks();
    res.json(tasks);
  });

  app.get("/api/activity", async (_req, res) => {
    const events = await storage.getActivity();
    res.json(events);
  });

  app.get("/api/songs/:songId/activity", async (req, res) => {
    const events = await storage.getActivity(req.params.songId);
    res.json(events);
  });

  app.get("/api/songs", async (_req, res) => {
    const result = await storage.getSongs();
    res.json(result);
  });

  app.get("/api/songs/:id", async (req, res) => {
    const song = await storage.getSongById(req.params.id);
    if (!song) return res.status(404).json({ message: "Song not found" });
    res.json(song);
  });

  app.post("/api/songs", async (req, res) => {
    const bodyInstruments: unknown = req.body.instruments;
    const instruments: string[] = Array.isArray(bodyInstruments)
      ? (bodyInstruments as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : DEFAULT_INSTRUMENTS;

    const bodyForSchema = { ...req.body };
    if (!Array.isArray(bodyForSchema.sections) || bodyForSchema.sections.length === 0) {
      bodyForSchema.sections = DEFAULT_SECTIONS;
    }

    const parsed = insertSongSchema.safeParse(bodyForSchema);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const song = await storage.createSong(parsed.data);
    await storage.seedSong(song.id, instruments, song.sections);
    res.status(201).json(song);
  });

  app.delete("/api/songs/:id", async (req, res) => {
    await storage.deleteSong(req.params.id);
    res.status(204).end();
  });

  app.patch("/api/songs/:id", async (req, res) => {
    const parsed = updateSongBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const song = await storage.updateSong(req.params.id, parsed.data);
    if (!song) return res.status(404).json({ message: "Song not found" });
    res.json(song);
  });

  // ─── Tracks ─────────────────────────────────────────────────────────────────

  app.post("/api/songs/:songId/tracks", async (req, res) => {
    const parsed = insertInstrumentTrackSchema.safeParse({
      id: randomUUID(),
      type: "audio",
      color: "hsl(var(--chart-1))",
      sortOrder: 999,
      ...req.body,
      songId: req.params.songId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const track = await storage.createTrack(parsed.data);

    storage.logActivity({
      id: randomUUID(),
      songId: req.params.songId,
      type: 'track-added',
      description: `Someone added an instrument — ${track.name}`,
      timestamp: Date.now(),
      instrument: track.name,
    }).catch(console.error);

    res.status(201).json(track);
  });

  app.delete("/api/tracks/:trackId", async (req, res) => {
    const trackToDelete = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, req.params.trackId)).get();
    await storage.hideTrack(req.params.trackId);
    if (trackToDelete) {
      storage.logActivity({
        id: randomUUID(),
        songId: trackToDelete.songId,
        type: 'track-deleted',
        description: `Someone deleted an instrument — ${trackToDelete.name}`,
        timestamp: Date.now(),
        instrument: trackToDelete.name,
      }).catch(console.error);
    }
    res.status(200).json({ ok: true });
  });

  app.post("/api/tracks/:trackId/restore", async (req, res) => {
    await storage.restoreTrack(req.params.trackId);
    res.status(200).json({ ok: true });
  });

  app.get("/api/songs/:songId/hidden-tracks", async (req, res) => {
    const hidden = await storage.getHiddenTracks(req.params.songId);
    res.json(hidden);
  });

  app.delete("/api/songs/:songId/sections/:sectionName", async (req, res) => {
    const decodedSection = decodeURIComponent(req.params.sectionName);
    console.log('[route deleteSection] songId:', req.params.songId, 'sectionName:', decodedSection);
    const deleteSectionResult = await storage.deleteSection(req.params.songId, decodedSection);
    console.log('[route deleteSection] deleteSection returned:', deleteSectionResult);

    storage.logActivity({
      id: randomUUID(),
      songId: req.params.songId,
      type: 'section-deleted',
      description: `Someone deleted section ${decodedSection}`,
      timestamp: Date.now(),
      sectionName: decodedSection,
    }).catch(console.error);

    res.status(204).send();
  });

  // ─── Timeline ───────────────────────────────────────────────────────────────

  app.get("/api/songs/:id/timeline", async (req, res) => {
    await storage.bootstrapDefaultSong();
    const [tracks, song] = await Promise.all([
      storage.getTimelineTracks(req.params.id),
      storage.getSongById(req.params.id),
    ]);
    res.json({ songName: song?.name ?? 'Untitled', tracks });
  });

  app.post("/api/tracks/:trackId/clips", async (req, res) => {
    const parsed = insertTimelineClipSchema.safeParse({
      ...req.body,
      trackId: req.params.trackId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    let clip = await storage.addTimelineClip(req.params.trackId, parsed.data);

    // If there's already a final bucket clip for this track+section, mark the new timeline clip final too
    if (clip.sectionName) {
      const idea = db.select().from(ideas)
        .where(and(eq(ideas.trackId, req.params.trackId), eq(ideas.sectionName, clip.sectionName)))
        .get();
      if (idea) {
        const finalBucketClip = db.select().from(clips)
          .where(and(eq(clips.ideaId, idea.id), eq(clips.isFinal, true)))
          .get();
        if (finalBucketClip && finalBucketClip.name === clip.name) {
          clip = (await storage.updateTimelineClip(clip.id, { isFinal: true })) ?? clip;
        }
      }
    }

    // Log clip-added-to-timeline activity event
    if (clip.sectionName) {
      try {
        const addTrack = db.select().from(instrumentTracks)
          .where(eq(instrumentTracks.id, req.params.trackId))
          .get();
        if (addTrack) {
          storage.logActivity({
            id: randomUUID(),
            songId: addTrack.songId,
            type: 'clip-added-to-timeline',
            description: `${req.body.author || 'Someone'} added ${clip.name} to ${addTrack.name} — ${clip.sectionName}`,
            timestamp: Date.now(),
            instrument: addTrack.name,
            sectionName: clip.sectionName,
          }).catch(console.error);
        }
      } catch (err) {
        console.error("[timeline clip add] failed to log activity:", err);
      }
    }

    res.status(201).json(clip);
  });

  app.patch("/api/timeline-clips/:id", async (req, res) => {
    const { author: commentAuthor, ...clipUpdates } = req.body;
    const existingClip = db.select().from(timelineClips).where(eq(timelineClips.id, req.params.id)).get();
    if (!existingClip) return res.status(404).json({ message: "Clip not found" });
    const clip = Object.keys(clipUpdates).length > 0
      ? await storage.updateTimelineClip(req.params.id, clipUpdates)
      : existingClip;
    if (!clip) return res.status(404).json({ message: "Clip not found" });

    const isFinal = clipUpdates.isFinal;
    if (isFinal === true || isFinal === false) {
      try {
        // Sync isFinal to the corresponding bucket clip so it persists across reloads
        if (clip.sectionName) {
          await storage.syncFinalClipFromTimeline(clip.trackId, clip.sectionName, clip.name, isFinal);
        }

        if (isFinal === true) {
          // Same name = same version: mark all same-name clips on this track as final
          db.update(timelineClips).set({ isFinal: true })
            .where(and(eq(timelineClips.trackId, clip.trackId), eq(timelineClips.name, clip.name)))
            .run();
          // Clear siblings in the same section with a different name
          const clipSectionName = clip.sectionName;
          if (clipSectionName) {
            db.update(timelineClips).set({ isFinal: false })
              .where(and(
                eq(timelineClips.trackId, clip.trackId),
                eq(timelineClips.sectionName, clipSectionName),
                ne(timelineClips.name, clip.name)
              ))
              .run();
          }
        } else {
          // Clear isFinal on all same-name clips on this track
          db.update(timelineClips).set({ isFinal: false })
            .where(and(eq(timelineClips.trackId, clip.trackId), eq(timelineClips.name, clip.name)))
            .run();
        }

        const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, clip.trackId)).get();
        if (track && clip.sectionName) {
          const task = await storage.getTaskByInstrumentSection(track.songId, track.name, clip.sectionName);
          if (task) {
            const author = commentAuthor || "Unknown";
            if (isFinal === true && task.status !== "complete") {
              await storage.updateTask(task.id, { status: "complete" });
              await storage.addTaskComment({
                id: randomUUID(),
                taskId: task.id,
                author,
                text: `Clip marked as final: "${clip.name}"`,
                timestamp: Date.now(),
              });
            } else if (isFinal === false && task.status === "complete") {
              await storage.updateTask(task.id, { status: "in-progress" });
              storage.logActivity({
                id: randomUUID(),
                songId: track.songId,
                type: 'clip-unmarked-final',
                description: `${commentAuthor || 'Someone'} unmarked ${clip.name} as final`,
                timestamp: Date.now(),
                instrument: track.name,
                sectionName: clip.sectionName ?? undefined,
              }).catch(console.error);
            }
          }
        }
      } catch (err) {
        console.error("[timeline-clip isFinal] failed to sync task status:", err);
      }
    }

    // Log clip-replaced activity when name+src both change (= replace operation from Replace submenu)
    const isReplace = typeof clipUpdates.name === 'string' && typeof clipUpdates.src === 'string'
      && clipUpdates.name !== existingClip.name;
    if (isReplace && clip.sectionName) {
      try {
        const replaceTrack = db.select().from(instrumentTracks)
          .where(eq(instrumentTracks.id, clip.trackId))
          .get();
        if (replaceTrack) {
          storage.logActivity({
            id: randomUUID(),
            songId: replaceTrack.songId,
            type: 'clip-replaced',
            description: `${commentAuthor || 'Someone'} replaced ${existingClip.name} with ${clip.name} in ${replaceTrack.name} — ${clip.sectionName}`,
            timestamp: Date.now(),
            instrument: replaceTrack.name,
            sectionName: clip.sectionName,
          }).catch(console.error);
        }
      } catch (err) {
        console.error("[timeline-clip replace] failed to log activity:", err);
      }
    }

    res.json(clip);
  });

  app.delete("/api/timeline-clips/:id", async (req, res) => {
    const clipToRemove = db.select().from(timelineClips).where(eq(timelineClips.id, req.params.id)).get();
    await storage.deleteTimelineClip(req.params.id);
    if (clipToRemove) {
      const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, clipToRemove.trackId)).get();
      if (track) {
        storage.logActivity({
          id: randomUUID(),
          songId: track.songId,
          type: 'clip-removed-from-timeline',
          description: `Someone removed ${clipToRemove.name} from ${track.name} — ${clipToRemove.sectionName}`,
          timestamp: Date.now(),
          instrument: track.name,
          sectionName: clipToRemove.sectionName ?? undefined,
        }).catch(console.error);
      }
    }
    res.status(204).send();
  });

  app.patch("/api/timeline-clips/:id/trim", async (req, res) => {
    const { trimStart, trimEnd } = req.body;
    if (typeof trimStart !== 'number' || (trimEnd !== null && trimEnd !== undefined && typeof trimEnd !== 'number')) {
      return res.status(400).json({ message: "trimStart must be a number; trimEnd must be a number or null" });
    }
    const clip = await storage.updateTimelineClip(req.params.id, { trimStart, trimEnd: trimEnd ?? null });
    if (!clip) return res.status(404).json({ message: "Clip not found" });
    res.json(clip);
  });

  app.post("/api/timeline-clips/apply-trim-to-instances", async (req, res) => {
    const { trackId, name, trimStart, trimEnd } = req.body;
    if (!trackId || !name || typeof trimStart !== 'number') {
      return res.status(400).json({ message: "trackId, name, and trimStart are required" });
    }
    if (trimEnd !== null && trimEnd !== undefined && typeof trimEnd !== 'number') {
      return res.status(400).json({ message: "trimEnd must be a number or null" });
    }
    db.update(timelineClips)
      .set({ trimStart, trimEnd: trimEnd ?? null })
      .where(and(eq(timelineClips.trackId, trackId), eq(timelineClips.name, name)))
      .run();
    res.json({ ok: true });
  });

  app.get("/api/timeline-clips/:id/replacements", async (req, res) => {
    const clip = db.select().from(timelineClips).where(eq(timelineClips.id, req.params.id)).get();
    if (!clip || !clip.sectionName) return res.json([]);

    const idea = db.select().from(ideas)
      .where(and(eq(ideas.trackId, clip.trackId), eq(ideas.sectionName, clip.sectionName)))
      .get();
    if (!idea) return res.json([]);

    const replacements = db.select({
      id: clips.id,
      name: clips.name,
      duration: clips.duration,
      src: clips.src,
      isFinal: clips.isFinal,
      createdAt: clips.createdAt,
    })
      .from(clips)
      .where(and(eq(clips.ideaId, idea.id), ne(clips.name, clip.name)))
      .orderBy(asc(clips.createdAt))
      .all();

    res.json(replacements);
  });

  app.get("/api/songs/:songId/timeline-has-finals", async (req, res) => {
    const hasFinals = await storage.timelineHasFinals(req.params.songId);
    res.json({ hasFinals });
  });

  app.delete("/api/songs/:songId/timeline-clips/non-final", async (req, res) => {
    await storage.deleteNonFinalTimelineClips(req.params.songId);
    res.status(204).send();
  });

  // ─── Bucket ─────────────────────────────────────────────────────────────────

  /** GET /api/songs/:id/bucket — full bucket tree: tracks → ideas → clips */
  app.get("/api/songs/:id/bucket", async (req, res) => {
    await storage.bootstrapDefaultSong();
    const bucket = await storage.getBucket(req.params.id);
    res.json(bucket);
  });

  // ─── Ideas ──────────────────────────────────────────────────────────────────

  /** POST /api/tracks/:trackId/ideas — create an idea (section slot) under a track */
  app.post("/api/tracks/:trackId/ideas", async (req, res) => {
    const parsed = insertIdeaSchema.safeParse({
      id: randomUUID(),
      sortOrder: 0,
      ...req.body,
      trackId: req.params.trackId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const idea = await storage.createIdea(parsed.data);

    // Log section-added once per user action. MediaBucket fires this route for every
    // active track simultaneously (Promise.all), so deduplicate via a 5-second window.
    try {
      const ideaTrack = db.select().from(instrumentTracks)
        .where(eq(instrumentTracks.id, req.params.trackId))
        .get();
      if (ideaTrack) {
        const fiveSecondsAgo = Date.now() - 5000;
        const recent = db.select().from(activityLog)
          .where(and(
            eq(activityLog.songId, ideaTrack.songId),
            eq(activityLog.type, 'section-added'),
            eq(activityLog.sectionName, idea.sectionName),
            gte(activityLog.timestamp, fiveSecondsAgo)
          ))
          .get();
        if (!recent) {
          storage.logActivity({
            id: randomUUID(),
            songId: ideaTrack.songId,
            type: 'section-added',
            description: `Someone added section ${idea.sectionName}`,
            timestamp: Date.now(),
            sectionName: idea.sectionName,
          }).catch(console.error);
        }
      }
    } catch (err) {
      console.error('[ideas] failed to log section-added activity:', err);
    }

    res.status(201).json(idea);
  });

  // ─── Clips (bucket versions) ─────────────────────────────────────────────────

  app.patch("/api/ideas/:ideaId", async (req, res) => {
    await storage.hideIdea(req.params.ideaId);
    res.status(200).json({ ok: true });
  });

  app.post("/api/ideas/:ideaId/restore", async (req, res) => {
    await storage.restoreIdea(req.params.ideaId);
    res.status(200).json({ ok: true });
  });

  app.get("/api/tracks/:trackId/hidden-ideas", async (req, res) => {
    const hidden = await storage.getHiddenIdeas(req.params.trackId);
    res.json(hidden);
  });

  app.patch("/api/clips/:clipId", async (req, res) => {
    const { author: commentAuthor, ...clipUpdates } = req.body;
    const clip = await storage.updateClip(req.params.clipId, clipUpdates);
    if (!clip) return res.status(404).json({ message: "Clip not found" });

    if (clipUpdates.isFinal === true || clipUpdates.isFinal === false) {
      try {
        const idea = db.select().from(ideas).where(eq(ideas.id, clip.ideaId)).get();
        if (idea) {
          if (clipUpdates.isFinal === true) {
            db.update(clips).set({ isFinal: false })
              .where(and(eq(clips.ideaId, idea.id), ne(clips.id, clip.id)))
              .run();
          }

          const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, idea.trackId)).get();
          if (track) {
            const task = await storage.getTaskByInstrumentSection(track.songId, track.name, idea.sectionName);
            if (task) {
              const author = commentAuthor || "Unknown";
              if (clipUpdates.isFinal === true && task.status !== "complete") {
                await storage.updateTask(task.id, { status: "complete" });
                await storage.addTaskComment({
                  id: randomUUID(),
                  taskId: task.id,
                  author,
                  text: `Clip marked as final: "${clip.name}"`,
                  timestamp: Date.now(),
                });
              } else if (clipUpdates.isFinal === false && task.status === "complete") {
                await storage.updateTask(task.id, { status: "in-progress" });
                storage.logActivity({
                  id: randomUUID(),
                  songId: track.songId,
                  type: 'clip-unmarked-final',
                  description: `${commentAuthor || 'Someone'} unmarked ${clip.name} as final`,
                  timestamp: Date.now(),
                  instrument: track.name,
                  sectionName: idea.sectionName,
                }).catch(console.error);
              }
            }
          }

          // Sync isFinal to timeline clips using name-matching logic
          if (clipUpdates.isFinal === true) {
            // Same name = same version: mark all same-name timeline clips on this track as final
            db.update(timelineClips).set({ isFinal: true })
              .where(and(eq(timelineClips.trackId, idea.trackId), eq(timelineClips.name, clip.name)))
              .run();
            // Clear siblings in the same section with a different name
            db.update(timelineClips).set({ isFinal: false })
              .where(and(
                eq(timelineClips.trackId, idea.trackId),
                eq(timelineClips.sectionName, idea.sectionName),
                ne(timelineClips.name, clip.name)
              ))
              .run();
          } else {
            // Clear isFinal on all same-name timeline clips on this track
            db.update(timelineClips).set({ isFinal: false })
              .where(and(eq(timelineClips.trackId, idea.trackId), eq(timelineClips.name, clip.name)))
              .run();
          }
        }
      } catch (err) {
        console.error("[isFinal] failed to sync task status:", err);
      }
    }

    res.json(clip);
  });

  /** POST /api/ideas/:ideaId/clips — attach a clip record to an idea */
  app.post("/api/ideas/:ideaId/clips", async (req, res) => {
    const parsed = insertClipSchema.safeParse({
      ...req.body,
      ideaId: req.params.ideaId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const clip = await storage.createClip(parsed.data);
    res.status(201).json(clip);
  });

  // ─── Clip Comments ────────────────────────────────────────────────────────────

  app.get("/api/clips/:clipId/comments", async (req, res) => {
    const comments = await storage.getClipComments(req.params.clipId);
    res.json(comments);
  });

  app.post("/api/clips/:clipId/comments", async (req, res) => {
    const { author, text } = req.body as { author: string; text: string };
    const comment = await storage.addClipComment({
      id: randomUUID(),
      clipId: req.params.clipId,
      author,
      text,
      timestamp: Date.now(),
    });
    res.status(201).json(comment);
  });

  app.patch("/api/clip-comments/:id", async (req, res) => {
    const comment = await storage.updateClipComment(req.params.id, req.body.text);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    res.json(comment);
  });

  app.delete("/api/clip-comments/:id", async (req, res) => {
    await storage.deleteClipComment(req.params.id);
    res.status(204).send();
  });

  // ─── File upload ─────────────────────────────────────────────────────────────

  /**
   * POST /api/upload
   *
   * Multipart form fields:
   *   file        — the audio file
   *   instrument  — track name (e.g. "Drums")
   *   section     — section name (e.g. "Verse 1")
   *   ideaId      — DB idea id this clip belongs to (used for version numbering)
   *
   * Returns: { url, duration, format, originalFileName }
   */
  app.post(
    "/api/upload",
    upload.single("file"),
    async (req: Request, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const { instrument = "unknown", section = "unknown", ideaId = "" } = req.body as {
          instrument?: string;
          section?: string;
          ideaId?: string;
        };

        // Count existing clips so we can assign the next version number
        const existingCount = ideaId
          ? await storage.countClipsForIdea(ideaId)
          : 0;
        const versionNum = existingCount + 1;

        // Build the canonical filename
        const filename = buildFilename(instrument, section, versionNum, req.file.originalname);
        const destPath = path.join(UPLOADS_DIR, filename);

        // Write buffer to disk
        fs.writeFileSync(destPath, req.file.buffer);

        // Extract duration and technical metadata using music-metadata
        let duration = 0;
        let format = path.extname(req.file.originalname).replace(".", "").toUpperCase() || "WAV";
        let sampleRateHz: number | undefined;
        let bitDepth: number | undefined;
        let numChannels: number | undefined;
        try {
          // Try with mimetype string first
          let meta = await parseBuffer(req.file.buffer, req.file.mimetype, { duration: true });
          duration = meta.format.duration ?? 0;

          // If that returns 0, try without mimetype hint (let music-metadata auto-detect)
          if (duration === 0) {
            meta = await parseBuffer(req.file.buffer, undefined, { duration: true });
            duration = meta.format.duration ?? 0;
          }

          if (meta.format.container) format = meta.format.container;
          sampleRateHz = meta.format.sampleRate;
          bitDepth = meta.format.bitsPerSample;
          numChannels = meta.format.numberOfChannels;
        } catch {
          console.warn("[upload] could not parse metadata for", req.file.originalname);
        }

        // If duration is still 0, fall back to a default so the clip is visible on the timeline
        if (duration < 1) {
          duration = 5;
        }

        // Format technical fields into display strings
        const sampleRateStr = sampleRateHz
          ? (sampleRateHz % 1000 === 0 ? `${sampleRateHz / 1000}kHz` : `${(sampleRateHz / 1000).toFixed(1)}kHz`)
          : '';
        const bitDepthStr = bitDepth ? `${bitDepth}-bit` : '';
        const channelsStr = numChannels === 1 ? 'Mono' : numChannels === 2 ? 'Stereo' : numChannels === 6 ? '5.1' : '';

        // The URL the browser's <audio> tag will use
        const url = `/uploads/${filename}`;

        res.status(201).json({
          url,
          duration,
          format,
          originalFileName: req.file.originalname,
          sampleRate: sampleRateStr,
          bitDepth: bitDepthStr,
          channels: channelsStr,
          uploadedDate: new Date().toISOString().split('T')[0],
          uploadedBy: req.session.userId
            ? (await storage.getUser(req.session.userId))?.username ?? 'Unknown'
            : 'Unknown',
        });
      } catch (err) {
        console.error("[upload] error:", err);
        res.status(500).json({ message: "Upload failed" });
      }
    }
  );

  // ─── Serve uploaded files ─────────────────────────────────────────────────────
  // Express static middleware for /uploads/ is registered in server/index.ts.
  // Add this line there if it isn't already:
  //   app.use("/uploads", express.static(path.resolve("uploads")));

  // ─── Production Tasks ─────────────────────────────────────────────────────────

  app.get("/api/songs/:songId/production-tasks", async (req, res) => {
    const tasks = await storage.getTasksForSong(req.params.songId);
    res.json(tasks);
  });

  app.get("/api/songs/:songId/task-counts", (req, res) => {
    const rows = db
      .select({ status: productionTasks.status })
      .from(productionTasks)
      .where(eq(productionTasks.songId, req.params.songId))
      .all();
    const total = rows.length;
    const completed = rows.filter(r => r.status === 'complete').length;
    res.json({ completed, total });
  });

  app.get("/api/songs/:songId/task-comment-counts", async (req, res) => {
    const rows = db
      .select({ taskId: taskComments.taskId, count: count() })
      .from(taskComments)
      .innerJoin(productionTasks, eq(taskComments.taskId, productionTasks.id))
      .where(and(
        eq(productionTasks.songId, req.params.songId),
        ne(taskComments.author, 'System'),
        ne(taskComments.author, 'Unknown')
      ))
      .groupBy(taskComments.taskId)
      .all();
    const result: Record<string, number> = {};
    for (const row of rows) result[row.taskId] = row.count;
    res.json(result);
  });

  app.patch("/api/production-tasks/:id", async (req, res) => {
    const { author: commentAuthor, ...taskUpdates } = req.body;

    const previous = db.select().from(productionTasks).where(eq(productionTasks.id, req.params.id)).get();

    if (taskUpdates.status === "complete") {
      if (!previous) return res.status(404).json({ message: "Task not found" });

      const [timelineClipForTask, finalClipForTask] = await Promise.all([
        storage.getTimelineClipForTask(previous.instrument, previous.sectionName, previous.songId),
        storage.getFinalClipForTask(previous.instrument, previous.sectionName, previous.songId),
      ]);

      if (!timelineClipForTask && !finalClipForTask) {
        return res.status(400).json({
          message: "Cannot mark as complete — no clip in the timeline or marked as final for this instrument and section.",
        });
      }

      if (timelineClipForTask && !finalClipForTask) {
        try {
          const track = db.select().from(instrumentTracks)
            .where(and(eq(instrumentTracks.songId, previous.songId), eq(instrumentTracks.name, previous.instrument)))
            .get();
          if (track) {
            const idea = db.select().from(ideas)
              .where(and(eq(ideas.trackId, track.id), eq(ideas.sectionName, previous.sectionName)))
              .get();
            if (idea) {
              const bucketClip = db.select().from(clips).where(eq(clips.ideaId, idea.id)).get();
              if (bucketClip) {
                await storage.updateClip(bucketClip.id, { isFinal: true });

                await storage.updateTimelineClip(timelineClipForTask.id, { isFinal: true });

                // Clear isFinal on any other timeline clips in the same section
                const taskClipSection = timelineClipForTask.sectionName;
                if (taskClipSection) {
                  db.update(timelineClips)
                    .set({ isFinal: false })
                    .where(and(
                      eq(timelineClips.trackId, timelineClipForTask.trackId),
                      eq(timelineClips.sectionName, taskClipSection),
                      ne(timelineClips.id, timelineClipForTask.id)
                    ))
                    .run();
                }

                await storage.addTaskComment({
                  id: randomUUID(),
                  taskId: req.params.id,
                  author: commentAuthor || "Unknown",
                  text: `Clip marked as final: "${bucketClip.name}"`,
                  timestamp: Date.now(),
                });
              }
            }
          }
        } catch (err) {
          console.error("[task patch] failed to auto-mark clip as final:", err);
        }
      }
    }

    const task = await storage.updateTask(req.params.id, taskUpdates);
    if (!task) return res.status(404).json({ message: "Task not found" });

    const author = commentAuthor || "Unknown";

    if (previous && taskUpdates.status && taskUpdates.status !== previous.status) {
      const label = STATUS_LABELS[taskUpdates.status as string];
      if (label) {
        storage.addTaskComment({
          id: randomUUID(),
          taskId: req.params.id,
          author: 'System',
          text: label,
          timestamp: Date.now(),
        }).catch(console.error);
      }
    }

    if (previous && 'assignee' in taskUpdates && taskUpdates.assignee !== previous.assignee) {
      const text = !taskUpdates.assignee ? "Assignee removed" : `Assignee set to ${taskUpdates.assignee}`;
      storage.addTaskComment({
        id: randomUUID(),
        taskId: req.params.id,
        author,
        text,
        timestamp: Date.now(),
      }).catch(console.error);
    }

    if (previous && 'dueDate' in taskUpdates && taskUpdates.dueDate !== previous.dueDate) {
      const text = !taskUpdates.dueDate ? "Due date removed" : `Due date set to ${taskUpdates.dueDate}`;
      storage.addTaskComment({
        id: randomUUID(),
        taskId: req.params.id,
        author,
        text,
        timestamp: Date.now(),
      }).catch(console.error);
    }

    if (taskUpdates.status && taskUpdates.status !== "complete" && previous?.status === "complete") {
      try {
        const finalClip = await storage.getFinalClipForTask(task.instrument, task.sectionName, task.songId);
        if (finalClip) {
          await storage.updateClip(finalClip.id, { isFinal: false });

          // Also unmark the timeline clip
          const timelineClipToUnmark = await storage.getTimelineClipForTask(task.instrument, task.sectionName, task.songId);
          if (timelineClipToUnmark) {
            await storage.updateTimelineClip(timelineClipToUnmark.id, { isFinal: false });
          }

          const statusNames: Record<string, string> = {
            "todo": "To Do",
            "in-progress": "In Progress",
            "will-not-play": "Will Not Play",
          };
          const unmarkText = `Clip unmarked as final: "${finalClip.name}". Status changed to ${statusNames[taskUpdates.status as string] ?? taskUpdates.status}.`;
          console.log('[addTaskComment isFinal=false] text:', unmarkText);
          await storage.addTaskComment({
            id: randomUUID(),
            taskId: req.params.id,
            author,
            text: unmarkText,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error("[task patch] failed to unmark final clip:", err);
      }
    }

    res.json(task);
  });

  app.get("/api/production-tasks/:id/comments", async (req, res) => {
    const comments = await storage.getTaskComments(req.params.id);
    res.json(comments);
  });

  app.post("/api/production-tasks/:id/comments", async (req, res) => {
    const { author, text } = req.body as { author: string; text: string };
    const comment = await storage.addTaskComment({
      id: randomUUID(),
      taskId: req.params.id,
      author,
      text,
      timestamp: Date.now(),
    });
    res.status(201).json(comment);
  });

  app.patch("/api/task-comments/:id", async (req, res) => {
    const comment = await storage.updateTaskComment(req.params.id, req.body.text);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    res.json(comment);
  });

  app.delete("/api/task-comments/:id", async (req, res) => {
    await storage.deleteTaskComment(req.params.id);
    res.status(204).send();
  });

  // ─── Reviews ────────────────────────────────────────────────────────────────

  const REVIEWS_DIR = path.join(UPLOADS_DIR, "reviews");
  if (!fs.existsSync(REVIEWS_DIR)) fs.mkdirSync(REVIEWS_DIR, { recursive: true });

  app.get("/api/songs/:songId/reviews", async (req, res) => {
    const reviews = await storage.getReviewsForSong(req.params.songId);
    res.json(reviews);
  });

  app.post("/api/songs/:songId/reviews", upload.single("file"), async (req: Request, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const name = String(req.body.name || "").trim();
      const format = String(req.body.format || "").trim();
      const duration = parseFloat(String(req.body.duration || "0")) || 0;
      if (!name || !format) return res.status(400).json({ message: "name and format are required" });

      const ext = format === "mp3" ? "mp3" : "wav";
      const filename = `review_${req.params.songId}_${Date.now()}.${ext}`;
      const destPath = path.join(REVIEWS_DIR, filename);
      fs.writeFileSync(destPath, req.file.buffer);

      const review = await storage.createReview({
        id: randomUUID(),
        songId: String(req.params.songId),
        name,
        src: `/uploads/reviews/${filename}`,
        format,
        duration,
        createdBy: req.session.userId
          ? (await storage.getUser(req.session.userId))?.username ?? 'Unknown'
          : 'Unknown',
      });
      res.status(201).json(review);
    } catch (err) {
      console.error("[review upload] error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  app.delete("/api/reviews/:reviewId", async (req, res) => {
    await storage.deleteReview(req.params.reviewId);
    res.status(204).send();
  });

  app.get("/api/reviews/:reviewId/comments", async (req, res) => {
    const comments = await storage.getReviewComments(req.params.reviewId);
    res.json(comments);
  });

  app.post("/api/reviews/:reviewId/comments", async (req, res) => {
    const { author, text, timestamp, parentId } = req.body as {
      author: string; text: string; timestamp: number; parentId?: string;
    };
    if (!author || !text || typeof timestamp !== "number") {
      return res.status(400).json({ message: "author, text, and timestamp are required" });
    }

    const review = db.select().from(songReviews).where(eq(songReviews.id, req.params.reviewId)).get();
    if (!review) return res.status(404).json({ message: "Review not found" });

    let parentAuthor: string | undefined;
    if (parentId) {
      const parent = db.select().from(songReviewComments)
        .where(eq(songReviewComments.id, parentId))
        .get();
      if (!parent || parent.parentId) {
        return res.status(400).json({ message: "parentId must reference a top-level comment" });
      }
      parentAuthor = parent.author;
    }

    const comment = await storage.addReviewComment({
      id: randomUUID(),
      reviewId: req.params.reviewId,
      author,
      text,
      timestamp,
      parentId: parentId ?? null,
    });

    if (parentId && parentAuthor !== undefined) {
      storage.logActivity({
        id: randomUUID(),
        songId: review.songId,
        type: 'review-reply',
        description: `${author} replied to ${parentAuthor}'s comment on ${review.name}`,
        timestamp: Date.now(),
        reviewId: req.params.reviewId,
        commentId: comment.id,
      }).catch(console.error);
    } else {
      storage.logActivity({
        id: randomUUID(),
        songId: review.songId,
        type: 'review-comment',
        description: `${author} commented on ${review.name}`,
        timestamp: Date.now(),
        reviewId: req.params.reviewId,
        commentId: comment.id,
      }).catch(console.error);
    }

    res.status(201).json(comment);
  });

  app.patch("/api/review-comments/:id", async (req, res) => {
    const { text, resolved } = req.body as { text?: string; resolved?: boolean };
    const updates: { text?: string; resolved?: boolean; editedAt?: string } = {};
    if (text !== undefined) {
      updates.text = text;
      updates.editedAt = new Date().toISOString();
    }
    if (resolved !== undefined) updates.resolved = resolved;
    const comment = await storage.updateReviewComment(req.params.id, updates);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    res.json(comment);
  });

  app.delete("/api/review-comments/:id", async (req, res) => {
    await storage.deleteReviewComment(req.params.id);
    res.status(204).send();
  });

  return httpServer;
}
