import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface AddInstrumentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  error?: string | null;
  onClearError?: () => void;
  title?: string;
  helperText?: string;
  placeholder?: string;
  hiddenTracks?: Array<{ id: string; name: string }>;
  onRestoreTrack?: (id: string) => void;
  isRestoring?: boolean;
}

export function AddInstrumentModal({
  open, onOpenChange,
  value, onChange, onSubmit,
  isPending, error, onClearError,
  title = 'Add Instrument',
  helperText = 'This instrument will be added across all sections.',
  placeholder = 'e.g. Keys',
  hiddenTracks, onRestoreTrack, isRestoring,
}: AddInstrumentModalProps) {
  const [selectedHiddenTrackId, setSelectedHiddenTrackId] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm uppercase tracking-widest font-heading">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Instrument Name</label>
            <Input
              placeholder={placeholder}
              value={value}
              onChange={(e) => { onChange(e.target.value); onClearError?.(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim()) onSubmit();
              }}
              className="bg-black/40 border-white/10 text-xs h-9"
              autoFocus
            />
            <p className="text-[9px] text-muted-foreground">{helperText}</p>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-[10px] text-red-400">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          {!!hiddenTracks?.length && (
            <div className="space-y-2 pt-2 border-t border-white/10">
              <label className="text-[10px] uppercase font-bold text-muted-foreground">Restore a removed instrument</label>
              <div className="flex gap-2">
                <Select value={selectedHiddenTrackId} onValueChange={setSelectedHiddenTrackId}>
                  <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9 flex-1">
                    <SelectValue placeholder="Select instrument…" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border max-h-48 overflow-y-auto">
                    {hiddenTracks.map(track => (
                      <SelectItem key={track.id} value={track.id} className="text-xs">
                        {track.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="uppercase tracking-widest text-[10px] font-bold shrink-0"
                  onClick={() => selectedHiddenTrackId && onRestoreTrack?.(selectedHiddenTrackId)}
                  disabled={!selectedHiddenTrackId || isRestoring}
                >
                  {isRestoring ? <Loader2 size={12} className="animate-spin" /> : 'Restore'}
                </Button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="uppercase tracking-widest text-[10px] font-bold"
              onClick={() => { if (value.trim()) onSubmit(); }}
              disabled={!value.trim() || isPending}
            >
              {isPending
                ? <><Loader2 size={12} className="mr-1 animate-spin" /> Adding…</>
                : title}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
