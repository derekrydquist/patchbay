// Builds the filename a Download saves under: "{prefix}_{base}.{ext}".
// - Real-song clip:  prefix = song name, base = clip name ("Midnight_Horizon_Drums_Intro_V2.mp3")
// - Ideas clip:      prefix = Idea name, base = clip name
// - Song/Track-scoped loose file: prefix = song name, base = original file name
// - Band-wide loose file: no prefix (it has no song)
// Display-only: stored names, uploads and Export names are untouched.

const MAX_LENGTH = 120;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aif|aiff|webm|mp4)$/i;
// music-metadata reports containers ("WAVE", "MPEG"), not extensions.
const FORMAT_EXT: Record<string, string> = { wave: 'wav', mpeg: 'mp3', 'mpeg-4': 'm4a', aiff: 'aiff', flac: 'flac', ogg: 'ogg' };

function extOf(path: string | undefined): string | undefined {
  const m = path?.split(/[?#]/)[0].match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : undefined;
}

function formatExt(format: string | undefined): string | undefined {
  if (!format) return undefined;
  const f = format.trim().toLowerCase();
  return FORMAT_EXT[f] ?? (/^[a-z0-9]{1,5}$/.test(f) ? f : undefined);
}

function sanitize(part: string): string {
  return part
    .replace(/\s+/g, '_')
    .replace(/[\u0000-\u001f\u007f/\\:*?"'<>|]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '');
}

export function buildDownloadFilename(opts: {
  prefix?: string | null;
  base: string;
  src?: string;
  format?: string;
  originalFileName?: string;
}): string {
  const ext = extOf(opts.src) ?? formatExt(opts.format) ?? extOf(opts.originalFileName)
    ?? (AUDIO_EXT.test(opts.base) ? extOf(opts.base) : undefined) ?? 'wav';
  // A raw-filename base ("bass_intro.mp3") must not end up as "bass_intro.mp3.mp3".
  let base = opts.base.trim();
  if (base.toLowerCase().endsWith(`.${ext}`)) base = base.slice(0, -(ext.length + 1));
  else base = base.replace(AUDIO_EXT, '');
  const stem = [opts.prefix, base].map((p) => sanitize(p ?? '')).filter(Boolean).join('_') || 'download';
  return `${stem.slice(0, MAX_LENGTH - ext.length - 1).replace(/[_.]+$/, '')}.${ext}`;
}

export function downloadFile(src: string, filename: string) {
  const link = document.createElement('a');
  link.href = src;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
