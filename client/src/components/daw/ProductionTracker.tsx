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
  ArrowRight,
  MessageSquare,
  AtSign,
  ChevronDown
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';

const instruments = ['Drums', 'Bass', 'Guitar 1', 'Guitar 2', 'Vocals', 'Overall'];
const taskPresets = ['Add Chorus', 'Add Verse', 'Add Bridge', 'Record Overdubs', 'Clean Up Takes', 'Mix Check'];
const bandMembers = ['Dave', 'Sarah', 'Mike', 'Elena'];

const statusConfig: Record<TaskStatus, { icon: any, color: string, label: string, bgColor: string }> = {
  'todo': { icon: Circle, color: 'text-muted-foreground', label: 'To Do', bgColor: 'bg-transparent' },
  'in-progress': { icon: Clock, color: 'text-blue-400', label: 'In Progress', bgColor: 'bg-blue-400/5' },
  'review': { icon: AlertCircle, color: 'text-amber-400', label: 'Review', bgColor: 'bg-amber-400/5' },
  'done': { icon: CheckCircle2, color: 'text-emerald-400', label: 'Done', bgColor: 'bg-emerald-400/10' }
};

const priorityConfig = {
  'low': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'medium': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'high': 'bg-rose-500/10 text-rose-400 border-rose-500/20'
};

