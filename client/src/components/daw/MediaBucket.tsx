import React, { useState } from 'react';
import { MOCK_SONG, InstrumentFolder, Idea, Clip } from '@/lib/daw-data';
import { BucketClip } from './Clip';
import { ChevronRight, Folder, Music, User, Library, Search, Upload, FileAudio, X, CheckCircle2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface MediaBucketProps {
  onAddToTimeline?: (clip: Clip) => void;
}

export function MediaBucket({ onAddToTimeline }: MediaBucketProps) {
  const [selectedInst, setSelectedInst] = useState<InstrumentFolder | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<{name: string, size: string}[]>([]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).map(f => ({
      name: f.name,
      size: (f.size / 1024 / 1024).toFixed(2) + ' MB'
    }));
    setUploadFiles(prev => [...prev, ...files]);
  };

  return (
    <div className="w-full h-80 border-b border-border bg-sidebar/80 backdrop-blur-xl flex flex-col z-20">
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Library size={18} className="text-primary" />
          <h2 className="text-sm font-heading font-bold uppercase tracking-widest text-white">
            Project: {MOCK_SONG.name}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input placeholder="Search project assets..." className="h-8 pl-8 text-xs bg-black/40 border-white/5 focus:border-primary/50" />
          </div>
          
          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-[10px] uppercase tracking-widest font-bold">
                <Upload size={14} className="mr-2" /> Upload
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-xl p-0 overflow-hidden">
              <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
                <DialogTitle className="text-sm uppercase tracking-widest font-heading">Asset Ingestion</DialogTitle>
                <p className="text-[10px] text-muted-foreground mt-1 uppercase">Drop files to add them to the project</p>
              </div>
              
              <div className="p-6 space-y-6">
                <div 
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  className="border-2 border-dashed border-white/10 rounded-xl p-10 flex flex-col items-center justify-center gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
                >
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload size={24} className="text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">Drag audio files here</p>
                    <p className="text-xs text-muted-foreground mt-1">WAV, AIFF, or MP3 up to 50MB</p>
                  </div>
                </div>

                {uploadFiles.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] uppercase font-bold text-muted-foreground">Pending Uploads ({uploadFiles.length})</h4>
                    <ScrollArea className="max-h-40 pr-4">
                      <div className="space-y-2">
                        {uploadFiles.map((f, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg">
                            <div className="flex items-center gap-3">
                              <FileAudio size={16} className="text-primary" />
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-white">{f.name}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{f.size}</span>
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}>
                              <X size={14} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Destination Idea</label>
                        <Select>
                          <SelectTrigger className="bg-black/40 border-white/5 text-xs h-9">
                            <SelectValue placeholder="Select Destination" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            {MOCK_SONG.instruments.map(inst => (
                              <React.Fragment key={inst.id}>
                                <div className="px-2 py-1 text-[9px] uppercase font-bold text-primary opacity-50">{inst.name}</div>
                                {inst.ideas.map(idea => (
                                  <SelectItem key={idea.id} value={idea.id} className="text-xs pl-4">{idea.name}</SelectItem>
                                ))}
                              </React.Fragment>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end">
                        <Button className="w-full h-9 uppercase tracking-widest text-[10px] font-bold" onClick={() => { setIsUploadOpen(false); setUploadFiles([]); }}>
                          Confirm Ingestion
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden divide-x divide-white/5">
        {/* Column 1: Instruments */}
        <div className="w-1/4 flex flex-col">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">Instruments</div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {MOCK_SONG.instruments.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => { setSelectedInst(inst); setSelectedIdea(null); }}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded text-xs transition-all",
                    selectedInst?.id === inst.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Folder size={14} className={selectedInst?.id === inst.id ? "text-primary" : "text-muted-foreground"} />
                    <span className="font-medium">{inst.name}</span>
                  </div>
                  <ChevronRight size={12} className="opacity-40" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Column 2: Ideas/Patterns */}
        <div className="w-1/4 flex flex-col bg-black/10">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">Ideas</div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedInst ? selectedInst.ideas.map(idea => (
                <button
                  key={idea.id}
                  onClick={() => setSelectedIdea(idea)}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded text-xs transition-all",
                    selectedIdea?.id === idea.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-white/5 hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Music size={14} className={selectedIdea?.id === idea.id ? "text-primary" : "text-muted-foreground"} />
                    <span className="font-medium">{idea.name}</span>
                  </div>
                  <ChevronRight size={12} className="opacity-40" />
                </button>
              )) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10">Select an instrument</div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Column 3: Versions (Draggable Items) */}
        <div className="flex-1 flex flex-col bg-black/20">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">Versions</div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedIdea ? selectedIdea.versions.map(version => (
                <BucketClip 
                  key={version.id} 
                  clip={version} 
                  onAddToTimeline={onAddToTimeline}
                />
              )) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10">Select an idea</div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Column 4: Context/Preview */}
        <div className="w-1/5 flex flex-col bg-black/30 p-4 border-l border-white/5">
           <div className="text-[10px] uppercase tracking-tighter text-muted-foreground font-bold mb-4">Activity</div>
           <div className="space-y-4">
              <div className="flex gap-3">
                 <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <User size={12} className="text-primary" />
                 </div>
                 <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-white">Dave uploaded V2</span>
                    <span className="text-[9px] text-muted-foreground">2 hours ago</span>
                 </div>
              </div>
              <div className="flex gap-3">
                 <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                    <User size={12} className="text-blue-400" />
                 </div>
                 <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-white">Sarah added a note</span>
                    <span className="text-[9px] text-muted-foreground">Yesterday</span>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
