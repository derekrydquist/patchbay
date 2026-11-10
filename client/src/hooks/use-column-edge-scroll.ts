import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useDndMonitor, type DragStartEvent } from '@dnd-kit/core';
import { createEdgeScroller, type EdgeScroller } from '@/lib/edge-scroller';
import { BUCKET_CLIP_DRAG_TYPE } from '@/hooks/use-loose-file-organize-dnd';

// Vertical edge scroll for the file browser columns (MediaBucket's Tracks / Sections /
// Files, the Library Songs browser's four columns) during an organize drag (a version
// or a loose file) on that surface; a timeline clip drag never scrolls them. dnd-kit's own auto-scroll can't do it: it only scrolls ancestors of the
// `over` node, and a column's drop target (Files column, Sections / Tracks
// backgrounds) is the column div that CONTAINS its scroll element. So every DndContext
// that renders these columns excludes them from dnd-kit's auto-scroll
// (isColumnScrollElement) and this hook scrolls them instead, with the timeline's
// createEdgeScroller rules on axis 'y'.

// Put on a column's scroll element: the overflow-y element, or the shadcn ScrollArea
// root (its Radix viewport, the real scroller, isn't reachable without editing the
// generated component — resolved by columnScrollViewport below).
export const COLUMN_SCROLL_ATTR = 'data-column-scroll';
export const columnScrollAttrs = { [COLUMN_SCROLL_ATTR]: '' } as const;

function columnScrollViewport(marked: HTMLElement): HTMLElement {
  return marked.querySelector<HTMLElement>(':scope > [data-radix-scroll-area-viewport]') ?? marked;
}

// True for a column's scroll element (marked directly, or the Radix viewport of a
// marked ScrollArea) — for dnd-kit's autoScroll.canScroll.
export function isColumnScrollElement(el: Element): boolean {
  return el.hasAttribute(COLUMN_SCROLL_ATTR)
    || (el.hasAttribute('data-radix-scroll-area-viewport') && !!el.parentElement?.hasAttribute(COLUMN_SCROLL_ATTR));
}

// autoScroll for a DndContext whose only scrollers to protect are the columns.
export const columnSafeAutoScroll = {
  canScroll: (el: Element) => !isColumnScrollElement(el),
};

// The timeline's 150 / 210 px zone is taller than many columns. A column's zone is
// 20% of its visible height, at least 32 px and at most 64 px; release is 1.4×
// engage (the timeline's 210 / 150 ratio).
const COLUMN_ZONE_FRACTION = 0.2;
const COLUMN_ZONE_MIN_PX = 32;
const COLUMN_ZONE_MAX_PX = 64;
const COLUMN_ZONE_RELEASE_RATIO = 1.4;
export function columnEdgeZone(el: HTMLElement): { engage: number; release: number } {
  const engage = Math.round(Math.min(COLUMN_ZONE_MAX_PX, Math.max(COLUMN_ZONE_MIN_PX, el.clientHeight * COLUMN_ZONE_FRACTION)));
  return { engage, release: Math.round(engage * COLUMN_ZONE_RELEASE_RATIO) };
}

// surfaceRef: the element holding the columns. A column is under the pointer when the
// pointer is within its scroll element's left / right and anywhere within the
// surface's top / bottom, so drifting up into a column header (past the zone's edge)
// keeps it engaged as a negative distance instead of stopping it. Moving to another
// column starts a fresh scroller (new origin for the distance gate); leaving every
// column, drop, cancel, window blur and unmount stop it. A column whose content fits
// does nothing.
export function useColumnEdgeScroll(surfaceRef: RefObject<HTMLElement | null>) {
  const activeRef = useRef<{ el: HTMLElement; scroller: EdgeScroller } | null>(null);
  const listenersCleanupRef = useRef<(() => void) | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const stopColumn = () => {
    activeRef.current?.scroller.stop();
    activeRef.current = null;
  };

  const handlers = useMemo(() => {
    const columnAt = (x: number, y: number): HTMLElement | null => {
      const surface = surfaceRef.current;
      if (!surface) return null;
      const surfaceRect = surface.getBoundingClientRect();
      if (y < surfaceRect.top || y > surfaceRect.bottom) return null;
      for (const marked of Array.from(surface.querySelectorAll<HTMLElement>(`[${COLUMN_SCROLL_ATTR}]`))) {
        const el = columnScrollViewport(marked);
        const rect = el.getBoundingClientRect();
        if (x < rect.left || x > rect.right) continue;
        return el.scrollHeight > el.clientHeight ? el : null;
      }
      return null;
    };
    // A column scroll moves rows under a still pointer; dnd-kit only re-runs collision
    // detection on its own events, so a synthetic move at the same coordinates keeps
    // `over` (and the highlights and spring-loading that read it) current — the
    // timeline does the same (nudgeDndCollision).
    const nudge = () => {
      const p = lastPointerRef.current;
      if (!p) return;
      document.dispatchEvent(new PointerEvent('pointermove', {
        clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse',
      }));
    };
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const el = columnAt(e.clientX, e.clientY);
      if (el !== activeRef.current?.el) {
        stopColumn();
        if (el) {
          // The 72 px default gate is bigger than a column's zone: a drag starting near
          // a column's bottom could never engage downward. Half the engage distance instead.
          const scroller = createEdgeScroller({
            getEl: () => el, axis: 'y', zone: columnEdgeZone, onScrolled: nudge,
            minDragDistance: Math.round(columnEdgeZone(el).engage / 2),
          });
          scroller.start(e.clientX, e.clientY);
          activeRef.current = { el, scroller };
        }
      }
      activeRef.current?.scroller.onPointerMove(e);
    };
    const stopAll = () => {
      listenersCleanupRef.current?.();
      listenersCleanupRef.current = null;
      stopColumn();
      lastPointerRef.current = null;
    };
    return {
      onDragStart: (event: DragStartEvent) => {
        stopAll();
        const type = event.active.data.current?.type;
        if (type !== 'loose-file' && type !== BUCKET_CLIP_DRAG_TYPE) return;
        // Blur stops the current column; the next move re-picks one with a fresh origin.
        const onBlur = () => stopColumn();
        window.addEventListener('pointermove', onMove, { capture: true });
        window.addEventListener('blur', onBlur);
        listenersCleanupRef.current = () => {
          window.removeEventListener('pointermove', onMove, { capture: true });
          window.removeEventListener('blur', onBlur);
        };
      },
      onDragEnd: stopAll,
      onDragCancel: stopAll,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useDndMonitor(handlers);
  useEffect(() => () => handlers.onDragCancel(), [handlers]);
}
