---
name: handoff
description: Verify the current PR's acceptance criteria against the running app
  before handing off to a human reviewer. Frontend tickets get Playwright MCP;
  backend tickets get curl + typecheck + build. Auto-commits fixes (max 2
  attempts per failing item, then asks). Skips OAuth-gated paths. Leaves the
  dev server running.
argument-hint: (no args — operates on the current branch's PR)
---

# /handoff — verify before human review

The user just invoked `/handoff` after `/work` opened a PR. Run automated
verification against the ticket's acceptance criteria, fix what can be fixed
within scope, and hand off a clean test plan to the human reviewer.

See [[sma-handoff-skill-rules]] (memory) for the operating rules confirmed
by Pedro. The summary: max 2 fix attempts per item, skip OAuth-gated, leave
dev server running, Playwright only for frontend tickets.

## What to do, in order

### 1. Discover context

- `git rev-parse --abbrev-ref HEAD` → current branch
- `gh pr view --json number,body,headRefName` → PR number + body
- Parse `Closes SMA-N` from PR body → ticket ID. **If no PR is open or no
  `Closes` reference, stop and ask the user which ticket to verify.**
- `git pull` to sync any manual push.

### 2. Fetch ticket acceptance

- Linear MCP `get_issue(id="SMA-N")` → description
- Extract `## Acceptance` checkboxes and `## Fora de escopo` (or `## Out of
  scope`). The latter tells you what NOT to test or fix.

### 3. Classify ticket kind

```
git diff main...HEAD --name-only
```

If any path matches `sma/app/`, `cma/client/`, or `*/app/*` / `*/client/*`
patterns → **frontend ticket** (run Playwright MCP).
Otherwise → **backend ticket** (skip Playwright; use curl + typecheck +
build only).

### 4. Classify each acceptance item

For each `- [ ] <text>` in the acceptance section:

| Pattern in the item                                                                   | Tester                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/health`, `curl`, `responds with`, `returns`, `HTTP <code>`, `/api/...`              | curl + jq match                                         |
| `build sem erros`, `build`, `typecheck`, `tsc`, `vite build`                          | `bun run build` / `bun run typecheck`                   |
| `migrations`, `db:migrate`, `db:generate`, `aplica`                                   | `bun run db:migrate` exit 0                             |
| `página X renderiza`, `tema`, `PT-BR`, `componente`, `card`, `layout`                 | Playwright (frontend tickets only)                      |
| `login`, `app shell pós-login`, `logout`, `UserButton`, anything OAuth-gated          | **SKIP — mark "requires human verification (login Google)"** |
| `design`, `designer`, subjective visual, `bonito`                                     | skip — mark "manual visual review"                      |

### 5. Boot the app

For SMA: `cd sma && bun run dev` in background (`Bash` with
`run_in_background: true`). Wait until `curl http://localhost:${PORT:-3000}/health`
returns ok (poll up to 30s).

If the port is taken, identify what's there with `lsof -i :PORT` before
killing. If it's an old instance of our own server, kill it. Otherwise
ask the user.

### 6. Run automated tests

For each acceptance item classified as automatable:
- Run the test (curl, Playwright navigate+snapshot, build, etc.)
- Mark ✅ pass or ❌ fail with a one-line reason
- For UI items: capture screenshot to `sma-<ticket>-<step>.png` (gitignored).

### 7. Auto-fix loop (max 2 attempts per failing item)

For each ❌:
1. Read logs / diff / Playwright snapshot to identify root cause.
2. Apply a fix **within the ticket's scope** (respect `## Fora de escopo`).
3. Re-run the failing test.
4. If pass → continue. If fail → attempt 2.
5. If 2 attempts fail → **STOP** and tell the user:
   > "Tentei 2 vezes consertar `<item>`. Falha persistente: `<last error>`.
   > Pode validar?"

**Never as a "fix":**
- Add Clerk dev-mode tokens, auth bypasses, or session shims in production
  code. OAuth-gated tests are out of scope for `/handoff`.
- Modify code paths outside the ticket's `## Acceptance` scope.
- Disable or comment out failing checks to make them green.
- Use `--no-verify` to skip git hooks.

### 8. Commit fixes

If any fixes were applied successfully:

```bash
git add <fixed files>
git commit -m "fix(<scope>): handoff verification — <brief> (SMA-N)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

One commit per logical fix. Don't squash unrelated fixes.

### 9. Push

```bash
git push
```

If push fails with 403 / wrong account, `gh auth switch -u pedroloes-maker`
and retry once.

### 10. Update PR description

Use `gh pr edit <N> --body "..."` with the updated body:
- For **passed** items: `[x]` (optionally + one-line note like "*via Playwright*")
- For **OAuth-gated skipped** items: `[ ]` + `*(requires manual login Google)*`
- For **visual-only skipped** items: `[ ]` + `*(manual visual review)*`
- Keep everything else intact: Summary, Stack, Notes/divergências, Closes
  SMA-N trailer

### 11. Comment on Linear

`save_comment` with a verification summary:
- Counts: X/Y passed automatically, Z skipped (OAuth), W skipped (visual)
- List of fixes committed with commit hashes
- List of items requiring human verification
- Screenshot filenames (don't attach; just note they exist locally)
- Verdict line: `handoff: clean — N items passed, M for human` or
  `handoff: blocked — needed 2 fix attempts on <item>, asking`

### 12. Stop

- `browser_close` to close Playwright.
- **DO NOT** kill the dev server. Leave the background `bun run dev` task
  running so the user can manually validate OAuth-gated items.

## Hard rules

- **Max 2 auto-fix attempts per item.** No infinite loops.
- **Never modify OAuth/auth code as a "fix".** Skip OAuth-gated tests entirely.
- **Never merge.** Human merge only.
- **Never `--force` push.** No `--no-verify`. No `git commit --amend` on
  failed-hook commits.
- **Don't expand ticket scope.** A failing test that needs out-of-scope work
  gets marked human-review, not fixed.
- **Leave the dev server running.** Confirmed Pedro preference.
- **Playwright MCP only for frontend tickets.** Backend tickets get curl +
  typecheck + build. Don't open the browser for backend-only diffs.
- **Don't disable or comment out failing checks** to make them pass.

## When to invoke

- After `/work SMA-N` opens a PR. The user types `/handoff` to verify.
- (Future) automatic at the end of `/work` — deferred per ticket scope.

## When in doubt

Read `WORKFLOW.md` (the loop contract), the ticket's Linear description, and
the `sma-handoff-skill-rules` memory entry.
