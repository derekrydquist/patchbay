import path from "path";
import fs from "fs";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { sqlite } from "./db";
import { BetterSqlite3Store } from "./session-store";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// #3 — session secret
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "SESSION_SECRET env var must be set in production. " +
      "Generate one with: openssl rand -hex 32",
  );
}

// #7 — Railway (and most PaaS) terminate TLS at a load balancer; without
// trust proxy, Express sees http and refuses to set secure cookies.
app.set("trust proxy", 1);

// #6 — SQLite-backed session store; sessions survive restarts and live on
// the same persistent volume as the database.
app.use(
  session({
    store: new BetterSqlite3Store(sqlite),
    secret: sessionSecret ?? "patchbay-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      // #7 — only send over HTTPS in production (Railway proxy sets this)
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

// #5 — uploads directory; resolve once from env, mkdir on boot
if (!process.env.UPLOADS_DIR && process.env.NODE_ENV === "production") {
  console.warn(
    "[PatchBay] WARNING: production is using the default ./uploads on local disk — " +
      "data will NOT survive redeploys. Set UPLOADS_DIR to a persistent volume path.",
  );
}
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// Serve uploaded audio files so <audio> tags can fetch them
app.use("/uploads", express.static(uploadsDir));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await storage.seedUsers();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // #8 — default to 3001 for local dev parity; Railway provides PORT at runtime.
  const port = parseInt(process.env.PORT || "3001", 10);
  httpServer.listen(port, () => {
    log(`serving on port ${port}`);
  });
})();
