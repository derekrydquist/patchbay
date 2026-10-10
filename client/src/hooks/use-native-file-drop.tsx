import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/hooks/use-toast';

// ─── Native (Finder) file drops ───────────────────────────────────────────────
// One drop-target behavior for every container that accepts an OS file drag: a
// drop carries its own destination, so each target owns its drop outright.
//
// - Reacts ONLY to native file drags (dataTransfer.types contains 'Files'). In-app
//   dnd-kit drags are pointer-event driven and never fire native drag events; a
//   native drag of something else on the page (a link, an image, selected text)
//   passes straight through untouched.
// - Stops propagation, so a target nested inside another (a Track row inside the
//   Tracks column) is the only one that sees the drag while the pointer is on it.
//   The outer target's counter drops to 0 on the matching dragleave, so its
//   highlight turns off while a nested target is hovered.
// - Highlight uses a dragenter/dragleave depth counter, not relatedTarget: moving
//   onto a child icon or label fires dragenter(child) before dragleave(parent), so
//   the count never touches 0 inside the target. (relatedTarget is often null on
//   dragleave in Safari, which made the old containment check flicker.)
// - enabled = false still calls preventDefault on dragover/drop, so the browser
//   never opens the dropped file, but shows no highlight and does nothing.

export function isNativeFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

// ─── Hold timer ───────────────────────────────────────────────────────────────
// One pending "fire after N ms" callback; arming again replaces it. Shared by both
// spring-loaded Track mechanisms — the dnd-kit one (useSpringLoadedTracks) and the
// native one (useNativeFileDrop's `hold` option, driven by
// useNativeSpringLoadedTracks) — so the two springs time out identically.
export interface HoldTimer {
  arm: (fire: () => void, ms: number) => void;
  cancel: () => void;
}

export function createHoldTimer(): HoldTimer {
  let id: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (id !== null) { clearTimeout(id); id = null; }
  };
  return {
    arm: (fire, ms) => {
      cancel();
      id = setTimeout(() => { id = null; fire(); }, ms);
    },
    cancel,
  };
}

// ─── Window-level native file drag tracker ────────────────────────────────────
// Knows when an OS file drag is over the page and, crucially, when it ENDS. For a
// Finder drag the source is outside the page, so the page never sees dragend; a
// target's own dragleave/drop only covers that target. One module-level tracker,
// listening on window in the CAPTURE phase (so the targets' stopPropagation can't
// hide events from it), installed while anything subscribes (onNativeFileDrag).
//
// End detection:
// 1. drop — the drag ended on a target that accepted it (dragover was cancelled).
//    `dropped` is true only if an ENABLED useNativeFileDrop received files
//    (markNativeDropAccepted); a disabled target's catch-and-discard counts as no
//    drop. Read on the next task, after the target's React handler has run (window
//    capture runs before React's root listener, and a microtask would run between
//    the two).
// 2. Page-wide dragenter/dragleave depth reaching 0. Moving between elements fires
//    dragenter(new) before dragleave(old), so the count never touches 0 mid-page.
//    It reaches 0 when the pointer leaves the window, and — where the browser
//    follows the HTML drag-and-drop processing model — when the drag is cancelled
//    or released over something that isn't a drop target (a final dragleave at
//    the current element with no matching dragenter).
// 3. A pointermove that actually moves (movementX or movementY non-zero). Chromium
//    fires NO event at all when a drag is cancelled (Escape) — confirmed through
//    its own drag pipeline (CDP Input.dispatchDragEvent) — so the restore lands on
//    the next real mouse movement. Zero-movement pointermoves are ignored: a real
//    Chrome Finder drag delivers one (buttons=1, movement 0,0, isTrusted) ~300ms
//    after a spring re-renders the Sections column under the cursor, while
//    dragover is still firing — counting it ended a live drag.
//
// Self-healing: dragover only ever fires while a drag is in flight, so every Files
// dragover re-arms the tracker (active, depth at least 1). A false end can never
// leave the tracker dead while the drag goes on; the drag simply resumes. Listeners
// hear onBegin({ fresh }) on every inactive → active transition: fresh = a drag
// entering the page from outside (dragenter with a null relatedTarget), otherwise a
// resume after a false end — so a listener can keep per-drag state (the spring's
// start selection) across a false end and reset it only for a genuinely new drag.
// Safari often reports a null relatedTarget mid-page too; there a resume can look
// fresh, which only costs the kept state.
//
// No timeout anywhere: dragover's repeat rate while the pointer rests varies by
// browser, and a false timeout mid-drag would close a sprung Track under the user.

export interface NativeFileDragEnd { dropped: boolean; }
export interface NativeFileDragBegin { fresh: boolean; }
export interface NativeFileDragListener {
  onBegin?: (begin: NativeFileDragBegin) => void;
  onEnd?: (end: NativeFileDragEnd) => void;
}

