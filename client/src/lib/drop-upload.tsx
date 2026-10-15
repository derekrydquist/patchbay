import { AlertCircle, CheckCircle2, Loader2, Undo2 } from 'lucide-react';
import { queryClient } from '@/lib/queryClient';
import { bucketKeys, looseFileKeys, type ApiClip, type ApiLooseFile } from '@/lib/bucket-api';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { requestLandingFlash, clipLandingZone, looseLandingZone } from '@/hooks/use-landing-flash';

// ── Finder-drop uploads ───────────────────────────────────────────────────────
// A Finder (OS) file drop uploads immediately, with no dialog. This module lives
// outside every surface, so a batch, its toast and its Undo survive the drop target
// unmounting (a spring that swaps a column, the Workspace Arrangement ↔ Production
// switch). Each startDropUpload call is one batch: its files upload one at a time
// through the one-request upload routes; separate drops run side by side.
//
// Nothing here moves the selection. The drop handler selects the destination at drop
// time; if the user has navigated away by the time files land, they stay put.
//
// Upload buttons keep using UploadModal.

export type DropUploadDestination =
  | { kind: 'placed'; songId: string; ideaId: string }
  | { kind: 'loose'; songId: string; trackId: string | null }
  | { kind: 'band-loose' };

export interface DropUploadOptions {
  files: File[];
  destination: DropUploadDestination;
  /** Human-readable destination: "Drums › Intro", "Drums", the song or Idea name, "Ideas". */
  label: string;
}

// What Undo needs for each landed file (POST /api/uploads/undo).
type UndoItem =
  | { kind: 'clip'; id: string; ideaId: string; taskAdvanced: boolean }
  | { kind: 'loose-file'; id: string; songId: string | null; trackId: string | null };

interface Landed { fileName: string; undo: UndoItem; }
interface Failed { fileName: string; reason: string; }

// The progress toast appears only if the batch is still running after this long.
// A local upload usually finishes almost at once; a progress toast shown and replaced
// right away only flashed an exit animation on every drop.
const PROGRESS_TOAST_DELAY_MS = 1000;

// Layout for every drop-upload toast, applied through the root's className (the
// Toaster's own markup in components/ui stays untouched): overflow-wrap is inherited,
// so an unbroken name wraps anywhere; the title/description wrapper (the root's first
// child) gets min-w-0 so it can shrink and the Undo action (shrink-0) stays on screen.
const LAYOUT_CLASS = '[overflow-wrap:anywhere] [&>div:first-child]:min-w-0';
const GOLD_TOAST_CLASS = `border-primary/50 bg-[#161410] shadow-[0_0_24px_rgba(234,179,8,0.25)] ${LAYOUT_CLASS}`;
const TITLE_CLASS = 'flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary';

// ── Leave-site warning while anything is uploading ────────────────────────────

let runningBatches = 0;

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Older browsers need returnValue set to show the prompt.
  e.returnValue = '';
}

function batchStarted() {
  if (runningBatches++ === 0) window.addEventListener('beforeunload', onBeforeUnload);
}

function batchFinished() {
  if (--runningBatches === 0) window.removeEventListener('beforeunload', onBeforeUnload);
}

// ── Requests ──────────────────────────────────────────────────────────────────

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { message?: unknown } | null;
  return typeof body?.message === 'string' && body.message ? body.message : fallback;
}

async function postFile<T>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form, credentials: 'include' });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
  if (!res.ok) throw new Error(await readError(res, `Upload failed (${res.status}).`));
  return res.json() as Promise<T>;
}

