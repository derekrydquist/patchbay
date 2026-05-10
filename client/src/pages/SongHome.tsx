import React, { useMemo, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import {
  ArrowLeft, ChevronRight, Music2, Circle, Clock, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaBucket } from '@/components/daw/MediaBucket';
import type { ProductionTask } from '@shared/schema';

interface Song {
  id: string;
  name: string;
  bpm: number | null;
}

interface LastSession {
  instrument: string;
  section: string;
}

function readLastSession(songId: string): LastSession | null {
  try {
    const raw = localStorage.getItem(`patchbay-last-session-${songId}`);
    return raw ? (JSON.parse(raw) as LastSession) : null;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
};

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function activityUrl(songId: string, event: ActivityEvent): string {
  const base = `/songs/${songId}/workspace`;
  if (event.type === 'status-change' && event.taskId) {
    return `${base}?tab=production&taskId=${event.taskId}`;
  }
  if (event.type === 'task-comment' && event.source === 'task' && event.taskId) {
    return `${base}?tab=production&taskId=${event.taskId}`;
  }
  if (event.type === 'clip-comment' && event.source === 'clip' && event.instrument && event.sectionName) {
    const params = new URLSearchParams({
      instrument: event.instrument,
      section: event.sectionName,
      ...(event.clipId ? { clipId: event.clipId } : {}),
      openComments: 'true',
    });
    return `${base}?${params}`;
  }
  if (event.instrument && event.sectionName) {
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  }
  return `/songs/${songId}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

interface ActivityEvent {
  type: string;
  description: string;
  timestamp: number;
  songId: string;
  songName: string;
  instrument?: string;
  sectionName?: string;
  taskId?: string;
  source?: 'clip' | 'task';
  clipId?: string;
}

export default function SongHome() {
  const { songId = 'patchbay-default' } = useParams<{ songId: string }>();
  const [, setLocation] = useLocation();

  const lastSession = useMemo(() => readLastSession(songId), [songId]);

  const { data: song } = useQuery<Song>({
    queryKey: ['song', songId],
    queryFn: () => fetch(`/api/songs/${songId}`).then(r => r.json()),
  });

  const { data: tasks = [] } = useQuery<ProductionTask[]>({
    queryKey: ['production-tasks', songId],
    queryFn: () => fetch(`/api/songs/${songId}/production-tasks`).then(r => r.json()),
  });

  const [showAllTasks, setShowAllTasks] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const { data: activityEvents = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['activity', songId],
    queryFn: () => fetch(`/api/songs/${songId}/activity`).then(r => r.json()),
    refetchInterval: 10000,
  });

  const visibleActivity = showAllActivity ? activityEvents : activityEvents.slice(0, 5);

  // TODO: replace with real auth user
  const CURRENT_USER = 'Jordan';

  const activeTasks = [...tasks.filter(t =>
    (t.status === 'todo' || t.status === 'in-progress') && t.assignee === CURRENT_USER
  )]
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  const visibleTasks = showAllTasks ? activeTasks : activeTasks.slice(0, 5);

  const goToWorkspace = (params?: Record<string, string>) => {
    const search = params ? '?' + new URLSearchParams(params).toString() : '';
    setLocation(`/songs/${songId}/workspace${search}`);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-primary/30 flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-white/5 bg-black/40 backdrop-blur-md flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLocation('/')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <Music2 size={18} className="text-black" />
            </div>
            <h1 className="text-lg font-heading font-black tracking-tighter uppercase text-white italic">
              Patch<span className="text-primary not-italic">Bay</span>
            </h1>
          </div>
          {song?.name && (
            <>
              <span className="text-white/20">/</span>
              <span className="text-sm font-semibold text-white/70 truncate max-w-[200px]">{song.name}</span>
            </>
          )}
        </div>
        <button
          onClick={() => goToWorkspace()}
          className="h-8 px-4 rounded-md bg-primary text-black text-xs font-bold hover:bg-primary/90 transition-colors"
        >
          Open Workspace
        </button>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-10">

        {/* ── Resume Last Session ─────────────────────────────────────────── */}
        <div
          onClick={() => goToWorkspace()}
          className="bg-gradient-to-r from-[#181C26] to-[#181C26]/80 rounded-2xl p-6 border border-white/5 hover:border-primary/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.08)] transition-all cursor-pointer group relative overflow-hidden"
        >
          <div className="absolute right-0 top-0 bottom-0 w-48 bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase text-primary mb-2">
                {lastSession ? 'Resume Last Session' : 'Get Started'}
              </p>
              <h2 className="text-2xl font-heading font-black tracking-tight mb-2 group-hover:text-primary transition-colors">
                {song?.name ?? '…'}
              </h2>
              {lastSession ? (
                <p className="text-sm text-muted-foreground font-medium">
                  {lastSession.instrument}
                  <span className="mx-2 text-white/20">•</span>
                  {lastSession.section}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground font-medium">Open Workspace to get started</p>
              )}
            </div>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 group-hover:bg-primary transition-all shrink-0">
              <ChevronRight size={24} className="text-primary group-hover:text-black" />
            </div>
          </div>
        </div>

        {/* ── Your Tasks ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/80">Your Tasks</h3>
            <button
              onClick={() => goToWorkspace({ tab: 'production' })}
              className="flex items-center gap-1.5 text-xs font-bold text-primary/70 hover:text-primary transition-colors"
            >
              Go to Tracker <ArrowRight size={12} />
            </button>
          </div>

          {activeTasks.length === 0 ? (
            <div className="bg-[#181C26]/60 rounded-xl border border-white/5 px-5 py-8 text-center">
              <p className="text-xs text-muted-foreground">No open tasks — everything is done or in the tracker.</p>
            </div>
          ) : (
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden divide-y divide-white/5">
              {visibleTasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => goToWorkspace({ instrument: task.instrument, section: task.sectionName })}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Circle
                      size={14}
                      className={cn(
                        'shrink-0',
                        task.status === 'in-progress' ? 'text-primary fill-primary/20' : 'text-white/20'
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white/90 group-hover:text-primary transition-colors truncate">
                        {task.instrument}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{task.sectionName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    {task.dueDate && (
                      <span className={cn(
                        'flex items-center gap-1 text-[10px] font-medium',
                        parseLocalDate(task.dueDate) < new Date() ? 'text-red-400' : 'text-muted-foreground'
                      )}>
                        <Clock size={10} className={parseLocalDate(task.dueDate) < new Date() ? 'text-red-400' : 'text-primary/40'} />
                        {formatDueDate(task.dueDate)}
                      </span>
                    )}
                    <span className={cn(
                      'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border',
                      task.status === 'in-progress'
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-white/5 text-white/50 border-white/10'
                    )}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeTasks.length > 5 && (
            <button
              onClick={() => setShowAllTasks(v => !v)}
              className="mt-2 w-full text-center text-xs font-bold text-white/40 hover:text-primary transition-colors py-2"
            >
              {showAllTasks ? 'Show less' : `Show all ${activeTasks.length} tasks`}
            </button>
          )}
        </section>

        {/* ── File Browser ────────────────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-4">Files</h3>
          <div className="rounded-xl border border-white/5 overflow-hidden" style={{ height: 520 }}>
            <DndContext>
              <MediaBucket songId={songId} />
            </DndContext>
          </div>
        </section>

        {/* ── Activity ─────────────────────────────────────────────────────── */}
        {activityEvents.length > 0 && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-4">Activity</h3>
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden divide-y divide-white/5">
              {visibleActivity.map((event, i) => (
                <div
                  key={i}
                  onClick={() => {
                    const url = activityUrl(songId, event);
                    console.log('[Activity click]', {
                      type: event.type,
                      source: event.source,
                      clipId: event.clipId,
                      taskId: event.taskId,
                      songId: event.songId,
                      instrument: event.instrument,
                      sectionName: event.sectionName,
                      url,
                    });
                    setLocation(url);
                  }}
                  className="flex items-start justify-between px-5 py-3.5 hover:bg-white/[0.03] hover:border-l-2 hover:border-primary/40 transition-all cursor-pointer gap-4"
                >
                  <p className="text-sm text-white/80 truncate">{event.description}</p>
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.timestamp)}</span>
                </div>
              ))}
            </div>
            {activityEvents.length > 5 && (
              <button
                onClick={() => setShowAllActivity(v => !v)}
                className="mt-2 w-full text-center text-xs font-bold text-white/40 hover:text-primary transition-colors py-2"
              >
                {showAllActivity ? 'Show less' : `Show ${activityEvents.length - 5} more`}
              </button>
            )}
          </section>
        )}

      </main>
    </div>
  );
}
