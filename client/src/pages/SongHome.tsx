import React, { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { capitalize } from '@/lib/utils';
import { useParams, useLocation, useSearch } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { DndContext } from '@dnd-kit/core';
import { useLooseFileOrganizeDnd } from '@/hooks/use-loose-file-organize-dnd';
import { LooseFileDragOverlay } from '@/components/daw/LooseFileDragOverlay';
import {
  ChevronRight, Circle, Clock, ArrowRight, Play, Pause,
  CheckCircle2, MoreHorizontal, ChevronDown, ChevronUp, MessageCircle,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { MentionText } from '@/components/MentionText';
import { cn, trapDialogTab } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { MediaBucket } from '@/components/daw/MediaBucket';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ProductionTask } from '@shared/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Song {
  id: string;
  name: string;
  bpm: number | null;
  lyrics: string | null;
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

interface LyricsComment {
  id: string;
  songId: string;
  parentId: string | null;
  author: string;
  text: string;
  anchorText: string;
  anchorOffset: number;
  resolved: boolean;
  createdAt: string;
  replies?: LyricsComment[];
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
  if (event.type === 'task-status-change') {
    return `${base}?tab=production`;
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

function truncateAnchor(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Shared by both click-to-highlight and position-based sorting. `anchorOffset`
// is checked first (fast path — lyrics haven't changed since the comment was
// made); falls back to a plain indexOf scan (first match) if the lyrics were
// edited and the original offset no longer lines up. Returns null when the
// anchor text isn't found anywhere in the current lyrics at all (deleted) —
// callers treat that as "unresolved": no highlight, sorts to the end.
function resolveCommentAnchor(
  lyrics: string,
  anchorText: string,
  anchorOffset: number
): { start: number; end: number } | null {
  if (!anchorText) return null;
  if (lyrics.slice(anchorOffset, anchorOffset + anchorText.length) === anchorText) {
    return { start: anchorOffset, end: anchorOffset + anchorText.length };
  }
  const idx = lyrics.indexOf(anchorText);
  if (idx === -1) return null;
  return { start: idx, end: idx + anchorText.length };
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
    queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
    queryClient.invalidateQueries({ queryKey: ['songs'] });
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
      queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
    } finally {
      setEditSubmitting(false);
    }
  };

  const executeDelete = async (commentId: string) => {
    await fetch(`/api/review-comments/${commentId}`, { method: 'DELETE' });
    setDeleteConfirmId(null);
    if (expandedThreadId === commentId) setExpandedThreadId(null);
    refetchComments();
    queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
    queryClient.invalidateQueries({ queryKey: ['songs'] });
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
        body: JSON.stringify({ text: newComment.trim(), timestamp: currentTime }),
      });
      setNewComment('');
      setMainMentionQuery(null);
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
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
        body: JSON.stringify({ text: replyText.trim(), timestamp: parentTimestamp, parentId }),
      });
      setReplyText('');
      setReplyMentionQuery(null);
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['activity', review.songId] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['songs'] });
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
                          <MentionText text={comment.text} usernames={bandMembers} />
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
                                <span className="text-sm text-white/80 break-words"><MentionText text={reply.text} usernames={bandMembers} /></span>
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

// ─── LyricsTab ────────────────────────────────────────────────────────────────

