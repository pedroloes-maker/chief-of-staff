---
name: work
description: Drive the WORKFLOW.md loop end-to-end on one Linear ticket. Usage `/work SMA-N`. Pulls the ticket via Linear MCP, branches, implements, tests, opens a PR, runs a code review pass, comments back on Linear, and stops for human review.
argument-hint: SMA-N
---

# /work — Drive the WORKFLOW.md loop on a Linear ticket

The user just invoked `/work {{args}}`. Treat `{{args}}` as the Linear ticket id
(e.g. `SMA-7`). If the user did not pass a valid `SMA-<digits>`
argument, stop and ask them to retry with one.

## What to do, in order

You are working ticket **{{args}}** from Linear: an issue in the `SmartTalks`
team, `Chief-of-Staff` project. Follow `WORKFLOW.md` at the repo root end-to-end.
The **source of truth is Linear**; the **artifact is a GitHub PR**; the
**only approval is a human merge**.

1. **Read the ticket.** Use the Linear MCP to fetch the issue
   (`mcp__claude_ai_Linear__get_issue` with `id: "{{args}}"`) plus its comments
   (`list_comments`). The **"Acceptance"** section in the description defines
   "done". If acceptance is unclear, stop and ask before writing code.

2. **State transition.** If the issue is not already `In Progress`, move it
   there via `save_issue` (`state: "In Progress"`).

3. **Clean branch.** Confirm the working tree is clean — `git status --short`
   must be empty. If not, stash unrelated work with a descriptive name
   (`git stash push -m "<purpose>"`) before continuing. Then:

   ```
   git checkout main
   git pull origin main
   git checkout -b {{args}}-<kebab-slug-from-issue-title>
   ```

4. **Implement.** The smallest credible change that satisfies acceptance.
   No drive-by refactors. No new dependencies that are not strictly necessary.
   Comments only when the *why* is non-obvious.

5. **Test.** Run the relevant test suite for the change. New code gets at least
   one test where it makes sense. Stop and fix if anything is red.

6. **Commit.** One or two atomic commits, conventional message style. Trailer:
   ```
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

7. **Push:** `git push -u origin <branch>`.

8. **Open the PR** with `gh pr create`:
   - Title: `[{{args}}] <issue title>`.
   - Body must include `Closes {{args}}` so the Linear↔GitHub integration
     auto-closes the issue on merge.
   - Body should have a one-paragraph **Summary** and a **Test plan** with
     checkboxes for the reviewer.

9. **Code review pass.** Before notifying anyone, do one careful self-review
   of the diff you just pushed:

   - `gh pr diff <pr-number>` (or `git diff main...HEAD`).
   - Walk the diff with a reviewer's eye: correctness, error handling at real
     boundaries, security (input validation, secret leakage, command
     injection), test coverage of the acceptance criteria, dead code, and
     unintended changes to unrelated files.
   - If you find a blocking issue: fix it, run tests, commit (NEW commit —
     never `--amend`), push, and re-run this step on the updated diff. Do
     not move to step 10 until the diff is clean.
   - If you find a non-blocking concern (nit, follow-up idea, deferred test):
     note it for inclusion in the Linear comment so the human reviewer sees it.

   Record one line of review verdict for the next step, e.g.
   `review: clean — no blocking issues; one follow-up noted`.

10. **Comment on Linear.** `save_comment` with `issueId: "{{args}}"` and a
    body containing:
    - The PR URL.
    - Branch name and head commit hash.
    - A short summary of what changed.
    - The local test result (e.g. "12/12 passing").
    - The review verdict line from step 9.

11. **STOP.** Leave the issue in `In Progress`. Do not merge the PR. Do not
    transition the issue to `Done`. The human reviewer is now in control; the
    GitHub-Linear integration will move the issue to `Done` on merge.

## Hard rules (do not break)

- Never force-push. Never `--no-verify`. Never `git commit --amend` on a
  failed-hook commit — make a NEW commit.
- Never commit `.env`, `.venv/`, or anything in `.gitignore`.
- Never merge your own PR.
- One ticket = one branch = one PR. If you discover the ticket needs broader
  scope than its description, comment on the Linear issue explaining what you
  found, push what you have so far if there's anything coherent to push, and
  stop. Don't silently grow the PR.

## Tools you'll need

- Linear MCP: `mcp__claude_ai_Linear__get_issue`, `list_comments`,
  `save_comment`, `save_issue`.
- Bash for `git`, `gh`. (`.claude/settings.json` pre-allows the safe
  invocations.)
- Read / Write / Edit for code changes.

## When in doubt

Read `WORKFLOW.md` (the contract) and `CLAUDE.md` (the operating manual).
