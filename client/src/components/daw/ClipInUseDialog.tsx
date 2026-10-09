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

interface UseClipInUseActionOptions<T> {
  // The leave request. Called with confirm=false first, then confirm=true from the dialog.
  request: (confirm: boolean) => Promise<T>;
  onSuccess?: (result: T) => void;
  // Any failure other than clip-in-use.
  onError?: (message: string) => void;
}

export function useClipInUseAction<T>({ request, onSuccess, onError }: UseClipInUseActionOptions<T>) {
  const [dependents, setDependents] = useState<ClipDependents | null>(null);
  const [isPending, setIsPending] = useState(false);

  const send = async (confirm: boolean) => {
    setIsPending(true);
    try {
      const result = await request(confirm);
      setDependents(null);
      onSuccess?.(result);
    } catch (err) {
      if (err instanceof ClipInUseError && !confirm) {
        setDependents(err.dependents);
      } else {
        setDependents(null);
        onError?.(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsPending(false);
    }
  };

  return {
    run: () => { void send(false); },
    isPending,
    dialogProps: {
      open: dependents !== null,
      dependents,
      pending: isPending,
      onConfirm: () => { void send(true); },
      onCancel: () => setDependents(null),
    },
  };
}

const STATUS_WORDS: Record<TaskStatus, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'complete': 'Complete',
  'will-not-play': 'Will Not Play',
};

// Plain-words list of what falls off: placements grouped by track > section,
// Final, and any task status that changes.
export function describeClipDependents(d: ClipDependents): string[] {
  const lines: string[] = [];
  const placements = new Map<string, number>();
  for (const c of d.timelineCopies) {
    const where = `${c.trackName} > ${c.sectionName ?? 'Full Take'}`;
    placements.set(where, (placements.get(where) ?? 0) + 1);
  }
  placements.forEach((n, where) => {
    lines.push(`On the timeline in ${where} (${n} ${n === 1 ? 'placement' : 'placements'})`);
  });
  if (d.isFinal) lines.push('Marked Final');
  for (const t of d.tasks) {
    if (t.willChangeTo !== t.status) {
      lines.push(`The ${t.sectionName} task will go back to ${STATUS_WORDS[t.willChangeTo]}`);
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
  // One line on what happens to placements, e.g. "Removing it takes it off the timeline and clears Final."
  consequence: string;
}

export function ClipInUseDialog({ open, dependents, pending, onConfirm, onCancel, actionLabel, consequence }: ClipInUseDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const lines = dependents ? describeClipDependents(dependents) : [];
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
              <ul className="list-disc pl-5 space-y-1 text-white/80">
                {lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p>{consequence} The audio file, notes and metadata are kept.</p>
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
