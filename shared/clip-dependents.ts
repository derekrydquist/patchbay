// What depends on a real-song version (a `clips` row) that is about to leave its
// section — by Remove today, by a move later. Returned by storage.getClipDependents
// and as the `dependents` field of a 409 { code: 'clip-in-use' } response, which the
// client shows in ClipInUseDialog before repeating the request with confirm: true.
// A response type only — not a table.

export type TaskStatus = "todo" | "in-progress" | "complete" | "will-not-play";

export interface ClipDependents {
  // Placed timeline copies of this version (timeline_clips.bucketClipId = the clip).
  timelineCopies: Array<{ id: string; trackName: string; sectionName: string | null; start: number }>;
  isFinal: boolean;
  // The production task of the section the version leaves, with the status it will
  // move to. willChangeTo equals status when the task is unaffected.
  tasks: Array<{ taskId: string; sectionName: string; status: TaskStatus; willChangeTo: TaskStatus }>;
}

export const CLIP_IN_USE_CODE = "clip-in-use";

// The decided rule for the task of a section a version leaves. "Versions left" counts
// the section's other active clips, not timeline copies.
//   - will-not-play: always left alone.
//   - no active versions left: To Do.
//   - versions left and the task was Complete: In Progress only if the leaving file
//     was Final and no remaining active version is Final (the section lost its only
//     Final). A non-final spare leaving, or a Final leaving while another Final
//     remains, leaves it Complete.
//   - versions left and the task was In Progress or To Do: unchanged.
// leavingWasFinal must be read before releaseClipDependencies clears it.
export function taskStatusAfterVersionLeaves(
  status: TaskStatus,
  activeVersionsLeft: number,
  leavingWasFinal: boolean,
  anyRemainingFinal: boolean,
): TaskStatus {
  if (status === "will-not-play") return status;
  if (activeVersionsLeft === 0) return "todo";
  if (status === "complete" && leavingWasFinal && !anyRemainingFinal) return "in-progress";
  return status;
}

// A placed copy or Final makes the leave a confirmed action. A task status change
// alone doesn't — placing a file moves its task silently, so taking one out does too.
// The task change is still applied on every leave, and listed in the dialog when the
// dialog appears for one of the other two reasons.
export function hasClipDependents(d: ClipDependents): boolean {
  return d.timelineCopies.length > 0 || d.isFinal;
}
