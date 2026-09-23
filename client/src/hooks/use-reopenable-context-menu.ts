import { useState } from "react";

/**
 * Right-clicking a card's trigger again while its own ContextMenu is already
 * open should reposition the menu at the new point, like a native context
 * menu. Two Radix behaviors combine to break this:
 *
 * 1. Radix's ContextMenu defaults to `modal: true`, which sets
 *    `document.body.style.pointerEvents = 'none'` while open, disabled only
 *    on the currently-open menu's own DOM node. The trigger itself isn't
 *    exempted, so a second `contextmenu` event on it never fires at all.
 *    Fix: pass `modal={false}` alongside this hook.
 * 2. Even with modal off, a rapid close-then-reopen (both happen within the
 *    same native event dispatch: the pointerdown-outside dismiss followed
 *    immediately by the new contextmenu open) never produces a real DOM
 *    unmount — shadcn's exit-animation `Presence` wrapper keeps the same
 *    `PopperContent` instance alive across the whole animate-out grace
 *    period, so its `useFloating()` position (tied to a virtual anchor
 *    whose object identity never changes across opens) is simply never
 *    recomputed for the new click coordinates.
 *
 * Bumping a `key` on `ContextMenuContent` forces React to treat it as a
 * different element and unmount/remount it outright, bypassing Presence's
 * animation grace and forcing a fresh `useFloating()` call that reads the
 * current (already-updated) anchor position.
 */
export function useReopenableContextMenu() {
  const [nonce, setNonce] = useState(0);

  const onContextMenuCapture = () => setNonce((n) => n + 1);

  return { nonce, onContextMenuCapture };
}
