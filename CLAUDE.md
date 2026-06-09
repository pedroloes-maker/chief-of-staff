# CLAUDE.md

High-level operating manual for this repo. **Auto-loaded into every Claude Code
session here — keep it short.** Detailed workflows live in `.claude/skills/`.

## What this repo is

Chief-of-Staff. PRD lives at `PRD.md`. Code structure evolves from there.

## How we ship

```
Linear ticket → branch → PR → human merge → Linear auto-closes
```

Linear (team `SmartTalks`, project `Chief-of-Staff`) is the source of truth. GitHub
(`pedroloes-maker/chief-of-staff`) is where the code lives. Human merge is the only approval. The
Linear↔GitHub integration auto-closes issues whose PR body contains
`Closes SMA-N`.

## When you start a session, use this

| Need                             | Skill                |
| -------------------------------- | -------------------- |
| Drive a Linear ticket end-to-end | `/work SMA-N` |

The skill file in `.claude/skills/work/` carries the detailed step-by-step.
Read `WORKFLOW.md` for the formal loop contract.

Frontend tickets get an extra UI-verification step driven by the **Playwright
MCP** (`mcp__playwright__*` — registered in `.mcp.json`, runs via
`npx @playwright/mcp@latest`). The `/work` skill calls into it automatically
on changes that touch user-visible UI.

## Hard rules (the only ones that belong here)

- **Never merge your own PR.** Human approval is the only path to `main`.
- **Never force-push, never `--no-verify`, never `git commit --amend` after a
  hook failure.**
- **One ticket = one branch = one PR.** No mixing.
- **No scope creep.** If a ticket needs broader work, comment on the issue and
  stop. Don't grow the PR silently.
- **Never commit `.env`, virtualenvs, or anything matched by `.gitignore`.**

`.claude/settings.json` enforces the irreversible parts (deny list: `gh pr
merge`, force-push, `git reset --hard`, `rm -rf`).

## Project layout

- `PRD.md` — why
- `WORKFLOW.md` — formal loop contract
- `.claude/` — repo-shared Claude Code config (this file, settings, skills)

## Linear project map

All issues use `SMA-N`. Team: `SmartTalks`. Project: `Chief-of-Staff`.

## When in doubt

Invoke `/work` or read `WORKFLOW.md`. If neither covers the case, ask the
human before improvising — don't grow this file with one-off rules.
