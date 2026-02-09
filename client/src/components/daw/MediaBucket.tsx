import React, { useState } from 'react';
import { MOCK_SONG, InstrumentFolder, Idea, Clip } from '@/lib/daw-data';
import { BucketClip } from './Clip';
import { ChevronRight, Folder, Music, User, Library, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function MediaBucket() {
  const [selectedInst, setSelectedInst] = useState<InstrumentFolder | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);

  return (
    <div className="w-full h-80 border-b border-border bg-sidebar/80 backdrop-blur-xl flex flex-col z-20">
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Library size={18} className="text-primary" />
          <h2 className="text-sm font-heading font-bold uppercase tracking-widest text-white">
            Project: {MOCK_SONG.name}
          </h2>
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="Search project assets..." className="h-8 pl-8 text-xs bg-black/40 border-white/5 focus:border-primary/50" />
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

        {/* Column 3: Versions (Draggable Items) - FIXED TO ONE LINE */}
        <div className="flex-1 flex flex-col bg-black/20">
          <div className="px-4 py-2 text-[10px] uppercase tracking-tighter text-muted-foreground font-bold border-b border-white/5 bg-white/[0.02]">Versions</div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {selectedIdea ? selectedIdea.versions.map(version => (
                <BucketClip key={version.id} clip={version} />
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
