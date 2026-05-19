import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Download, FileAudio, Settings2, Loader2, Share2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Mp3Encoder } from '@breezystack/lamejs';
import JSZip from 'jszip';

type TimelineClip = {
  id: string;
  start: number;
  duration: number;
  src: string | null;
  trimStart: number;
  trimEnd: number | null;
};

type ApiTrack = {
  id: string;
  name: string;
  timelineClips: TimelineClip[];
};

type ExportClip = { src: string; start: number; duration: number; volume: number; trimStart: number; trimEnd: number | null };

type Progress = { phase: string; done: number; total: number };

// --- Audio utilities ---

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function encodeWav(buf: AudioBuffer): Blob {
  const nc = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const ns = buf.length;
  const bps = 16;
  const dataSize = ns * nc * (bps / 8);
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, nc, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * nc * (bps / 8), true);
  view.setUint16(32, nc * (bps / 8), true);
  view.setUint16(34, bps, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < ns; i++) {
    for (let ch = 0; ch < nc; ch++) {
      const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
      view.setInt16(off, Math.round(s * (s < 0 ? 32768 : 32767)), true);
      off += 2;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}

function encodeMp3(buf: AudioBuffer): Blob {
  const nc = buf.numberOfChannels;
  const encoder = new Mp3Encoder(nc, buf.sampleRate, 128);
  const BLOCK = 1152;
  const parts: Uint8Array[] = [];

  const toI16 = (f32: Float32Array): Int16Array => {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = Math.round(s * (s < 0 ? 32768 : 32767));
    }
    return out;
  };

  const left = toI16(buf.getChannelData(0));
  const right = nc > 1 ? toI16(buf.getChannelData(1)) : left;

  for (let i = 0; i < left.length; i += BLOCK) {
    const chunk = encoder.encodeBuffer(left.subarray(i, i + BLOCK), right.subarray(i, i + BLOCK));
    if (chunk.length > 0) parts.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);

  return new Blob(parts, { type: 'audio/mpeg' });
}

function normalizeInPlace(buf: AudioBuffer): void {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak === 0 || peak >= 1) return;
  const scale = 1 / peak;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

