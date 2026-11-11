// Where the Timeline's loose-file "Place … here?" confirm dialog sits, in viewport px.
// Pure, so it can be tested without a DOM.
//
// The dialog is horizontally centred in the window (its CSS does that). Vertically it
// is centred in the gap between the bottom of the app header and the top of the
// timeline (the Media Bucket area). When that gap is too short for it, it stays as
// close to that spot as it can while keeping clear of the frozen landing outline:
// first the gap's centre kept inside the window; if that covers the outline, just above
// the outline; if there's no room there, just below it; and if neither fits, as high as
// the window allows. Never over the outline whenever any position avoids it.

export interface Box { top: number; bottom: number; left: number; right: number }

export interface ConfirmDialogPlacementInput {
  dialogWidth: number;
  dialogHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gapTop: number;      // bottom of the app header
  gapBottom: number;   // top of the timeline
  outline: Box | null; // the frozen landing outline on screen (null = not known)
  margin?: number;     // kept clear around the window edges and the outline
}

// Returns the dialog's top edge.
export function confirmDialogTop(input: ConfirmDialogPlacementInput): number {
  const { dialogWidth: w, dialogHeight: h, viewportWidth, viewportHeight, gapTop, gapBottom, outline } = input;
  const margin = input.margin ?? 8;
  const minTop = margin;
  const maxTop = Math.max(minTop, viewportHeight - margin - h);
  const clamp = (t: number) => Math.min(maxTop, Math.max(minTop, t));

  const centred = clamp((gapTop + gapBottom) / 2 - h / 2);
  if (!outline) return centred;

  const left = (viewportWidth - w) / 2;
  const covers = (top: number) =>
    top < outline.bottom + margin && top + h > outline.top - margin
    && left < outline.right + margin && left + w > outline.left - margin;
  if (!covers(centred)) return centred;

  const above = outline.top - margin - h;
  if (above >= minTop) return above;
  const below = outline.bottom + margin;
  if (below + h <= viewportHeight - margin) return below;
  return minTop;
}
