import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      bandId?: string;
    }
  }
}
import { createServer, type Server } from "http";
import bcrypt from "bcrypt";
import multer from "multer";
import { parseBuffer } from "music-metadata";
import { eq, and, ne, count, asc, gte, max, inArray } from "drizzle-orm";
import { db, sqlite } from "./db";
import { storage, DEFAULT_INSTRUMENTS, DEFAULT_SECTIONS, insertProductionTaskForSection } from "./storage";
import {
  insertSongSchema,
  insertInstrumentTrackSchema,
  insertTimelineClipSchema,
  insertIdeaSchema,
  insertClipSchema,
  insertProductionTaskSchema,
  insertTaskCommentSchema,
  songs,
  ideas,
  clips,
  timelineClips,
  instrumentTracks,
  productionTasks,
  taskComments,
  clipComments,
  songReviewComments,
  songReviews,
  activityLog,
  bands,
  albums,
} from "@shared/schema";

const STATUS_LABELS: Record<string, string> = {
  "todo": "Status changed to To Do",
  "in-progress": "Status changed to In Progress",
  "complete": "Status changed to Complete",
  "will-not-play": "Status changed to Will Not Play",
};

const updateSongBody = insertSongSchema.partial();

// ─── Multer setup ─────────────────────────────────────────────────────────────

const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("uploads");
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

// ─── Band session enrichment ──────────────────────────────────────────────────
// Runs before all routes. If a logged-in session lacks bandId (e.g. sessions
// created before the bands migration), resolves it from the users table and
// caches it in the session. Never rejects — simply skips if not logged in.
async function enrichSessionBand(req: Request, _res: Response, next: NextFunction) {
  if (req.session.userId && !req.session.bandId) {
    const user = await storage.getUser(req.session.userId);
    if (user?.bandId) {
      req.session.bandId = user.bandId;
    }
  }
  next();
}

// requireBand — apply to individual routes to enforce band scoping.
// Reads the bandId already cached in the session and exposes it as req.bandId.
export function requireBand(req: Request, res: Response, next: NextFunction) {
  const bandId = req.session.bandId;
  if (!bandId) return res.status(403).json({ message: "Band not resolved for session." });
  req.bandId = bandId;
  next();
}

// ─── Ownership helpers ────────────────────────────────────────────────────────
// Returns true if song exists and belongs to req.bandId; otherwise sends 404.
function assertSongOwned(req: Request, res: Response, rawId: string | string[]): boolean {
  const songId = Array.isArray(rawId) ? rawId[0] : rawId;
  const row = db.select({ bandId: songs.bandId }).from(songs).where(eq(songs.id, songId)).get();
  if (!row || row.bandId !== req.bandId) {
    res.status(404).json({ message: "Not found" });
    return false;
  }
  return true;
}

// Returns true if album exists and belongs to req.bandId; otherwise sends 404.
function assertAlbumOwned(req: Request, res: Response, rawId: string | string[]): boolean {
  const albumId = Array.isArray(rawId) ? rawId[0] : rawId;
  const row = db.select({ bandId: albums.bandId }).from(albums).where(eq(albums.id, albumId)).get();
  if (!row || row.bandId !== req.bandId) {
    res.status(404).json({ message: "Not found" });
    return false;
  }
  return true;
}

// Chain-walk helpers: return songId or null.
function trackSongId(trackId: string): string | null {
  return db.select({ songId: instrumentTracks.songId }).from(instrumentTracks)
    .where(eq(instrumentTracks.id, trackId)).get()?.songId ?? null;
}
function ideaSongId(ideaId: string): string | null {
  const row = db.select({ songId: instrumentTracks.songId })
    .from(ideas).innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
    .where(eq(ideas.id, ideaId)).get();
  return row?.songId ?? null;
}
function clipSongId(clipId: string): string | null {
  const row = db.select({ songId: instrumentTracks.songId })
    .from(clips)
    .innerJoin(ideas, eq(clips.ideaId, ideas.id))
    .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
    .where(eq(clips.id, clipId)).get();
  return row?.songId ?? null;
}
function timelineClipSongId(clipId: string): string | null {
  const row = db.select({ songId: instrumentTracks.songId })
    .from(timelineClips)
    .innerJoin(instrumentTracks, eq(timelineClips.trackId, instrumentTracks.id))
    .where(eq(timelineClips.id, clipId)).get();
  return row?.songId ?? null;
}
function taskSongId(taskId: string): string | null {
  return db.select({ songId: productionTasks.songId }).from(productionTasks)
    .where(eq(productionTasks.id, taskId)).get()?.songId ?? null;
}
function taskCommentSongId(commentId: string): string | null {
  const row = db.select({ songId: productionTasks.songId })
    .from(taskComments)
    .innerJoin(productionTasks, eq(taskComments.taskId, productionTasks.id))
    .where(eq(taskComments.id, commentId)).get();
  return row?.songId ?? null;
}
function clipCommentSongId(commentId: string): string | null {
  const row = db.select({ songId: instrumentTracks.songId })
    .from(clipComments)
    .innerJoin(clips, eq(clipComments.clipId, clips.id))
    .innerJoin(ideas, eq(clips.ideaId, ideas.id))
    .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
    .where(eq(clipComments.id, commentId)).get();
  return row?.songId ?? null;
}
function reviewSongId(reviewId: string): string | null {
  return db.select({ songId: songReviews.songId }).from(songReviews)
    .where(eq(songReviews.id, reviewId)).get()?.songId ?? null;
}
function reviewCommentSongId(commentId: string): string | null {
  const row = db.select({ songId: songReviews.songId })
    .from(songReviewComments)
    .innerJoin(songReviews, eq(songReviewComments.reviewId, songReviews.id))
    .where(eq(songReviewComments.id, commentId)).get();
  return row?.songId ?? null;
}