async function renderClips(
  clips: ExportClip[],
  totalDuration: number,
  onDecoded: () => void,
): Promise<AudioBuffer> {
  const SR = 44100;
  const frameCount = Math.max(1, Math.ceil(totalDuration * SR));
  console.log('[Export] renderClips — clips:', clips.length, '| totalDuration:', totalDuration, '| frameCount:', frameCount);
  const ctx = new OfflineAudioContext(2, frameCount, SR);

  await Promise.all(
    clips.map(async (clip, idx) => {
      console.log(`[Export] clip[${idx}] fetching: ${clip.src}`);
      try {
        const res = await fetch(clip.src);
        console.log(`[Export] clip[${idx}] fetch status: ${res.status} ${res.statusText} | type: ${res.headers.get('content-type')}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${clip.src}`);
        const ab = await res.arrayBuffer();
        console.log(`[Export] clip[${idx}] arrayBuffer size: ${ab.byteLength} bytes — decoding…`);
        const decoded = await ctx.decodeAudioData(ab);
        console.log(`[Export] clip[${idx}] decoded: ${decoded.duration.toFixed(2)}s | ${decoded.numberOfChannels}ch | ${decoded.sampleRate}Hz`);
        onDecoded();
        const trimStartSecs = clip.trimStart ?? 0;
        const trimEndSecs = clip.trimEnd ?? decoded.duration;
        const trimDuration = Math.max(0, trimEndSecs - trimStartSecs);
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        if (clip.volume !== 1) {
          const gain = ctx.createGain();
          gain.gain.value = clip.volume;
          source.connect(gain);
          gain.connect(ctx.destination);
        } else {
          source.connect(ctx.destination);
        }
        source.start(clip.start, trimStartSecs, trimDuration);
        console.log(`[Export] clip[${idx}] scheduled at start=${clip.start}s offset=${trimStartSecs}s duration=${trimDuration}s`);
      } catch (err) {
        console.error(`[Export] clip[${idx}] FAILED (${clip.src}):`, err);
        onDecoded();
      }
    }),
  );

  console.log('[Export] calling startRendering…');
  const rendered = await ctx.startRendering();
  console.log(`[Export] rendered: ${rendered.duration.toFixed(2)}s | ${rendered.numberOfChannels}ch | ${rendered.length} frames`);
  return rendered;
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function datestamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}${dd}${yyyy}`;
}

function generateFilename(songName: string, ext: string, instrument?: string): string {
  const base = `${slugify(songName)}_${datestamp()}`;
  return instrument ? `${base}_${slugify(instrument)}.${ext}` : `${base}.${ext}`;
}

function generateStemsZipName(songName: string): string {
  return `${slugify(songName)}_${datestamp()}_stems.zip`;
}

async function saveFile(blob: Blob, filename: string): Promise<void> {
  console.log(`[Export] saveFile: "${filename}" | ${blob.size} bytes | ${blob.type}`);

  if ('showSaveFilePicker' in window) {
    try {
      const ext = filename.split('.').pop() ?? 'wav';
      const mimeType = blob.type || `audio/${ext}`;
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Audio', accept: { [mimeType]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      console.log('[Export] saved via showSaveFilePicker');
      return;
    } catch (err: any) {
      // User cancelled the picker — AbortError is expected, don't fall through to anchor.
      if (err?.name === 'AbortError') {
        console.log('[Export] save cancelled by user');
        return;
      }
      console.warn('[Export] showSaveFilePicker failed, falling back to anchor download:', err);
    }
  }

  // Fallback: anchor download (Safari, Firefox without File System Access API)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  console.log('[Export] saved via anchor download fallback');
}

// --- Component ---

export function ExportDialog({ children, songId = 'patchbay-default' }: { children: React.ReactNode; songId?: string }) {
  const [format, setFormat] = useState('wav');
  const [normalize, setNormalize] = useState(true);
  const [exportStems, setExportStems] = useState(false);
  const [shareToReview, setShareToReview] = useState(false);
  const [reviewName, setReviewName] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const { toast } = useToast();

  // When "Share to Review" is toggled on, suggest the same filename the export would use.
  useEffect(() => {
    if (!shareToReview) return;
    fetch(`/api/songs/${songId}`)
      .then(r => r.json())
      .then((song: { name: string }) => {
        const suggested = `${slugify(song.name)}_${datestamp()}`;
        setReviewName(prev => prev || suggested);
      })
      .catch(() => {});
  }, [shareToReview, songId]);

  const handleShareToReviewChange = (checked: boolean) => {
    setShareToReview(checked);
    if (!checked) setReviewName('');
  };

  const handleExport = async () => {
    console.log('[Export] ——— handleExport START ———', { songId, format, normalize, exportStems });
    setIsExporting(true);
    setProgress({ phase: 'Fetching timeline…', done: 0, total: 0 });

    try {
      const res = await fetch(`/api/songs/${songId}/timeline`);
      console.log('[Export] timeline fetch status:', res.status);
      if (!res.ok) throw new Error(`Timeline fetch failed: HTTP ${res.status}`);
      const body = await res.json();
      const songName: string = body.songName ?? 'Untitled';
      const tracks: ApiTrack[] = body.tracks;
      console.log('[Export] songName:', songName, '| tracks:', tracks.map((t) => ({ id: t.id, name: t.name, clips: t.timelineClips.length })));

      const VOLUME = 0.8;
      const tracksWithClips = tracks.filter((t) => t.timelineClips.some((c) => c.src));
      console.log('[Export] tracksWithClips:', tracksWithClips.length, '(tracks that have ≥1 clip with a src URL)');

      if (tracksWithClips.length === 0) {
        console.warn('[Export] No clips with src found — nothing to export. Aborting.');
        setIsExporting(false);
        setProgress(null);
        return;
      }

      const allClips: ExportClip[] = tracksWithClips.flatMap((t) =>
        t.timelineClips.filter((c) => c.src).map((c) => ({
          src: c.src!,
          start: c.start,
          duration: c.duration,
          volume: VOLUME,
          trimStart: c.trimStart ?? 0,
          trimEnd: c.trimEnd ?? null,
        })),
      );
      const totalDuration = Math.max(...allClips.map((c) => c.start + (c.trimEnd ?? c.duration) - c.trimStart));
      console.log('[Export] allClips:', allClips, '| totalDuration:', totalDuration);
      const ext = format === 'mp3' ? 'mp3' : 'wav';

      if (exportStems) {
        const zip = new JSZip();
        let stemsDone = 0;

        for (const track of tracksWithClips) {
          const stemClips: ExportClip[] = track.timelineClips
            .filter((c) => c.src)
            .map((c) => ({
              src: c.src!,
              start: c.start,
              duration: c.duration,
              volume: VOLUME,
              trimStart: c.trimStart ?? 0,
              trimEnd: c.trimEnd ?? null,
            }));

          let clipsDone = 0;
          setProgress({ phase: `Rendering ${track.name} (0/${stemClips.length} clips)…`, done: stemsDone, total: tracksWithClips.length });

          const rendered = await renderClips(stemClips, totalDuration, () => {
            clipsDone++;
            setProgress({ phase: `Rendering ${track.name} (${clipsDone}/${stemClips.length} clips)…`, done: stemsDone, total: tracksWithClips.length });
          });

          if (normalize) normalizeInPlace(rendered);

          setProgress({ phase: `Encoding ${track.name}…`, done: stemsDone, total: tracksWithClips.length });
          console.log(`[Export] encoding stem: ${track.name} as ${format}`);
          const blob = format === 'mp3' ? encodeMp3(rendered) : encodeWav(rendered);
          console.log(`[Export] stem blob size: ${blob.size} bytes`);
          zip.file(generateFilename(songName, ext, track.name), blob);
          stemsDone++;
        }

        setProgress({ phase: 'Creating zip…', done: tracksWithClips.length, total: tracksWithClips.length });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        console.log('[Export] zip blob size:', zipBlob.size, 'bytes');
        await saveFile(zipBlob, generateStemsZipName(songName));
      } else {
        let clipsDone = 0;
        setProgress({ phase: `Fetching audio (0/${allClips.length} clips)…`, done: 0, total: allClips.length });

        const rendered = await renderClips(allClips, totalDuration, () => {
          clipsDone++;
          setProgress({ phase: `Fetching audio (${clipsDone}/${allClips.length} clips)…`, done: clipsDone, total: allClips.length });
        });

        if (normalize) {
          console.log('[Export] normalizing…');
          normalizeInPlace(rendered);
        }

        console.log(`[Export] encoding as ${format}…`);
        setProgress({ phase: `Encoding ${format.toUpperCase()}…`, done: allClips.length, total: allClips.length });
        const blob = format === 'mp3' ? encodeMp3(rendered) : encodeWav(rendered);
        console.log(`[Export] blob ready: ${blob.size} bytes | type: ${blob.type}`);
        await saveFile(blob, generateFilename(songName, ext));

        if (shareToReview && reviewName.trim()) {
          setProgress({ phase: 'Sharing to Review tab…', done: allClips.length, total: allClips.length });
          const formData = new FormData();
          formData.append('file', blob, `review.${ext}`);
          formData.append('name', reviewName.trim());
          formData.append('format', format);
          formData.append('duration', String(totalDuration));
          const uploadRes = await fetch(`/api/songs/${songId}/reviews`, { method: 'POST', body: formData });
          if (uploadRes.ok) {
            toast({ title: 'Shared to Review tab' });
          }
        }
      }

      console.log('[Export] ——— handleExport DONE ———');
    } catch (err) {
      console.error('[Export] CAUGHT ERROR:', err);
      if (err instanceof Error) {
        console.error('[Export] message:', err.message);
        console.error('[Export] stack:', err.stack);
      }
    } finally {
      console.log('[Export] finally — resetting state');
      setIsExporting(false);
      setProgress(null);
    }
  };

  const progressPct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-[#09090b] border-white/10 text-white shadow-2xl shadow-black/50">
        <DialogHeader>
          <DialogTitle className="text-xl font-heading uppercase tracking-widest text-primary flex items-center gap-2">
            <Download size={20} />
            Export Mixdown
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Render your current timeline to an audio file.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-primary/70 flex items-center gap-2 border-b border-white/10 pb-2">
              <FileAudio size={14} />
              Format
            </h4>
            <RadioGroup defaultValue={format} onValueChange={setFormat} className="grid grid-cols-2 gap-4">
              <div>
                <RadioGroupItem value="wav" id="wav" className="peer sr-only" />
                <Label
                  htmlFor="wav"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-white/5 bg-white/[0.02] p-4 hover:bg-white/[0.05] hover:border-white/20 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 cursor-pointer transition-all"
                >
                  <span className="text-lg font-bold">WAV</span>
                  <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Lossless (Best)</span>
                </Label>
              </div>
              <div>
                <RadioGroupItem value="mp3" id="mp3" className="peer sr-only" />
                <Label
                  htmlFor="mp3"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-white/5 bg-white/[0.02] p-4 hover:bg-white/[0.05] hover:border-white/20 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 cursor-pointer transition-all"
                >
                  <span className="text-lg font-bold">MP3</span>
                  <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">Compressed</span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-primary/70 flex items-center gap-2 border-b border-white/10 pb-2">
              <Settings2 size={14} />
              Options
            </h4>

            <div className="space-y-3">
              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="normalize" className="flex flex-col space-y-1 cursor-pointer">
                  <span className="text-sm font-medium">Normalize Audio</span>
                  <span className="font-normal text-[10px] text-muted-foreground uppercase tracking-wider">Peak at 0 dBFS</span>
                </Label>
                <Checkbox
                  id="normalize"
                  checked={normalize}
                  onCheckedChange={(v) => setNormalize(v === true)}
                  className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </div>

              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="stems" className="flex flex-col space-y-1 cursor-pointer">
                  <span className="text-sm font-medium">Export Stems</span>
                  <span className="font-normal text-[10px] text-muted-foreground uppercase tracking-wider">Individual tracks as zip</span>
                </Label>
                <Checkbox
                  id="stems"
                  checked={exportStems}
                  onCheckedChange={(v) => setExportStems(v === true)}
                  className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </div>

              {!exportStems && (
                <>
                  <div className="flex items-center justify-between space-x-2">
                    <Label htmlFor="share-review" className="flex flex-col space-y-1 cursor-pointer">
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        <Share2 size={13} className="text-primary/60" />
                        Share to Review
                      </span>
                      <span className="font-normal text-[10px] text-muted-foreground uppercase tracking-wider">Post mix to Review tab</span>
                    </Label>
                    <Checkbox
                      id="share-review"
                      checked={shareToReview}
                      onCheckedChange={(v) => handleShareToReviewChange(v === true)}
                      className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </div>

                  {shareToReview && (
                    <div className="space-y-1.5 pl-1">
                      <Label htmlFor="review-name" className="text-[10px] text-muted-foreground uppercase tracking-wider">Version Name</Label>
                      <input
                        id="review-name"
                        type="text"
                        value={reviewName}
                        onChange={(e) => setReviewName(e.target.value)}
                        placeholder="Demo v1"
                        className="w-full bg-white/[0.03] border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-primary/40 transition-colors"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin text-primary shrink-0" />
                <span className="truncate">{progress.phase}</span>
              </div>
              {progressPct !== null && (
                <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-widest transition-all"
          >
            {isExporting ? (
              <span className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Rendering…
              </span>
            ) : shareToReview && !exportStems ? (
              'Export & Share'
            ) : (
              'Export File'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