interface SelectionRange {
  start: number;
  end: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

// Trigger point the composer anchors to. bottomY is the point the composer's
// own bottom edge aligns to (the pill's bottom edge, or the right-click point
// for a single-point trigger) — the composer always grows upward from there,
// however tall its content makes it.
interface ComposerAnchor {
  x: number;
  bottomY: number;
}

function LyricsTab({ songId, song }: { songId: string; song: Song | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const [lyricsDraft, setLyricsDraft] = useState('');
  const [lastSavedLyrics, setLastSavedLyrics] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const initialized = useRef(false);

  // One-shot init from the fetched song — same pattern as MediaBucket's session
  // restore ref, so a later refetch (e.g. after another user's edit) never clobbers
  // an in-progress draft. Gated on `song` (not just its lyrics field) so a direct
  // deep link to ?tab=lyrics can't init from an still-loading placeholder before
  // the song query resolves.
  // useLayoutEffect (not useEffect) — on a hard reload, `song` transitions from
  // undefined to loaded in a render triggered by the query resolving, at which
  // point `lyricsDraft` is still '' from initial state. A plain useEffect runs
  // AFTER that render paints, so the browser visibly flashes the empty/placeholder
  // textarea for a frame before this effect corrects it. useLayoutEffect runs
  // before paint, so the correction happens in the same commit the browser
  // actually shows — same reasoning as the auto-grow effect below.
  useLayoutEffect(() => {
    if (initialized.current || !song) return;
    initialized.current = true;
    setLyricsDraft(song.lyrics ?? '');
    setLastSavedLyrics(song.lyrics ?? '');
  }, [song]);

  const saveLyrics = useMutation({
    mutationFn: async (lyrics: string) => {
      const r = await fetch(`/api/songs/${songId}/lyrics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to save lyrics');
      }
      return r.json();
    },
    onSuccess: (_data, lyrics) => {
      setLastSavedLyrics(lyrics);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
      queryClient.invalidateQueries({ queryKey: ['song', songId] });
    },
    onError: (err) => {
      toast({
        title: 'Failed to save lyrics',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'destructive',
      });
    },
  });

  const handleBlur = () => {
    if (lyricsDraft === lastSavedLyrics) return;
    saveLyrics.mutate(lyricsDraft);
  };

  // ── Comments ──────────────────────────────────────────────────────────────

  const { data: lyricsComments = [], isLoading: commentsLoading } = useQuery<LyricsComment[]>({
    queryKey: ['lyrics-comments', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}/lyrics-comments`).then(r => r.json()),
  });
  // Gates the sidebar's rendering below. On a hard reload this query and the
  // song query race independently — if comments resolve first, `lyricsDraft`
  // is still '' (song not loaded/seeded yet), so resolveCommentAnchor can't
  // match any anchorText against real content and every comment falls back
  // to the unresolved/newest-first sort order for a frame. Requiring `song`
  // to be loaded too (not just comments) means resolvedAnchors below is only
  // ever rendered once it's computed against real lyrics content.
  const commentsDataReady = song !== undefined && !commentsLoading;
  // Resolved once per comment per lyrics change, reused by both the sidebar's
  // position-based ordering and click-to-highlight (avoids recomputing the
  // same anchor scan twice for the same render).
  const resolvedAnchors = useMemo(() => {
    const map = new Map<string, { start: number; end: number } | null>();
    for (const c of lyricsComments) {
      map.set(c.id, resolveCommentAnchor(lyricsDraft, c.anchorText, c.anchorOffset));
    }
    return map;
  }, [lyricsComments, lyricsDraft]);

  // Top-of-document first, matching reading order (Google Docs convention) —
  // not creation time. Unresolved comments (anchor text no longer found in the
  // lyrics at all) sort to the end, keeping the prior most-recent-first order
  // among themselves since exact tiebreak order there isn't load-bearing.
  const sortedComments = useMemo(() => {
    return [...lyricsComments].sort((a, b) => {
      const posA = resolvedAnchors.get(a.id)?.start ?? null;
      const posB = resolvedAnchors.get(b.id)?.start ?? null;
      if (posA === null && posB === null) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (posA === null) return 1;
      if (posB === null) return -1;
      return posA - posB;
    });
  }, [lyricsComments, resolvedAnchors]);

  // Resolved comments are hidden by default behind a "Show resolved" toggle,
  // same convention as ReviewPlayer's `showResolved`/`visibleComments` — they
  // don't just fade in place. Filtering happens after the position-based sort
  // above, so resolving a comment never changes its place in the list.
  // Persisted per-song to localStorage — personal UI state, same convention
  // as zoom/scroll/loop in Timeline.tsx/Transport.tsx. Lazy-initialized so
  // the first paint is already correct (no post-mount effect correction).
  const [showResolved, setShowResolved] = useState(() => localStorage.getItem(`patchbay-lyrics-show-resolved-${songId}`) === 'true');
  useEffect(() => {
    localStorage.setItem(`patchbay-lyrics-show-resolved-${songId}`, String(showResolved));
  }, [showResolved, songId]);
  const resolvedCount = lyricsComments.filter(c => c.resolved).length;
  const visibleComments = showResolved ? sortedComments : sortedComments.filter(c => !c.resolved);

  // @ mention autocomplete — same pattern as ReviewPlayer/ClipInfoWindow:
  // plain-text `@username` insertion, no structured mention format, no
  // backend parsing/notification.
  const { data: usersData = [] } = useQuery<{ id: string; username: string }[]>({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then(r => r.json()),
  });
  const bandMembers = usersData.map(u => u.username);
  const [composerMentionQuery, setComposerMentionQuery] = useState<string | null>(null);
  const [composerMentionIndex, setComposerMentionIndex] = useState(0);
  const composerMentionResults = composerMentionQuery !== null
    ? bandMembers.filter(m => m.toLowerCase().startsWith(composerMentionQuery.toLowerCase()))
    : [];
  const [replyMentionQuery, setReplyMentionQuery] = useState<string | null>(null);
  const [replyMentionIndex, setReplyMentionIndex] = useState(0);
  const replyMentionResults = replyMentionQuery !== null
    ? bandMembers.filter(m => m.toLowerCase().startsWith(replyMentionQuery.toLowerCase()))
    : [];

  // Replies — one level of nesting, same as ReviewPlayer's expandedThreadId
  // (only one thread open at a time).
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const replyInputRef = useRef<HTMLInputElement>(null);

  const toggleThread = (commentId: string) => {
    const opening = expandedThreadId !== commentId;
    setExpandedThreadId(opening ? commentId : null);
    setReplyText('');
    setReplyMentionQuery(null);
    // Opening a thread (via "Reply" or "N replies") makes it the active/glowing
    // comment too — the user is now clearly interacting with it, same as a
    // click-to-highlight, even though this doesn't touch the textarea
    // selection at all. Collapsing does not clear the glow — that's not a
    // "selection cleared" event, just hiding the thread view.
    if (opening) setActiveCommentId(commentId);
  };

  // The captured character-offset selection driving the pending comment, plus
  // where to render the floating icon / context menu / composer for it. All
  // three are `fixed`-positioned using raw clientX/clientY, matching Timeline's
  // existing background-right-click context menu pattern — no relative-wrapper
  // coordinate math needed.
  const [selectionRange, setSelectionRange] = useState<SelectionRange | null>(null);
  const [iconPos, setIconPos] = useState<ScreenPoint | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<ScreenPoint | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerAnchor, setComposerAnchor] = useState<ComposerAnchor | null>(null);
  const [composerText, setComposerText] = useState('');
  // Which comment card (if any) is showing the "active" glow — set only when
  // a click-to-highlight actually lands a real selection, cleared whenever
  // that selection stops being current for any reason (see the clear sites
  // below: resetSelectionUi, a fresh manual selection, and selection collapse
  // on typing).
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  // Refs to the three floating elements that can steal focus from the textarea
  // as part of their own intended click flow (pill → composer, context menu →
  // composer). handleTextareaBlur must not treat focus moving to any of these
  // as an "outside click" — see handleTextareaBlur below for why.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pillButtonRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  // For measuring where the pill should sit — the same document-flow wrapper
  // the highlight overlay lives in, and the mirror span for the current
  // selection within it. See the iconPos-computing effect below.
  const lyricsWrapperRef = useRef<HTMLDivElement>(null);
  const selectionMirrorSpanRef = useRef<HTMLSpanElement>(null);
  // Clicking the pill replaces it with the composer in the SAME React commit
  // (iconPos -> null, composerOpen -> true together). The composer's textarea
  // autoFocuses, which blurs this textarea synchronously during React's
  // mutation phase — before composerContainerRef gets attached in the later
  // layout phase, and after pillButtonRef is already nulled from the pill's
  // own unmount. So at blur time both refs are null and the relatedTarget
  // check below can't recognize the composer. This ref-free flag is the fix:
  // it's set synchronously (no commit-timing dependency) only when the
  // textarea is the one actually about to lose focus.
  const suppressNextBlurResetRef = useRef(false);

  // Auto-grow: no internal scrollbar, no manual resize handle — the textarea
  // always sizes to exactly fit its content, like Google Docs. Runs on every
  // lyricsDraft change, which covers typing, paste, cut, AND the one-shot
  // programmatic init from the loaded song (so the initial height already
  // fits saved lyrics on first render, not just after the first keystroke).
  // useLayoutEffect (not useEffect) so the resize happens before the browser
  // paints — otherwise a stale height would flash before snapping to the
  // correct one. Reset to 'auto' first: scrollHeight only reports the height
  // needed to fit content at the CURRENT height, so shrinking (e.g. after
  // deleting a line) would otherwise never be detected — collapsing back to
  // 'auto' forces the browser to recompute scrollHeight from scratch. The
  // CSS min-h-[640px] class still provides the floor: setting an inline
  // height shorter than that has no visible effect since min-height always
  // wins over a smaller height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [lyricsDraft]);

  // Pill position — derived from the mirror span's real document-flow position,
  // not a one-time viewport snapshot. The old approach stored e.clientX/clientY
  // (viewport-relative) and rendered the pill `position: fixed`, so it stayed
  // put on screen while the underlying text scrolled out from under it. This
  // effect instead measures selectionMirrorSpanRef — the same always-rendered
  // mirror the highlight overlay uses — relative to lyricsWrapperRef (a normal,
  // in-flow ancestor), and the pill renders `position: absolute` inside that
  // same wrapper. An absolute offset from an in-flow ancestor scrolls with the
  // page automatically, so this needs no scroll listener to stay correct.
  // getClientRects() (not getBoundingClientRect()) because a wrapped selection
  // spans multiple line boxes; the LAST one approximates "near the end of the
  // selection," matching where the old mouseup-coordinate approach landed.
  // Gated on contextMenuPos/composerOpen because handleTextareaContextMenu and
  // openComposer both also touch selectionRange, but neither should show the
  // pill — this must stay in sync with the same gates those two use.
  useLayoutEffect(() => {
    if (!selectionRange || contextMenuPos || composerOpen) {
      setIconPos(null);
      return;
    }
    const span = selectionMirrorSpanRef.current;
    const wrapper = lyricsWrapperRef.current;
    if (!span || !wrapper) {
      setIconPos(null);
      return;
    }
    const rects = span.getClientRects();
    if (rects.length === 0) {
      setIconPos(null);
      return;
    }
    const lastRect = rects[rects.length - 1];
    const wrapperRect = wrapper.getBoundingClientRect();
    setIconPos({ x: lastRect.right - wrapperRect.left, y: lastRect.top - wrapperRect.top });
  }, [selectionRange, contextMenuPos, composerOpen]);

  const resetSelectionUi = () => {
    setSelectionRange(null);
    setIconPos(null);
    setContextMenuPos(null);
    setComposerOpen(false);
    setComposerAnchor(null);
    setComposerText('');
    setActiveCommentId(null);
  };

  // iconPos (the floating pill) is otherwise only ever recalculated inside
  // the document-level mouseup handler below — but deleting a selection via
  // Delete/Backspace, or typing a character over one, never fires mouseup,
  // so nothing else tells
  // the pill its tracked selection just collapsed (confirmed via trace: after
  // Delete, selectionStart/End correctly collapse but the pill stayed
  // rendered at its old position). The composer is deliberately left out of
  // this check — while it's open, edits happen in ITS OWN textarea, not this
  // one, so this handler doesn't fire during that flow and can't interfere.
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLyricsDraft(e.target.value);
    if (e.target.selectionStart === e.target.selectionEnd) {
      if (iconPos || selectionRange) resetSelectionUi();
      // A comment-click highlight isn't tracked via `selectionRange` (it's a
      // real native selection set directly on the element), so it isn't
      // caught by the branch above — clear it separately whenever typing
      // collapses whatever was selected, comment-driven or not.
      else if (activeCommentId) setActiveCommentId(null);
    }
  };

  // A mouseup bound directly to the textarea only fires when the release
  // itself lands inside the textarea's own rendered box — but word-wrapped
  // lines rarely span its full width, so releasing in the blank space to the
  // right of a short line (still visually "in the textarea" to the user) missed
  // the event entirely and the pill never appeared, even though a real
  // selection existed. Fix: mousedown on the textarea attaches a ONE-SHOT
  // listener on `document` itself instead, which sees a mouseup no matter
  // where on the page it lands (anywhere in the browser window — a release
  // that leaves the window entirely, e.g. onto the OS desktop or another
  // app, can never be observed by any JS in the page; that's a platform
  // limit, not a bug). The listener removes itself the first time it fires
  // so it's never left attached past the drag it was meant to catch; the
  // cleanup effect below is a backstop for the case where a mousedown starts
  // but this component unmounts before any mouseup follows.
  const documentMouseUpHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  const handleTextareaMouseDown = () => {
    if (documentMouseUpHandlerRef.current) {
      document.removeEventListener('mouseup', documentMouseUpHandlerRef.current);
    }
    const handleDocumentMouseUp = (e: MouseEvent) => {
      document.removeEventListener('mouseup', handleDocumentMouseUp);
      documentMouseUpHandlerRef.current = null;
      // Same guard as before, just moved from the textarea's own mouseup to
      // this document-level one: right-click's native event order is
      // mousedown -> contextmenu -> mouseup, so this still-attached listener
      // (armed by right-click's own mousedown) would otherwise see that
      // trailing mouseup and clobber state the contextmenu handler just set.
      if (e.button !== 0) return;
      // Deferred by a tick: when this click also restores focus after the
      // textarea was blurred elsewhere (switching tabs/apps/windows) while a
      // selection was active, Chromium does not collapse/recompute the caret to
      // the click position synchronously with mousedown/mouseup/click — it does
      // so on a later task (confirmed via native event tracing: sync mouseup,
      // a queued microtask, and the click event all still read the OLD,
      // pre-blur selection; only a read deferred past this task sees the real,
      // settled one). Reading synchronously here would show a phantom selection
      // that's about to collapse, making the pill appear over text that isn't
      // actually highlighted anymore. A plain click on an already-focused
      // textarea is unaffected — its selection is already settled by the time
      // mouseup fires, so deferring doesn't change that value, only its timing
      // by under a frame.
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        if (el.selectionStart === el.selectionEnd) {
          resetSelectionUi();
          return;
        }
        setSelectionRange({ start: el.selectionStart, end: el.selectionEnd });
        // iconPos is no longer set directly here — the layout effect above
        // derives it from the mirror span once this selectionRange change
        // re-renders it, so the pill's position is document-flow-relative
        // instead of a one-time viewport snapshot.
        setContextMenuPos(null);
        setComposerOpen(false);
        setComposerText('');
        // A fresh manual selection always supersedes a comment-click highlight.
        setActiveCommentId(null);
      }, 0);
    };
    documentMouseUpHandlerRef.current = handleDocumentMouseUp;
    document.addEventListener('mouseup', handleDocumentMouseUp);
  };

  useEffect(() => {
    return () => {
      if (documentMouseUpHandlerRef.current) {
        document.removeEventListener('mouseup', documentMouseUpHandlerRef.current);
      }
    };
  }, []);

  const handleTextareaContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart === el.selectionEnd) return; // no selection — let the native menu show
    e.preventDefault();
    setSelectionRange({ start: el.selectionStart, end: el.selectionEnd });
    setComposerOpen(false);
    setComposerText('');
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Native selection is cleared the moment the textarea loses focus, but our
  // own pill/menu/composer state is independent React state and won't clear
  // itself — this is what leaves the pill stuck after clicking away. The catch:
  // clicking the pill (composer opens), clicking "Add comment" in the right-click
  // menu (composer opens), and the composer's own autoFocus stealing focus the
  // instant it opens ALL fire a real blur on this textarea too, with
  // relatedTarget pointing at that respective element — so a blanket
  // "clear on any blur" would wipe selectionRange out from under the composer
  // before it can render (composer's render guard requires selectionRange).
  // suppressNextBlurResetRef handles the pill's same-commit race (see its
  // declaration above); the relatedTarget check below still covers the
  // context-menu path, whose ref is already attached from an earlier commit
  // by the time its "Add comment" click fires. Only a genuine focus move to
  // somewhere outside all of these should reset.
  const handleTextareaBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    handleBlur();
    if (suppressNextBlurResetRef.current) {
      suppressNextBlurResetRef.current = false;
      return;
    }
    const related = e.relatedTarget as Node | null;
    const movingToFloatingUi =
      !!related &&
      (pillButtonRef.current?.contains(related) ||
        contextMenuRef.current?.contains(related) ||
        composerContainerRef.current?.contains(related));
    if (movingToFloatingUi) return;
    resetSelectionUi();
  };

  const openComposer = (anchor: ComposerAnchor) => {
    // Only the pill path needs this: the textarea is still focused right up
    // until this same commit unmounts the pill and mounts the composer. The
    // context-menu path already lost focus earlier (to the menu button), so
    // this textarea won't blur again here — leaving the flag unset for that
    // path avoids it going stale and swallowing some later, unrelated blur.
    if (document.activeElement === textareaRef.current) {
      suppressNextBlurResetRef.current = true;
    }
    setComposerAnchor(anchor);
    setContextMenuPos(null);
    setComposerOpen(true);
  };

  // Composer vertical placement — the composer's own bottom edge anchors
  // directly to composerAnchor.bottomY (the pill's bottom edge, or the
  // right-click point), and it grows upward from there as its content
  // changes height. No JS measurement needed: this is a pure CSS trick
  // (top: bottomY + transform: translateY(-100%), applied inline in the JSX
  // below) rather than a layout effect, so there's no measure-then-correct
  // step and no "not enough room above" case to detect — if that pushes the
  // composer up over the header for a selection near the top of the page,
  // that's accepted, not a bug.

  // Dismiss the right-click menu on outside click or Escape — same pattern as
  // Timeline's background context menu.
  useEffect(() => {
    if (!contextMenuPos) return;
    const dismiss = () => setContextMenuPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenuPos(null); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenuPos]);

  // Escape closes the composer too.
  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') resetSelectionUi(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [composerOpen]);

  // Shared by both the top-level composer and replies — a reply is just a
  // comment with `parentId` set. `anchorText`/`anchorOffset` are NOT NULL
  // columns with no server-side inherit-from-parent logic (confirmed against
  // routes.ts), so a reply must carry the parent's anchor values explicitly —
  // same pattern ReviewPlayer.submitReply uses for `timestamp`.
  const addComment = useMutation({
    mutationFn: async (payload: { text: string; anchorText: string; anchorOffset: number; parentId?: string }) => {
      const r = await fetch(`/api/songs/${songId}/lyrics-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to add comment');
      }
      return r.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lyrics-comments', songId] });
      if (variables.parentId) {
        setReplyText('');
        setReplyMentionQuery(null);
      } else {
        resetSelectionUi();
      }
    },
    onError: (err) => {
      toast({
        title: 'Failed to add comment',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'destructive',
      });
    },
  });

  const handleSubmitComment = () => {
    if (!selectionRange || !composerText.trim() || addComment.isPending) return;
    addComment.mutate({
      text: composerText.trim(),
      anchorText: lyricsDraft.slice(selectionRange.start, selectionRange.end),
      anchorOffset: selectionRange.start,
    });
  };

  const submitReply = (parent: LyricsComment) => {
    if (!replyText.trim() || addComment.isPending) return;
    addComment.mutate({
      text: replyText.trim(),
      anchorText: parent.anchorText,
      anchorOffset: parent.anchorOffset,
      parentId: parent.id,
    });
  };

  const toggleResolved = useMutation({
    mutationFn: async (comment: LyricsComment) => {
      const r = await fetch(`/api/lyrics-comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !comment.resolved }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to update comment');
      }
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lyrics-comments', songId] }),
    onError: (err) => {
      toast({
        title: 'Failed to update comment',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'destructive',
      });
    },
  });

  // Delete — the same route/storage method handles both a top-level comment
  // (deleteLyricsComment explicitly deletes rows where parentId = id first,
  // then the comment itself — cascade is storage-layer, not a DB FK) and a
  // single reply (no rows match parentId = replyId, so only that row goes).
  // Server enforces author-only delete (403 otherwise) — this mutation
  // doesn't duplicate that check, it just surfaces the server's error.
  const [deleteConfirmComment, setDeleteConfirmComment] = useState<LyricsComment | null>(null);
  const deleteCommentButtonRef = useRef<HTMLButtonElement>(null);

  const deleteComment = useMutation({
    mutationFn: async (commentId: string) => {
      const r = await fetch(`/api/lyrics-comments/${commentId}`, { method: 'DELETE' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to delete comment');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lyrics-comments', songId] }),
    onError: (err) => {
      toast({
        title: 'Failed to delete comment',
        description: err instanceof Error ? err.message : 'An error occurred.',
        variant: 'destructive',
      });
    },
  });

  // Top-level comment with replies needs confirmation (irreversible, affects
  // other people's replies); zero-reply comments and single replies delete
  // immediately — same low-stakes tier.
  const handleDeleteComment = (comment: LyricsComment) => {
    if ((comment.replies ?? []).length > 0) {
      setDeleteConfirmComment(comment);
    } else {
      deleteComment.mutate(comment.id);
    }
  };

  // Composer @ mention handlers — mirrors ReviewPlayer's handleMainChange /
  // handleMainKeyDown / insertMainMention exactly, adapted for a <textarea>.
  const handleComposerTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComposerText(val);
    const m = /@(\w*)$/.exec(val);
    setComposerMentionQuery(m ? m[1] : null);
    setComposerMentionIndex(0);
  };

  const insertComposerMention = (name: string) => {
    setComposerText(prev => prev.replace(/@\w*$/, `@${name} `));
    setComposerMentionQuery(null);
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composerMentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setComposerMentionIndex(i => Math.min(i + 1, composerMentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setComposerMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); insertComposerMention(composerMentionResults[composerMentionIndex]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setComposerMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmitComment();
    }
  };

  // Reply @ mention handlers — mirrors ReviewPlayer's handleReplyChange /
  // handleReplyKeyDown / insertReplyMention exactly.
  const handleReplyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setReplyText(val);
    const m = /@(\w*)$/.exec(val);
    setReplyMentionQuery(m ? m[1] : null);
    setReplyMentionIndex(0);
  };

  const insertReplyMention = (name: string) => {
    setReplyText(prev => prev.replace(/@\w*$/, `@${name} `));
    setReplyMentionQuery(null);
    setTimeout(() => replyInputRef.current?.focus(), 0);
  };

  const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, parent: LyricsComment) => {
    if (replyMentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setReplyMentionIndex(i => Math.min(i + 1, replyMentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setReplyMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') { e.preventDefault(); insertReplyMention(replyMentionResults[replyMentionIndex]); return; }
      if (e.key === 'Escape') { setReplyMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(parent); return; }
    if (e.key === 'Escape') { setExpandedThreadId(null); setReplyText(''); setReplyMentionQuery(null); }
  };

  // Click a comment card -> highlight its anchor text as a real native
  // selection (setSelectionRange + focus, not a CSS overlay). Takes priority
  // over any in-progress pill/menu/composer/own-selection state — cleared via
  // resetSelectionUi before applying the new selection. Unresolved comments
  // (anchor text no longer found anywhere in the lyrics) fail silently.
  const handleCommentClick = (comment: LyricsComment) => {
    const resolved = resolvedAnchors.get(comment.id);
    if (!resolved) return;
    const el = textareaRef.current;
    if (!el) return;
    resetSelectionUi();
    el.setSelectionRange(resolved.start, resolved.end);
    el.focus();
    setActiveCommentId(comment.id);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

      {/* Left column — Lyrics */}
      <div className="lg:col-span-2 bg-[#181C26] rounded-xl border border-white/5">
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <p className="text-[10px] font-bold tracking-widest uppercase text-white/40">Lyrics</p>
          {(saveLyrics.isPending || justSaved) && (
            <span className={cn(
              'text-[10px] font-semibold uppercase tracking-widest',
              saveLyrics.isPending ? 'text-white/40' : 'text-primary'
            )}>
              {saveLyrics.isPending ? 'Saving…' : 'Saved'}
            </span>
          )}
        </div>
        <div className="p-5">
          <div ref={lyricsWrapperRef} className="relative">
            {/* Selection mirror — always rendered whenever there's an active selectionRange
                (pill-showing OR composing), not just while composing. Two jobs:
                1. Highlight overlay while composing — a blurred <textarea> renders NO selection
                   indicator at all once focus moves to another element in the same document
                   (confirmed via screenshot: this is different from the muted "inactive"
                   highlight browsers show when the whole window loses focus, which IS visible —
                   see the Known browser-timing gotchas note). The composer's own autoFocus is
                   exactly that case, so the original selection needs to be reproduced here since
                   the real native one won't render while the composer has focus. Sits behind the
                   textarea (z-0 vs textarea's z-10) with fully transparent text — only the
                   highlighted span's background shows (bg-primary/30, composing state only —
                   plain transparent otherwise), through the textarea's own transparent
                   background, with the textarea's real (visible) text painted on top of it.
                2. Position source for the floating pill — see the iconPos-computing effect
                   above. selectionMirrorSpanRef points at the middle (selected-range) span;
                   its getClientRects() relative to lyricsWrapperRef gives the pill a
                   document-flow-relative position that scrolls with the page naturally,
                   instead of the one-time viewport snapshot (clientX/clientY + position:fixed)
                   this used to use, which is what left the pill behind when the page scrolled.
                This inner wrapper carries no padding of its own (the padding is on the OUTER
                div) — inset-0 on an absolutely-positioned child aligns to its nearest
                positioned ancestor's *padding* box, so nesting it inside the padded div
                directly would offset it by the full padding amount from the textarea's own
                (padding-respecting, normal-flow) position. */}
            {selectionRange && (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-0 pointer-events-none whitespace-pre-wrap break-words font-sans text-sm leading-relaxed overflow-hidden"
              >
                <span className="text-transparent">{lyricsDraft.slice(0, selectionRange.start)}</span>
                <span
                  ref={selectionMirrorSpanRef}
                  className={cn('text-transparent', composerOpen && 'bg-primary/30')}
                >
                  {lyricsDraft.slice(selectionRange.start, selectionRange.end)}
                </span>
                <span className="text-transparent">{lyricsDraft.slice(selectionRange.end)}</span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={lyricsDraft}
              onChange={handleTextareaChange}
              onBlur={handleTextareaBlur}
              onMouseDown={handleTextareaMouseDown}
              onContextMenu={handleTextareaContextMenu}
              placeholder={song !== undefined && lyricsDraft === '' ? 'No lyrics yet — start typing...' : undefined}
              className="relative z-10 w-full min-h-[640px] bg-transparent text-sm text-white/90 leading-relaxed resize-none overflow-hidden outline-none placeholder:text-muted-foreground placeholder:italic"
            />
            {/* Floating "Add comment" pill — shown after a mouseup selection, hidden once the
                composer opens. position: absolute (not fixed) inside this same in-flow wrapper,
                using the wrapper-relative offset the effect above computed, so it scrolls with
                the page instead of staying pinned to a stale viewport position. */}
            {iconPos && !composerOpen && (
              <button
                ref={pillButtonRef}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  // The composer still renders position: fixed (viewport-relative, untouched by
                  // the earlier scroll-tracking fix), so it needs a fresh viewport point — read
                  // live from the pill's own rect at click time rather than reusing iconPos,
                  // which is wrapper-relative and would be the wrong coordinate space for a
                  // fixed-positioned element. bottomY (the pill's real bottom edge) is the point
                  // the composer's own bottom edge anchors to.
                  const rect = pillButtonRef.current?.getBoundingClientRect();
                  const anchor = rect ? { x: rect.left, bottomY: rect.bottom } : { x: 0, bottomY: 0 };
                  openComposer(anchor);
                }}
                className="absolute z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-black text-[10px] font-bold shadow-xl hover:bg-primary/90 transition-colors cursor-pointer whitespace-nowrap"
                style={{ left: iconPos.x, top: iconPos.y - 36 }}
              >
                <MessageCircle size={12} />
                Add comment
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Right column — Comments sidebar */}
      <div className="lg:col-span-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-white/80 mb-4">Comments</h3>
        {!commentsDataReady ? null : sortedComments.length === 0 ? (
          <div className="bg-[#181C26]/60 rounded-xl border border-white/5 px-5 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              No comments yet — highlight text and add a comment to start the conversation.
            </p>
          </div>
        ) : (
          <div className="bg-[#181C26] rounded-xl border border-white/5 flex flex-col" style={{ height: 640 }}>
            {/* Show/hide resolved — same convention as ReviewPlayer's toggle;
                resolved comments are hidden by default, not just faded. */}
            {resolvedCount > 0 && (
              <div className="px-4 py-2 border-b border-white/5 flex items-center justify-end shrink-0">
                <button
                  onClick={() => setShowResolved(v => !v)}
                  className="text-[10px] font-bold text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
                >
                  <CheckCircle2 size={11} className="text-green-500/60" />
                  {showResolved ? 'Hide' : 'Show'} resolved ({resolvedCount})
                </button>
              </div>
            )}
            <div
              className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}
            >
              {visibleComments.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">All comments resolved.</p>
              ) : visibleComments.map((c) => {
                const isResolved = c.resolved;
                const replies = c.replies ?? [];
                const isExpanded = expandedThreadId === c.id;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      'rounded-lg',
                      activeCommentId === c.id && 'ring-1 ring-inset ring-primary/40 bg-primary/5',
                    )}
                  >
                    <div
                      onClick={() => handleCommentClick(c)}
                      className={cn(
                        'px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer',
                        isResolved && 'opacity-50',
                      )}
                    >
                      <p className="text-[10px] text-muted-foreground italic truncate mb-1">
                        on: "{truncateAnchor(c.anchorText)}"
                      </p>
                      <p className={cn('text-sm text-white/80 leading-snug', isResolved && 'line-through text-white/40')}>
                        <MentionText text={c.text} usernames={bandMembers} />
                      </p>
                      <div className="flex items-center justify-between mt-1.5 gap-3">
                        <span className="text-[11px] font-semibold text-white/50 flex items-center gap-1">
                          {capitalize(c.author)}
                          {isResolved && <CheckCircle2 size={11} className="text-green-500/70" />}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(new Date(c.createdAt).getTime())}</span>
                      </div>
                      {/* Reply / resolve actions */}
                      <div className="flex items-center gap-3 mt-1.5" onClick={e => e.stopPropagation()}>
                        {replies.length > 0 ? (
                          <button
                            onClick={() => toggleThread(c.id)}
                            className="text-[10px] font-bold text-white/30 hover:text-primary/80 transition-colors flex items-center gap-1"
                          >
                            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                            {isExpanded ? 'Hide' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleThread(c.id)}
                            className="text-[10px] font-bold text-white/30 hover:text-primary/80 transition-colors"
                          >
                            {isExpanded ? 'Cancel' : 'Reply'}
                          </button>
                        )}
                        <button
                          onClick={() => toggleResolved.mutate(c)}
                          className="text-[10px] font-bold text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
                        >
                          <CheckCircle2 size={11} className={isResolved ? 'text-white/30' : 'text-green-500/70'} />
                          {isResolved ? 'Unresolve' : 'Resolve'}
                        </button>
                        {c.author === user?.username && (
                          <button
                            onClick={() => handleDeleteComment(c)}
                            className="text-[10px] font-bold text-white/30 hover:text-red-400 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded thread — replies (one level only) + reply composer */}
                    {isExpanded && (
                      <div onClick={e => e.stopPropagation()}>
                        {replies.map(reply => (
                          <div key={reply.id} className="pl-8 pr-4 py-2 border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold text-white/50">{capitalize(reply.author)}</span>
                              {reply.author === user?.username && (
                                <button
                                  onClick={() => deleteComment.mutate(reply.id)}
                                  className="text-[10px] font-bold text-white/30 hover:text-red-400 transition-colors"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                            <p className="text-sm text-white/80 leading-snug break-words"><MentionText text={reply.text} usernames={bandMembers} /></p>
                          </div>
                        ))}
                        <div className="pl-8 pr-4 py-2 border-t border-white/[0.03] relative bg-white/[0.01]">
                          <div className="flex items-center gap-2">
                            <input
                              ref={replyInputRef}
                              type="text"
                              value={replyText}
                              onChange={handleReplyChange}
                              onKeyDown={e => handleReplyKeyDown(e, c)}
                              placeholder="Reply…"
                              className="flex-1 bg-transparent text-sm text-white placeholder:text-white/20 outline-none min-w-0"
                              autoFocus
                            />
                            {replyText.trim() && (
                              <button
                                onClick={() => submitReply(c)}
                                disabled={addComment.isPending}
                                className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors shrink-0"
                              >
                                Post
                              </button>
                            )}
                          </div>
                          {replyMentionResults.length > 0 && (
                            <div className="absolute left-8 right-4 top-full mt-1 bg-[#09090b] border border-white/10 rounded-md overflow-hidden shadow-lg z-50">
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
          </div>
        )}
      </div>

      {/* Right-click menu — only ever shown when a selection was active on right-click */}
      {contextMenuPos && (
        <div
          ref={contextMenuRef}
          className="fixed z-[9999] bg-popover border border-border rounded-md shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs font-semibold text-white/80 hover:bg-white/5 transition-colors cursor-pointer"
            onClick={() => openComposer({ x: contextMenuPos.x, bottomY: contextMenuPos.y })}
          >
            Add comment
          </button>
        </div>
      )}

      {/* Inline comment composer. Anchored purely in CSS: `top` is set to the
          trigger's bottomY and `translateY(-100%)` pulls the element's own
          bottom edge up to sit exactly there, so it grows upward from the
          pill/right-click point as content height changes — no JS
          measurement, no effect, no flip logic. */}
      {composerOpen && composerAnchor && selectionRange && (
        <div
          ref={composerContainerRef}
          className="fixed z-[9999] bg-[#181C26] border border-white/10 rounded-lg shadow-xl p-3 w-72"
          style={{
            left: Math.min(composerAnchor.x, window.innerWidth - 300),
            top: composerAnchor.bottomY,
            transform: 'translateY(-100%)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] text-muted-foreground italic truncate mb-2">
            on: "{truncateAnchor(lyricsDraft.slice(selectionRange.start, selectionRange.end))}"
          </p>
          <div className="relative">
            <textarea
              autoFocus
              value={composerText}
              onChange={handleComposerTextChange}
              onKeyDown={handleComposerKeyDown}
              placeholder="Add a comment…"
              rows={3}
              className="w-full bg-white/5 rounded-md p-2 text-sm text-white placeholder:text-white/30 outline-none resize-none"
            />
            {composerMentionResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#09090b] border border-white/10 rounded-md overflow-hidden shadow-lg z-50">
                {composerMentionResults.map((name, i) => (
                  <div
                    key={name}
                    className={cn('flex items-center gap-2 px-3 py-1.5 cursor-pointer', i === composerMentionIndex ? 'bg-primary/10' : 'hover:bg-white/5')}
                    onMouseDown={(e) => { e.preventDefault(); insertComposerMention(name); }}
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
          <div className="flex justify-end gap-3 mt-2">
            <button
              onClick={resetSelectionUi}
              className="text-[10px] font-bold text-white/50 hover:text-white/80 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitComment}
              disabled={!composerText.trim() || addComment.isPending}
              className="text-[10px] font-bold text-primary hover:text-primary/80 disabled:opacity-40 disabled:hover:text-primary transition-colors"
            >
              Comment
            </button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteConfirmComment} onOpenChange={(v) => !v && setDeleteConfirmComment(null)}>
        <AlertDialogContent
          className="bg-[#0c0c0e] border-white/10"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            deleteCommentButtonRef.current?.focus();
          }}
          onKeyDown={trapDialogTab}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const n = deleteConfirmComment?.replies?.length ?? 0;
                return `Delete this comment and its ${n} ${n === 1 ? 'reply' : 'replies'}? This can't be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={deleteCommentButtonRef}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (deleteConfirmComment) deleteComment.mutate(deleteConfirmComment.id);
                setDeleteConfirmComment(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  const activeTab = (tabParam === 'review' || tabParam === 'files' || tabParam === 'lyrics') ? tabParam : 'overview';
  const autoReviewId = searchParams.get('reviewId');
  const autoCommentId = searchParams.get('commentId');

  const lastSession = useMemo(() => readLastSession(songId), [songId]);

  // Song Files tab loose-file organize drag interaction — same shared hook Workspace/
  // MediaBucket, the Dashboard Ideas shelf, and the Songs quick-browser all use. This
  // route needs its own DndContext (a separate mount from Workspace's), but MediaBucket
  // itself already implements the loose-files list, the loose-mode Upload entry point,
  // and both the Section-row and Versions-column droppables — nothing else to build here
  // beyond wiring sensors/collisionDetection/handlers into the DndContext below.
  const looseFileOrganizeDnd = useLooseFileOrganizeDnd(songId, {
    onError: (msg) => console.error('[organizeLooseFile] error:', msg),
  });

  const { data: song } = useQuery<Song>({
    queryKey: ['song', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}`).then(r => r.json()),
  });

  const { data: tasks = [] } = useQuery<ProductionTask[]>({
    queryKey: ['production-tasks', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}/production-tasks`).then(r => r.json()),
  });

  const { data: reviews = [] } = useQuery<ReviewType[]>({
    queryKey: ['reviews', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}/reviews`).then(r => r.json()),
  });

  const [showAllTasks, setShowAllTasks] = useState(false);
  const [activityHeight, setActivityHeight] = useState<number | null>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const hasMeasured = useRef(false);

  const { data: activityEvents = [] } = useQuery<ActivityEvent[]>({
    queryKey: ['activity', songId],
    queryFn: () => apiRequest('GET', `/api/songs/${songId}/activity`).then(r => r.json()),
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
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1 bg-white/[0.03] p-1 rounded-lg border border-white/5 self-start w-fit">
            {(['overview', 'files', 'lyrics', 'review'] as const).map(tab => (
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
                {tab === 'overview' ? 'Overview' : tab === 'files' ? 'Song Files' : tab === 'lyrics' ? 'Lyrics' : `Review${reviews.length > 0 ? ` (${reviews.length})` : ''}`}
              </button>
            ))}
          </div>
          <button
            onClick={() => goToWorkspace()}
            className="h-8 px-4 rounded-md bg-primary text-black text-xs font-bold hover:bg-primary/90 transition-colors shrink-0"
          >
            Open Workspace
          </button>
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
              <DndContext
                sensors={looseFileOrganizeDnd.sensors}
                collisionDetection={looseFileOrganizeDnd.collisionDetection}
                onDragStart={looseFileOrganizeDnd.handleDragStart}
                onDragEnd={looseFileOrganizeDnd.handleDragEnd}
              >
                <MediaBucket songId={songId} />
                <LooseFileDragOverlay clip={looseFileOrganizeDnd.activeDrag} />
              </DndContext>
            </div>
          </div>
        )}

        {/* ── Lyrics tab ───────────────────────────────────────────────────── */}
        {activeTab === 'lyrics' && (
          <LyricsTab songId={songId} song={song} />
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
