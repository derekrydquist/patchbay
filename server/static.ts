import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In esbuild's CJS bundle (dist/index.cjs), Node.js injects __dirname at
  // runtime as the absolute directory of the bundle file — i.e. "dist/".
  // path.resolve(__dirname, "public") therefore equals "dist/public" regardless
  // of CWD, which is exactly where Vite places the client build.
  //
  // CLIENT_DIST_PATH lets Railway or other hosts override this if the layout
  // ever differs (e.g. the bundle and the static files live in different dirs).
  const distPath = process.env.CLIENT_DIST_PATH
    ? path.resolve(process.env.CLIENT_DIST_PATH)
    : path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