function TaskModal({ task, onUpdate }: { task: ProductionTask, onUpdate: (task: ProductionTask) => void }) {
  const [subtasks, setSubtasks] = useState(task.subtasks || []);
  const [newSubtask, setNewSubtask] = useState("");

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    setSubtasks([...subtasks, { id: nanoid(), text: newSubtask, completed: false }]);
    setNewSubtask("");
  };

  return (
    <DialogContent className="max-w-2xl bg-[#0c0c0e] border-primary/20 p-0 overflow-hidden">
      <div className="flex flex-col h-[80vh]">
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-primary/10 to-transparent">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="outline" className="text-[10px] uppercase border-primary/30 text-primary">Task Detail</Badge>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{task.instrument}</span>
          </div>
          <DialogTitle className="text-2xl font-heading font-bold text-white mb-2">{task.title}</DialogTitle>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar size={14} />
              <span>Due: {task.dueDate || 'No date'}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserIcon size={14} />
              <span>Assigned: {task.assignee}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <ScrollArea className="flex-1 p-6 border-r border-white/5">
            <div className="space-y-8">
              <div>
                <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60 mb-3">Description</h4>
                <Textarea 
                  placeholder="Add more details about this task..." 
                  className="bg-black/40 border-white/5 text-sm min-h-[100px]"
                  defaultValue={task.description}
                />
              </div>

              <div>
                <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60 mb-3 flex justify-between items-center">
                  Checklist
                  <span className="text-[9px] font-mono text-muted-foreground">{subtasks.filter(s => s.completed).length}/{subtasks.length}</span>
                </h4>
                <div className="space-y-2 mb-4">
                  {subtasks.map(s => (
                    <div key={s.id} className="flex items-center gap-3 group">
                      <button 
                        onClick={() => setSubtasks(subtasks.map(st => st.id === s.id ? {...st, completed: !st.completed} : st))}
                        className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors", s.completed ? "bg-emerald-500 border-emerald-500" : "border-white/20 hover:border-primary")}
                      >
                        {s.completed && <CheckCircle2 size={12} className="text-black" />}
                      </button>
                      <span className={cn("text-xs transition-all", s.completed ? "text-muted-foreground line-through" : "text-white/80")}>{s.text}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Add item..." 
                    className="h-8 text-xs bg-black/40 border-white/5"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                  />
                  <Button size="sm" className="h-8" onClick={addSubtask}><Plus size={14} /></Button>
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="w-64 flex flex-col bg-black/20">
            <div className="p-4 border-b border-white/5">
               <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60 mb-3">Activity</h4>
               <ScrollArea className="h-48 mb-4">
                  <div className="space-y-4">
                     <div className="text-[11px] leading-relaxed">
                        <span className="font-bold text-primary">@Dave</span> added this to the production queue.
                        <div className="text-[9px] text-muted-foreground mt-1">2h ago</div>
                     </div>
                  </div>
               </ScrollArea>
               <div className="relative">
                  <Textarea placeholder="Type @ to mention..." className="bg-black/40 border-white/5 text-xs min-h-[60px] pr-8" />
                  <AtSign size={12} className="absolute bottom-2 right-2 text-primary/40" />
               </div>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

function TaskCard({ task }: { task: ProductionTask }) {
  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className={cn(
          "group border border-white/10 rounded-lg p-3 transition-all cursor-pointer relative overflow-hidden",
          config.bgColor,
          task.status === 'done' ? "opacity-60 grayscale-[0.5]" : "hover:border-primary/40 hover:bg-white/[0.02]"
        )}>
          {task.relatedClipId && (
            <div className="absolute top-0 right-0 w-1 h-full bg-primary" />
          )}
          <div className="flex justify-between items-start mb-2">
            <StatusIcon size={14} className={cn(config.color)} />
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal size={12} />
              </Button>
            </div>
          </div>
          <h4 className={cn(
            "text-xs font-medium mb-3 leading-snug transition-all",
            task.status === 'done' ? "text-muted-foreground line-through" : "text-white/90"
          )}>{task.title}</h4>
          <div className="flex items-center justify-between mt-auto">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn("text-[9px] uppercase px-1.5 h-4", priorityConfig[task.priority])}>
                {task.priority}
              </Badge>
              {task.subtasks && (
                 <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    <CheckCircle2 size={10} />
                    {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
                 </div>
              )}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <UserIcon size={10} />
              {task.assignee}
            </div>
          </div>
        </div>
      </DialogTrigger>
      <TaskModal task={task} onUpdate={() => {}} />
    </Dialog>
  );
}

export function ProductionTracker() {
  const [tasks, setTasks] = useState(MOCK_TASKS);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);

  // Derive "Final Asset" tasks from MOCK_SONG
  const finalTasks = useMemo(() => {
    const tasks: ProductionTask[] = [];
    MOCK_SONG.instruments.forEach(inst => {
      inst.ideas.forEach(idea => {
        idea.versions.forEach(version => {
          if (version.isFinal) {
            tasks.push({
              id: `final-${version.id}`,
              title: `Final: ${idea.name}`,
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

  const allTasks = [...tasks, ...finalTasks];

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
            <LayoutDashboard size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-heading font-bold uppercase tracking-[0.2em] text-white italic">Session Board</h2>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest opacity-60">Production Pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[10px] uppercase tracking-widest bg-black/40 border-white/10">
            <Filter size={12} className="mr-2 text-primary" /> Filter
          </Button>
          <Dialog open={isNewTaskOpen} onOpenChange={setIsNewTaskOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-[10px] uppercase tracking-widest font-bold shadow-lg shadow-primary/20">
                <Plus size={14} className="mr-2" /> New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0c0c0e] border-primary/20 max-w-md">
               <DialogHeader>
                  <DialogTitle className="text-sm uppercase tracking-widest font-heading">Add Production Task</DialogTitle>
               </DialogHeader>
               <div className="space-y-4 py-4">
                  <div className="space-y-2">
                     <label className="text-[10px] uppercase font-bold text-muted-foreground">Category</label>
                     <Select defaultValue="Overall">
                        <SelectTrigger className="bg-black/40 border-white/5">
                           <SelectValue placeholder="Select Instrument" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                           {instruments.map(inst => (
                              <SelectItem key={inst} value={inst}>{inst}</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[10px] uppercase font-bold text-muted-foreground">Task Template</label>
                     <div className="flex flex-wrap gap-2">
                        {taskPresets.map(preset => (
                           <button key={preset} className="text-[10px] px-3 py-1.5 rounded-full border border-white/5 bg-white/5 hover:border-primary/50 transition-all">
                              {preset}
                           </button>
                        ))}
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[10px] uppercase font-bold text-muted-foreground">Assignee</label>
                     <Select>
                        <SelectTrigger className="bg-black/40 border-white/5">
                           <SelectValue placeholder="Choose Band Member" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                           {bandMembers.map(m => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <Button className="w-full uppercase tracking-widest text-[11px] font-bold" onClick={() => setIsNewTaskOpen(false)}>Create Task</Button>
               </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex h-full p-6 gap-6 min-w-max">
          {instruments.map(inst => {
            const instTasks = allTasks
              .filter(t => t.instrument === inst)
              .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 0 : 1));
            
            return (
              <div key={inst} className="w-72 flex flex-col bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <div className="w-1 h-3 rounded-full bg-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/80">{inst}</h3>
                    <Badge variant="secondary" className="h-4 px-1.5 text-[9px] bg-white/5 text-muted-foreground font-mono">
                      {instTasks.length}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/10">
                    <Plus size={14} className="text-muted-foreground" />
                  </Button>
                </div>
                
                <ScrollArea className="flex-1">
                  <div className="p-3 space-y-3">
                    {instTasks.map(task => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                    {instTasks.length === 0 && (
                      <div className="h-32 border border-dashed border-white/5 rounded-lg flex flex-col items-center justify-center text-[10px] text-muted-foreground/30 italic gap-2">
                        <LayoutDashboard size={16} className="opacity-20" />
                        No active tasks
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <div className="p-3 bg-black/40 border-t border-white/5">
                   <Button 
                    variant="ghost" 
                    className="w-full h-9 border border-dashed border-white/10 hover:border-primary/40 hover:bg-primary/5 text-[10px] uppercase font-bold tracking-widest text-muted-foreground hover:text-primary transition-all group"
                  >
                    <Plus size={12} className="mr-2 opacity-50 group-hover:opacity-100" />
                    Add Entry
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
