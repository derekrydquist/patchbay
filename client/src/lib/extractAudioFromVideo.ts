import type { FFmpeg } from '@ffmpeg/ffmpeg';

// Singleton FFmpeg instance — loaded once on first use, reused for all extractions.
// Uses the single-threaded core (not core-mt) so no COOP/COEP headers are required.
let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

// Serial execution queue — FFmpeg's in-memory FS is shared per instance, so
// concurrent write/exec/read sequences must not interleave.
let executionQueue: Promise<unknown> = Promise.resolve();

const TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s — the worker may have failed to load.`)), ms)
    ),
  ]);
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegInstance) {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    ffmpegInstance = new FFmpeg();
    console.log('[ffmpeg] FFmpeg instance created');
  }

  if (ffmpegInstance.loaded) {
    console.log('[ffmpeg] reusing already-loaded instance');
    return ffmpegInstance;
  }

  if (!loadPromise) {
    console.log('[ffmpeg] starting core load from CDN…');
    loadPromise = withTimeout(
      (async () => {
        const { toBlobURL } = await import('@ffmpeg/util');
        // Must use the ESM build — Vite spawns module workers (type:"module"), so
        // importScripts() always throws and the fallback is import(). The library's
        // auto UMD→ESM correction only fires for its own default URL; a custom blob
        // URL bypasses it, so we have to supply the ESM build ourselves.
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm';
        const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
        console.log('[ffmpeg] blob URLs ready, calling ffmpeg.load()…');
        await ffmpegInstance!.load({ coreURL, wasmURL });
        console.log('[ffmpeg] core loaded successfully ✓');
      })(),
      TIMEOUT_MS,
      'FFmpeg core load',
    );

    // Reset on failure so the next call can retry (e.g. CDN was briefly unavailable
    // or the Vite worker resolution hung).
    loadPromise.catch((err) => {
      console.error('[ffmpeg] core load failed:', err);
      loadPromise = null;
      ffmpegInstance = null;
    });
  }

  await loadPromise;
  return ffmpegInstance!;
}

/**
 * Extracts the audio track from a video File and returns an MP3 File.
 * Lazy-loads the ffmpeg.wasm core from CDN on first call; subsequent calls
 * reuse the cached instance. Calls are serialized so concurrent invocations
 * do not corrupt FFmpeg's in-memory filesystem. Times out after 60s so a
 * silent worker failure surfaces as an error toast instead of hanging forever.
 */
export async function extractAudioFromVideo(file: File): Promise<File> {
  console.log(`[ffmpeg] extractAudioFromVideo called for "${file.name}" (${file.type}, ${(file.size / 1024 / 1024).toFixed(2)} MB)`);

  const extraction = executionQueue.then(() =>
    withTimeout(
      (async () => {
        const ffmpeg = await getFFmpeg();
        const { fetchFile } = await import('@ffmpeg/util');

        const ext = file.name.match(/\.[^.]+$/)?.[0] ?? '.mp4';
        const inputName = `input${ext}`;
        const outputName = 'output.mp3';

        try {
          console.log(`[ffmpeg] fetching file data for "${file.name}"…`);
          const fileData = await fetchFile(file);
          console.log(`[ffmpeg] writing "${inputName}" to WASM FS (${fileData.byteLength} bytes)…`);
          await ffmpeg.writeFile(inputName, fileData);
          console.log(`[ffmpeg] "${inputName}" written ✓ — calling exec()…`);

          const exitCode = await ffmpeg.exec([
            '-i', inputName,
            '-vn',                    // strip video stream
            '-codec:a', 'libmp3lame', // encode audio as MP3
            '-q:a', '2',              // VBR ~190 kbps
            outputName,
          ]);

          console.log(`[ffmpeg] exec() completed, exit code: ${exitCode}`);

          if (exitCode !== 0) {
            throw new Error(`FFmpeg exited with code ${exitCode} — the file may be corrupt or use an unsupported codec.`);
          }

          console.log(`[ffmpeg] reading "${outputName}" from WASM FS…`);
          const data = await ffmpeg.readFile(outputName);
          console.log(`[ffmpeg] read ${(data as Uint8Array).byteLength} bytes ✓ — returning File`);

          const baseName = file.name.replace(/\.[^.]+$/, '');
          return new File([data as Uint8Array], `${baseName}.mp3`, { type: 'audio/mpeg' });
        } catch (err) {
          console.error('[ffmpeg] extraction error:', err);
          throw err;
        } finally {
          await ffmpeg.deleteFile(inputName).catch(() => {});
          await ffmpeg.deleteFile(outputName).catch(() => {});
        }
      })(),
      TIMEOUT_MS,
      `Audio extraction for "${file.name}"`,
    )
  );

  // Advance the queue regardless of success/failure so later calls are not blocked.
  executionQueue = extraction.catch((err) => {
    console.error('[ffmpeg] queued extraction failed (queue advanced):', err);
  });
  return extraction;
}
