import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import { type ApiClip, type ApiIdea, type ApiTrack, fetchBucket, bucketKeys } from '@/lib/bucket-api';
import { Upload, FileAudio, X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

async function uploadFile(
  file: File,
  instrument: string,
  section: string,
  ideaId: string,
): Promise<{ url: string; duration: number; format: string; originalFileName: string; sampleRate: string; bitDepth: string; channels: string; uploadedDate: string; uploadedBy: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('instrument', instrument);
  form.append('section', section);
  form.append('ideaId', ideaId);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(err.message ?? 'Upload failed');
  }
  return res.json();
}

async function createClip(ideaId: string, payload: {
  id: string;
  name: string;
  type: string;
  color: string;
  duration: number;
  src: string;
  sectionName: string;
  isFinal: boolean;
  metadata: Record<string, unknown>;
}): Promise<ApiClip> {
  const res = await fetch(`/api/ideas/${ideaId}/clips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ideaId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to save clip' }));
    throw new Error(err.message ?? 'Failed to save clip');
  }
  return res.json();
}

export interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: string;
  defaultIdeaId?: string;
  defaultInstrumentName?: string;
  defaultSectionName?: string;
  initialFiles?: File[];
  songType?: 'song' | 'idea';
  onUploadSuccess?: (result: { destTrackId: string; destIdeaId: string }) => void;
}

export function UploadModal({
  open, onOpenChange, songId,
  defaultIdeaId, defaultInstrumentName, defaultSectionName,
  initialFiles, songType = 'song', onUploadSuccess,
}: UploadModalProps) {
  const queryClient = useQueryClient();
  const [uploadFiles, setUploadFiles] = useState<{ name: string; size: string; file: File }[]>([]);
  const [uploadDestination, setUploadDestination] = useState(defaultIdeaId ?? '');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tracks = [] } = useQuery<ApiTrack[]>({
    queryKey: bucketKeys.bucket(songId),
    queryFn: () => fetchBucket(songId),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setUploadDestination(defaultIdeaId ?? '');
      setUploadError(null);
      if (initialFiles?.length) {
        setUploadFiles(initialFiles.map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f })));
      }
    } else {
      setUploadFiles([]);
      setUploadDestination('');
      setUploadError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files)
      .filter(f => f.type.startsWith('audio/'))
      .map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f }));
    setUploadFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files).map(f => ({ name: f.name, size: (f.size / 1024 / 1024).toFixed(2) + ' MB', file: f }));
    setUploadFiles(prev => [...prev, ...files]);
    e.target.value = '';
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const destId = uploadDestination;
      if (!destId || uploadFiles.length === 0) return;
      setUploadError(null);
      let destTrack: ApiTrack | null = null;
      let destIdea: ApiIdea | null = null;
      for (const t of tracks) {
        const idea = t.ideas.find(i => i.id === destId);
        if (idea) { destTrack = t; destIdea = idea; break; }
      }
      if (!destTrack || !destIdea) throw new Error('Destination not found');
      const usingDefault = defaultIdeaId && uploadDestination === defaultIdeaId;
      const instrumentForUpload = (usingDefault && defaultInstrumentName) ? defaultInstrumentName : destTrack.name;
      const sectionForUpload = (usingDefault && defaultSectionName) ? defaultSectionName : destIdea.sectionName;
      for (const { file } of uploadFiles) {
        const { url, duration, format, originalFileName, sampleRate, bitDepth, channels, uploadedDate, uploadedBy } =
          await uploadFile(file, instrumentForUpload, sectionForUpload, destIdea.id);
        const versionNum = destIdea.clips.length + 1;
        const clipName = songType === 'idea'
          ? (originalFileName || file.name)
          : `${destTrack.name} ${destIdea.sectionName} V${versionNum}`;
        await createClip(destIdea.id, {
          id: nanoid(),
          name: clipName,
          type: destTrack.type === 'vocal' ? 'vocal' : 'audio',
          color: destTrack.color ?? 'hsl(var(--primary))',
          duration, src: url, sectionName: destIdea.sectionName, isFinal: false,
          metadata: {
            format, originalFileName, uploadedBy, uploadedDate, sampleRate, bitDepth,
            channels: (channels as 'Mono' | 'Stereo' | '5.1') || 'Stereo',
            peakLevel: '', timeSignature: '', key: '', bpm: 0, description: '', tags: [],
          },
        });
        destIdea = { ...destIdea, clips: [...destIdea.clips, {} as ApiClip] };
      }
      return { destTrackId: destTrack.id, destIdeaId: destId };
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: bucketKeys.bucket(songId) });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      onOpenChange(false);
      setUploadFiles([]);
      setUploadDestination('');
      onUploadSuccess?.(result);
    },
    onError: (err: Error) => setUploadError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={open => {
      onOpenChange(open);
      if (!open) { setUploadFiles([]); setUploadDestination(defaultIdeaId ?? ''); setUploadError(null); }
    }}>
      <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-xl p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
          <DialogTitle className="text-sm uppercase tracking-widest font-heading">Asset Ingestion</DialogTitle>
          <p className="text-[10px] text-muted-foreground mt-1 uppercase">Drop files to add them to the project</p>
        </div>
        <div className="p-6 space-y-6">
          {songType === 'idea' ? (
            defaultInstrumentName && (
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Uploading to</label>
                <p className="text-xs text-white/80 font-medium px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-md">
                  {defaultInstrumentName}{defaultSectionName ? ` → ${defaultSectionName}` : ''}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Destination Section</label>
              <Select value={uploadDestination} onValueChange={setUploadDestination}>
                <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9">
                  <SelectValue placeholder="Select Destination" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-64 overflow-y-auto">
                  {tracks.flatMap(track =>
                    track.ideas.map(idea => (
                      <SelectItem key={idea.id} value={idea.id} className="text-xs">
                        {track.name} → {idea.sectionName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/10 rounded-xl p-10 flex flex-col items-center justify-center gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
          >
            <input type="file" ref={fileInputRef} className="hidden" multiple accept="audio/*" onChange={handleFileSelect} />
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Upload size={24} className="text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">Click or drag audio files here</p>
              <p className="text-xs text-muted-foreground mt-1">WAV, AIFF, or MP3 up to 50MB</p>
            </div>
          </div>
          {uploadFiles.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] uppercase font-bold text-muted-foreground">
                Pending Uploads ({uploadFiles.length})
              </h4>
              <div className="max-h-48 overflow-y-auto space-y-2 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10">
                {uploadFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileAudio size={16} className="text-primary" />
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-white">{f.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{f.size}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}>
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-white/5 flex justify-end">
                <Button
                  className="h-9 uppercase tracking-widest text-[10px] font-bold"
                  onClick={() => uploadMutation.mutate()}
                  disabled={!uploadDestination || uploadFiles.length === 0 || uploadMutation.isPending}
                >
                  {uploadMutation.isPending
                    ? <><Loader2 size={14} className="mr-2 animate-spin" />Uploading…</>
                    : 'Confirm Ingestion'}
                </Button>
              </div>
              {uploadError && (
                <div className="flex items-center gap-2 text-[10px] text-red-400 pt-1">
                  <AlertCircle size={12} /> {uploadError}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
