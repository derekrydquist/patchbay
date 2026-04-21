import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Download, FileAudio, Settings2 } from 'lucide-react';

export function ExportDialog({ children }: { children: React.ReactNode }) {
  const [format, setFormat] = useState('wav');
  const [quality, setQuality] = useState('high');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = () => {
    setIsExporting(true);
    // Simulate export delay
    setTimeout(() => {
      setIsExporting(false);
    }, 2000);
  };

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
                  <span className="font-normal text-[10px] text-muted-foreground uppercase tracking-wider">Prevent clipping</span>
                </Label>
                <Checkbox id="normalize" defaultChecked className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
              </div>
              
              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="stems" className="flex flex-col space-y-1 cursor-pointer">
                  <span className="text-sm font-medium">Export Stems</span>
                  <span className="font-normal text-[10px] text-muted-foreground uppercase tracking-wider">Individual tracks</span>
                </Label>
                <Checkbox id="stems" className="border-white/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button 
            onClick={handleExport} 
            disabled={isExporting}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-widest transition-all"
          >
            {isExporting ? 'Rendering...' : 'Export File'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
