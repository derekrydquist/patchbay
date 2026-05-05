import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { parseBuffer } from "music-metadata";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  insertSongSchema,
  insertInstrumentTrackSchema,
  insertTimelineClipSchema,
  insertIdeaSchema,
  insertClipSchema,
  insertProductionTaskSchema,
  insertTaskCommentSchema,
  ideas,
  instrumentTracks,
  productionTasks,
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

  // ─── Songs ──────────────────────────────────────────────────────────────────

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
    const parsed = insertSongSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const song = await storage.createSong(parsed.data);
    res.status(201).json(song);
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
    res.status(201).json(track);
  });

  app.delete("/api/tracks/:trackId", async (req, res) => {
    await storage.hideTrack(req.params.trackId);
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
    console.log('[deleteSection]', req.params.songId, req.params.sectionName);
    await storage.deleteSection(req.params.songId, decodeURIComponent(req.params.sectionName));
    res.status(204).send();
  });

  // ─── Timeline ───────────────────────────────────────────────────────────────

  app.get("/api/songs/:id/timeline", async (req, res) => {
    await storage.bootstrapDefaultSong();
    const tracks = await storage.getTimelineTracks(req.params.id);
    res.json(tracks);
  });

  app.post("/api/tracks/:trackId/clips", async (req, res) => {
    const parsed = insertTimelineClipSchema.safeParse({
      ...req.body,
      trackId: req.params.trackId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const clip = await storage.addTimelineClip(req.params.trackId, parsed.data);
    res.status(201).json(clip);
  });

  app.patch("/api/timeline-clips/:id", async (req, res) => {
    const clip = await storage.updateTimelineClip(req.params.id, req.body);
    if (!clip) return res.status(404).json({ message: "Clip not found" });
    res.json(clip);
  });

  app.delete("/api/timeline-clips/:id", async (req, res) => {
    await storage.deleteTimelineClip(req.params.id);
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
                await storage.addTaskComment({
                  id: randomUUID(),
                  taskId: task.id,
                  author,
                  text: `Clip unmarked as final: "${clip.name}". Status reverted to In Progress.`,
                  timestamp: Date.now(),
                });
              }
            }
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

        // Extract duration using music-metadata (reads from buffer — no ffmpeg needed)
        let duration = 0;
        let format = path.extname(req.file.originalname).replace(".", "").toUpperCase() || "WAV";
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
        } catch {
          console.warn("[upload] could not parse duration for", req.file.originalname);
        }

        // If duration is still 0, fall back to a default so the clip is visible on the timeline
        if (duration < 1) {
          duration = 5;
        }

        // The URL the browser's <audio> tag will use
        const url = `/uploads/${filename}`;

        res.status(201).json({
          url,
          duration,
          format,
          originalFileName: req.file.originalname,
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

  app.patch("/api/production-tasks/:id", async (req, res) => {
    console.log("[task patch] req.body:", JSON.stringify(req.body));
    const { author: commentAuthor, ...taskUpdates } = req.body;

    const previous = db.select().from(productionTasks).where(eq(productionTasks.id, req.params.id)).get();

    const task = await storage.updateTask(req.params.id, taskUpdates);
    if (!task) return res.status(404).json({ message: "Task not found" });

    const author = commentAuthor || "Unknown";

    if (previous && taskUpdates.status && taskUpdates.status !== previous.status) {
      const label = STATUS_LABELS[taskUpdates.status as string];
      if (label) {
        storage.addTaskComment({
          id: randomUUID(),
          taskId: req.params.id,
          author,
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
        console.log("[unmark] checking for final clip — instrument:", task.instrument, "sectionName:", task.sectionName, "songId:", task.songId);
        const finalClip = await storage.getFinalClipForTask(task.instrument, task.sectionName, task.songId);
        console.log("[unmark] finalClip result:", finalClip);
        if (finalClip) {
          await storage.updateClip(finalClip.id, { isFinal: false });
          const statusNames: Record<string, string> = {
            "todo": "To Do",
            "in-progress": "In Progress",
            "will-not-play": "Will Not Play",
          };
          await storage.addTaskComment({
            id: randomUUID(),
            taskId: req.params.id,
            author,
            text: `Clip unmarked as final: "${finalClip.name}". Status changed to ${statusNames[taskUpdates.status as string] ?? taskUpdates.status}.`,
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

  return httpServer;
}
