import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { User, Check, Camera } from 'lucide-react';
import { cn } from '@/lib/utils';

const DEFAULT_INSTRUMENTS = ['Drums', 'Bass', 'Guitar 1', 'Guitar 2', 'Vocals'];

interface ProfileSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function readInstruments(): string[] {
  try {
    return JSON.parse(localStorage.getItem('patchbay-profile-instruments') ?? '[]');
  } catch {
    return [];
  }
}

export function ProfileSettingsModal({ open, onOpenChange }: ProfileSettingsModalProps) {
  // TODO: replace with real auth user storage
  const [avatar, setAvatar] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('John Doe');
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync from localStorage each time the modal opens
  useEffect(() => {
    if (!open) return;
    setAvatar(localStorage.getItem('patchbay-profile-avatar'));
    setDisplayName(localStorage.getItem('patchbay-profile-name') ?? 'John Doe');
    setSelectedInstruments(readInstruments());
    setSaved(false);
  }, [open]);

  const initials = displayName.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'JD';

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const toggleInstrument = (instrument: string) => {
    setSelectedInstruments(prev =>
      prev.includes(instrument) ? prev.filter(i => i !== instrument) : [...prev, instrument]
    );
  };

  const handleSave = () => {
    // TODO: replace with real auth user storage
    if (avatar) {
      localStorage.setItem('patchbay-profile-avatar', avatar);
    } else {
      localStorage.removeItem('patchbay-profile-avatar');
    }
    localStorage.setItem('patchbay-profile-name', displayName);
    localStorage.setItem('patchbay-profile-instruments', JSON.stringify(selectedInstruments));
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onOpenChange(false);
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-md p-0 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading font-bold text-white flex items-center gap-2">
              <User size={16} className="text-primary" /> Profile Settings
            </DialogTitle>
          </DialogHeader>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2">
            Manage your identity and instrument preferences
          </p>
        </div>

        <div className="p-6 space-y-8">
          {/* PROFILE */}
          <div className="space-y-4">
            <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold border-b border-white/5 pb-2">
              Profile
            </h4>

            {/* Avatar upload */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleAvatarClick}
                className="relative w-16 h-16 rounded-full bg-gradient-to-tr from-primary/20 to-white/10 border border-white/10 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors group shrink-0"
              >
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <span className="text-lg font-bold text-primary">{initials}</span>
                )}
                <div className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera size={16} className="text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="space-y-1">
                <p className="text-xs font-bold text-white/90">Profile Photo</p>
                <p className="text-[10px] text-muted-foreground">Click to upload. Shown as your avatar across PatchBay.</p>
              </div>
            </div>

            {/* Display Name */}
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Display Name
              </Label>
              <Input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="bg-black/40 border-white/10 text-xs focus-visible:ring-primary/50 h-9"
              />
            </div>

            {/* Email — read-only until auth */}
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Email
              </Label>
              <Input
                value="john@example.com"
                readOnly
                disabled
                className="bg-black/20 border-white/5 text-xs text-white/30 h-9 cursor-not-allowed"
              />
              <p className="text-[10px] text-muted-foreground">Managed via account settings</p>
            </div>
          </div>

          {/* YOUR INSTRUMENTS */}
          <div className="space-y-4 pt-2 border-t border-white/5">
            <h4 className="text-[10px] uppercase tracking-[0.2em] text-primary/70 font-bold border-b border-white/5 pb-2">
              Your Instruments
            </h4>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_INSTRUMENTS.map(instrument => {
                const isSelected = selectedInstruments.includes(instrument);
                return (
                  <button
                    key={instrument}
                    type="button"
                    onClick={() => toggleInstrument(instrument)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-bold border transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20 hover:text-white/60'
                    )}
                  >
                    {instrument}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">Select the instruments you play in this band.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-end gap-3">
          {saved && (
            <span className="text-green-400 text-xs flex items-center gap-1">
              <Check size={10} /> Saved
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={saved}
            className="h-8 px-5 bg-primary text-black hover:bg-primary/90 font-bold text-xs"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
