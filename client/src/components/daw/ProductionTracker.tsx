import React, { useMemo, useState } from 'react';
import { MOCK_SONG, Clip, ProductionTask, TaskStatus } from '@/lib/daw-data';
import { CheckCircle2, Circle, Clock, Minus, Music2, MoreHorizontal, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const sectionRows = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'];
const cellStates = ['todo', 'in-progress', 'complete', 'not-applicable'] as const;

type CellState = typeof cellStates[number];

const stateConfig: Record<CellState, { label: string; icon: any; className: string }> = {
  todo: { label: 'To Do', icon: Circle, className: 'text-white/30' },
  'in-progress': { label: 'In Progress', icon: Clock, className: 'text-blue-300' },
  complete: { label: 'Complete', icon: CheckCircle2, className: 'text-primary' },
  'not-applicable': { label: 'Won\'t Play', icon: Minus, className: 'text-white/20' },
};

function initialGrid() {
  const grid: Record<string, CellState> = {};
  MOCK_SONG.instruments.forEach((inst) => {
    sectionRows.forEach((row) => {
      const key = `${inst.id}:${row}`;
      grid[key] = Math.random() > 0.72 ? 'complete' : Math.random() > 0.82 ? 'in-progress' : 'todo';
    });
  });
  return grid;
}

function CellModal({ open, onOpenChange, instrument, section, value, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; instrument: string; section: string; value: CellState; onSelect: (state: CellState) => void }) {
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

        <div className="p-4 space-y-2">
          {cellStates.map((state) => {
            const Icon = stateConfig[state].icon;
            return (
              <button
                key={state}
                data-testid={`button-state-${instrument}-${section}-${state}`}
                onClick={() => onSelect(state)}
                className={cn(
                  'w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-all',
                  value === state ? 'border-primary/60 bg-primary/10' : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.05]'
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon size={14} className={stateConfig[state].className} />
                  <span className="text-xs uppercase tracking-[0.2em] font-bold text-white/80">{stateConfig[state].label}</span>
                </div>
                {value === state && <CheckCircle2 size={14} className="text-primary" />}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProductionTracker() {
  const [grid, setGrid] = useState<Record<string, CellState>>(() => initialGrid());
  const [activeCell, setActiveCell] = useState<{ instrument: string; section: string; value: CellState } | null>(null);

  const columns = useMemo(() => MOCK_SONG.instruments, []);

  const updateCell = (instrumentId: string, section: string, value: CellState) => {
    const key = `${instrumentId}:${section}`;
    setGrid((prev) => ({ ...prev, [key]: value }));
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
        <Badge variant="outline" className="bg-white/[0.03] border-white/10 text-[10px] uppercase tracking-[0.2em] text-primary">Grid View</Badge>
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

            {sectionRows.map((section) => (
              <React.Fragment key={section}>
                <div className="sticky left-0 z-10 bg-[#0b0b0d] border-r border-t border-white/5 px-4 py-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-white/80 font-bold">{section}</div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Arrangement</div>
                  </div>
                </div>
                {columns.map((inst) => {
                  const key = `${inst.id}:${section}`;
                  const value = grid[key];
                  const Icon = stateConfig[value].icon;
                  return (
                    <button
                      key={key}
                      data-testid={`button-cell-${inst.id}-${section}`}
                      onClick={() => setActiveCell({ instrument: inst.name, section, value })}
                      className={cn(
                        'relative border-t border-l border-white/5 min-h-[78px] p-3 text-left transition-all hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary/40',
                        value === 'complete' && 'bg-primary/10',
                        value === 'in-progress' && 'bg-blue-400/10',
                        value === 'not-applicable' && 'bg-white/[0.02]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Icon size={13} className={stateConfig[value].className} />
                            <span className="text-[9px] uppercase tracking-[0.2em] text-white/45 font-bold">{stateConfig[value].label}</span>
                          </div>
                          <div className="h-1.5 w-16 rounded-full bg-white/5 overflow-hidden">
                            <div className={cn('h-full rounded-full', value === 'complete' ? 'bg-primary w-full' : value === 'in-progress' ? 'bg-blue-400 w-2/3' : value === 'not-applicable' ? 'bg-white/20 w-1/4' : 'bg-white/20 w-1/3')} />
                          </div>
                        </div>
                        <MoreHorizontal size={14} className="text-white/15 shrink-0" />
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
          value={activeCell.value}
          onSelect={(state) => {
            const inst = columns.find((c) => c.name === activeCell.instrument);
            if (inst) updateCell(inst.id, activeCell.section, state);
            setActiveCell(null);
          }}
        />
      )}
    </div>
  );
}
