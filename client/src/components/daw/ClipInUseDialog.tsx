import { useRef, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { trapDialogTab } from '@/lib/utils';
import { CLIP_IN_USE_CODE, type ClipDependents, type TaskStatus } from '@shared/clip-dependents';

// The "this file is in use" flow shared by every action that takes a real-song
// version out of its section (Remove today, moves later). The route answers
// 409 { code: 'clip-in-use', dependents } when something depends on the version;
// useClipInUseAction opens ClipInUseDialog with that list, and confirming repeats
// the same request with confirm: true. With no dependents the request just succeeds.

export class ClipInUseError extends Error {
  constructor(public dependents: ClipDependents, message = 'This file is in use.') {
    super(message);
    this.name = 'ClipInUseError';
  }
}

// POSTs `body` plus `confirm` to a leave route. Throws ClipInUseError on the
// clip-in-use 409, a plain Error with the server's message on any other failure.
export async function postClipLeave<T>(url: string, body: Record<string, unknown>, confirm: boolean): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, confirm }),
  });
  const data = await res.json().catch(() => null) as { code?: string; message?: string; dependents?: ClipDependents } | null;
  if (res.status === 409 && data?.code === CLIP_IN_USE_CODE && data.dependents) {
    throw new ClipInUseError(data.dependents, data.message);
  }
  if (!res.ok) throw new Error(data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

// V is the per-call variables: run(vars) passes them to request, and the dialog's
// confirm repeats the request with the same vars. Remove uses no vars (run()); a
// move passes its destination, so one surface-level instance serves every drop.
interface UseClipInUseActionOptions<T, V> {
  // The leave request. Called with confirm=false first, then confirm=true from the dialog.
  request: (confirm: boolean, vars: V) => Promise<T>;
  onSuccess?: (result: T, vars: V) => void;
  // Any failure other than clip-in-use.
  onError?: (message: string, vars: V) => void;
  // The dialog was dismissed (Cancel, Escape, outside click) — nothing was sent.
  onCancel?: (vars: V) => void;
}

export function useClipInUseAction<T, V = void>({ request, onSuccess, onError, onCancel }: UseClipInUseActionOptions<T, V>) {
  const [dependents, setDependents] = useState<ClipDependents | null>(null);
  // The vars of the request the dialog is asking about — state (for rendering the
  // dialog's wording) and a ref (for the confirm handler, which must not read a
  // stale render's value).
  const [pendingVars, setPendingVars] = useState<V | null>(null);
  const pendingVarsRef = useRef<V | null>(null);
  const [isPending, setIsPending] = useState(false);

  const setPending = (vars: V | null) => {
    pendingVarsRef.current = vars;
    setPendingVars(vars);
  };

  const send = async (confirm: boolean, vars: V) => {
    setIsPending(true);
    try {
      const result = await request(confirm, vars);
      setDependents(null);
      setPending(null);
      onSuccess?.(result, vars);
    } catch (err) {
      if (err instanceof ClipInUseError && !confirm) {
        setPending(vars);
        setDependents(err.dependents);
      } else {
        setDependents(null);
        setPending(null);
        onError?.(err instanceof Error ? err.message : String(err), vars);
      }
    } finally {
      setIsPending(false);
    }
  };

  return {
    run: (vars: V) => { void send(false, vars); },
    isPending,
    pendingVars,
    dialogProps: {
      open: dependents !== null,
      dependents,
      pending: isPending,
      onConfirm: () => { void send(true, pendingVarsRef.current as V); },
      onCancel: () => {
        const vars = pendingVarsRef.current as V;
        setDependents(null);
        setPending(null);
        onCancel?.(vars);
      },
    },
  };
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'complete': 'Complete',
  'will-not-play': 'Will Not Play',
};

// The bulleted list for every leave action (Remove, a move): each line says what the
// action will do, after an intro like 'Removing "X" will:' or 'Moving "X" to
// Track › Section will:'. sourceTrackName is the track the version leaves (the task
// line names it); null drops the track from that line.
export function describeLeaveDependents(d: ClipDependents, sourceTrackName: string | null): string[] {
  const lines: string[] = [];
  const placements = new Map<string, number>();
  for (const c of d.timelineCopies) {
    const where = `${c.trackName} › ${c.sectionName ?? 'Full Take'}`;
    placements.set(where, (placements.get(where) ?? 0) + 1);
  }
  placements.forEach((n, where) => {
    lines.push(n === 1
      ? `Remove it from the timeline in ${where}`
      : `Remove its ${n} placements from the timeline in ${where}`);
  });
  if (d.isFinal) lines.push('Clear its Final mark');
  for (const t of d.tasks) {
    if (t.willChangeTo !== t.status) {
      const section = sourceTrackName ? `${sourceTrackName} › ${t.sectionName}` : t.sectionName;
      lines.push(`Change the ${section} task from ${STATUS_WORDS[t.status]} to ${STATUS_WORDS[t.willChangeTo]}`);
    }
  }
  return lines;
}

interface ClipInUseDialogProps {
  open: boolean;
  dependents: ClipDependents | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // Labels the confirm button for the action, e.g. "Remove anyway".
  actionLabel: string;
  // Optional line above the dependents list, e.g. 'Moving "Bass Intro V2" to Bass › Verse 1 will:'.
  intro?: string;
  // Optional line on what happens to placements, e.g. "Removing it takes it off the timeline and clears Final."
  consequence?: string;
  // Builds the bulleted list from the dependents. Defaults to describeLeaveDependents
  // with no track name; Remove and the move dialog pass it with the version's track.
  describe?: (d: ClipDependents) => string[];
}

export function ClipInUseDialog({ open, dependents, pending, onConfirm, onCancel, actionLabel, intro, consequence, describe = (d) => describeLeaveDependents(d, null) }: ClipInUseDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lines = dependents ? describe(dependents) : [];
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent
        className="bg-[#0c0c0e] border-border"
        onOpenAutoFocus={(e) => { e.preventDefault(); confirmRef.current?.focus(); }}
        onKeyDown={trapDialogTab}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading uppercase tracking-wider">This file is in use</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              {intro && <p>{intro}</p>}
              <ul className="list-disc pl-5 space-y-1 text-white/80">
                {lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p>{consequence ? `${consequence} ` : ''}The audio file, notes and metadata are kept.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// The in-use dialog for a version move — to another section (Move A) or out to a
// loose file (Moves B/C/D, "Move Out of Section"). Rendered once per surface with
// useVersionMoveDnd's dialogProps and pendingVars.
type VersionMoveDialogVars =
  | { kind: 'section'; clipName: string; sourceTrackName: string; destTrackName: string; destSectionName: string }
  | { kind: 'loose'; clipName: string; sourceTrackName: string; sourceSectionName: string };

export function VersionMoveInUseDialog({ dialogProps, vars }: {
  dialogProps: Omit<ClipInUseDialogProps, 'actionLabel' | 'intro' | 'consequence' | 'describe'>;
  vars: VersionMoveDialogVars | null;
}) {
  const intro = !vars
    ? undefined
    : vars.kind === 'section'
      ? `Moving "${vars.clipName}" to ${vars.destTrackName} › ${vars.destSectionName} will:`
      : `Moving "${vars.clipName}" out of ${vars.sourceTrackName} › ${vars.sourceSectionName} will:`;
  return (
    <ClipInUseDialog
      {...dialogProps}
      describe={(d) => describeLeaveDependents(d, vars?.sourceTrackName || null)}
      actionLabel="Move"
      intro={intro}
    />
  );
}
