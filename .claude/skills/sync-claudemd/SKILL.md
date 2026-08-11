---
name: sync-claudemd
description: Re-syncs PatchBay's split CLAUDE.md files after the user pastes/replaces the root CLAUDE.md with an updated master copy. Diffs the new root content against client/src/components/daw/CLAUDE.md, server/CLAUDE.md, and the six .claude/skills/*/SKILL.md files, routes new or changed subsystem-specific content to the correct split file, and keeps the "Deep-Dive Architecture Notes" index in root accurate. Use whenever the user says they've updated, replaced, or re-added CLAUDE.md, or asks to sync/resync the docs.
---

# Sync CLAUDE.md after a master-copy replace

PatchBay's project docs are split across multiple files (done 2026-08-11 to keep the always-loaded
root file small):

- `CLAUDE.md` (root) — universal context + the "Deep-Dive Architecture Notes" index table
- `client/src/components/daw/CLAUDE.md` — Timeline/Clip/Track/MediaBucket/ProductionTracker/Transport internals
- `server/CLAUDE.md` — Bands multi-tenancy implementation detail
- `.claude/skills/isfinal-sync/SKILL.md` — isFinal ↔ task-status sync rules
- `.claude/skills/review-tab/SKILL.md` — Review tab architecture
- `.claude/skills/activity-feed/SKILL.md` — Activity feed + Promote to Song
- `.claude/skills/api-reference/SKILL.md` — full API endpoint reference
- `.claude/skills/feature-status/SKILL.md` — feature-by-feature build status
- `.claude/skills/deploy/SKILL.md` — Railway deployment steps

The user maintains a master copy of the docs elsewhere and periodically replaces root `CLAUDE.md`
wholesale. When that happens, the new root file may contain content that actually belongs in one
of the split files instead (a new Timeline gotcha, an updated API route, a changed Bands rule,
a revised feature's status, etc.). Left in root, it either duplicates or silently contradicts the
split file, and re-bloats the file that's loaded into every session regardless of task.

## Steps

1. **See what changed.** Run `git diff HEAD -- CLAUDE.md` if the previous version was committed;
   otherwise compare the new root content against `git show HEAD:CLAUDE.md`, or against what the
   split files currently say if root has no useful git baseline. Read the full current content of
   every split file listed above before deciding anything.

2. **Classify each new or changed chunk** in the new root content:
   - **Matches an existing split-file topic** (per the "Deep-Dive Architecture Notes" table in
     root) → this content belongs in that file, not root.
   - **Describes a genuinely new subsystem/topic** not covered by any existing split file → ask
     the user whether it should become a new skill / nested `CLAUDE.md`, or just stay in root.
     Don't decide this unilaterally — it changes what loads automatically and when.
   - **Universal, safety-critical, or short** (the kind of content that survived the original
     doctor trim — see "What To Avoid" in root for the bar) → stays in root as-is.

3. **Apply.**
   - For matched content: merge it into the relevant section of the destination split file.
     Preserve that file's existing structure — update/replace the specific subsection, don't
     overwrite unrelated content.
   - Remove the routed content from root. If it's covered by an existing "Deep-Dive Architecture
     Notes" row, no new pointer text is needed. If it's a new topic that got a new destination
     file, add a row to that table.
   - If a chunk conflicts with what a split file currently says (not just adds to it), the new
     master copy wins — but flag the conflict to the user in your summary so they know something
     was overwritten, not just appended.

4. **Verify.** Confirm root no longer contains the routed content (leaving it in both places
   defeats the point), and that the split files don't now contradict each other or the "What To
   Avoid" list in root.

5. **Report.** Summarize what moved where — file + short description, same style as the original
   doctor split — so the user can review before committing. Don't commit anything yourself unless
   asked.

## Notes

- Don't ask for confirmation before applying the routing — the user has already approved this
  pattern (2026-08-11: "keep the split, I re-sync it"). Do ask if a chunk's destination is
  genuinely ambiguous (new topic, or content that could plausibly belong in two places).
- If the user's new root `CLAUDE.md` is dramatically different in structure (not just an
  incremental update — e.g. a full rewrite), say so before proceeding rather than guessing at a
  chunk-by-chunk diff; a full re-split (same process as the original doctor run) may be more
  appropriate than an incremental sync.