// Uploads one file to the destination's route; answers what Undo and the landing
// flash need.
async function uploadOne(file: File, dest: DropUploadDestination): Promise<{ undo: UndoItem; zone: string }> {
  if (dest.kind === 'placed') {
    const clip = await postFile<ApiClip & { taskAdvanced: boolean }>(
      `/api/ideas/${encodeURIComponent(dest.ideaId)}/clips/upload`, file,
    );
    return {
      undo: { kind: 'clip', id: clip.id, ideaId: clip.ideaId, taskAdvanced: clip.taskAdvanced },
      zone: clipLandingZone(clip.ideaId),
    };
  }
  const looseFile = dest.kind === 'loose'
    ? await postFile<ApiLooseFile>(
        `/api/songs/${encodeURIComponent(dest.songId)}/loose-files/upload`, file,
        dest.trackId ? { trackId: dest.trackId } : {},
      )
    : await postFile<ApiLooseFile>('/api/loose-files/unassigned/upload', file);
  return {
    undo: { kind: 'loose-file', id: looseFile.id, songId: looseFile.songId, trackId: looseFile.trackId },
    zone: looseLandingZone(looseFile),
  };
}

// The same keys UploadModal's onSuccess invalidates for that mode. A loose upload
// includes bucketKeys.bucket — the Tracks column's folder fill (hasLooseFiles) rides
// on it.
function invalidateFor(dest: DropUploadDestination) {
  if (dest.kind === 'band-loose') {
    queryClient.invalidateQueries({ queryKey: looseFileKeys.unassigned() });
    return;
  }
  const { songId } = dest;
  queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
  // all() covers the song's list and every Track's byTrack list.
  queryClient.invalidateQueries({ queryKey: looseFileKeys.all() });
  queryClient.invalidateQueries({ queryKey: ['activity'] });
  queryClient.invalidateQueries({ queryKey: ['songs'] });
  queryClient.invalidateQueries({ queryKey: ['production-tasks', songId] });
  queryClient.invalidateQueries({ queryKey: ['final-clips', songId] });
}

// ── Toast text ────────────────────────────────────────────────────────────────

const MAX_NAME_CHARS = 40;

// "ARCHSPIRE%20-%20Limb%20of…%29.mp3" — keeps the start and the extension (with the
// last few characters before it), about MAX_NAME_CHARS long. Every file name in these
// toasts goes through this.
export function shortenFileName(name: string, max = MAX_NAME_CHARS): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const tail = stem.slice(-4) + ext;
  return `${stem.slice(0, Math.max(1, max - 1 - tail.length))}…${tail}`;
}

function progressText(files: File[], done: number, label: string): string {
  if (files.length === 1) return `Uploading ${shortenFileName(files[0].name)} to ${label}…`;
  return `Uploading ${Math.min(done + 1, files.length)} of ${files.length} files to ${label}…`;
}

function failureList(failed: Failed[]): string {
  return failed.map(f => `${f.fileName} failed: ${f.reason}`).join('; ');
}

const TITLE_ICONS = {
  progress: <Loader2 size={14} className="animate-spin shrink-0" />,
  done: <CheckCircle2 size={14} className="shrink-0" />,
  undone: <Undo2 size={14} className="shrink-0" />,
  refused: <AlertCircle size={14} className="shrink-0" />,
};

function title(icon: keyof typeof TITLE_ICONS, text: string) {
  return <span className={TITLE_CLASS}>{TITLE_ICONS[icon]}{text}</span>;
}

// ── Undo ──────────────────────────────────────────────────────────────────────

async function undoBatch(landed: Landed[], dest: DropUploadDestination) {
  const names = new Map(landed.map(l => [l.undo.id, l.fileName]));
  let results: { id: string; status: 'undone' | 'refused'; reason?: string }[];
  try {
    const res = await fetch('/api/uploads/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ items: landed.map(l => l.undo) }),
    });
    if (!res.ok) throw new Error(await readError(res, `Undo failed (${res.status}).`));
    results = (await res.json() as { results: typeof results }).results;
  } catch (err) {
    toast({
      title: "Couldn't undo the upload",
      description: err instanceof Error && err.message !== 'Failed to fetch' ? err.message : "Couldn't reach the server.",
      variant: 'destructive',
      className: LAYOUT_CLASS,
    });
    return;
  }

  invalidateFor(dest);

  const undone = results.filter(r => r.status === 'undone');
  const refused = results.filter(r => r.status === 'refused');
  const reasonOf = (r: { id: string; reason?: string }) =>
    landed.length === 1 ? (r.reason ?? 'Unknown reason.') : `${names.get(r.id) ?? 'A file'}: ${r.reason ?? 'Unknown reason.'}`;

  // Same gold style as the "Uploaded" toast; only a failed request is destructive.
  if (!refused.length) {
    toast({ title: title('undone', 'Undone'), description: 'Upload undone', className: GOLD_TOAST_CLASS });
  } else if (undone.length) {
    toast({
      title: title('undone', 'Partly undone'),
      description: `Undid ${undone.length} of ${results.length} — ${refused.map(reasonOf).join('; ')}`,
      className: GOLD_TOAST_CLASS,
    });
  } else {
    toast({
      title: title('refused', 'Not undone'),
      description: refused.map(reasonOf).join('; '),
      className: GOLD_TOAST_CLASS,
    });
  }
}