const dragListeners = new Set<NativeFileDragListener>();
let pageDepth = 0;
let dragActive = false;
let dropAccepted = false;
// Between a drop and its deferred read: ignore everything else, so a trailing
// dragleave can't end the drag as "no drop" first.
let dropPending = false;

function isFilesEvent(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

function beginNativeFileDrag(fresh: boolean) {
  dragActive = true;
  Array.from(dragListeners).forEach(l => l.onBegin?.({ fresh }));
}

function endNativeFileDrag(dropped: boolean) {
  pageDepth = 0;
  dropAccepted = false;
  dropPending = false;
  if (!dragActive) return;
  dragActive = false;
  Array.from(dragListeners).forEach(l => l.onEnd?.({ dropped }));
}

const onWindowDragEnter = (e: DragEvent) => {
  if (!isFilesEvent(e)) return;
  pageDepth += 1;
  if (!dragActive) {
    const fresh = e.relatedTarget === null;
    // Resumed by an element transition inside the page: the element being left
    // still counts until its dragleave, which follows immediately.
    if (!fresh) pageDepth += 1;
    beginNativeFileDrag(fresh);
  }
};
const onWindowDragOver = (e: DragEvent) => {
  if (!isFilesEvent(e) || dropPending) return;
  // A drag is in flight: re-arm (see "Self-healing" above).
  if (pageDepth < 1) pageDepth = 1;
  if (!dragActive) beginNativeFileDrag(false);
};
const onWindowDragLeave = (e: DragEvent) => {
  if (!isFilesEvent(e) || dropPending) return;
  pageDepth = Math.max(0, pageDepth - 1);
  if (pageDepth === 0) endNativeFileDrag(false);
};
const onWindowDrop = (e: DragEvent) => {
  if (!isFilesEvent(e)) return;
  pageDepth = 0;
  dropPending = true;
  setTimeout(() => endNativeFileDrag(dropAccepted), 0);
};
const onWindowPointerMove = (e: PointerEvent) => {
  if (!dragActive || dropPending) return;
  if (e.movementX !== 0 || e.movementY !== 0) endNativeFileDrag(false);
};

/** Subscribe to native file drag begin/end. Returns the unsubscribe function. */
export function onNativeFileDrag(listener: NativeFileDragListener): () => void {
  if (dragListeners.size === 0) {
    window.addEventListener('dragenter', onWindowDragEnter, true);
    window.addEventListener('dragover', onWindowDragOver, true);
    window.addEventListener('dragleave', onWindowDragLeave, true);
    window.addEventListener('drop', onWindowDrop, true);
    window.addEventListener('pointermove', onWindowPointerMove, true);
  }
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
    if (dragListeners.size === 0) {
      window.removeEventListener('dragenter', onWindowDragEnter, true);
      window.removeEventListener('dragover', onWindowDragOver, true);
      window.removeEventListener('dragleave', onWindowDragLeave, true);
      window.removeEventListener('drop', onWindowDrop, true);
      window.removeEventListener('pointermove', onWindowPointerMove, true);
      pageDepth = 0;
      dragActive = false;
      dropAccepted = false;
      dropPending = false;
    }
  };
}

/** Subscribe to native file drag ends only. Returns the unsubscribe function. */
export function onNativeFileDragEnd(listener: (end: NativeFileDragEnd) => void): () => void {
  return onNativeFileDrag({ onEnd: listener });
}

