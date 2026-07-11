import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { capitalize } from '@/lib/utils';
import { useParams, useLocation, useSearch } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import {
  ChevronRight, Circle, Clock, ArrowRight, Play, Pause,
  CheckCircle2, MoreHorizontal, ChevronDown, ChevronUp,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { cn } from '@/lib/utils';
import { MediaBucket } from '@/components/daw/MediaBucket';
import type { ProductionTask } from '@shared/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Song {
  id: string;
  name: string;
  bpm: number | null;
}

interface LastSession {
  instrument: string;
  section: string;
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
  reviewId?: string;
  commentId?: string;
}

interface ReviewType {
  id: string;
  songId: string;
  name: string;
  src: string;
  format: string;
  duration: number;
  createdAt: string;
  createdBy: string;
}

interface ReviewComment {
  id: string;
  reviewId: string;
  parentId?: string | null;
  author: string;
  text: string;
  timestamp: number;
  createdAt: string;
  resolved?: boolean;
  editedAt?: string | null;
  replies?: ReviewComment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function activityUrl(songId: string, event: ActivityEvent): string {
  const base = `/songs/${songId}/workspace`;
  const songBase = `/songs/${songId}`;
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
  if (event.type === 'review-shared' && event.reviewId) {
    return `${songBase}?tab=review&reviewId=${event.reviewId}`;
  }
  if ((event.type === 'review-comment' || event.type === 'review-reply') && event.reviewId) {
    const params = new URLSearchParams({ tab: 'review', reviewId: event.reviewId });
    if (event.commentId) params.set('commentId', event.commentId);
    return `${songBase}?${params}`;
  }
  if (event.instrument && event.sectionName) {
    return `${base}?instrument=${encodeURIComponent(event.instrument)}&section=${encodeURIComponent(event.sectionName)}`;
  }
  return songBase;
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

// ─── Review helpers ───────────────────────────────────────────────────────────


function memberAvatarColor(name: string): string {
  const palette = ['#D4AF37', '#5C7A8E', '#7A5C8E', '#5C8E6A', '#8E7A5C', '#5C6A8E'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ─── ReviewPlayer ─────────────────────────────────────────────────────────────

function ReviewPlayer({ review, autoCommentId }: { review: ReviewType; autoCommentId?: string | null }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: usersData = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
  });
  const bandMembers = usersData.map(u => u.username);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Drag-to-scrub state
  const isDraggingRef = useRef(false);
  const dragTimeRef = useRef(0);
  const dragRafRef = useRef<number | null>(null);
  const autoHighlightFired = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hoveredAvatarId, setHoveredAvatarId] = useState<string | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<string | null>(null);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // null = not in mention mode; '' = @ typed with no chars yet (show all); string = filter prefix
  const [mainMentionQuery, setMainMentionQuery] = useState<string | null>(null);
  const [mainMentionIndex, setMainMentionIndex] = useState(0);
  const [replyMentionQuery, setReplyMentionQuery] = useState<string | null>(null);
  const [replyMentionIndex, setReplyMentionIndex] = useState(0);

  const { data: comments = [], refetch: refetchComments } = useQuery<ReviewComment[]>({
    queryKey: ['review-comments', review.id],
    queryFn: () => fetch(`/api/reviews/${review.id}/comments`).then(r => r.json()),
  });

  // Scroll to and highlight a specific comment when navigating from the activity feed
  useEffect(() => {
    if (!autoCommentId || autoHighlightFired.current === autoCommentId || comments.length === 0) return;
    // Top-level comment
    const topLevel = comments.find(c => c.id === autoCommentId);
    if (topLevel) {
      autoHighlightFired.current = autoCommentId;
      setHighlightedCommentId(autoCommentId);
      setTimeout(() => {
        document.getElementById(`review-comment-${autoCommentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => setHighlightedCommentId(null), 1500);
      }, 150);
      return;
    }
    // Reply — scroll to parent and expand its thread
    const parent = comments.find(c => (c.replies ?? []).some(r => r.id === autoCommentId));
    if (parent) {
      autoHighlightFired.current = autoCommentId;
      setExpandedThreadId(parent.id);
      setTimeout(() => {
        document.getElementById(`review-comment-${parent.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 150);
    }
  }, [autoCommentId, comments.length]);

  const mainMentionResults = mainMentionQuery !== null
    ? bandMembers.filter(m => m.toLowerCase().startsWith(mainMentionQuery.toLowerCase()))
    : [];
  const replyMentionResults = replyMentionQuery !== null
    ? bandMembers.filter(m => m.toLowerCase().startsWith(replyMentionQuery.toLowerCase()))
    : [];

  const resolvedCount = comments.filter(c => c.resolved).length;
  const visibleComments = showResolved ? comments : comments.filter(c => !c.resolved);

  // Group top-level comments within 0.25s into a single cluster marker
  // Respects showResolved — resolved comments hidden from the list are also hidden on the waveform
  const avatarGroups = useMemo(() => {
    const sorted = [...visibleComments].sort((a, b) => a.timestamp - b.timestamp);
    const groups: ReviewComment[][] = [];
    for (const comment of sorted) {
      const last = groups[groups.length - 1];
      if (last && comment.timestamp - last[0].timestamp < 0.25) {
        last.push(comment);
      } else {
        groups.push([comment]);
      }
    }
    return groups;
  }, [visibleComments]);

  // Close ••• menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuButtonRef.current && menuButtonRef.current.contains(e.target as Node)) return;
      setMenuOpenId(null);
    };
    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, [menuOpenId]);

  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    menuButtonRef.current = e.currentTarget as HTMLButtonElement;
    setMenuOpenId(prev => prev === id ? null : id);
  };

  // Create and manage the HTMLAudioElement
  useEffect(() => {
    const audio = new Audio(review.src);
    audioRef.current = audio;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => { setIsPlaying(false); setCurrentTime(0); audio.currentTime = 0; };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [review.src]);

  // Draw function — waveform bars only; avatar markers are HTML elements
  drawRef.current = () => {
    const canvas = canvasRef.current;
    const buf = decodedBufferRef.current;
    if (!canvas || !buf) return;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const channelData = buf.getChannelData(0);
    const totalSamples = channelData.length;
    const mid = h / 2;
    const playedFraction = review.duration > 0 ? Math.min(1, currentTime / review.duration) : 0;
    const playedPx = playedFraction * w;
    for (let px = 0; px < w; px++) {
      const start = Math.floor((px / w) * totalSamples);
      const end = Math.max(start + 1, Math.floor(((px + 1) / w) * totalSamples));
      let min = 0, max = 0;
      for (let i = start; i < end; i++) {
        const v = channelData[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const barH = Math.max(1, (max - min) * mid);
      ctx.fillStyle = px < playedPx ? 'rgba(212,175,55,0.85)' : 'rgba(255,255,255,0.2)';
      ctx.fillRect(px, mid - barH / 2, 1, barH);
    }
  };

  useEffect(() => {
    if (!review.src) return;
    let cancelled = false;
    fetch(review.src)
      .then(r => r.arrayBuffer())
      .then(ab => { if (cancelled) return null; const actx = new AudioContext(); return actx.decodeAudioData(ab); })
      .then(buf => { if (cancelled || !buf) return; decodedBufferRef.current = buf; drawRef.current?.(); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [review.src]);

  useEffect(() => { drawRef.current?.(); }, [currentTime]);
  useEffect(() => { drawRef.current?.(); }, [comments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => drawRef.current?.());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Cancel any pending drag rAF on unmount
  useEffect(() => () => { if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current); }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play().catch(() => {}); setIsPlaying(true); }
  };

  const timeFromPointer = (clientX: number, rect: DOMRect): number => {
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * review.duration;
  };

  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    const time = timeFromPointer(e.clientX, e.currentTarget.getBoundingClientRect());
    dragTimeRef.current = time;
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleWaveformPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const time = timeFromPointer(e.clientX, e.currentTarget.getBoundingClientRect());
    dragTimeRef.current = time;
    if (audioRef.current) audioRef.current.currentTime = time;
    // rAF throttle — one React state update per frame at most
    if (dragRafRef.current !== null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      setCurrentTime(dragTimeRef.current);
    });
  };

  const handleWaveformPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    if (dragRafRef.current !== null) { cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null; }
    const time = timeFromPointer(e.clientX, e.currentTarget.getBoundingClientRect());
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const seekToTimestamp = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleAvatarClick = (e: React.MouseEvent, comment: ReviewComment) => {
    e.stopPropagation();
    seekToTimestamp(comment.timestamp);
    setHighlightedCommentId(comment.id);
    setTimeout(() => {
      document.getElementById(`review-comment-${comment.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
    setTimeout(() => setHighlightedCommentId(null), 1500);
  };

  const handleClusterClick = (e: React.MouseEvent, group: ReviewComment[]) => {
    e.stopPropagation();
    if (group.length === 0) return;
    seekToTimestamp(group[0].timestamp);
    document.getElementById(`review-comment-${group[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    group.forEach((comment, i) => {
      setTimeout(() => {
        setHighlightedCommentId(comment.id);
        if (i === group.length - 1) {
          setTimeout(() => setHighlightedCommentId(null), 1500);
        }
      }, i * 1500);
    });
  };

  const toggleThread = (commentId: string) => {
    setExpandedThreadId(prev => prev === commentId ? null : commentId);
    setReplyText('');
    setReplyMentionQuery(null);
  };

  const resolveComment = async (comment: ReviewComment) => {
    setMenuOpenId(null);
    await fetch(`/api/review-comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !comment.resolved }),
    });
    refetchComments();
  };

  const startEdit = (comment: ReviewComment) => {
    setMenuOpenId(null);
    setEditingId(comment.id);
    setEditText(comment.text);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const saveEdit = async (commentId: string) => {
    if (!editText.trim() || editSubmitting) return;
    setEditSubmitting(true);
    try {
      await fetch(`/api/review-comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText.trim() }),
      });
      setEditingId(null);
      refetchComments();
    } finally {
      setEditSubmitting(false);
    }
  };

  const executeDelete = async (commentId: string) => {
    await fetch(`/api/review-comments/${commentId}`, { method: 'DELETE' });
    setDeleteConfirmId(null);
    if (expandedThreadId === commentId) setExpandedThreadId(null);
    refetchComments();
  };

  // Main input @ mention handlers
  const handleMainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewComment(val);
    const m = /@(\w*)$/.exec(val);
    setMainMentionQuery(m ? m[1] : null);
    setMainMentionIndex(0);
  };

  const handleMainKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mainMentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMainMentionIndex(i => Math.min(i + 1, mainMentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMainMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); insertMainMention(mainMentionResults[mainMentionIndex]); return; }
      if (e.key === 'Escape') { setMainMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) submitComment();
  };

  const insertMainMention = (name: string) => {
    setNewComment(prev => prev.replace(/@\w*$/, `@${name} `));
    setMainMentionQuery(null);
    setTimeout(() => mainInputRef.current?.focus(), 0);
  };

  // Reply input @ mention handlers
  const handleReplyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setReplyText(val);
    const m = /@(\w*)$/.exec(val);
    setReplyMentionQuery(m ? m[1] : null);
    setReplyMentionIndex(0);
  };

  const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, commentId: string) => {
    if (replyMentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setReplyMentionIndex(i => Math.min(i + 1, replyMentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setReplyMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); insertReplyMention(replyMentionResults[replyMentionIndex]); return; }
      if (e.key === 'Escape') { setReplyMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { submitReply(commentId); return; }
    if (e.key === 'Escape') { setExpandedThreadId(null); setReplyText(''); setReplyMentionQuery(null); }
  };

  const insertReplyMention = (name: string) => {
    setReplyText(prev => prev.replace(/@\w*$/, `@${name} `));
    setReplyMentionQuery(null);
    setTimeout(() => replyInputRef.current?.focus(), 0);
  };

  const submitComment = async () => {
    if (!newComment.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await fetch(`/api/reviews/${review.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: user?.username ?? 'Unknown', text: newComment.trim(), timestamp: currentTime }),
      });
      setNewComment('');
      setMainMentionQuery(null);
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitReply = async (parentId: string) => {
    if (!replyText.trim() || replySubmitting) return;
    setReplySubmitting(true);
    const parentTimestamp = comments.find(c => c.id === parentId)?.timestamp ?? currentTime;
    try {
      await fetch(`/api/reviews/${review.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: user?.username ?? 'Unknown', text: replyText.trim(), timestamp: parentTimestamp, parentId }),
      });
      setReplyText('');
      setReplyMentionQuery(null);
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    } finally {
      setReplySubmitting(false);
    }
  };

  const playheadPct = review.duration > 0 ? Math.min(100, (currentTime / review.duration) * 100) : 0;

  return (
    <div className="bg-[#181C26] rounded-xl border border-white/5">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{review.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{formatReviewDate(review.createdAt)}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-white/5 text-white/50 border-white/10">
          {review.format.toUpperCase()}
        </span>
      </div>

      {/* Waveform + controls */}
      <div className="p-4 space-y-3">
        {/* Waveform — outer div provides 14px below for avatar markers to straddle the bottom edge */}
        <div className="relative" style={{ paddingBottom: '14px' }}>
          <div
            className="relative h-16 bg-black/20 rounded-lg overflow-hidden cursor-pointer select-none"
            onPointerDown={handleWaveformPointerDown}
            onPointerMove={handleWaveformPointerMove}
            onPointerUp={handleWaveformPointerUp}
            onPointerCancel={() => { isDraggingRef.current = false; }}
          >
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-primary z-10 pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            />
          </div>

          {/* Avatar / cluster markers — one marker per group, straddling the waveform bottom edge */}
          {review.duration > 0 && avatarGroups.map((group) => {
            const first = group[0];
            const leftPct = (first.timestamp / review.duration) * 100;
            const hoverKey = first.id;
            const isCluster = group.length > 1;
            const allResolved = group.every(c => c.resolved);

            if (isCluster) {
              return (
                <div
                  key={hoverKey}
                  className="absolute z-20"
                  style={{ left: `${leftPct}%`, bottom: '2px', transform: 'translateX(-50%)', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredAvatarId(hoverKey)}
                  onMouseLeave={() => setHoveredAvatarId(null)}
                  onClick={e => handleClusterClick(e, group)}
                >
                  {hoveredAvatarId === hoverKey && (
                    <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-[#09090b] border border-white/10 rounded-md px-2 py-1.5 pointer-events-none z-30 shadow-lg" style={{ whiteSpace: 'nowrap' }}>
                      {group.map(c => (
                        <div key={c.id} className="text-[11px] text-white/80" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.text.slice(0, 35)}{c.text.length > 35 ? '…' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ring-2 ring-[#181C26] shadow-md"
                    style={{ backgroundColor: '#D4AF37', color: '#000', opacity: allResolved ? 0.35 : 1 }}
                  >
                    {group.length}
                  </div>
                </div>
              );
            }

            const isResolved = first.resolved ?? false;
            return (
              <div
                key={hoverKey}
                className="absolute z-20"
                style={{ left: `${leftPct}%`, bottom: '2px', transform: 'translateX(-50%)', cursor: 'pointer', opacity: isResolved ? 0.35 : 1 }}
                onMouseEnter={() => setHoveredAvatarId(hoverKey)}
                onMouseLeave={() => setHoveredAvatarId(null)}
                onClick={e => handleAvatarClick(e, first)}
              >
                {hoveredAvatarId === hoverKey && (
                  <div
                    className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-[#09090b] border border-white/10 rounded-md px-2 py-1 text-[11px] text-white/80 pointer-events-none z-30 shadow-lg"
                    style={{ whiteSpace: 'nowrap', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {first.text.slice(0, 40)}{first.text.length > 40 ? '…' : ''}
                  </div>
                )}
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ring-2 ring-[#181C26] shadow-md"
                  style={{ backgroundColor: isResolved ? '#555' : memberAvatarColor(first.author), color: '#000' }}
                >
                  {memberInitials(first.author)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Play/pause + time */}
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-black hover:bg-primary/90 transition-colors shrink-0"
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="text-xs font-mono text-white/50 tabular-nums">
            {formatTime(currentTime)} / {formatTime(review.duration)}
          </span>
        </div>
      </div>

      {/* Comments */}
      <div className="border-t border-white/5">
        {/* Show resolved toggle */}
        {resolvedCount > 0 && (
          <div className="px-5 py-2 border-b border-white/5 flex items-center justify-end">
            <button
              onClick={() => setShowResolved(v => !v)}
              className="text-[10px] font-bold text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
            >
              <CheckCircle2 size={11} className="text-green-500/60" />
              {showResolved ? 'Hide' : 'Show'} resolved ({resolvedCount})
            </button>
          </div>
        )}

        {visibleComments.length > 0 && (
          <div className="max-h-64 overflow-y-auto divide-y divide-white/5">
            {[...visibleComments].sort((a, b) => a.timestamp - b.timestamp).map((comment) => {
              const isResolved = comment.resolved ?? false;
              const replyCount = (comment.replies ?? []).length;
              const isExpanded = expandedThreadId === comment.id;
              return (
                <div key={comment.id}>
                  {/* Top-level comment */}
                  <div
                    id={`review-comment-${comment.id}`}
                    className={cn(
                      'px-5 py-3 flex items-start gap-3 hover:bg-white/[0.03] cursor-pointer transition-all group/comment',
                      highlightedCommentId === comment.id && 'ring-1 ring-inset ring-primary/40 bg-primary/5',
                      menuOpenId === comment.id && 'bg-white/[0.04]',
                      isResolved && 'opacity-50',
                    )}
                    onClick={() => toggleThread(comment.id)}
                  >
                    <span
                      className="text-[10px] font-mono text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded shrink-0 tabular-nums mt-0.5 hover:bg-primary/20 transition-colors cursor-pointer"
                      onClick={e => { e.stopPropagation(); seekToTimestamp(comment.timestamp); }}
                    >
                      {formatTime(comment.timestamp)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0"
                          style={{ backgroundColor: memberAvatarColor(comment.author), color: '#000' }}
                        >
                          {memberInitials(comment.author)}
                        </div>
                        <span className="text-[11px] font-semibold text-white/50">
                          {comment.author === user?.username ? 'You' : capitalize(comment.author)}
                        </span>
                        {isResolved && <CheckCircle2 size={11} className="text-green-500/70" />}
                        {comment.editedAt && <span className="text-[9px] text-white/25 italic">(edited)</span>}
                      </div>
                      {editingId === comment.id ? (
                        <div className="flex items-center gap-2 mt-1" onClick={e => e.stopPropagation()}>
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEdit(comment.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white outline-none focus:border-primary/40 min-w-0"
                          />
                          <button
                            onClick={() => saveEdit(comment.id)}
                            disabled={editSubmitting || !editText.trim()}
                            className="text-[10px] font-bold text-primary hover:text-primary/80 shrink-0"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-[10px] font-bold text-white/30 hover:text-white/60 shrink-0"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p className={cn('text-sm text-white/80 break-words', isResolved && 'line-through text-white/40')}>
                          {comment.text}
                        </p>
                      )}
                      {/* Reply / thread toggle */}
                      <div className="flex items-center gap-3 mt-1.5" onClick={e => e.stopPropagation()}>
                        {replyCount > 0 ? (
                          <button
                            onClick={() => toggleThread(comment.id)}
                            className="text-[10px] font-bold text-white/30 hover:text-primary/80 transition-colors flex items-center gap-1"
                          >
                            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                            {isExpanded ? 'Hide' : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleThread(comment.id)}
                            className="text-[10px] font-bold text-white/30 hover:text-primary/80 transition-colors"
                          >
                            {isExpanded ? 'Cancel' : 'Reply'}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* ••• menu */}
                    <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={e => openMenu(e, comment.id)}
                        className={cn(
                          'w-6 h-6 flex items-center justify-center rounded transition-all',
                          menuOpenId === comment.id
                            ? 'opacity-100 text-white/80 bg-white/10'
                            : 'opacity-0 group-hover/comment:opacity-100 text-white/40 hover:text-white/80 hover:bg-white/5',
                        )}
                      >
                        <MoreHorizontal size={13} />
                      </button>
                      {menuOpenId === comment.id && (
                        <div className="absolute right-0 top-full mt-1 w-36 bg-[#09090b] border border-white/10 rounded-lg overflow-hidden shadow-xl z-50">
                          <button
                            onMouseDown={() => resolveComment(comment)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-white/70 hover:bg-white/5 text-left"
                          >
                            <CheckCircle2 size={12} className={isResolved ? 'text-white/30' : 'text-green-500/70'} />
                            {isResolved ? 'Unresolve' : 'Resolve'}
                          </button>
                          <button
                            onMouseDown={() => startEdit(comment)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-white/70 hover:bg-white/5 text-left"
                          >
                            Edit
                          </button>
                          <button
                            onMouseDown={() => { setMenuOpenId(null); setDeleteConfirmId(comment.id); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-red-400/80 hover:bg-red-950/30 text-left"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Delete confirmation */}
                  {deleteConfirmId === comment.id && (
                    <div className="px-5 py-2.5 bg-red-950/20 border-t border-red-900/30 flex items-center justify-between gap-3">
                      <span className="text-[11px] text-red-400/80">
                        {replyCount > 0 ? `Delete this comment and its ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}?` : 'Delete this comment?'}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="text-[10px] font-bold text-white/30 hover:text-white/60"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => executeDelete(comment.id)}
                          className="text-[10px] font-bold text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded thread (replies + reply input) */}
                  {isExpanded && (
                    <div>
                      {(comment.replies ?? []).map(reply => (
                        <div
                          key={reply.id}
                          className="pl-14 pr-5 py-2 border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors group/reply"
                        >
                          <div className="flex items-start gap-2">
                            <div
                              className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 mt-0.5"
                              style={{ backgroundColor: memberAvatarColor(reply.author), color: '#000' }}
                            >
                              {memberInitials(reply.author)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[11px] font-semibold text-white/50">
                                  {reply.author === user?.username ? 'You' : capitalize(reply.author)}
                                </span>
                                {reply.editedAt && <span className="text-[9px] text-white/25 italic">(edited)</span>}
                              </div>
                              {editingId === reply.id ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveEdit(reply.id);
                                      if (e.key === 'Escape') setEditingId(null);
                                    }}
                                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white outline-none focus:border-primary/40 min-w-0"
                                  />
                                  <button onClick={() => saveEdit(reply.id)} disabled={editSubmitting || !editText.trim()} className="text-[10px] font-bold text-primary hover:text-primary/80 shrink-0">Save</button>
                                  <button onClick={() => setEditingId(null)} className="text-[10px] font-bold text-white/30 hover:text-white/60 shrink-0">Cancel</button>
                                </div>
                              ) : (
                                <span className="text-sm text-white/80 break-words">{reply.text}</span>
                              )}
                            </div>
                            {/* ••• menu for replies */}
                            <div className="relative shrink-0">
                              <button
                                onClick={e => openMenu(e, reply.id)}
                                className="opacity-0 group-hover/reply:opacity-100 w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
                              >
                                <MoreHorizontal size={13} />
                              </button>
                              {menuOpenId === reply.id && (
                                <div className="absolute right-0 top-full mt-1 w-28 bg-[#09090b] border border-white/10 rounded-lg overflow-hidden shadow-xl z-50">
                                  <button onMouseDown={() => startEdit(reply)} className="w-full px-3 py-2 text-[12px] text-white/70 hover:bg-white/5 text-left">Edit</button>
                                  <button onMouseDown={() => { setMenuOpenId(null); setDeleteConfirmId(reply.id); }} className="w-full px-3 py-2 text-[12px] text-red-400/80 hover:bg-red-950/30 text-left">Delete</button>
                                </div>
                              )}
                            </div>
                          </div>
                          {deleteConfirmId === reply.id && (
                            <div className="mt-2 pl-6 flex items-center justify-between gap-3">
                              <span className="text-[11px] text-red-400/80">Delete this reply?</span>
                              <div className="flex items-center gap-2">
                                <button onClick={() => setDeleteConfirmId(null)} className="text-[10px] font-bold text-white/30 hover:text-white/60">Cancel</button>
                                <button onClick={() => executeDelete(reply.id)} className="text-[10px] font-bold text-red-400 hover:text-red-300">Delete</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Reply input at bottom of expanded thread */}
                      <div className="pl-14 pr-5 py-2 border-t border-white/[0.03] relative bg-white/[0.01]">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0"
                            style={{ backgroundColor: memberAvatarColor(user?.username ?? ''), color: '#000' }}
                          >
                            {memberInitials(user?.username ?? '?')}
                          </div>
                          <input
                            ref={replyInputRef}
                            type="text"
                            value={replyText}
                            onChange={handleReplyChange}
                            onKeyDown={e => handleReplyKeyDown(e, comment.id)}
                            placeholder={`Reply to ${comment.author === user?.username ? 'yourself' : capitalize(comment.author)}…`}
                            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none min-w-0"
                            autoFocus={replyCount === 0}
                          />
                          {replyText.trim() && (
                            <button
                              onClick={() => submitReply(comment.id)}
                              disabled={replySubmitting}
                              className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors shrink-0"
                            >
                              Post
                            </button>
                          )}
                        </div>
                        {replyMentionResults.length > 0 && (
                          <div className="absolute left-14 right-5 bottom-full mb-1 bg-[#09090b] border border-white/10 rounded-md overflow-hidden shadow-lg z-50">
                            {replyMentionResults.map((name, i) => (
                              <div
                                key={name}
                                className={cn('flex items-center gap-2 px-3 py-1.5 cursor-pointer', i === replyMentionIndex ? 'bg-primary/10' : 'hover:bg-white/5')}
                                onMouseDown={(e) => { e.preventDefault(); insertReplyMention(name); }}
                              >
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0" style={{ backgroundColor: memberAvatarColor(name), color: '#000' }}>
                                  {memberInitials(name)}
                                </div>
                                <span className="text-sm text-white/80">{capitalize(name)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Main comment input — pinned below scrollable list */}
        <div className="border-t border-white/5 px-5 py-3 flex items-center gap-3 relative">
          <span className="text-[10px] font-mono text-primary/40 tabular-nums shrink-0 w-8 text-right">
            {formatTime(currentTime)}
          </span>
          <input
            ref={mainInputRef}
            type="text"
            value={newComment}
            onChange={handleMainChange}
            onKeyDown={handleMainKeyDown}
            placeholder="Add a comment at this position…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none min-w-0"
          />
          {newComment.trim() && (
            <button
              onClick={submitComment}
              disabled={isSubmitting}
              className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors shrink-0"
            >
              Post
            </button>
          )}
          {mainMentionResults.length > 0 && (
            <div className="absolute left-16 right-5 bottom-full mb-1 bg-[#09090b] border border-white/10 rounded-md overflow-hidden shadow-lg z-50">
              {mainMentionResults.map((name, i) => (
                <div
                  key={name}
                  className={cn('flex items-center gap-2 px-3 py-1.5 cursor-pointer', i === mainMentionIndex ? 'bg-primary/10' : 'hover:bg-white/5')}
                  onMouseDown={(e) => { e.preventDefault(); insertMainMention(name); }}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0" style={{ backgroundColor: memberAvatarColor(name), color: '#000' }}>
                    {memberInitials(name)}
                  </div>
                  <span className="text-sm text-white/80">{capitalize(name)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ─── SongHome ─────────────────────────────────────────────────────────────────

export default function SongHome() {
  const { user } = useAuth();
  const { songId = 'patchbay-default' } = useParams<{ songId: string }>();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const tabParam = searchParams.get('tab');
  const activeTab = (tabParam === 'review' || tabParam === 'files') ? tabParam : 'overview';
  const autoReviewId = searchParams.get('reviewId');
  const autoCommentId = searchParams.get('commentId');

  const lastSession = useMemo(() => readLastSession(songId), [songId]);

  const { data: song } = useQuery<Song>({
    queryKey: ['song', songId],
    queryFn: () => fetch(`/api/songs/${songId}`).then(r => r.json()),
  });

  const { data: tasks = [] } = useQuery<ProductionTask[]>({
    queryKey: ['production-tasks', songId],
    queryFn: () => fetch(`/api/songs/${songId}/production-tasks`).then(r => r.json()),
  });

  const { data: reviews = [] } = useQuery<ReviewType[]>({
    queryKey: ['reviews', songId],
    queryFn: () => fetch(`/api/songs/${songId}/reviews`).then(r => r.json()),
  });

  const [showAllTasks, setShowAllTasks] = useState(false);
  const [activityHeight, setActivityHeight] = useState<number | null>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const hasMeasured = useRef(false);

  const { data: activityEvents = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['activity', songId],
    queryFn: () => fetch(`/api/songs/${songId}/activity`).then(r => r.json()),
    refetchInterval: 10000,
  });

  const CURRENT_USER = user?.username ?? '';

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

  // Measure the left column height once after tasks first load, then never again.
  // This captures the default collapsed state (Resume card + up to 5 tasks).
  useEffect(() => {
    if (hasMeasured.current || !leftColRef.current || tasks.length === 0) return;
    hasMeasured.current = true;
    setActivityHeight(leftColRef.current.getBoundingClientRect().height);
  }, [tasks.length]);

  const goToWorkspace = (params?: Record<string, string>) => {
    const search = params ? '?' + new URLSearchParams(params).toString() : '';
    setLocation(`/songs/${songId}/workspace${search}`);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-primary/30 flex flex-col">
      <AppHeader
        className="shrink-0"
        postLogoSlot={song?.name && (
          <>
            <span className="text-white/20">/</span>
            <span className="text-sm font-semibold text-white/70 truncate max-w-[200px]">{song.name}</span>
          </>
        )}
        actionSlot={
          <button
            onClick={() => goToWorkspace()}
            className="h-8 px-4 rounded-md bg-primary text-black text-xs font-bold hover:bg-primary/90 transition-colors"
          >
            Open Workspace
          </button>
        }
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-white/[0.03] p-1 rounded-lg border border-white/5 self-start w-fit">
          {(['overview', 'files', 'review'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => {
                const params = new URLSearchParams(search);
                if (tab === 'overview') params.delete('tab');
                else params.set('tab', tab);
                const qs = params.toString();
                setLocation(`/songs/${songId}${qs ? `?${qs}` : ''}`);
              }}
              className={cn(
                'px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all cursor-pointer',
                activeTab === tab
                  ? 'bg-primary text-black'
                  : 'text-white/40 hover:text-white/70'
              )}
            >
              {tab === 'overview' ? 'Overview' : tab === 'files' ? 'Song Files' : `Review${reviews.length > 0 ? ` (${reviews.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* ── Overview tab ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

            {/* Left column — Resume + Tasks */}
            <div ref={leftColRef} className="lg:col-span-2 space-y-10">

              {/* Resume Last Session */}
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

              {/* Your Tasks */}
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
                    <p className="text-xs text-muted-foreground mb-4">No open tasks — everything is done or in the tracker.</p>
                    <button
                      onClick={() => goToWorkspace({ tab: 'production' })}
                      className="h-8 px-4 bg-primary text-black hover:bg-primary/90 font-bold text-xs rounded flex items-center gap-1.5 mx-auto"
                    >
                      Go to Tracker <ArrowRight size={12} />
                    </button>
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

            </div>

            {/* Right column — Activity sidebar */}
            <div className="lg:col-span-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-4">Activity</h3>
              {activityEvents.length === 0 ? (
                <div className="bg-[#181C26]/60 rounded-xl border border-white/5 px-5 py-8 text-center">
                  <p className="text-xs text-muted-foreground">No activity yet.</p>
                </div>
              ) : (
                <div
                  className="bg-[#181C26] rounded-xl border border-white/5 divide-y divide-white/5 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent"
                  style={{ height: activityHeight ?? 496, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
                >
                  {activityEvents.map((event, i) => (
                    <div
                      key={i}
                      onClick={() => {
                        const url = activityUrl(songId, event);
                        console.log('[Activity click]', {
                          type: event.type,
                          songId: event.songId,
                          reviewId: event.reviewId,
                          commentId: event.commentId,
                          url,
                        });
                        setLocation(url);
                      }}
                      className="flex items-start justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer gap-3"
                    >
                      <p className="text-sm text-white/80 leading-snug">{capitalize(event.description)}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{timeAgo(event.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── Files tab ────────────────────────────────────────────────────── */}
        {activeTab === 'files' && (
          <div className="p-6">
            <div className="bg-[#181C26] rounded-xl border border-white/5 overflow-hidden">
              <DndContext>
                <MediaBucket songId={songId} />
              </DndContext>
            </div>
          </div>
        )}

        {/* ── Review tab ───────────────────────────────────────────────────── */}
        {activeTab === 'review' && (
          <div className="space-y-6">
            {reviews.length === 0 ? (
              <div className="bg-[#181C26]/60 rounded-xl border border-white/5 px-6 py-16 text-center">
                <p className="text-sm font-semibold text-white/60 mb-2">No mixes shared yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Export a mix from the Workspace and check{' '}
                  <span className="text-primary/70 font-medium">Share to Review</span> to post it here.
                </p>
                <button
                  onClick={() => goToWorkspace()}
                  className="mt-6 h-8 px-5 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
                >
                  Open Workspace
                </button>
              </div>
            ) : (
              reviews.map(review => (
                <ReviewPlayer
                  key={review.id}
                  review={review}
                  autoCommentId={review.id === autoReviewId ? autoCommentId : null}
                />
              ))
            )}
          </div>
        )}

      </main>
    </div>
  );
}
