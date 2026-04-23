import React, { useState, useEffect, useRef } from 'react';
import { MOCK_SONG, InstrumentFolder, Idea, Clip, addInstrument, addSection, addVersionToIdea } from '@/lib/daw-data';
import { BucketClip } from './Clip';
import { ChevronRight, Folder, Music, User, Library, Search, Upload, FileAudio, X, CheckCircle2, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface MediaBucketProps {
  onAddToTimeline?: (clip: Clip) => void;
  onInstrumentAdded?: () => void;
}

export function MediaBucket({ onAddToTimeline, onInstrumentAdded }: MediaBucketProps) {
  const [selectedInst, setSelectedInst] = useState<InstrumentFolder | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<{name: string, size: string, file: File}[]>([]);
  const [uploadDestination, setUploadDestination] = useState<string>('');
  const [isNewInstOpen, setIsNewInstOpen] = useState(false);
  const [newInstName, setNewInstName] = useState('');
  const [isNewIdeaOpen, setIsNewIdeaOpen] = useState(false);
  const [newIdeaName, setNewIdeaName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).map(f => ({
      name: f.name,
      size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
      file: f
    }));
    setUploadFiles(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files).map(f => ({
      name: f.name,
      size: (f.size / 1024 / 1024).toFixed(2) + ' MB',
      file: f
    }));
    setUploadFiles(prev => [...prev, ...files]);
    // Reset input so the same file can be selected again
    e.target.value = '';
  };

  const handleConfirmUpload = () => {
    if (!uploadDestination || uploadFiles.length === 0) return;
    
    uploadFiles.forEach(f => {
      addVersionToIdea(uploadDestination, f.file, f.name);
    });
    
    setIsUploadOpen(false);
    setUploadFiles([]);
    setUploadDestination('');
    
    // Automatically select the instrument and idea we just uploaded to
    for (const inst of MOCK_SONG.instruments) {
      const idea = inst.ideas.find(i => i.id === uploadDestination);
      if (idea) {
        setSelectedInst(inst);
        setSelectedIdea(idea);
        break;
      }
    }
  };

  const handleAddInstrument = () => {
    if (!newInstName.trim()) return;
    addInstrument(newInstName);
    setIsNewInstOpen(false);
    setNewInstName('');
    onInstrumentAdded?.();
    window.dispatchEvent(new CustomEvent('song-updated'));
  };

  const handleAddIdea = () => {
    if (!newIdeaName.trim()) return;
    
    // Add section globally to sync with timeline and production whiteboard
    addSection(newIdeaName.trim());
    
    setIsNewIdeaOpen(false);
    setNewIdeaName('');
  };

  useEffect(() => {
    const handleSongUpdated = () => {
      // Force a re-render to pick up new sections/instruments
      setSelectedInst(prev => {
        if (!prev) return null;
        const updatedInst = MOCK_SONG.instruments.find(i => i.id === prev.id);
        return updatedInst || null;
      });
      
      setSelectedIdea(prev => {
        if (!prev) return null;
        // Find the idea in any instrument
        for (const inst of MOCK_SONG.instruments) {
          const updatedIdea = inst.ideas.find(i => i.id === prev.id);
          if (updatedIdea) return updatedIdea;
        }
        return null;
      });
    };
    window.addEventListener('song-updated', handleSongUpdated);
    return () => window.removeEventListener('song-updated', handleSongUpdated);
  }, []);

  return (
    <div className="w-full flex-1 border-b border-border bg-sidebar/80 backdrop-blur-xl flex flex-col z-20 min-h-0">
      <div className="flex items-center justify-between px-6 h-14 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <Library size={18} className="text-primary" />
          <h2 className="text-sm font-heading font-bold uppercase tracking-widest text-white">
            Project: {MOCK_SONG.name}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input 
              placeholder="Search project assets..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-black/40 border-white/5 focus:border-primary/50" 
            />
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
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-xl p-10 flex flex-col items-center justify-center gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    multiple 
                    accept="audio/*" 
                    onChange={handleFileSelect} 
                  />
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
                        <label className="text-[10px] uppercase font-bold text-muted-foreground">Destination Section</label>
                        <Select value={uploadDestination} onValueChange={setUploadDestination}>
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
                        <Button 
                          className="w-full h-9 uppercase tracking-widest text-[10px] font-bold" 
                          onClick={handleConfirmUpload}
                          disabled={!uploadDestination || uploadFiles.length === 0}
                        >
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
        <div className="w-1/4 flex flex-col">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/header">
            <span>Instruments</span>
            <Dialog open={isNewInstOpen} onOpenChange={setIsNewInstOpen}>
              <DialogTrigger asChild>
                <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5">
                  <Plus size={12} />
                </button>
              </DialogTrigger>
              <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-sm uppercase tracking-widest font-heading font-bold text-white">New Instrument</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Instrument Name</label>
                    <Input 
                      placeholder="e.g. Lead Vocals, Bass Synth" 
                      value={newInstName}
                      onChange={(e) => setNewInstName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddInstrument();
                        }
                      }}
                      className="bg-black/40 border-white/10 text-xs h-10"
                      autoFocus
                    />
                  </div>
                  <Button onClick={handleAddInstrument} className="w-full h-10 text-[10px] uppercase tracking-[0.2em] font-bold shadow-lg shadow-primary/10">
                    Create Instrument
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {MOCK_SONG.instruments.map(inst => {
                const filteredIdeas = searchQuery 
                  ? inst.ideas.filter(idea => 
                      idea.versions.some(version => {
                        const query = searchQuery.toLowerCase();
                        const matchName = version.name.toLowerCase().includes(query);
                        const matchOriginalFile = version.metadata?.originalFileName?.toLowerCase().includes(query);
                        return matchName || matchOriginalFile;
                      })
                    )
                  : inst.ideas;
                
                const hasFiles = filteredIdeas.some(idea => idea.versions.length > 0);
                
                if (searchQuery && filteredIdeas.length === 0) return null;
                
                return (
                <button
                  key={inst.id}
                  onClick={() => { setSelectedInst(inst); setSelectedIdea(null); }}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded text-xs transition-all",
                    selectedInst?.id === inst.id ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]" : "text-muted-foreground hover:bg-white/5 hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Folder 
                      size={14} 
                      className={selectedInst?.id === inst.id ? "text-primary" : "text-muted-foreground"} 
                      fill={hasFiles ? "currentColor" : "none"} 
                    />
                    <span className="font-bold tracking-tight">{inst.name}</span>
                  </div>
                  <ChevronRight size={12} className="opacity-40" />
                </button>
              )})}
            </div>
          </ScrollArea>
        </div>

        <div className="w-1/4 flex flex-col bg-black/10">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02] flex items-center justify-between group/header">
            <span>Sections</span>
            <Dialog open={isNewIdeaOpen} onOpenChange={setIsNewIdeaOpen}>
              <DialogTrigger asChild>
                <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5">
                  <Plus size={12} />
                </button>
              </DialogTrigger>
              <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-sm uppercase tracking-widest font-heading font-bold text-white">New Section</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">Section Name</label>
                    <Input 
                      placeholder="e.g. Chorus 3, Outro Alt" 
                      value={newIdeaName}
                      onChange={(e) => setNewIdeaName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddIdea();
                        }
                      }}
                      className="bg-black/40 border-white/10 text-xs h-10"
                      autoFocus
                    />
                  </div>
                  <Button onClick={handleAddIdea} className="w-full h-10 text-[10px] uppercase tracking-[0.2em] font-bold shadow-lg shadow-primary/10">
                    Add Section
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedInst ? selectedInst.ideas.filter(idea => {
                if (!searchQuery) return true;
                return idea.versions.some(version => {
                  const query = searchQuery.toLowerCase();
                  const matchName = version.name.toLowerCase().includes(query);
                  const matchOriginalFile = version.metadata?.originalFileName?.toLowerCase().includes(query);
                  return matchName || matchOriginalFile;
                });
              }).map(idea => {
                const hasFiles = idea.versions.length > 0;
                return (
                <button
                  key={idea.id}
                  onClick={() => setSelectedIdea(idea)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('bg-primary/10', 'border', 'border-primary/50');
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-primary/10', 'border', 'border-primary/50');
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      Array.from(e.dataTransfer.files).forEach(file => {
                        if (file.type.startsWith('audio/')) {
                          addVersionToIdea(idea.id, file, file.name);
                        }
                      });
                      
                      // Trigger a re-render to show the new files
                      window.dispatchEvent(new CustomEvent('song-updated'));
                      
                      // Auto-select this idea if it wasn't already selected
                      if (selectedIdea?.id !== idea.id) {
                        setSelectedIdea(idea);
                      }
                    }
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded text-xs transition-all border border-transparent",
                    selectedIdea?.id === idea.id ? "bg-primary/20 text-primary shadow-[inset_0_0_10px_rgba(212,175,55,0.05)]" : "text-muted-foreground hover:bg-white/5 hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Folder 
                      size={14} 
                      className={selectedIdea?.id === idea.id ? "text-primary" : "text-muted-foreground"} 
                      fill={hasFiles ? "currentColor" : "none"} 
                    />
                    <span className="font-bold tracking-tight">{idea.name}</span>
                  </div>
                  <ChevronRight size={12} className="opacity-40" />
                </button>
              )}) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">Select an instrument to view or add sections</div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div 
          className="flex-1 flex flex-col bg-black/20 transition-all border border-transparent"
          onDragOver={(e) => {
            if (!selectedIdea) return;
            e.preventDefault();
            e.currentTarget.classList.add('bg-primary/5', 'border-primary/30');
          }}
          onDragLeave={(e) => {
            if (!selectedIdea) return;
            e.preventDefault();
            e.currentTarget.classList.remove('bg-primary/5', 'border-primary/30');
          }}
          onDrop={(e) => {
            if (!selectedIdea) return;
            e.preventDefault();
            e.currentTarget.classList.remove('bg-primary/5', 'border-primary/30');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              Array.from(e.dataTransfer.files).forEach(file => {
                if (file.type.startsWith('audio/')) {
                  addVersionToIdea(selectedIdea.id, file, file.name);
                }
              });
              window.dispatchEvent(new CustomEvent('song-updated'));
            }
          }}
        >
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">Versions</div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedIdea ? (
                selectedIdea.versions
                  .filter(version => {
                    if (!searchQuery) return true;
                    const query = searchQuery.toLowerCase();
                    const matchName = version.name.toLowerCase().includes(query);
                    const matchOriginalFile = version.metadata?.originalFileName?.toLowerCase().includes(query);
                    return matchName || matchOriginalFile;
                  })
                  .map(version => (
                    <BucketClip 
                      key={version.id} 
                      clip={version} 
                      onAddToTimeline={onAddToTimeline}
                    />
                  ))
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">Select a section to view or add versions</div>
              )}
              {selectedIdea && selectedIdea.versions.filter(version => {
                  if (!searchQuery) return true;
                  const query = searchQuery.toLowerCase();
                  const matchName = version.name.toLowerCase().includes(query);
                  const matchOriginalFile = version.metadata?.originalFileName?.toLowerCase().includes(query);
                  return matchName || matchOriginalFile;
                }).length === 0 && (
                <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/40 italic mt-10 uppercase tracking-widest text-center px-4">
                  No versions match your search
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="w-1/5 flex flex-col bg-black/30 p-4 border-l border-white/5">
           <div className="text-[10px] uppercase tracking-tighter text-muted-foreground font-bold mb-4">Activity</div>
           <div className="space-y-4">
              <div className="flex gap-3">
                 <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <User size={12} className="text-primary" />
                 </div>
                 <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-white">Dave uploaded V2</span>
                    <span className="text-[9px] text-muted-foreground uppercase">2 hours ago</span>
                 </div>
              </div>
              <div className="flex gap-3">
                 <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                    <User size={12} className="text-blue-400" />
                 </div>
                 <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold text-white">Sarah added a note</span>
                    <span className="text-[9px] text-muted-foreground uppercase">Yesterday</span>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
