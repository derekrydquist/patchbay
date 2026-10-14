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

// The decided rule for the task of a section brought back for a track (per-track
// restore, song-wide section restore, track restore). Hiding deleted the section's
// timeline copies, so the "timeline rule" applies: Complete needs a placement.
//   - will-not-play and todo: always left alone.
//   - complete with no timeline clips for the track + section: In Progress if the
//     section still has active versions, else To Do.
//   - in-progress with no active versions: To Do.
//   - anything else: unchanged.
// Never touches clips.isFinal — a Final version keeps its badge.
export function taskStatusAfterRestore(
  status: TaskStatus,
  hasTimelineClips: boolean,
  hasActiveVersions: boolean,
): TaskStatus {
  if (status === "will-not-play" || status === "todo") return status;
  if (status === "complete" && !hasTimelineClips) return hasActiveVersions ? "in-progress" : "todo";
  if (status === "in-progress" && !hasActiveVersions) return "todo";
  return status;
}

// A placed copy or Final makes the leave a confirmed action. A task status change
// alone doesn't — placing a file moves its task silently, so taking one out does too.
// The task change is still applied on every leave, and listed in the dialog when the
// dialog appears for one of the other two reasons.
export function hasClipDependents(d: ClipDependents): boolean {
  return d.timelineCopies.length > 0 || d.isFinal;
}
