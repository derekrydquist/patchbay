import React, { useMemo, useState } from 'react';
import { MOCK_SONG, addSongSection } from '@/lib/daw-data';
import { CheckCircle2, Circle, Clock, Minus, Music2, MoreHorizontal, Plus, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const cellStates = ['todo', 'in-progress', 'complete', 'not-applicable'] as const;

type CellState = typeof cellStates[number];

type CellData = {
  state: CellState;
  versionName?: string;
  note?: string;
};

const stateConfig: Record<CellState, { label: string; icon: any; className: string }> = {
  todo: { label: 'To Do', icon: Circle, className: 'text-white/30' },
  'in-progress': { label: 'In Progress', icon: Clock, className: 'text-blue-300' },
  complete: { label: 'Complete', icon: CheckCircle2, className: 'text-primary' },
  'not-applicable': { label: 'Won\'t Play', icon: Minus, className: 'text-white/20' },
};

function initialGrid() {
  const grid: Record<string, CellData> = {};
  MOCK_SONG.instruments.forEach((inst) => {
    MOCK_SONG.sections.forEach((row) => {
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
      
      grid[key] = { 
        state, 
        versionName,
        note: rand > 0.9 ? "@Dave are you tracking this tomorrow?" : ""
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
  const [note, setNote] = useState(data.note || '');

  const handleStateSelect = (state: CellState) => {
    onUpdate({ ...data, state, note });
    onOpenChange(false);
  };

  const handleSaveNote = () => {
    onUpdate({ ...data, note });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0c0c0e] border-primary/20 p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
          <DialogHeader>
            <DialogTitle className="text-sm uppercase tracking-[0.2em] font-heading text-white">Mark Board Cell</DialogTitle>
          </DialogHeader>
          <div className="mt-3 space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-primary/70">{instrument}</div>
            <div className="text-xl font-heading font-bold text-white uppercase">{section}</div>
          </div>
        </div>

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

          <div className="space-y-3 pt-4 border-t border-white/5">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1 flex items-center gap-2">
              <MessageSquare size={12} /> Task Notes
            </label>
            <Textarea 
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note or @mention a bandmate to notify them..."
              className="bg-black/40 border-white/10 text-xs min-h-[80px] text-white/80 focus:border-primary/50"
            />
            <Button 
              onClick={handleSaveNote} 
              className="w-full h-9 text-[10px] uppercase tracking-[0.2em] font-bold shadow-lg shadow-primary/10"
            >
               Save Changes
            </Button>
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
    addSongSection(newSection);
    setIsNewSectionOpen(false);
    setNewSection('');
    setSectionsVersion((v) => v + 1);
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
        <div className="flex items-center gap-2">
          <Dialog open={isNewSectionOpen} onOpenChange={setIsNewSectionOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-[10px] uppercase tracking-[0.2em] font-bold shadow-lg shadow-primary/20">
                <Plus size={14} className="mr-2" /> New Section
              </Button>
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
          <Badge variant="outline" className="bg-white/[0.03] border-white/10 text-[10px] uppercase tracking-[0.2em] text-primary">Grid View</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="min-w-[1100px] rounded-2xl border border-white/5 bg-white/[0.02] shadow-2xl shadow-black/40 overflow-hidden">
          <div className="grid" style={{ gridTemplateColumns: `220px repeat(${columns.length}, minmax(150px, 1fr))` }}>
            <div className="sticky left-0 z-20 bg-[#0c0c0e] border-r border-white/5 px-4 py-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-primary/70 font-bold">Song Sections</div>
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
                  const data = grid[key] ?? { state: 'todo' };
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
                          {data.note && (
                            <div className="flex items-center justify-center w-4 h-4 rounded-full bg-white/10" title={data.note}>
                              <MessageSquare size={8} className="text-white/70" />
                            </div>
                          )}
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
