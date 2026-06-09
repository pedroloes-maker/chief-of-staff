---
tracker:
  kind: linear
  team: SmartTalks
  project: Chief-of-Staff
  pickup_states: [Backlog, Todo, In Progress]   # /work can claim a ticket from any of these (In Progress = resuming own work)
  active_state: In Progress                     # set when implementation begins
  handoff_state: In Review                      # set when the PR is opened; means "human's court"
  terminal_states: [Done, Canceled, Duplicate]  # only the human merge moves the ticket to Done (via GitHub↔Linear integration)
agent:
  name: claude-code
  model: claude-opus-4-7
git:
  remote: origin
  default_branch: main
  branch_pattern: "SMA-{id}-{slug}"
  pr_title_pattern: "[SMA-{id}] {title}"
  commit_co_author: "Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
review:
  required: human
  merge_gate: github_pr_merge
---

# WORKFLOW — Chief-of-Staff agent loop (v0)

This file is the policy contract that any coding agent (Claude Code today)
follows when working a Linear ticket end-to-end.

**Source of truth:** Linear. **Artifact:** GitHub PR. **Approval:** human merge.

## State model

```
Backlog / Todo  ──/work──▶  In Progress  ──PR open──▶  In Review  ──human merge──▶  Done
```

- `/work` may pick up a ticket from `Backlog`, `Todo`, or `In Progress` (the
  last for resuming your own in-flight work).
- `In Review` is a hard stop for the agent — the ticket is in the human's
  court. The GitHub↔Linear integration moves it to `Done` on merge.

## Loop (per ticket)

1. **Pick up.** Read the Linear issue via the Linear MCP. Verify it is in
   `Backlog`, `Todo`, or `In Progress`. If it is in `In Review`, `Done`,
   `Canceled`, or `Duplicate`, or if it already has an open PR, stop.
2. **Move to In Progress** (if not already).
3. **Branch from `main`** using the `branch_pattern` above. Stash
   any unrelated uncommitted work first — branches must be clean.
4. **Implement** the smallest credible change that satisfies the issue's
   "Acceptance" section. No drive-by refactors or unrelated cleanup. No new
   dependencies that aren't necessary.
5. **Test.** Run whatever test suite is appropriate for the change. New code
   gets at least one test where it makes sense. Stop if tests fail and fix
   before moving on.
5b. **UI-verify (frontend tickets only).** If the change touches user-visible
    UI, boot the app and drive the golden path through the **Playwright MCP**
    (`mcp__playwright__*`): navigate to the affected screen, perform the user
    action, observe the result, take a screenshot. Stop and fix if behaviour
    diverges from the acceptance criteria. Skip this step for
    backend/infra/docs-only tickets — note in the Linear comment which path
    you took ("UI-verified" or "no UI surface").
6. **Commit** with a conventional message ending in the configured
   `commit_co_author`. Prefer one or two atomic commits over a single megablob.
7. **Push** the branch to `origin`.
8. **Open the PR** via `gh pr create` with the `pr_title_pattern` title and a
   body that links the Linear issue. Body must include `Closes SMA-{id}`
   so Linear's GitHub integration auto-closes the issue on merge.
9. **Transition to In Review.** Move the Linear issue to `In Review` —
   signalling the PR is open and the ticket is now in the human's court.
10. **Comment on Linear.** Post a comment on the issue with the PR URL and a
    one-line summary of what changed. The issue stays in `In Review` from
    here on.
11. **Stop.** Do not auto-merge. Do not transition to `Done`. The human
    reviews, merges, and the GitHub↔Linear integration closes the issue.

## Hard rules

- **Never** force-push to `main` or to any merged branch.
- **Never** skip git hooks (`--no-verify`).
- **Never** commit secrets, `.env`, virtualenvs, or anything matched by
  `.gitignore`.
- **Never** merge your own PR. Human approval is the only path to `main`.
- **Never** expand scope. If a ticket turns out to need broader work, comment
  on the Linear issue and stop — don't silently grow the PR.
- **One ticket = one branch = one PR.** No mixing.

## Branch and PR conventions

- Branch: `SMA-{id}-{kebab-slug}` (e.g. `SMA-12-onboarding-form`).
- PR title: `[SMA-{id}] {issue title}`.
- PR body must include `Closes SMA-{id}` (Linear's GitHub integration
  uses this to auto-close the issue on merge).

## Per-issue prompt template

When a coding-agent session is launched on a ticket, this is the canonical brief:

> You are working ticket **SMA-{id}** from Linear: _{issue title}_.
>
> 1. Read the issue description and the comments via the Linear MCP. The
>    "Acceptance" section defines done.
> 2. Follow `WORKFLOW.md` end-to-end. Source of truth is Linear; the artifact
>    is a GitHub PR.
> 3. Implement the smallest credible change that satisfies acceptance. No
>    scope creep.
> 4. Test. Push. Open the PR. Comment the PR URL on the Linear issue. Stop.
