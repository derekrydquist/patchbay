import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

const dbPath = process.env.DATABASE_URL ?? "./patchbay.db";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "[PatchBay] WARNING: production is using the default ./patchbay.db on local disk — " +
      "data will NOT survive redeploys. Set DATABASE_URL to a persistent volume path.",
  );
}

// Export the raw connection so the session store can share the same file.
export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
