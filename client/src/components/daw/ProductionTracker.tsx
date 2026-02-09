import React, { useState, useMemo } from 'react';
import { MOCK_TASKS, ProductionTask, TaskStatus, MOCK_SONG } from '@/lib/daw-data';
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  Plus, 
  MoreHorizontal,
  LayoutDashboard,
  Calendar,
  User as UserIcon,
  Filter,
  ArrowRight
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const instruments = ['Drums', 'Bass', 'Guitar 1', 'Guitar 2', 'Vocals', 'Overall'];

const statusConfig: Record<TaskStatus, { icon: any, color: string, label: string }> = {
  'todo': { icon: Circle, color: 'text-muted-foreground', label: 'To Do' },
  'in-progress': { icon: Clock, color: 'text-blue-400', label: 'In Progress' },
  'review': { icon: AlertCircle, color: 'text-amber-400', label: 'Review' },
  'done': { icon: CheckCircle2, color: 'text-emerald-400', label: 'Done' }
};

const priorityConfig = {
  'low': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'medium': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'high': 'bg-rose-500/10 text-rose-400 border-rose-500/20'
};

function TaskCard({ task }: { task: ProductionTask }) {
  const StatusIcon = statusConfig[task.status].icon;
  
  return (
    <div className="group bg-black/40 border border-white/5 rounded-lg p-3 hover:border-primary/30 transition-all cursor-pointer relative overflow-hidden">
      {task.relatedClipId && (
        <div className="absolute top-0 right-0 w-1 h-full bg-primary/40" />
      )}
      <div className="flex justify-between items-start mb-2">
        <StatusIcon size={14} className={cn(statusConfig[task.status].color)} />
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
          <MoreHorizontal size={12} />
        </Button>
      </div>
      <h4 className="text-xs font-medium text-white/90 mb-3 leading-snug">{task.title}</h4>
      <div className="flex items-center justify-between mt-auto">
        <div className="flex items-center gap-2">
           <Badge variant="outline" className={cn("text-[9px] uppercase px-1.5 h-4", priorityConfig[task.priority])}>
            {task.priority}
          </Badge>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <UserIcon size={10} />
            {task.assignee}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProductionTracker() {
  const [manualTasks, setManualTasks] = useState(MOCK_TASKS);

  // Derive "Final Asset" tasks from MOCK_SONG
  const finalTasks = useMemo(() => {
    const tasks: ProductionTask[] = [];
    MOCK_SONG.instruments.forEach(inst => {
      inst.ideas.forEach(idea => {
        idea.versions.forEach(version => {
          if (version.isFinal) {
            tasks.push({
              id: `final-${version.id}`,
              title: `Finalized: ${idea.name} (${version.name})`,
              instrument: inst.name,
              status: 'done',
              priority: 'high',
              assignee: version.metadata?.uploadedBy || 'System',
              relatedClipId: version.id
            });
          }
        });
      });
    });
    return tasks;
  }, []);

  const allTasks = [...manualTasks, ...finalTasks];

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
            <LayoutDashboard size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-heading font-bold uppercase tracking-widest text-white">Production Tracker</h2>
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Session Tasks & Milestones</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[10px] uppercase tracking-wider bg-black/40 border-white/10">
            <Filter size={12} className="mr-2" /> Filter
          </Button>
          <Button size="sm" className="h-8 text-[10px] uppercase tracking-wider">
            <Plus size={12} className="mr-2" /> New Task
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex h-full p-6 gap-6 min-w-max">
          {instruments.map(inst => {
            const instTasks = allTasks.filter(t => t.instrument === inst);
            
            return (
              <div key={inst} className="w-72 flex flex-col gap-4">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">{inst}</h3>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[9px] bg-white/5 text-muted-foreground">
                      {instTasks.length}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/5">
                    <Plus size={14} className="text-muted-foreground" />
                  </Button>
                </div>
                
                <div className="flex flex-col gap-3">
                  {instTasks.map(task => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {instTasks.length === 0 && (
                    <div className="h-24 border border-dashed border-white/5 rounded-lg flex items-center justify-center text-[10px] text-muted-foreground/30 italic">
                      No tasks assigned
                    </div>
                  )}
                  <Button 
                    variant="ghost" 
                    className="w-full h-8 border border-dashed border-white/5 hover:border-primary/20 hover:bg-primary/5 text-[10px] uppercase text-muted-foreground hover:text-primary transition-all group"
                  >
                    <Plus size={12} className="mr-2 opacity-50 group-hover:opacity-100" />
                    Quick Add
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
