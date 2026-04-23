import React, { useMemo, useState, useEffect } from 'react';
import { MOCK_SONG, addSection } from '@/lib/daw-data';
import { CheckCircle2, Circle, Clock, Minus, Music2, MoreHorizontal, Plus, MessageSquare, UserPlus, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const cellStates = ['todo', 'in-progress', 'complete', 'not-applicable'] as const;

type CellState = typeof cellStates[number];

type Comment = {
  id: string;
  author: string;
  text: string;
  timestamp: string;
  avatarColor: string;
};

type User = {
  id: string;
  name: string;
  avatarColor: string;
};

const BAND_MEMBERS: User[] = [
  { id: 'u1', name: 'JD (You)', avatarColor: 'bg-primary' },
  { id: 'u2', name: 'Alex', avatarColor: 'bg-blue-500' },
  { id: 'u3', name: 'Dave', avatarColor: 'bg-green-500' },
  { id: 'u4', name: 'Sarah', avatarColor: 'bg-purple-500' },
];

type CellData = {
  state: CellState;
  versionName?: string;
  comments: Comment[];
  dueDate?: string;
  assigneeId?: string;
};

const stateConfig: Record<CellState, { label: string; icon: any; className: string }> = {
  todo: { label: 'To Do', icon: Circle, className: 'text-white/30' },
  'in-progress': { label: 'In Progress', icon: Clock, className: 'text-blue-300' },
  complete: { label: 'Complete', icon: CheckCircle2, className: 'text-primary' },
  'not-applicable': { label: 'Won\'t Play', icon: Minus, className: 'text-white/20' },
};

const DEFAULT_SECTIONS = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'];

function initialGrid() {
  const grid: Record<string, CellData> = {};
  MOCK_SONG.instruments.forEach((inst) => {
    DEFAULT_SECTIONS.forEach((row) => {
      const key = `${inst.id}:${row}`;
      const rand = Math.random();
      let state: CellState = 'todo';
      let versionName;
      
      if (rand > 0.72) {
        state = 'complete';
        if (inst.ideas.length > 0 && inst.ideas[0].versions.length > 0) {
          versionName = inst.ideas[0].versions[Math.floor(Math.random() * inst.ideas[0].versions.length)].name;
        } else {
          versionName = `${inst.name} V1`;
        }
      } else if (rand > 0.82) {
        state = 'in-progress';
      }
      
      const comments: Comment[] = [];
      let dueDate;
      let assigneeId;
      if (rand > 0.95) {
        comments.push(
          { id: '1', author: 'Alex', text: 'Are we still using the vintage synth for this?', timestamp: '2 hours ago', avatarColor: 'bg-blue-500' },
          { id: '2', author: 'Dave', text: '@Alex yeah, I\'ll track it tomorrow morning.', timestamp: '1 hour ago', avatarColor: 'bg-green-500' }
        );
        dueDate = '2026-05-12';
        assigneeId = 'u2'; // Alex
      } else if (rand > 0.85) {
        comments.push(
          { id: '1', author: 'Sarah', text: 'Needs more low end.', timestamp: 'Yesterday', avatarColor: 'bg-purple-500' }
        );
        assigneeId = 'u4'; // Sarah
      } else if (rand > 0.6) {
        dueDate = '2026-04-20';
        if (rand > 0.7) assigneeId = 'u1'; // JD
      }

      grid[key] = { 
        state, 
        versionName,
        comments,
        dueDate,
        assigneeId
      };
    });
  });
  return grid;
}

function CellModal({ 
  open, 
  onOpenChange, 
  instrument, 
  section, 
  data, 
  onUpdate 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void; 
  instrument: string; 
  section: string; 
  data: CellData; 
  onUpdate: (data: CellData) => void 
}) {
  const [newComment, setNewComment] = useState('');

  const handleStateSelect = (state: CellState) => {
    onUpdate({ ...data, state });
    onOpenChange(false);
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    
    const comment: Comment = {
      id: Math.random().toString(36).substr(2, 9),
      author: 'You',
      text: newComment,
      timestamp: 'Just now',
      avatarColor: 'bg-primary'
    };
    
    onUpdate({ 
      ...data, 
      comments: [...(data.comments || []), comment] 
    });
    setNewComment('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0c0c0e] border-primary/20 p-0 overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent shrink-0">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading text-white">Mark Board Cell</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">{instrument}</div>
            <div className="text-xl font-heading font-bold text-white uppercase">{section}</div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-4 space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1">Status</label>
              <div className="space-y-1.5">
                {cellStates.map((state) => {
                  const Icon = stateConfig[state].icon;
                  return (
                    <button
                      key={state}
                      data-testid={`button-state-${instrument}-${section}-${state}`}
                      onClick={() => handleStateSelect(state)}
                      className={cn(
                        'w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all',
                        data.state === state ? 'border-primary/60 bg-primary/10' : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.05]'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={14} className={stateConfig[state].className} />
                        <span className="text-xs uppercase tracking-[0.2em] font-bold text-white/80">{stateConfig[state].label}</span>
                      </div>
                      {data.state === state && <CheckCircle2 size={14} className="text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1">Assignee</label>
              <div className="px-1">
                <Select
                  value={data.assigneeId || "unassigned"}
                  onValueChange={(val) => onUpdate({ ...data, assigneeId: val === "unassigned" ? undefined : val })}
                >
                  <SelectTrigger className="w-full bg-black/40 border-white/10 text-xs h-10">
                    <SelectValue placeholder="Select band member" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0c0c0e] border-white/10">
                    <SelectItem value="unassigned" className="text-xs text-muted-foreground focus:bg-white/5 focus:text-white">
                      Unassigned
                    </SelectItem>
                    {BAND_MEMBERS.map(member => (
                      <SelectItem 
                        key={member.id} 
                        value={member.id}
                        className="text-xs focus:bg-white/5 focus:text-white"
                      >
                        <div className="flex items-center gap-2">
                          <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white", member.avatarColor)}>
                            {member.name.charAt(0)}
                          </div>
                          {member.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-white/5">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1">Due Date</label>
              <div className="px-1">
                <Input
                  type="date"
                  value={data.dueDate || ''}
                  onChange={(e) => onUpdate({ ...data, dueDate: e.target.value })}
                  className="bg-black/40 border-white/10 text-xs h-10 w-full"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[10px] text-primary/60 uppercase tracking-[0.2em] font-bold flex items-center gap-2 flex-1">
                  <div className="h-px flex-1 bg-primary/20" /> Session Notes
                </h4>
              </div>
              
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Add a collaboration note..." 
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                    className="bg-black/40 border-white/10 text-xs h-9"
                  />
                  <Button size="sm" onClick={handleAddComment} className="h-9 px-3">
                    <Plus size={14} />
                  </Button>
                </div>

                <div className="bg-black/30 rounded border border-white/5 p-1 max-h-[300px] overflow-y-auto">
                  {(data.comments || []).length > 0 ? (
                    <div className="space-y-1">
                      {(data.comments || []).map(c => (
                        <div key={c.id} className="p-3 hover:bg-white/5 transition-colors rounded">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                              <User size={10} /> {c.author}
                            </span>
                            <span className="text-[9px] text-muted-foreground font-mono opacity-50">{c.timestamp}</span>
                          </div>
                          <p className="text-xs text-foreground/80 leading-relaxed italic">"{c.text}"</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 flex flex-col items-center justify-center text-muted-foreground text-[11px] italic opacity-40">
                      <MessageSquare size={16} className="mb-2" />
                      No collaboration notes for this cell.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProductionTracker() {
  const [grid, setGrid] = useState<Record<string, CellData>>(() => initialGrid());
  const [activeCell, setActiveCell] = useState<{ instrument: string; section: string; data: CellData } | null>(null);
  const [newSection, setNewSection] = useState('');
  const [isNewSectionOpen, setIsNewSectionOpen] = useState(false);
  const [sectionsVersion, setSectionsVersion] = useState(0);

  const columns = useMemo(() => MOCK_SONG.instruments, [sectionsVersion]);
  const sections = useMemo(() => MOCK_SONG.sections, [sectionsVersion]);

  useEffect(() => {
    const handleSongUpdated = () => {
      setSectionsVersion(v => v + 1);
    };
    window.addEventListener('song-updated', handleSongUpdated);
    return () => window.removeEventListener('song-updated', handleSongUpdated);
  }, []);

  const updateCell = (instrumentId: string, section: string, data: CellData) => {
    const key = `${instrumentId}:${section}`;
    // When marking complete from here without a version, just placeholder it
    if (data.state === 'complete' && !data.versionName) {
      data.versionName = 'Manual Complete';
    }
    setGrid((prev) => ({ ...prev, [key]: data }));
  };

  const handleAddSection = () => {
    if (!newSection.trim()) return;
    addSection(newSection);
    setIsNewSectionOpen(false);
    setNewSection('');
  };

  return (
    <div className="h-full flex flex-col bg-[#09090b] text-foreground overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Music2 size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-heading font-bold uppercase tracking-[0.2em] text-white">Production Whiteboard</h2>
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Track each instrument against the song structure</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-[1100px] rounded-2xl border border-white/5 bg-white/[0.02] shadow-2xl shadow-black/40 overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: `220px repeat(${columns.length}, minmax(150px, 1fr))` }}>
            <div className="sticky left-0 z-20 bg-[#0c0c0e] border-r border-white/5 px-4 py-4 flex items-center justify-between group/header">
              <span className="text-[10px] uppercase tracking-[0.3em] text-primary/70 font-bold">Song Sections</span>
              <Dialog open={isNewSectionOpen} onOpenChange={setIsNewSectionOpen}>
                <DialogTrigger asChild>
                  <button className="opacity-0 group-hover/header:opacity-100 hover:text-primary transition-all p-0.5 text-muted-foreground">
                    <Plus size={12} />
                  </button>
                </DialogTrigger>
                <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-sm p-6">
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-sm uppercase tracking-widest font-heading font-bold text-white">Add Song Section</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase font-bold text-muted-foreground">Section Name</label>
                      <Input 
                        placeholder="e.g. Pre-Chorus, Solo, Outro 2" 
                        value={newSection}
                        onChange={(e) => setNewSection(e.target.value)}
                        className="bg-black/40 border-white/10 text-xs h-10"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSection()}
                      />
                    </div>
                    <Button onClick={handleAddSection} className="w-full h-10 text-[10px] uppercase tracking-[0.2em] font-bold shadow-lg shadow-primary/10">
                      Add Section
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            {columns.map((inst) => (
              <div key={inst.id} className="border-l border-white/5 px-4 py-4 bg-[#0c0c0e]">
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/70 font-bold truncate">{inst.name}</div>
              </div>
            ))}

            {sections.map((section) => (
              <React.Fragment key={section}>
                <div className="sticky left-0 z-10 bg-[#0b0b0d] border-r border-t border-white/5 px-4 py-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-white/80 font-bold">{section}</div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Arrangement</div>
                  </div>
                </div>
                {columns.map((inst) => {
                  const key = `${inst.id}:${section}`;
                  const data = grid[key] ?? { state: 'todo', comments: [] };
                  const Icon = stateConfig[data.state].icon;
                  return (
                    <button
                      key={key}
                      data-testid={`button-cell-${inst.id}-${section}`}
                      onClick={() => setActiveCell({ instrument: inst.name, section, data })}
                      className={cn(
                        'relative border-t border-l border-white/5 min-h-[78px] p-3 text-left transition-all hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40',
                        data.state === 'complete' && 'bg-primary/10',
                        data.state === 'in-progress' && 'bg-blue-400/10',
                        data.state === 'not-applicable' && 'bg-white/[0.02]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2 min-w-0">
                          <div className="flex items-center gap-2">
                            <Icon size={13} className={stateConfig[data.state].className} shrink-0 />
                            <span className="text-[9px] uppercase tracking-[0.2em] text-white/45 font-bold truncate">{stateConfig[data.state].label}</span>
                          </div>
                          
                          {data.state === 'complete' && data.versionName && (
                            <div className="text-[10px] text-primary truncate font-bold font-mono">
                              {data.versionName}
                            </div>
                          )}

                          {data.state !== 'complete' && (
                            <div className="h-1.5 w-16 rounded-full bg-white/5 overflow-hidden">
                              <div className={cn('h-full rounded-full', data.state === 'in-progress' ? 'bg-blue-400 w-2/3' : data.state === 'not-applicable' ? 'bg-white/20 w-1/4' : 'bg-white/20 w-1/3')} />
                            </div>
                          )}
                        </div>
                        
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <MoreHorizontal size={14} className="text-white/15" />
                          <div className="flex flex-col gap-1 items-end">
                            <div className="flex items-center gap-1.5">
                              {data.assigneeId && (
                                <div 
                                  className={cn(
                                    "w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white shadow-sm",
                                    BAND_MEMBERS.find(m => m.id === data.assigneeId)?.avatarColor || "bg-white/20"
                                  )}
                                  title={`Assigned to ${BAND_MEMBERS.find(m => m.id === data.assigneeId)?.name}`}
                                >
                                  {BAND_MEMBERS.find(m => m.id === data.assigneeId)?.name.charAt(0)}
                                </div>
                              )}
                              {data.dueDate && (
                                <div className="text-[9px] font-mono text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded">
                                  {new Date(data.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </div>
                              )}
                            </div>
                            {(data.comments || []).length > 0 && (
                              <div className="flex items-center justify-center gap-1 px-1.5 h-4 rounded-full bg-white/10" title={`${data.comments.length} comments`}>
                                <MessageSquare size={8} className="text-white/70" />
                                <span className="text-[8px] font-bold text-white/70">{data.comments.length}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {activeCell && (
        <CellModal
          open={!!activeCell}
          onOpenChange={(open) => !open && setActiveCell(null)}
          instrument={activeCell.instrument}
          section={activeCell.section}
          data={activeCell.data}
          onUpdate={(newData) => {
            const inst = columns.find((c) => c.name === activeCell.instrument);
            if (inst) updateCell(inst.id, activeCell.section, newData);
          }}
        />
      )}
    </div>
  );
}
