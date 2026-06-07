---
tracker:
  kind: linear
  team: SmartTalks
  project: Chief-of-Staff
  active_states: [Todo, In Progress]
  terminal_states: [Done, Canceled, Duplicate]
  handoff_state: In Progress   # Linear has no "In Review" state today; PR-open issues stay here until human merges
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

## Loop (per ticket)

1. **Pick up.** Read the Linear issue via the Linear MCP. Verify it is in `Todo`
   or `In Progress`. If it's blocked or already has an open PR, stop.
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
9. **Comment on Linear.** Post a comment on the issue with the PR URL and a
   one-line summary of what changed. Leave the issue in `In Progress` — it's
   now in the human's court.
10. **Stop.** Do not auto-merge. Do not transition to `Done`. The human reviews,
    merges, and Linear closes the issue on merge.

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