// ── Batch ─────────────────────────────────────────────────────────────────────

export function startDropUpload({ files, destination, label }: DropUploadOptions): void {
  if (!files.length) return;
  void runBatch(files, destination, label);
}

async function runBatch(files: File[], dest: DropUploadDestination, label: string) {
  batchStarted();
  // Created only if the batch outlives PROGRESS_TOAST_DELAY_MS; then it stays up
  // until the batch finishes (duration Infinity), updated in place per file.
  let done = 0;
  const progress: { current: ReturnType<typeof toast> | null } = { current: null };
  const progressProps = () => ({
    title: title('progress', 'Uploading'),
    description: progressText(files, done, label),
    className: GOLD_TOAST_CLASS,
    duration: Infinity,
  });
  const progressTimer = window.setTimeout(() => {
    progress.current = toast(progressProps());
  }, PROGRESS_TOAST_DELAY_MS);

  const landed: Landed[] = [];
  const failed: Failed[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { undo, zone } = await uploadOne(file, dest);
        landed.push({ fileName: shortenFileName(file.name), undo });
        // Files appear as they land.
        invalidateFor(dest);
        // scrollPage: SongHome's Song Files grows with the page, so its column never
        // scrolls on its own — scroll the page to show the file instead.
        requestLandingFlash([{ id: undo.id, zone }], { scrollPage: true });
      } catch (err) {
        failed.push({ fileName: shortenFileName(file.name), reason: err instanceof Error ? err.message : 'Upload failed.' });
      }
      done = i + 1;
      if (progress.current && done < files.length) {
        progress.current.update({ id: progress.current.id, ...progressProps() });
      }
    }
  } finally {
    window.clearTimeout(progressTimer);
    batchFinished();
  }

  // The result is a NEW toast, not an in-place update of the progress toast. Radix
  // does restart its auto-dismiss timer when `duration` changes, but it seeds the
  // pause/resume "remaining time" once from the first duration (Infinity) and never
  // resets it — so after any hover (which is how you reach Undo) the result toast
  // would never close. A batch that finished inside the delay never had one.
  progress.current?.dismiss();

  if (!landed.length) {
    toast({
      title: 'Upload failed',
      description: files.length === 1
        ? `Couldn't upload ${shortenFileName(files[0].name)} to ${label}: ${failed[0].reason}`
        : `Couldn't upload ${files.length} files to ${label} — ${failureList(failed)}`,
      variant: 'destructive',
      className: LAYOUT_CLASS,
    });
    return;
  }

  let undoClicked = false;
  const result = toast({
    title: title('done', 'Uploaded'),
    description: !failed.length
      ? (files.length === 1 ? `Uploaded ${shortenFileName(files[0].name)} to ${label}` : `Uploaded ${files.length} files to ${label}`)
      : `Uploaded ${landed.length} of ${files.length} files to ${label} — ${failureList(failed)}`,
    className: GOLD_TOAST_CLASS,
    action: (
      <ToastAction
        altText="Undo upload"
        className="shrink-0"
        onClick={() => {
          // Radix closes the toast on click; the flag guards a second click that
          // lands before it unmounts.
          if (undoClicked) return;
          undoClicked = true;
          result.update({
            id: result.id,
            action: <ToastAction altText="Undo upload" className="shrink-0" disabled>Undo</ToastAction>,
          });
          void undoBatch(landed, dest);
        }}
      >
        Undo
      </ToastAction>
    ),
  });
}