// ─── Window-level guard: never open a dropped file ────────────────────────────
// Releasing a Finder file anywhere that isn't a drop target used to make the
// browser navigate to the file (a new tab playing the audio) — the drop's default
// action. Mounted once for the whole app (useWindowFileDropGuard in App.tsx), so it
// covers every page, the login page included.
//
// Listens on window in the BUBBLE phase, so it only ever sees what no target took:
// - useNativeFileDrop targets call stopPropagation on dragover and drop, so their
//   events never reach window — they keep their own preventDefault, 'copy' cursor
//   and drop handling, untouched.
// - A drop zone that calls preventDefault without stopping propagation (UploadModal's
//   "Click or drag files here" box) does reach window; e.defaultPrevented marks it
//   as handled and the guard leaves it alone.
// - Anything inside an <input type="file"> is left to the browser, which handles a
//   file drop onto one itself.
// - Only native file drags ('Files' in dataTransfer.types). dnd-kit drags are
//   pointer events and never fire drag events; a dragged link or text selection
//   isn't a file and passes through.
// What remains is a non-target: dragover is cancelled with dropEffect 'none' — the
// cursor shows the no-drop state and the browser treats a release there as a
// cancelled drag (no drop event, nothing opens) — and a drop that arrives anyway
// is cancelled too. Nothing visible happens. The page-wide tracker above still sees
// both events (it listens in the capture phase) and ends the drag as "no drop".
function isInsideFileInput(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest('input[type="file"]');
}
function isUnhandledFileDragEvent(e: DragEvent): boolean {
  return isFilesEvent(e) && !e.defaultPrevented && !isInsideFileInput(e.target);
}
const onGuardDragOver = (e: DragEvent) => {
  if (!isUnhandledFileDragEvent(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
};
const onGuardDrop = (e: DragEvent) => {
  if (!isUnhandledFileDragEvent(e)) return;
  e.preventDefault();
};

export function useWindowFileDropGuard(): void {
  useEffect(() => {
    window.addEventListener('dragover', onGuardDragOver);
    window.addEventListener('drop', onGuardDrop);
    return () => {
      window.removeEventListener('dragover', onGuardDragOver);
      window.removeEventListener('drop', onGuardDrop);
    };
  }, []);
}

function markNativeDropAccepted() {
  dropAccepted = true;
}

/** Fire onHold once the drag has rested on the target for `ms` (see `hold` below). */
export interface NativeFileHold {
  ms: number;
  onHold: () => void;
}

interface UseNativeFileDropOptions {
  enabled?: boolean;
  /** Every file in the drop — use takeAudioFiles() to filter and toast. */
  onDrop: (files: File[]) => void;
  /** Hover-to-act timer: armed when the drag enters the target, cancelled when it
   *  leaves, drops, or the drag ends anywhere. Read at enter time — pass undefined
   *  to not arm. Fires at most once per visit. No visual change of its own.
   *  Once `ms` has elapsed the hold is only DUE; it fires on the next dragover on
   *  this target. Browsers keep sending dragover while the pointer rests and send
   *  nothing after a cancel (Chromium fires no event at all on Escape), so a drag
   *  that was cancelled mid-wait can never fire it. */
  hold?: NativeFileHold;
}

export function useNativeFileDrop({ enabled = true, onDrop, hold }: UseNativeFileDropOptions) {
  const depthRef = useRef(0);
  const [isOver, setIsOver] = useState(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const holdTimerRef = useRef<HoldTimer | null>(null);
  if (!holdTimerRef.current) holdTimerRef.current = createHoldTimer();
  const holdTimer = holdTimerRef.current;
  const holdDueRef = useRef(false);
  const cancelHold = () => { holdTimer.cancel(); holdDueRef.current = false; };

  const reset = () => { depthRef.current = 0; setIsOver(false); cancelHold(); };

  // A drag that ends anywhere clears this target too — covers a dragleave the
  // browser never delivered (otherwise the highlight would stick and a pending
  // hold could fire after the drag is gone).
  useEffect(() => onNativeFileDragEnd(() => {
    depthRef.current = 0; setIsOver(false); holdTimer.cancel(); holdDueRef.current = false;
  }), [holdTimer]);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.stopPropagation();
      depthRef.current += 1;
      if (depthRef.current === 1) {
        setIsOver(true);
        const h = holdRef.current;
        holdDueRef.current = false;
        if (h) holdTimer.arm(() => { holdDueRef.current = true; }, h.ms);
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // Explicit, on every dragover of every target (enabled or not): left unset,
      // the browser derives the effect itself, and the cursor's copy (+) badge
      // dropped out after a spring re-rendered the Sections column.
      e.dataTransfer.dropEffect = 'copy';
      if (holdDueRef.current && depthRef.current > 0) {
        holdDueRef.current = false;
        holdRef.current?.onHold();
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) { setIsOver(false); cancelHold(); }
    },
    onDrop: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      if (!enabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) { markNativeDropAccepted(); onDrop(files); }
    },
  };

  return { isOver: isOver && enabled, handlers };
}

/** Audio files from a drop, or [] after showing the unsupported-file-type toast. */
export function takeAudioFiles(files: File[]): File[] {
  const audio = files.filter(f => f.type.startsWith('audio/'));
  if (!audio.length) {
    toast({
      title: 'Unsupported file type',
      description: 'Only audio files can be uploaded here.',
      variant: 'destructive',
    });
  }
  return audio;
}

// Shared highlight styling. Feedback must never change layout: nothing is inserted
// and no border width or padding changes, so the row under the pointer never moves
// (an in-flow "Drop to upload" banner used to push every row down ~39px, which made
// the top row unreachable and churned enter/leave as rows jumped under the pointer).
// - Row: every target row already carries `border border-transparent`, so this only
//   recolors the existing 1px border and background — fixed size.
// - Column blank space: background tint + inset ring (box-shadow, no layout).
export const NATIVE_DROP_ROW_CLASS = 'bg-primary/10 border-primary/50';
export const NATIVE_DROP_COLUMN_CLASS = 'bg-primary/5 ring-1 ring-inset ring-primary/40';

export type NativeFileDropHandlers = ReturnType<typeof useNativeFileDrop>['handlers'];
