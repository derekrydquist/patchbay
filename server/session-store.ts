import session from "express-session";
import type Database from "better-sqlite3";

interface SessionRow {
  sess: string;
  expired_at: number;
}

/**
 * Minimal better-sqlite3 session store for express-session.
 * Writes to the same SQLite database as the rest of the app so sessions
 * survive server restarts and live on the same persistent volume.
 */
export class BetterSqlite3Store extends session.Store {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    super();
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid       TEXT PRIMARY KEY NOT NULL,
        sess      TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      )
    `);
    // Prune expired rows every 15 minutes; .unref() so the timer doesn't
    // keep the process alive if everything else has shut down.
    const prune = () =>
      db.prepare("DELETE FROM sessions WHERE expired_at < ?").run(Date.now());
    prune();
    setInterval(prune, 15 * 60 * 1000).unref();
  }

  get(
    sid: string,
    callback: (err: any, session?: session.SessionData | null) => void,
  ): void {
    try {
      const row = this.db
        .prepare("SELECT sess, expired_at FROM sessions WHERE sid = ?")
        .get(sid) as SessionRow | undefined;
      if (!row || row.expired_at < Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess) as session.SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: any) => void,
  ): void {
    try {
      const expiredAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.db
        .prepare(
          `INSERT INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE
           SET sess = excluded.sess, expired_at = excluded.expired_at`,
        )
        .run(sid, JSON.stringify(sess), expiredAt);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(
    sid: string,
    sess: session.SessionData,
    callback?: () => void,
  ): void {
    this.set(sid, sess, callback);
  }
}
