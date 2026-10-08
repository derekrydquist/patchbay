import type React from 'react';
import { useRef, useState } from 'react';
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

interface UseNativeFileDropOptions {
  enabled?: boolean;
  /** Every file in the drop — use takeAudioFiles() to filter and toast. */
  onDrop: (files: File[]) => void;
}

export function useNativeFileDrop({ enabled = true, onDrop }: UseNativeFileDropOptions) {
  const depthRef = useRef(0);
  const [isOver, setIsOver] = useState(false);

  const reset = () => { depthRef.current = 0; setIsOver(false); };

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.stopPropagation();
      depthRef.current += 1;
      if (depthRef.current === 1) setIsOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.stopPropagation();
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!isNativeFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      if (!enabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) onDrop(files);
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