// ─── reconcileSectionTaskStatus ───────────────────────────────────────────────
// Central helper: reads the current isFinal state of ALL timeline clips for a
// given trackId+sectionName and reconciles the linked production task status.
//
// Rules:
//   - 0 clips       → no-op (leave task as-is)
//   - all final     → advance to "complete" if not already
//   - not all final → revert to "in-progress" if currently "complete"
//   - task is "todo" && ≥1 clip → advance to "in-progress"
async function reconcileSectionTaskStatus(
  trackId: string,
  sectionName: string,
  actor: string,
  commentAuthor: string,
): Promise<void> {
  const sectionClips = db.select().from(timelineClips)
    .where(and(eq(timelineClips.trackId, trackId), eq(timelineClips.sectionName, sectionName)))
    .all();

  if (sectionClips.length === 0) return;

  const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, trackId)).get();
  if (!track) return;

  const task = await storage.getTaskByInstrumentSection(track.songId, track.name, sectionName);
  if (!task) return;

  const allFinal = sectionClips.every(c => c.isFinal);

  if (allFinal && task.status !== 'complete') {
    await storage.updateTask(task.id, { status: 'complete' });
    await storage.addTaskComment({
      id: randomUUID(),
      taskId: task.id,
      author: commentAuthor,
      text: 'All clips marked final — task completed',
      timestamp: Date.now(),
    });
    storage.logActivity({
      id: randomUUID(),
      songId: track.songId,
      type: 'marked-final',
      description: `${actor} completed ${track.name} · ${sectionName}`,
      timestamp: Date.now(),
      instrument: track.name,
      sectionName,
      author: actor,
    }).catch(console.error);
  } else if (!allFinal && task.status === 'complete') {
    await storage.updateTask(task.id, { status: 'in-progress' });
    await storage.addTaskComment({
      id: randomUUID(),
      taskId: task.id,
      author: commentAuthor,
      text: 'Clip state changed — task reverted to In Progress',
      timestamp: Date.now(),
    });
    storage.logActivity({
      id: randomUUID(),
      songId: track.songId,
      type: 'clip-unmarked-final',
      description: `${actor} reverted ${track.name} · ${sectionName} to In Progress`,
      timestamp: Date.now(),
      instrument: track.name,
      sectionName,
      author: actor,
    }).catch(console.error);
  } else if (task.status === 'todo') {
    await storage.updateTask(task.id, { status: 'in-progress' });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use(enrichSessionBand);

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
    if (user.bandId) req.session.bandId = user.bandId;
    const { password: _pw, ...safeUser } = user;
    const band = user.bandId
      ? db.select({ name: bands.name }).from(bands).where(eq(bands.id, user.bandId)).get()
      : null;
    return res.json({ ...safeUser, bandName: band?.name ?? null });
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
    const band = user.bandId
      ? db.select({ name: bands.name }).from(bands).where(eq(bands.id, user.bandId)).get()
      : null;
    return res.json({ ...safeUser, bandName: band?.name ?? null });
  });

  // ─── Settings ───────────────────────────────────────────────────────────────

  app.get("/api/settings", requireBand, async (req, res) => {
    const settings = await storage.getSettings(req.bandId!);
    res.json(settings);
  });

  app.patch("/api/settings", requireBand, async (req, res) => {
    const { defaultInstruments, defaultSections, defaultBpm } = req.body;
    await storage.updateSettings(req.bandId!, { defaultInstruments, defaultSections, defaultBpm });
    res.json({ ok: true });
  });

  // ─── Songs ──────────────────────────────────────────────────────────────────

  app.get("/api/tasks", requireBand, async (req, res) => {
    const tasks = await storage.getAllTasks(req.bandId!);
    res.json(tasks);
  });

  app.get("/api/activity", requireBand, async (req, res) => {
    const events = await storage.getActivity(req.bandId!);
    res.json(events);
  });

  app.get("/api/songs/:songId/activity", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const events = await storage.getActivity(req.bandId!, songId);
    res.json(events);
  });

  app.get("/api/songs", requireBand, async (req, res) => {
    const sessionUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
    const result = sessionUser
      ? await storage.getSongsWithLastActive(req.bandId!, sessionUser.username)
      : await storage.getSongs(req.bandId!);
    const rows = db
      .select({ songId: instrumentTracks.songId })
      .from(clips)
      .innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .all();
    const hasFilesSet = new Set(rows.map(r => r.songId));
    res.json(result.map(s => ({ ...s, hasFiles: hasFilesSet.has(s.id) })));
  });

  app.get("/api/songs/:id", requireBand, async (req, res) => {
    const id = req.params.id as string;
    if (!assertSongOwned(req, res, id)) return;
    const song = await storage.getSongById(id);
    if (!song) return res.status(404).json({ message: "Song not found" });
    res.json(song);
  });

  app.post("/api/songs", requireBand, async (req, res) => {
    const bodyInstruments: unknown = req.body.instruments;
    const instruments: string[] = Array.isArray(bodyInstruments)
      ? (bodyInstruments as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : DEFAULT_INSTRUMENTS;

    const bodyForSchema = { ...req.body };
    if (bodyForSchema.type !== 'idea' && (!Array.isArray(bodyForSchema.sections) || bodyForSchema.sections.length === 0)) {
      bodyForSchema.sections = DEFAULT_SECTIONS;
    }

    const parsed = insertSongSchema.safeParse(bodyForSchema);

    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const song = await storage.createSong(parsed.data, req.bandId!);
    if (song.type !== 'idea') {
      await storage.seedSong(song.id, instruments, song.sections);
    }

    const songCreatedActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId: song.id,
      type: song.type === 'idea' ? 'idea-created' : 'song-created',
      description: song.type === 'idea'
        ? `${songCreatedActor} created a new idea — ${song.name}`
        : `${songCreatedActor} created a new song — ${song.name}`,
      timestamp: Date.now(),
      author: songCreatedActor,
    }).catch(console.error);

    res.status(201).json(song);
  });

  app.delete("/api/songs/:id", requireBand, async (req, res) => {
    const id = req.params.id as string;
    if (!assertSongOwned(req, res, id)) return;
    const songToDelete = db.select().from(songs).where(eq(songs.id, id)).get();
    const deleteSongActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    await storage.deleteSong(id);
    if (songToDelete) {
      storage.logActivity({
        id: randomUUID(), songId: id,
        type: 'song-deleted',
        description: `${deleteSongActor} deleted song — ${songToDelete.name}`,
        timestamp: Date.now(),
        author: deleteSongActor,
      }).catch(console.error);
    }
    res.status(204).end();
  });

  app.patch("/api/songs/:id", requireBand, async (req, res) => {
    const id = req.params.id as string;
    if (!assertSongOwned(req, res, id)) return;
    const parsed = updateSongBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const song = await storage.updateSong(id, parsed.data);
    if (!song) return res.status(404).json({ message: "Song not found" });
    res.json(song);
  });

  // ─── Tracks ─────────────────────────────────────────────────────────────────

  app.post("/api/songs/:songId/tracks", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const maxRow = db.select({ val: max(instrumentTracks.sortOrder) })
      .from(instrumentTracks)
      .where(eq(instrumentTracks.songId, songId))
      .get();
    const nextSortOrder = (maxRow?.val ?? -1) + 1;
    const parsed = insertInstrumentTrackSchema.safeParse({
      id: randomUUID(),
      type: "audio",
      color: "hsl(var(--chart-1))",
      ...req.body,
      sortOrder: nextSortOrder,
      songId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const existingAny = db.select().from(instrumentTracks)
      .where(and(
        eq(instrumentTracks.songId, songId),
        eq(instrumentTracks.name, parsed.data.name),
      )).get();
    if (existingAny) {
      const hint = existingAny.active
        ? `An instrument named "${parsed.data.name}" already exists in this song.`
        : `An instrument named "${parsed.data.name}" already exists. It's currently hidden — you can restore it from the Add Instrument dialog's restore option.`;
      return res.status(409).json({ message: hint });
    }
    const track = await storage.createTrack(parsed.data);

    const trackAddedActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const trackAddedSong = await storage.getSongById(songId);
    const trackAddedDesc = trackAddedSong?.type === 'idea'
      ? `${trackAddedActor} added a part — ${track.name}`
      : `${trackAddedActor} added an instrument — ${track.name}`;

    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'track-added',
      description: trackAddedDesc,
      timestamp: Date.now(),
      instrument: track.name,
      author: trackAddedActor,
    }).catch(console.error);

    res.status(201).json(track);
  });

  app.delete("/api/tracks/:trackId", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    const trackToDelete = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, trackId)).get();
    const trackDeletedActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    await storage.hideTrack(trackId);
    if (trackToDelete) {
      storage.logActivity({
        id: randomUUID(),
        songId: trackToDelete.songId,
        type: 'track-deleted',
        description: `${trackDeletedActor} deleted an instrument — ${trackToDelete.name}`,
        timestamp: Date.now(),
        instrument: trackToDelete.name,
        author: trackDeletedActor,
      }).catch(console.error);
    }
    res.status(200).json({ ok: true });
  });

  app.post("/api/tracks/:trackId/restore", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    const trackToRestore = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, trackId)).get();
    if (!trackToRestore) return res.status(404).json({ message: "Track not found" });
    await storage.restoreTrack(trackId);
    const restoreTrackActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId: trackToRestore.songId,
      type: 'track-restored',
      description: `${restoreTrackActor} restored instrument — ${trackToRestore.name}`,
      timestamp: Date.now(),
      instrument: trackToRestore.name,
      author: restoreTrackActor,
    }).catch(console.error);
    res.status(200).json({ ok: true });
  });

  app.patch("/api/tracks/:trackId", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    const { volume } = req.body as { volume?: unknown };
    if (volume === undefined) return res.status(400).json({ message: "No updates provided" });
    if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 100) {
      return res.status(400).json({ message: "volume must be a number between 0 and 100" });
    }
    const track = await storage.updateTrack(trackId, { volume: Math.round(volume) });
    if (!track) return res.status(404).json({ message: "Track not found" });

    const volumeActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId: trackSongIdVal,
      type: 'volume-changed',
      description: `${volumeActor} changed volume on ${track.name}`,
      timestamp: Date.now(),
      instrument: track.name,
      author: volumeActor,
    }).catch(console.error);

    res.json(track);
  });

  app.get("/api/songs/:songId/hidden-tracks", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const hidden = await storage.getHiddenTracks(songId);
    res.json(hidden);
  });

  // Atomic song-wide section creation: inserts one ideas row per active track in a
  // single transaction, sortOrder computed once, full name-uniqueness check (active or hidden).
  app.post("/api/songs/:songId/sections", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const { sectionName } = req.body as { sectionName?: string };
    if (!sectionName?.trim()) return res.status(400).json({ message: "sectionName required" });
    const name = sectionName.trim();

    // 1. All active tracks for this song.
    const activeTracks = db.select().from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .all();
    if (!activeTracks.length) return res.status(400).json({ message: "No active tracks found for this song." });

    // 2. Uniqueness check — active OR hidden — across every active track.
    const trackIds = activeTracks.map(t => t.id);
    const existingIdeas = db.select().from(ideas).where(inArray(ideas.trackId, trackIds)).all();
    const existingIdea = existingIdeas.find(
      i => i.sectionName.toLowerCase() === name.toLowerCase()
    );
    if (existingIdea) {
      const hint = existingIdea.active
        ? `A section named "${name}" already exists in this song.`
        : `A section named "${name}" already exists. It's currently hidden — you can restore it from the Add Section dialog's restore option.`;
      return res.status(409).json({ message: hint });
    }

    // 3. Shared sortOrder: MAX across all ideas on these tracks + 1.
    const maxOrderRow = db.select({ val: max(ideas.sortOrder) })
      .from(ideas)
      .where(inArray(ideas.trackId, trackIds))
      .get();
    const nextSortOrder = (maxOrderRow?.val ?? -1) + 1;

    // 4. Insert one ideas row per track in a single transaction (UNIQUE index is the final backstop).
    const insertTxn = sqlite.transaction((): typeof ideas.$inferSelect[] => {
      const created: typeof ideas.$inferSelect[] = [];
      for (const track of activeTracks) {
        const id = randomUUID();
        db.insert(ideas).values({
          id,
          trackId: track.id,
          name: `${track.name} ${name}`,
          sectionName: name,
          sortOrder: nextSortOrder,
          active: true,
        }).run();
        created.push(db.select().from(ideas).where(eq(ideas.id, id)).get()!);
      }
      return created;
    });

    let createdIdeas: typeof ideas.$inferSelect[];
    try {
      createdIdeas = insertTxn();
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ message: `A section named "${name}" already exists in this song.` });
      }
      throw err;
    }

    // 5. Production tasks — outside the transaction (uses onConflictDoNothing).
    for (const track of activeTracks) {
      insertProductionTaskForSection({ songId, trackId: track.id, instrument: track.name, sectionName: name });
    }

    // 6. Activity log (no dedup needed — single endpoint call per user action).
    const sectionAddedSong = await storage.getSongById(songId);
    if (sectionAddedSong?.type !== 'idea') {
      const actor = req.session.userId
        ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
        : 'Someone';
      storage.logActivity({
        id: randomUUID(),
        songId,
        type: 'section-added',
        description: `${actor} added section ${name}`,
        timestamp: Date.now(),
        sectionName: name,
        author: actor,
      }).catch(console.error);
    }

    res.status(201).json({ sectionName: name, ideas: createdIdeas });
  });

  app.delete("/api/songs/:songId/sections/:sectionName", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const decodedSection = decodeURIComponent(req.params.sectionName as string);
    console.log('[route deleteSection] songId:', songId, 'sectionName:', decodedSection);
    const sectionDeletedActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const deleteSectionResult = await storage.deleteSection(songId, decodedSection);
    console.log('[route deleteSection] deleteSection returned:', deleteSectionResult);

    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'section-deleted',
      description: `${sectionDeletedActor} deleted section ${decodedSection}`,
      timestamp: Date.now(),
      sectionName: decodedSection,
      author: sectionDeletedActor,
    }).catch(console.error);

    res.status(204).send();
  });

  // Song-wide section restore: reactivate hidden ideas for every active track, and
  // backfill missing ideas+tasks for tracks added after the section was hidden.
  app.post("/api/songs/:songId/sections/restore", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const { sectionName } = req.body as { sectionName?: string };
    if (!sectionName) return res.status(400).json({ message: "sectionName required" });

    const activeTracks = db
      .select()
      .from(instrumentTracks)
      .where(and(eq(instrumentTracks.songId, songId), eq(instrumentTracks.active, true)))
      .all();

    for (const track of activeTracks) {
      const existing = db
        .select()
        .from(ideas)
        .where(and(eq(ideas.trackId, track.id), eq(ideas.sectionName, sectionName)))
        .get();

      if (existing) {
        db.update(ideas).set({ active: true }).where(eq(ideas.id, existing.id)).run();
      } else {
        // Track was added after this section was hidden — create idea + task.
        const { cnt } = db.select({ cnt: count() }).from(ideas).where(eq(ideas.trackId, track.id)).get() ?? { cnt: 0 };
        await storage.createIdea({
          id: randomUUID(),
          trackId: track.id,
          name: `${track.name} ${sectionName}`,
          sectionName,
          sortOrder: cnt,
        });
        insertProductionTaskForSection({ songId, trackId: track.id, instrument: track.name, sectionName });
      }
    }

    const restoreSectionActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'section-restored',
      description: `${restoreSectionActor} restored section ${sectionName}`,
      timestamp: Date.now(),
      sectionName,
      author: restoreSectionActor,
    }).catch(console.error);

    res.status(200).json({ ok: true });
  });

  // ─── Timeline ───────────────────────────────────────────────────────────────

  app.get("/api/songs/:id/timeline", requireBand, async (req, res) => {
    const id = req.params.id as string;
    if (!assertSongOwned(req, res, id)) return;
    await storage.bootstrapDefaultSong();
    const [tracks, song] = await Promise.all([
      storage.getTimelineTracks(id),
      storage.getSongById(id),
    ]);
    res.json({ songName: song?.name ?? 'Untitled', tracks });
  });

  app.post("/api/tracks/:trackId/clips", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    const parsed = insertTimelineClipSchema.safeParse({
      ...req.body,
      trackId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    let clip = await storage.addTimelineClip(trackId, parsed.data);

    // If there's already a final bucket clip for this track+section, mark the new timeline clip final too
    if (clip.sectionName) {
      const idea = db.select().from(ideas)
        .where(and(eq(ideas.trackId, trackId), eq(ideas.sectionName, clip.sectionName)))
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

    // Log activity + reconcile task status after placement
    if (clip.sectionName) {
      const clipAddedActor = req.session.userId
        ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
        : 'Someone';

      try {
        const addTrack = db.select().from(instrumentTracks)
          .where(eq(instrumentTracks.id, trackId))
          .get();
        if (addTrack) {
          storage.logActivity({
            id: randomUUID(),
            songId: addTrack.songId,
            type: 'clip-added-to-timeline',
            description: `${clipAddedActor} added ${clip.name} to ${addTrack.name} — ${clip.sectionName}`,
            timestamp: Date.now(),
            instrument: addTrack.name,
            sectionName: clip.sectionName,
            author: clipAddedActor,
          }).catch(console.error);
        }
      } catch (err) {
        console.error("[timeline clip add] failed to log activity:", err);
      }

      // Reconcile task status (subsumes todo→in-progress since ≥1 clip now exists)
      try {
        await reconcileSectionTaskStatus(
          trackId,
          clip.sectionName,
          clipAddedActor,
          clipAddedActor,
        );
      } catch (err) {
        console.error("[timeline clip add] failed to reconcile task status:", err);
      }
    }

    res.status(201).json(clip);
  });

  app.patch("/api/timeline-clips/:id", requireBand, async (req, res) => {
    const clipId = req.params.id as string;
    const tclipSongId = timelineClipSongId(clipId);
    if (!tclipSongId || !assertSongOwned(req, res, tclipSongId)) return;
    const { author: commentAuthor, ...clipUpdates } = req.body;
    const timelineClipActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const existingClip = db.select().from(timelineClips).where(eq(timelineClips.id, clipId)).get();
    if (!existingClip) return res.status(404).json({ message: "Clip not found" });
    const clip = Object.keys(clipUpdates).length > 0
      ? await storage.updateTimelineClip(clipId, clipUpdates)
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
          // Same-name rule: mark all same-name timeline clips on this track as final
          db.update(timelineClips).set({ isFinal: true })
            .where(and(eq(timelineClips.trackId, clip.trackId), eq(timelineClips.name, clip.name)))
            .run();
        } else {
          // Same-name rule: clear isFinal on all same-name clips on this track
          db.update(timelineClips).set({ isFinal: false })
            .where(and(eq(timelineClips.trackId, clip.trackId), eq(timelineClips.name, clip.name)))
            .run();
        }

        // Reconcile task status from the full section state
        if (clip.sectionName) {
          await reconcileSectionTaskStatus(
            clip.trackId,
            clip.sectionName,
            timelineClipActor,
            commentAuthor || "Unknown",
          );
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
            description: `${timelineClipActor} replaced ${existingClip.name} with ${clip.name} in ${replaceTrack.name} — ${clip.sectionName}`,
            timestamp: Date.now(),
            instrument: replaceTrack.name,
            sectionName: clip.sectionName,
            author: timelineClipActor,
          }).catch(console.error);
        }
      } catch (err) {
        console.error("[timeline-clip replace] failed to log activity:", err);
      }
    }

    // Log timeline-reordered for plain start-position updates (drag reorder / section reorder).
    // isFinal and replace branches already have their own logActivity calls above.
    const isFinalUpdate = clipUpdates.isFinal === true || clipUpdates.isFinal === false;
    if ('start' in clipUpdates && !isFinalUpdate && !isReplace) {
      try {
        const reorderTrack = db.select().from(instrumentTracks)
          .where(eq(instrumentTracks.id, clip.trackId))
          .get();
        if (reorderTrack) {
          storage.logActivity({
            id: randomUUID(),
            songId: reorderTrack.songId,
            type: 'timeline-reordered',
            description: `${timelineClipActor} reordered clips on ${reorderTrack.name}`,
            timestamp: Date.now(),
            instrument: reorderTrack.name,
            sectionName: clip.sectionName ?? undefined,
            author: timelineClipActor,
          }).catch(console.error);
        }
      } catch (err) {
        console.error("[timeline-clip reorder] failed to log activity:", err);
      }
    }

    res.json(clip);
  });

  app.delete("/api/timeline-clips/:id", requireBand, async (req, res) => {
    const clipId = req.params.id as string;
    const tclipSongId = timelineClipSongId(clipId);
    if (!tclipSongId || !assertSongOwned(req, res, tclipSongId)) return;
    const clipToRemove = db.select().from(timelineClips).where(eq(timelineClips.id, clipId)).get();
    const clipRemovedActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    await storage.deleteTimelineClip(clipId);
    if (clipToRemove) {
      const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, clipToRemove.trackId)).get();
      if (track) {
        storage.logActivity({
          id: randomUUID(),
          songId: track.songId,
          type: 'clip-removed-from-timeline',
          description: `${clipRemovedActor} removed ${clipToRemove.name} from ${track.name} — ${clipToRemove.sectionName}`,
          timestamp: Date.now(),
          instrument: track.name,
          sectionName: clipToRemove.sectionName ?? undefined,
          author: clipRemovedActor,
        }).catch(console.error);
      }
      // Reconcile task status now that a clip has been removed from the section
      if (clipToRemove.sectionName) {
        await reconcileSectionTaskStatus(
          clipToRemove.trackId,
          clipToRemove.sectionName,
          clipRemovedActor,
          clipRemovedActor,
        ).catch(err => console.error("[timeline clip delete] failed to reconcile task status:", err));
      }
    }
    res.status(204).send();
  });

  app.patch("/api/timeline-clips/:id/trim", requireBand, async (req, res) => {
    const clipId = req.params.id as string;
    const tclipSongId = timelineClipSongId(clipId);
    if (!tclipSongId || !assertSongOwned(req, res, tclipSongId)) return;
    const { trimStart, trimEnd } = req.body;
    if (typeof trimStart !== 'number' || (trimEnd !== null && trimEnd !== undefined && typeof trimEnd !== 'number')) {
      return res.status(400).json({ message: "trimStart must be a number; trimEnd must be a number or null" });
    }
    const clip = await storage.updateTimelineClip(clipId, { trimStart, trimEnd: trimEnd ?? null });
    if (!clip) return res.status(404).json({ message: "Clip not found" });

    const trimActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const trimTrack = db.select().from(instrumentTracks)
      .where(eq(instrumentTracks.id, clip.trackId))
      .get();
    if (trimTrack) {
      storage.logActivity({
        id: randomUUID(),
        songId: trimTrack.songId,
        type: 'clip-trimmed',
        description: `${trimActor} trimmed ${clip.name} in ${trimTrack.name}`,
        timestamp: Date.now(),
        instrument: trimTrack.name,
        sectionName: clip.sectionName ?? undefined,
        author: trimActor,
      }).catch(console.error);
    }

    res.json(clip);
  });

  app.post("/api/timeline-clips/apply-trim-to-instances", requireBand, async (req, res) => {
    const { trackId, name, trimStart, trimEnd } = req.body;
    if (!trackId || !name || typeof trimStart !== 'number') {
      return res.status(400).json({ message: "trackId, name, and trimStart are required" });
    }
    if (trimEnd !== null && trimEnd !== undefined && typeof trimEnd !== 'number') {
      return res.status(400).json({ message: "trimEnd must be a number or null" });
    }
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    db.update(timelineClips)
      .set({ trimStart, trimEnd: trimEnd ?? null })
      .where(and(eq(timelineClips.trackId, trackId), eq(timelineClips.name, name)))
      .run();

    const applyTrimActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const applyTrimTrack = db.select().from(instrumentTracks)
      .where(eq(instrumentTracks.id, trackId))
      .get();
    if (applyTrimTrack) {
      storage.logActivity({
        id: randomUUID(),
        songId: applyTrimTrack.songId,
        type: 'clip-trimmed',
        description: `${applyTrimActor} applied trim to all instances of ${name} in ${applyTrimTrack.name}`,
        timestamp: Date.now(),
        instrument: applyTrimTrack.name,
        author: applyTrimActor,
      }).catch(console.error);
    }

    res.json({ ok: true });
  });

  app.get("/api/timeline-clips/:id/replacements", requireBand, async (req, res) => {
    const clipId = req.params.id as string;
    const tclipSongId = timelineClipSongId(clipId);
    if (!tclipSongId || !assertSongOwned(req, res, tclipSongId)) return;
    const clip = db.select().from(timelineClips).where(eq(timelineClips.id, clipId)).get();
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

  app.get("/api/songs/:songId/timeline-has-finals", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const hasFinals = await storage.timelineHasFinals(songId);
    res.json({ hasFinals });
  });

  app.delete("/api/songs/:songId/timeline-clips/non-final", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    await storage.deleteNonFinalTimelineClips(songId);

    const nonFinalActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'timeline-cleared',
      description: `${nonFinalActor} cleared non-final clips from the timeline`,
      timestamp: Date.now(),
      author: nonFinalActor,
    }).catch(console.error);

    res.status(204).send();
  });

  // ─── Bucket ─────────────────────────────────────────────────────────────────

  /** GET /api/songs/:id/bucket — full bucket tree: tracks → ideas → clips */
  app.get("/api/songs/:id/bucket", requireBand, async (req, res) => {
    const id = req.params.id as string;
    if (!assertSongOwned(req, res, id)) return;
    await storage.bootstrapDefaultSong();
    const bucket = await storage.getBucket(id);
    res.json(bucket);
  });

  // ─── Ideas ──────────────────────────────────────────────────────────────────

  /** POST /api/tracks/:trackId/full-take — create (or restore) a Full Takes idea for a single track */
  app.post("/api/tracks/:trackId/full-take", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;

    // Check for an existing full-take idea — active or hidden.
    const existing = db.select().from(ideas)
      .where(and(eq(ideas.trackId, trackId), eq(ideas.isFullTake, true)))
      .get();

    if (existing) {
      if (existing.active) {
        return res.status(409).json({ message: "A Full Takes section already exists for this instrument." });
      }
      // Hidden — restore it rather than creating a duplicate.
      db.update(ideas).set({ active: true }).where(eq(ideas.id, existing.id)).run();
      const restored = db.select().from(ideas).where(eq(ideas.id, existing.id)).get()!;
      return res.status(200).json(restored);
    }

    // Compute sortOrder: append after the last existing idea for this track.
    const maxOrderRow = db.select({ val: max(ideas.sortOrder) })
      .from(ideas)
      .where(eq(ideas.trackId, trackId))
      .get();
    const nextSortOrder = (maxOrderRow?.val ?? -1) + 1;

    const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, trackId)).get();
    const id = randomUUID();
    await storage.createIdea({
      id,
      trackId,
      name: `${track?.name ?? 'Unknown'} Full Takes`,
      sectionName: "Full Takes",
      sortOrder: nextSortOrder,
      isFullTake: true,
    });
    const created = db.select().from(ideas).where(eq(ideas.id, id)).get()!;
    return res.status(201).json(created);
  });

  /** POST /api/tracks/:trackId/ideas — create an idea (section slot) under a track */
  app.post("/api/tracks/:trackId/ideas", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    const parsed = insertIdeaSchema.safeParse({
      id: randomUUID(),
      sortOrder: 0,
      ...req.body,
      trackId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const idea = await storage.createIdea(parsed.data);

    // Fetch the track once — shared by task creation and activity logging below.
    const ideaTrack = db.select().from(instrumentTracks)
      .where(eq(instrumentTracks.id, trackId))
      .get();

    // Create the production task for this instrument + section.
    // useAddSection fires this route in a Promise.all across all active tracks,
    // so each call independently creates its own task row.
    if (ideaTrack && idea.sectionName) {
      try {
        insertProductionTaskForSection({
          songId: ideaTrack.songId,
          trackId: ideaTrack.id,
          instrument: ideaTrack.name,
          sectionName: idea.sectionName,
        });
      } catch (err) {
        console.error('[ideas] failed to create production task:', err);
      }
    }

    // Log section-added once per user action. MediaBucket fires this route for every
    // active track simultaneously (Promise.all), so deduplicate via a 5-second window.
    try {
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
          const sectionAddedSong = await storage.getSongById(ideaTrack.songId);
          if (sectionAddedSong?.type !== 'idea') {
            const sectionAddedActor = req.session.userId
              ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
              : 'Someone';
            storage.logActivity({
              id: randomUUID(),
              songId: ideaTrack.songId,
              type: 'section-added',
              description: `${sectionAddedActor} added section ${idea.sectionName}`,
              timestamp: Date.now(),
              sectionName: idea.sectionName,
              author: sectionAddedActor,
            }).catch(console.error);
          }
        }
      }
    } catch (err) {
      console.error('[ideas] failed to log section-added activity:', err);
    }

    res.status(201).json(idea);
  });

  // ─── Clips (bucket versions) ─────────────────────────────────────────────────

  app.patch("/api/ideas/:ideaId", requireBand, async (req, res) => {
    const ideaId = req.params.ideaId as string;
    const songId = ideaSongId(ideaId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const hideIdeaRow = db.select().from(ideas).where(eq(ideas.id, ideaId)).get();
    const hideIdeaTrack = hideIdeaRow
      ? db.select().from(instrumentTracks).where(eq(instrumentTracks.id, hideIdeaRow.trackId)).get()
      : null;
    await storage.hideIdea(ideaId);
    const hideIdeaActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'idea-hidden',
      description: `${hideIdeaActor} hid section ${hideIdeaRow?.sectionName ?? ideaId} from ${hideIdeaTrack?.name ?? 'a track'}`,
      timestamp: Date.now(),
      instrument: hideIdeaTrack?.name,
      sectionName: hideIdeaRow?.sectionName ?? undefined,
      author: hideIdeaActor,
    }).catch(console.error);
    res.status(200).json({ ok: true });
  });

  app.post("/api/ideas/:ideaId/restore", requireBand, async (req, res) => {
    const ideaId = req.params.ideaId as string;
    const songId = ideaSongId(ideaId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const restoreIdeaRow = db.select().from(ideas).where(eq(ideas.id, ideaId)).get();
    const restoreIdeaTrack = restoreIdeaRow
      ? db.select().from(instrumentTracks).where(eq(instrumentTracks.id, restoreIdeaRow.trackId)).get()
      : null;
    await storage.restoreIdea(ideaId);
    const restoreIdeaActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'idea-restored',
      description: `${restoreIdeaActor} restored section ${restoreIdeaRow?.sectionName ?? ideaId} on ${restoreIdeaTrack?.name ?? 'a track'}`,
      timestamp: Date.now(),
      instrument: restoreIdeaTrack?.name,
      sectionName: restoreIdeaRow?.sectionName ?? undefined,
      author: restoreIdeaActor,
    }).catch(console.error);
    res.status(200).json({ ok: true });
  });

  app.get("/api/tracks/:trackId/hidden-ideas", requireBand, async (req, res) => {
    const trackId = req.params.trackId as string;
    const trackSongIdVal = trackSongId(trackId);
    if (!trackSongIdVal || !assertSongOwned(req, res, trackSongIdVal)) return;
    const hidden = await storage.getHiddenIdeas(trackId);
    res.json(hidden);
  });

  app.patch("/api/clips/:clipId", requireBand, async (req, res) => {
    const clipId = req.params.clipId as string;
    const songId = clipSongId(clipId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const { author: commentAuthor, ...clipUpdates } = req.body;
    const bucketClipActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const clip = await storage.updateClip(clipId, clipUpdates);
    if (!clip) return res.status(404).json({ message: "Clip not found" });

    // Temporary debug — write incoming body + updated clip to /tmp for Add to Song verification
    try {
      fs.writeFileSync('/tmp/patchbay-addsong-debug.json', JSON.stringify({ body: req.body, updatedClip: clip }, null, 2));
    } catch (_) {}


    if (clipUpdates.isFinal === true || clipUpdates.isFinal === false) {
      try {
        const idea = db.select().from(ideas).where(eq(ideas.id, clip.ideaId)).get();
        if (idea) {
          // Same-name rule: sync isFinal to timeline clips (no sibling clearing anywhere)
          if (clipUpdates.isFinal === true) {
            db.update(timelineClips).set({ isFinal: true })
              .where(and(eq(timelineClips.trackId, idea.trackId), eq(timelineClips.name, clip.name)))
              .run();
          } else {
            db.update(timelineClips).set({ isFinal: false })
              .where(and(eq(timelineClips.trackId, idea.trackId), eq(timelineClips.name, clip.name)))
              .run();
          }

          // Reconcile task status from full section state
          await reconcileSectionTaskStatus(
            idea.trackId,
            idea.sectionName,
            bucketClipActor,
            commentAuthor || "Unknown",
          );
        }
      } catch (err) {
        console.error("[isFinal] failed to sync task status:", err);
      }
    }

    // Log clip-metadata-edited for metadata-only patches
    if ('metadata' in clipUpdates && clipUpdates.isFinal === undefined && clipUpdates.active === undefined) {
      try {
        const metaIdea = db.select().from(ideas).where(eq(ideas.id, clip.ideaId)).get();
        const metaTrack = metaIdea
          ? db.select().from(instrumentTracks).where(eq(instrumentTracks.id, metaIdea.trackId)).get()
          : null;
        storage.logActivity({
          id: randomUUID(),
          songId,
          type: 'clip-metadata-edited',
          description: `${bucketClipActor} edited metadata on ${clip.name}`,
          timestamp: Date.now(),
          instrument: metaTrack?.name,
          sectionName: metaIdea?.sectionName ?? undefined,
          author: bucketClipActor,
        }).catch(console.error);
      } catch (err) {
        console.error('[clip-metadata] failed to log activity:', err);
      }
    }

    // Log clip-removed for soft-delete (active: false)
    if (clipUpdates.active === false) {
      try {
        const removeIdea = db.select().from(ideas).where(eq(ideas.id, clip.ideaId)).get();
        const removeTrack = removeIdea
          ? db.select().from(instrumentTracks).where(eq(instrumentTracks.id, removeIdea.trackId)).get()
          : null;
        storage.logActivity({
          id: randomUUID(),
          songId,
          type: 'clip-removed',
          description: `${bucketClipActor} removed ${clip.name}`,
          timestamp: Date.now(),
          instrument: removeTrack?.name,
          sectionName: removeIdea?.sectionName ?? undefined,
          author: bucketClipActor,
        }).catch(console.error);
      } catch (err) {
        console.error('[clip-remove] failed to log activity:', err);
      }
    }

    res.json(clip);
  });

  /** POST /api/ideas/:ideaId/clips — attach a clip record to an idea */
  app.post("/api/ideas/:ideaId/clips", requireBand, async (req, res) => {
    const ideaId = req.params.ideaId as string;
    const songId = ideaSongId(ideaId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const parsed = insertClipSchema.safeParse({
      ...req.body,
      ideaId,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }
    const clip = await storage.createClip(parsed.data);

    // Advance task from "todo" → "in-progress" when the first clip lands in the bucket
    const uploadActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    try {
      const idea = db.select().from(ideas).where(eq(ideas.id, ideaId)).get();
      if (idea?.sectionName && idea.trackId) {
        const track = db.select().from(instrumentTracks).where(eq(instrumentTracks.id, idea.trackId)).get();
        if (track) {
          const task = await storage.getTaskByInstrumentSection(track.songId, track.name, idea.sectionName);
          // Keep direct todo→in-progress for bucket-only uploads (reconcile returns early
          // when there are zero timeline clips, so this is the only path that fires then)
          if (task?.status === "todo") {
            await storage.updateTask(task.id, { status: "in-progress" });
          }
          storage.logActivity({
            id: randomUUID(), songId,
            type: 'file-uploaded',
            description: `${uploadActor} uploaded ${clip.name}`,
            timestamp: Date.now(),
            instrument: track.name,
            sectionName: idea.sectionName,
            author: uploadActor,
          }).catch(console.error);
          // Also reconcile in case timeline clips already exist for this section
          await reconcileSectionTaskStatus(
            idea.trackId,
            idea.sectionName,
            uploadActor,
            uploadActor,
          );
        }
      }
    } catch (err) {
      console.error("[ideas/:ideaId/clips] failed to advance task status:", err);
    }

    res.status(201).json(clip);
  });

  // ─── Clip Comments ────────────────────────────────────────────────────────────

  app.get("/api/clips/:clipId/comments", requireBand, async (req, res) => {
    const clipId = req.params.clipId as string;
    const songId = clipSongId(clipId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const comments = await storage.getClipComments(clipId);
    res.json(comments);
  });

  app.post("/api/clips/:clipId/comments", requireBand, async (req, res) => {
    const clipId = req.params.clipId as string;
    const songId = clipSongId(clipId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const { author, text, parentId } = req.body as { author: string; text: string; parentId?: string };
    if (parentId) {
      const parent = db.select().from(clipComments).where(eq(clipComments.id, parentId)).get();
      if (!parent || parent.parentId || parent.clipId !== clipId) {
        return res.status(400).json({ message: "parentId must reference a top-level comment on this clip" });
      }
    }
    const comment = await storage.addClipComment({
      id: randomUUID(),
      clipId,
      author,
      text,
      timestamp: Date.now(),
      parentId: parentId ?? null,
    });

    const clipCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: parentId ? 'clip-comment-reply' : 'clip-comment-added',
      description: parentId
        ? `${clipCommentActor} replied to a comment on a clip`
        : `${clipCommentActor} commented on a clip`,
      timestamp: Date.now(),
      author: clipCommentActor,
    }).catch(console.error);

    res.status(201).json(comment);
  });

  app.patch("/api/clip-comments/:id", requireBand, async (req, res) => {
    const commentId = req.params.id as string;
    const songId = clipCommentSongId(commentId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const comment = await storage.updateClipComment(commentId, req.body.text);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const editCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'clip-comment-edited',
      description: `${editCommentActor} edited a comment on a clip`,
      timestamp: Date.now(),
      author: editCommentActor,
    }).catch(console.error);

    res.json(comment);
  });

  app.delete("/api/clip-comments/:id", requireBand, async (req, res) => {
    const commentId = req.params.id as string;
    const songId = clipCommentSongId(commentId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const deleteCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId,
      type: 'clip-comment-deleted',
      description: `${deleteCommentActor} deleted a comment on a clip`,
      timestamp: Date.now(),
      author: deleteCommentActor,
    }).catch(console.error);
    await storage.deleteClipComment(commentId);
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
    requireBand,
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

        // Verify the upload destination belongs to this band
        if (ideaId) {
          const uploadSongId = ideaSongId(ideaId);
          if (!uploadSongId || !assertSongOwned(req, res, uploadSongId)) return;
        }

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

  app.get("/api/songs/:songId/production-tasks", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const tasks = await storage.getTasksForSong(songId);
    res.json(tasks);
  });

  app.get("/api/songs/:songId/task-counts", requireBand, (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const song = db.select({ type: songs.type }).from(songs).where(eq(songs.id, songId)).get();
    if (song?.type === "idea") {
      return res.json({ completed: 0, total: 0, applicable: false });
    }
    const rows = db
      .select({ status: productionTasks.status })
      .from(productionTasks)
      .innerJoin(instrumentTracks, and(
        eq(instrumentTracks.id, productionTasks.trackId),
        eq(instrumentTracks.active, true),
      ))
      .where(eq(productionTasks.songId, songId))
      .all();
    const total = rows.length;
    const completed = rows.filter(r => r.status === 'complete' || r.status === 'will-not-play').length;
    res.json({ completed, total, applicable: true });
  });

  app.get("/api/songs/:songId/clip-comment-summary", requireBand, (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const rows = db
      .select({
        clipId: clipComments.clipId,
        count: count(),
        latestTimestamp: max(clipComments.timestamp),
      })
      .from(clipComments)
      .innerJoin(clips, eq(clipComments.clipId, clips.id))
      .innerJoin(ideas, eq(clips.ideaId, ideas.id))
      .innerJoin(instrumentTracks, eq(ideas.trackId, instrumentTracks.id))
      .where(eq(instrumentTracks.songId, songId))
      .groupBy(clipComments.clipId)
      .all();
    const result: Record<string, { count: number; latestCommentAt: string }> = {};
    for (const row of rows) {
      if (row.count > 0) {
        result[row.clipId] = {
          count: row.count,
          latestCommentAt: new Date(row.latestTimestamp ?? 0).toISOString(),
        };
      }
    }
    res.json(result);
  });

  app.get("/api/songs/:songId/task-comment-counts", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const rows = db
      .select({ taskId: taskComments.taskId, count: count() })
      .from(taskComments)
      .innerJoin(productionTasks, eq(taskComments.taskId, productionTasks.id))
      .where(and(
        eq(productionTasks.songId, songId),
        ne(taskComments.author, 'System'),
        ne(taskComments.author, 'Unknown')
      ))
      .groupBy(taskComments.taskId)
      .all();
    const result: Record<string, number> = {};
    for (const row of rows) result[row.taskId] = row.count;
    res.json(result);
  });

  app.patch("/api/production-tasks/:id", requireBand, async (req, res) => {
    const taskId = req.params.id as string;
    const songId = taskSongId(taskId);
    if (!songId || !assertSongOwned(req, res, songId)) return;
    const { author: commentAuthor, ...taskUpdates } = req.body;

    const previous = db.select().from(productionTasks).where(eq(productionTasks.id, taskId)).get();

    if (taskUpdates.status === "complete") {
      if (!previous) return res.status(404).json({ message: "Task not found" });

      // Resolve the track once so we can query timeline clips
      const completeTrack = db.select().from(instrumentTracks)
        .where(and(eq(instrumentTracks.songId, previous.songId), eq(instrumentTracks.name, previous.instrument)))
        .get();

      if (!completeTrack) {
        return res.status(400).json({ message: "Cannot mark as complete — instrument track not found." });
      }

      // Guard: at least one timeline clip must exist for this section
      const allSectionClips = db.select().from(timelineClips)
        .where(and(
          eq(timelineClips.trackId, completeTrack.id),
          eq(timelineClips.sectionName, previous.sectionName),
        ))
        .all();

      if (allSectionClips.length === 0) {
        return res.status(400).json({
          message: "Cannot mark as complete — no clip in the timeline for this instrument and section.",
        });
      }

      // Mark ALL timeline clips in this section as final (same-name rule + bucket sync)
      try {
        const uniqueNames = Array.from(new Set(allSectionClips.map(c => c.name).filter((n): n is string => Boolean(n))));
        for (const name of uniqueNames) {
          db.update(timelineClips).set({ isFinal: true })
            .where(and(eq(timelineClips.trackId, completeTrack.id), eq(timelineClips.name, name)))
            .run();
          await storage.syncFinalClipFromTimeline(completeTrack.id, previous.sectionName, name, true);
        }
        if (uniqueNames.length > 0) {
          await storage.addTaskComment({
            id: randomUUID(),
            taskId,
            author: commentAuthor || "Unknown",
            text: `All clips marked final: ${uniqueNames.map(n => `"${n}"`).join(', ')}`,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error("[task patch] failed to auto-mark clips as final:", err);
      }
    }

    // Validate relatedClipId belongs to the same song (non-null only; null clears the link)
    if ('relatedClipId' in taskUpdates && taskUpdates.relatedClipId != null) {
      const relatedSong = clipSongId(taskUpdates.relatedClipId as string);
      if (!relatedSong || relatedSong !== songId) {
        return res.status(404).json({ message: "Not found" });
      }
    }

    const task = await storage.updateTask(taskId, taskUpdates);
    if (!task) return res.status(404).json({ message: "Task not found" });

    const author = commentAuthor || "Unknown";

    if (previous && taskUpdates.status && taskUpdates.status !== previous.status) {
      const label = STATUS_LABELS[taskUpdates.status as string];
      if (label) {
        const sessionUser = req.session.userId ? await storage.getUser(req.session.userId) : null;
        const actorName = sessionUser?.username ?? author;
        await storage.addTaskComment({
          id: randomUUID(),
          taskId,
          author: actorName,
          text: label,
          timestamp: Date.now(),
        });
        const displayLabel = label.replace(/^Status changed to /, '');
        storage.logActivity({
          id: randomUUID(),
          songId: previous.songId,
          type: 'task-status-change',
          description: `${actorName} changed status to ${displayLabel} — ${previous.instrument} · ${previous.sectionName}`,
          timestamp: Date.now(),
          instrument: previous.instrument,
          sectionName: previous.sectionName,
          author: actorName,
        }).catch(console.error);
      }
    }

    if (previous && 'assignee' in taskUpdates && taskUpdates.assignee !== previous.assignee) {
      const text = !taskUpdates.assignee ? "Assignee removed" : `Assignee set to ${taskUpdates.assignee}`;
      await storage.addTaskComment({
        id: randomUUID(),
        taskId,
        author,
        text,
        timestamp: Date.now(),
      });
    }

    if (previous && 'dueDate' in taskUpdates && taskUpdates.dueDate !== previous.dueDate) {
      const text = !taskUpdates.dueDate ? "Due date removed" : `Due date set to ${taskUpdates.dueDate}`;
      await storage.addTaskComment({
        id: randomUUID(),
        taskId,
        author,
        text,
        timestamp: Date.now(),
      });
    }

    if (taskUpdates.status && taskUpdates.status !== "complete" && previous?.status === "complete") {
      try {
        const revertTrack = db.select().from(instrumentTracks)
          .where(and(eq(instrumentTracks.songId, task.songId), eq(instrumentTracks.name, task.instrument)))
          .get();
        if (revertTrack && task.sectionName) {
          // Unmark ALL currently-final timeline clips in this section (same-name rule + bucket sync)
          const finalSectionClips = db.select().from(timelineClips)
            .where(and(
              eq(timelineClips.trackId, revertTrack.id),
              eq(timelineClips.sectionName, task.sectionName),
              eq(timelineClips.isFinal, true),
            ))
            .all();

          const processedNames = new Set<string>();
          const unmarkedNames: string[] = [];
          for (const tc of finalSectionClips) {
            if (!tc.name || processedNames.has(tc.name)) continue;
            processedNames.add(tc.name);
            unmarkedNames.push(tc.name);
            db.update(timelineClips).set({ isFinal: false })
              .where(and(eq(timelineClips.trackId, revertTrack.id), eq(timelineClips.name, tc.name)))
              .run();
            await storage.syncFinalClipFromTimeline(revertTrack.id, task.sectionName, tc.name, false);
          }

          if (unmarkedNames.length > 0) {
            const statusNames: Record<string, string> = {
              "todo": "To Do",
              "in-progress": "In Progress",
              "will-not-play": "Will Not Play",
            };
            await storage.addTaskComment({
              id: randomUUID(),
              taskId,
              author,
              text: `Clips unmarked as final: ${unmarkedNames.map(n => `"${n}"`).join(', ')}. Status changed to ${statusNames[taskUpdates.status as string] ?? taskUpdates.status}.`,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        console.error("[task patch] failed to unmark final clips:", err);
      }
    }

    res.json(task);
  });

  app.get("/api/production-tasks/:id/comments", requireBand, async (req, res) => {
    const tId = req.params.id as string;
    const sId = taskSongId(tId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const comments = await storage.getTaskComments(tId);
    res.json(comments);
  });

  app.post("/api/production-tasks/:id/comments", requireBand, async (req, res) => {
    const tId = req.params.id as string;
    const sId = taskSongId(tId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const { text, parentId } = req.body as { author?: string; text: string; parentId?: string };
    if (parentId) {
      const parent = db.select().from(taskComments).where(eq(taskComments.id, parentId)).get();
      if (!parent || parent.parentId || parent.taskId !== tId) {
        return res.status(400).json({ message: "parentId must reference a top-level comment on this task" });
      }
    }
    const taskCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    const comment = await storage.addTaskComment({
      id: randomUUID(),
      taskId: tId,
      author: taskCommentActor,
      text,
      timestamp: Date.now(),
      parentId: parentId ?? null,
    });
    storage.logActivity({
      id: randomUUID(),
      songId: sId,
      type: parentId ? 'task-comment-reply' : 'task-comment-added',
      description: parentId
        ? `${taskCommentActor} replied to a comment on a task`
        : `${taskCommentActor} commented on a task`,
      timestamp: Date.now(),
      author: taskCommentActor,
    }).catch(console.error);
    res.status(201).json(comment);
  });

  app.patch("/api/task-comments/:id", requireBand, async (req, res) => {
    const commentId = req.params.id as string;
    const sId = taskCommentSongId(commentId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const comment = await storage.updateTaskComment(commentId, req.body.text);
    if (!comment) return res.status(404).json({ message: "Comment not found" });
    const editTaskCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId: sId,
      type: 'task-comment-edited',
      description: `${editTaskCommentActor} edited a comment on a task`,
      timestamp: Date.now(),
      author: editTaskCommentActor,
    }).catch(console.error);
    res.json(comment);
  });

  app.delete("/api/task-comments/:id", requireBand, async (req, res) => {
    const commentId = req.params.id as string;
    const sId = taskCommentSongId(commentId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const deleteTaskCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(),
      songId: sId,
      type: 'task-comment-deleted',
      description: `${deleteTaskCommentActor} deleted a comment on a task`,
      timestamp: Date.now(),
      author: deleteTaskCommentActor,
    }).catch(console.error);
    await storage.deleteTaskComment(commentId);
    res.status(204).send();
  });

  // ─── Reviews ────────────────────────────────────────────────────────────────

  const REVIEWS_DIR = path.join(UPLOADS_DIR, "reviews");
  if (!fs.existsSync(REVIEWS_DIR)) fs.mkdirSync(REVIEWS_DIR, { recursive: true });

  app.get("/api/songs/:songId/reviews", requireBand, async (req, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    const reviews = await storage.getReviewsForSong(songId);
    res.json(reviews);
  });

  app.post("/api/songs/:songId/reviews", requireBand, upload.single("file"), async (req: Request, res) => {
    const songId = req.params.songId as string;
    if (!assertSongOwned(req, res, songId)) return;
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const name = String(req.body.name || "").trim();
      const format = String(req.body.format || "").trim();
      const duration = parseFloat(String(req.body.duration || "0")) || 0;
      if (!name || !format) return res.status(400).json({ message: "name and format are required" });

      const ext = format === "mp3" ? "mp3" : "wav";
      const filename = `review_${songId}_${Date.now()}.${ext}`;
      const destPath = path.join(REVIEWS_DIR, filename);
      fs.writeFileSync(destPath, req.file.buffer);

      const reviewActor = req.session.userId
        ? (await storage.getUser(req.session.userId))?.username ?? 'Unknown'
        : 'Unknown';
      const review = await storage.createReview({
        id: randomUUID(),
        songId,
        name,
        src: `/uploads/reviews/${filename}`,
        format,
        duration,
        createdBy: reviewActor,
      });
      storage.logActivity({
        id: randomUUID(), songId,
        type: 'review-shared',
        description: `${reviewActor} shared ${name} to Review`,
        timestamp: Date.now(),
        reviewId: review.id,
        author: reviewActor,
      }).catch(console.error);
      res.status(201).json(review);
    } catch (err) {
      console.error("[review upload] error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  app.delete("/api/reviews/:reviewId", requireBand, async (req, res) => {
    const reviewId = req.params.reviewId as string;
    const sId = reviewSongId(reviewId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    await storage.deleteReview(reviewId);
    res.status(204).send();
  });

  app.get("/api/reviews/:reviewId/comments", requireBand, async (req, res) => {
    const reviewId = req.params.reviewId as string;
    const sId = reviewSongId(reviewId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const comments = await storage.getReviewComments(reviewId);
    res.json(comments);
  });

  app.post("/api/reviews/:reviewId/comments", requireBand, async (req, res) => {
    const reviewId = req.params.reviewId as string;
    const sId = reviewSongId(reviewId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const { text, timestamp, parentId } = req.body as {
      author?: string; text: string; timestamp: number; parentId?: string;
    };
    if (!text || typeof timestamp !== "number") {
      return res.status(400).json({ message: "text and timestamp are required" });
    }

    const reviewCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';

    const review = db.select().from(songReviews).where(eq(songReviews.id, reviewId)).get();
    if (!review) return res.status(404).json({ message: "Review not found" });

    let parentAuthor: string | undefined;
    if (parentId) {
      const parent = db.select().from(songReviewComments)
        .where(eq(songReviewComments.id, parentId))
        .get();
      if (!parent || parent.parentId || parent.reviewId !== reviewId) {
        return res.status(400).json({ message: "parentId must reference a top-level comment on this review" });
      }
      parentAuthor = parent.author;
    }

    const comment = await storage.addReviewComment({
      id: randomUUID(),
      reviewId,
      author: reviewCommentActor,
      text,
      timestamp,
      parentId: parentId ?? null,
    });

    if (parentId && parentAuthor !== undefined) {
      storage.logActivity({
        id: randomUUID(),
        songId: review.songId,
        type: 'review-reply',
        description: `${reviewCommentActor} replied to ${parentAuthor}'s comment on ${review.name}`,
        timestamp: Date.now(),
        reviewId,
        commentId: comment.id,
        author: reviewCommentActor,
      }).catch(console.error);
    } else {
      storage.logActivity({
        id: randomUUID(),
        songId: review.songId,
        type: 'review-comment',
        description: `${reviewCommentActor} commented on ${review.name}`,
        timestamp: Date.now(),
        reviewId,
        commentId: comment.id,
        author: reviewCommentActor,
      }).catch(console.error);
    }

    res.status(201).json(comment);
  });

  app.patch("/api/review-comments/:id", requireBand, async (req, res) => {
    const commentId = req.params.id as string;
    const sId = reviewCommentSongId(commentId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const { text, resolved } = req.body as { text?: string; resolved?: boolean };
    const updates: { text?: string; resolved?: boolean; editedAt?: string } = {};
    if (text !== undefined) {
      updates.text = text;
      updates.editedAt = new Date().toISOString();
    }
    if (resolved !== undefined) updates.resolved = resolved;
    const comment = await storage.updateReviewComment(commentId, updates);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const patchReviewCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    if (text !== undefined) {
      storage.logActivity({
        id: randomUUID(), songId: sId,
        type: 'review-comment-edited',
        description: `${patchReviewCommentActor} edited a review comment`,
        timestamp: Date.now(), author: patchReviewCommentActor,
      }).catch(console.error);
    } else if (resolved !== undefined) {
      storage.logActivity({
        id: randomUUID(), songId: sId,
        type: resolved ? 'review-comment-resolved' : 'review-comment-unresolved',
        description: `${patchReviewCommentActor} ${resolved ? 'resolved' : 'unresolved'} a review comment`,
        timestamp: Date.now(), author: patchReviewCommentActor,
      }).catch(console.error);
    }

    res.json(comment);
  });

  app.delete("/api/review-comments/:id", requireBand, async (req, res) => {
    const commentId = req.params.id as string;
    const sId = reviewCommentSongId(commentId);
    if (!sId || !assertSongOwned(req, res, sId)) return;
    const deleteReviewCommentActor = req.session.userId
      ? (await storage.getUser(req.session.userId))?.username ?? 'Someone'
      : 'Someone';
    storage.logActivity({
      id: randomUUID(), songId: sId,
      type: 'review-comment-deleted',
      description: `${deleteReviewCommentActor} deleted a review comment`,
      timestamp: Date.now(), author: deleteReviewCommentActor,
    }).catch(console.error);
    await storage.deleteReviewComment(commentId);
    res.status(204).send();
  });

  // ─── Albums ─────────────────────────────────────────────────────────────────

  app.get("/api/albums", requireBand, async (req, res) => {
    res.json(await storage.getAlbums(req.bandId!));
  });

  app.post("/api/albums", requireBand, async (req, res) => {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return res.status(400).json({ message: "Album name is required." });
    const album = await storage.createAlbum(name.trim(), req.bandId!);
    return res.status(201).json(album);
  });

  app.patch("/api/albums/:id", requireBand, async (req, res) => {
    const albumId = req.params.id as string;
    if (!assertAlbumOwned(req, res, albumId)) return;
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return res.status(400).json({ message: "Album name is required." });
    const album = await storage.renameAlbum(albumId, name.trim());
    if (!album) return res.status(404).json({ message: "Album not found." });
    return res.json(album);
  });

  app.delete("/api/albums/:id", requireBand, async (req, res) => {
    const albumId = req.params.id as string;
    if (!assertAlbumOwned(req, res, albumId)) return;
    await storage.deleteAlbum(albumId);
    res.status(204).send();
  });

  app.get("/api/albums/:id/songs", requireBand, async (req, res) => {
    const albumId = req.params.id as string;
    if (!assertAlbumOwned(req, res, albumId)) return;
    res.json(await storage.getAlbumSongs(albumId));
  });

  app.post("/api/albums/:id/songs", requireBand, async (req, res) => {
    const albumId = req.params.id as string;
    if (!assertAlbumOwned(req, res, albumId)) return;
    const { songId } = req.body as { songId?: string };
    if (!songId) return res.status(400).json({ message: "songId is required." });
    if (!assertSongOwned(req, res, songId)) return;
    const result = await storage.addSongToAlbum(albumId, songId);
    return res.status(201).json(result);
  });

  app.delete("/api/albums/:id/songs/:songId", requireBand, async (req, res) => {
    const albumId = req.params.id as string;
    const songId = req.params.songId as string;
    if (!assertAlbumOwned(req, res, albumId)) return;
    if (!assertSongOwned(req, res, songId)) return;
    await storage.removeSongFromAlbum(albumId, songId);
    res.status(204).send();
  });

  app.patch("/api/albums/:id/songs/:songId/move", requireBand, async (req, res) => {
    const albumId = req.params.id as string;
    const songId = req.params.songId as string;
    if (!assertAlbumOwned(req, res, albumId)) return;
    if (!assertSongOwned(req, res, songId)) return;
    const { direction } = req.body as { direction?: string };
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ message: "direction must be 'up' or 'down'." });
    }
    await storage.moveAlbumSong(albumId, songId, direction);
    return res.json({ ok: true });
  });

  app.get("/api/album-memberships", requireBand, async (req, res) => {
    res.json(await storage.getAllAlbumMemberships(req.bandId!));
  });

  return httpServer;
}
