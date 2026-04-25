import React from 'react';
import { useLocation } from 'wouter';
import { Play, CheckCircle2, Clock, FileAudio, Folder, ChevronRight, Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Mock Data
const RECENT_PROJECTS = [
  { id: '1', name: 'Neon Nights', instrument: 'Synth Lead', section: 'Chorus 2', status: 'In Progress', lastUpdated: '2 hours ago' },
  { id: '2', name: 'Midnight Drive', instrument: 'Drums', section: 'Intro', status: 'To Do', lastUpdated: '5 hours ago' },
  { id: '3', name: 'Summer Breeze', instrument: 'Bass', section: 'Bridge', status: 'Complete', lastUpdated: '1 day ago' },
];

const YOUR_TASKS = [
  { id: 't1', title: 'Record harmony layers', section: 'Chorus 1', instrument: 'Vocals', status: 'To Do', dueDate: 'Today', assignee: 'JD' },
  { id: 't2', title: 'Quantize drum fills', section: 'Outro', instrument: 'Drums', status: 'In Progress', dueDate: 'Tomorrow', assignee: 'JD' },
  { id: 't3', title: 'Fix bass timing', section: 'Verse 2', instrument: 'Bass', status: 'To Do', dueDate: 'Next Week', assignee: 'JD' },
  { id: 't4', title: 'Add ambient textures', section: 'Bridge', instrument: 'Keys', status: 'In Progress', dueDate: 'Today', assignee: 'JD' },
  { id: 't5', title: 'Re-amp rhythm guitars', section: 'Chorus 2', instrument: 'Guitar', status: 'To Do', dueDate: 'Friday', assignee: 'JD' },
  { id: 't6', title: 'Edit vocal breath noises', section: 'Verse 1', instrument: 'Vocals', status: 'Complete', dueDate: 'Yesterday', assignee: 'JD' },
  { id: 't7', title: 'Write synth arp', section: 'Intro', instrument: 'Synth Lead', status: 'To Do', dueDate: 'Next Mon', assignee: 'JD' },
  { id: 't8', title: 'Check sub frequencies', section: 'Drop', instrument: 'Bass', status: 'In Progress', dueDate: 'Tomorrow', assignee: 'JD' },
];

const RECENT_FILES = [
  { id: 'f1', name: 'Synth Lead Take 4.wav', instrument: 'Keys', timestamp: '10 mins ago' },
  { id: 'f2', name: 'Drum Loop Alt.wav', instrument: 'Drums', timestamp: '1 hour ago' },
  { id: 'f3', name: 'Bass DI.wav', instrument: 'Bass', timestamp: '3 hours ago' },
  { id: 'f4', name: 'Vocal Scratch.mp3', instrument: 'Vocals', timestamp: 'Yesterday' },
  { id: 'f5', name: 'Guitar Solo Concept.wav', instrument: 'Guitar', timestamp: '2 days ago' },
  { id: 'f6', name: 'Ambient Pad 01.wav', instrument: 'Keys', timestamp: '3 days ago' },
  { id: 'f7', name: 'Snare One Shot.wav', instrument: 'Drums', timestamp: 'Last week' },
];

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const openArrangement = ({ instrument, section, fileId }: { instrument?: string, section?: string, fileId?: string }) => {
    const params = new URLSearchParams();
    if (instrument) params.set('instrument', instrument);
    if (section) params.set('section', section);
    if (fileId) params.set('file', fileId);
    
    setLocation(`/workspace?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white p-8 font-sans selection:bg-primary/30 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-12">
        
        {/* Header */}
        <header className="flex items-center justify-between pb-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <Music2 size={20} className="text-black" />
            </div>
            <h1 className="text-2xl font-heading font-black tracking-tighter uppercase text-white italic">
              Studio <span className="text-primary not-italic">Lux</span>
            </h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-white/10 border border-white/10 flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
            <span className="text-xs font-bold text-primary">JD</span>
          </div>
        </header>

        {/* Resume Last Session (Featured Card) */}
        <section>
          <div 
            onClick={() => openArrangement({ instrument: 'Synth Lead', section: 'Chorus 2' })}
            className="bg-gradient-to-r from-[#181C26] to-[#181C26]/80 rounded-2xl p-6 border border-white/5 hover:border-primary/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.1)] transition-all cursor-pointer group relative overflow-hidden"
          >
            <div className="absolute right-0 top-0 bottom-0 w-64 bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />
            
            <div className="flex items-center justify-between relative z-10">
              <div>
                <p className="text-xs font-bold tracking-widest uppercase text-primary mb-2">Resume Last Session</p>
                <h2 className="text-3xl font-heading font-black tracking-tight mb-2 group-hover:text-primary transition-colors">Neon Nights</h2>
                <div className="flex items-center gap-4 text-sm text-muted-foreground font-medium">
                  <span className="flex items-center gap-1.5"><Folder size={14} className="text-primary/60" /> Synth Lead</span>
                  <span className="w-1 h-1 rounded-full bg-white/20" />
                  <span className="flex items-center gap-1.5"><Play size={14} className="text-primary/60" /> Chorus 2</span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-primary transition-all">
                <ChevronRight size={24} className="text-primary group-hover:text-black" />
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Column (2/3 width) */}
          <div className="lg:col-span-2 space-y-10">
            
            {/* Continue Working */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white/90">Continue Working</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {RECENT_PROJECTS.map(project => (
                  <div 
                    key={project.id}
                    onClick={() => openArrangement({ instrument: project.instrument, section: project.section })}
                    className="bg-[#181C26] rounded-xl p-5 border border-white/5 hover:border-primary/30 hover:-translate-y-1 transition-all cursor-pointer group"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{project.name}</h4>
                      <span className={cn(
                        "text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded border",
                        project.status === 'Complete' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                        project.status === 'In Progress' ? "bg-primary/10 text-primary border-primary/20" :
                        "bg-white/5 text-muted-foreground border-white/10"
                      )}>
                        {project.status}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 text-xs font-medium text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Folder size={14} /> <span>{project.instrument}</span>
                        <span className="text-white/20">•</span>
                        <span>{project.section}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] mt-2 opacity-60">
                        <Clock size={12} /> Last updated {project.lastUpdated}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Your Tasks */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white/90">Your Tasks</h3>
              </div>
              <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden">
                <div className="divide-y divide-white/5">
                  {YOUR_TASKS.map(task => (
                    <div 
                      key={task.id}
                      onClick={() => openArrangement({ instrument: task.instrument, section: task.section })}
                      className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                          task.status === 'Complete' ? "bg-primary border-primary text-black" : "border-white/20 group-hover:border-primary/50"
                        )}>
                          {task.status === 'Complete' && <CheckCircle2 size={12} />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white mb-1 group-hover:text-primary transition-colors">{task.title}</p>
                          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                            <span>{task.section}</span>
                            <span className="text-white/20">—</span>
                            <span className="text-primary/70">{task.instrument}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                          <Clock size={12} /> {task.dueDate}
                        </span>
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold text-primary border border-primary/20">
                          {task.assignee}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

          </div>

          {/* Sidebar Column (1/3 width) */}
          <div className="space-y-10">
            
            {/* Recent Files / Ideas */}
            <section>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white/90">Recent Files</h3>
              </div>
              <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden">
                <div className="divide-y divide-white/5">
                  {RECENT_FILES.map(file => (
                    <div 
                      key={file.id}
                      onClick={() => openArrangement({ instrument: file.instrument, fileId: file.id })}
                      className="p-4 hover:bg-white/[0.02] transition-colors cursor-pointer group flex items-start gap-3"
                    >
                      <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary/20 transition-colors">
                        <FileAudio size={14} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white mb-1 truncate group-hover:text-primary transition-colors">{file.name}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-black/40 px-2 py-0.5 rounded">
                            {file.instrument}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-medium">
                            {file.timestamp}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

          </div>
        </div>

      </div>
    </div>
  );
}
