# Nad CLI

[![CI](https://github.com/NahidDavoudi/nad-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/NahidDavoudi/nad-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-7.0-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](#license)

The command-line interface for the **Nad Platform**: one standard workflow for developing, testing, shipping and operating every Nad project.

`nad` is the entry point developers (and AI agents) use to prepare a repository for containers, start feature branches and, in later phases, drive CI/CD, staging and production releases.

> **Status:** early development (`0.0.1`). The `hi`, `git status`, `git repair`, `feat`, `commit`, `pr`, `init` and `inspect` commands are implemented. The rest are on the [roadmap](#roadmap).

---

## Table of contents

- [Why Nad CLI](#why-nad-cli)
- [Requirements](#requirements)
- [Installation](#installation)
- [Commands](#commands)
- [How it behaves](#how-it-behaves)
- [Project structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [Continuous integration](#continuous-integration)
- [Roadmap](#roadmap)
- [Design principles](#design-principles)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Why Nad CLI

Every new project repeats the same setup work: repository layout, branch conventions, Dockerfiles, CI, staging, backups, rollbacks. Nad CLI defines that workflow **once**, encodes it as code and reuses it across all Nad projects.

The CLI is deliberately an **orchestration layer**. It does not reimplement Git, GitHub, Docker or Caddy; it coordinates them behind one consistent, safe interface.

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22 | CI runs on Node 22 |
| Git | any recent version | must be on `PATH` |
| npm | 9 or newer | for installation and scripts |
| Docker + Compose | recent | only to *use* the generated files, not to run `nad` |

## Installation

The package is `private` and is **not published to npm**. Install it from source:

```bash
git clone https://github.com/NahidDavoudi/nad-cli.git
cd nad-cli
npm install
npm run build
npm link          # makes the `nad` command available globally
```

Verify:

```bash
nad --version
nad --help
```

## Commands

### `nad hi [name]`

Prints a greeting (default name: `love`). A smoke test for the installation.

```text
$ nad hi Ada
✔ Hello there, Ada!
```

### `nad git status`

Prints `git status --porcelain=v1 --branch` for the current repository. Fails with a clear message outside a Git repository.

### `nad git repair detect`

Read-only scan (works on any branch, dirty tree allowed) that reports two groups of tracked files:

- **Ignored but tracked:** files matching `.gitignore` (`git ls-files -ci --exclude-standard`), grouped by top-level directory (root files are listed by their own name, e.g. `.env`).
- **Known-bad even when not ignored:** `node_modules`, `vendor`, `uploads`, `storage`, `dist`, `build`, `.next`, `__pycache__`, and secrets-like files (`.env`, `.env.*`, `*.pem`, `id_rsa*`; `.env.example` is exempt), grouped the same way.

If `vendor/` is tracked and no `Dockerfile` contains `composer install`, you also get a warning that vendor may be committed on purpose. The report always exits `0`; when anything is found it prints the exact command to fix it.

### `nad git repair untrack <path...> [--apply]`

Removes paths from the git index (files stay on disk) and adds them to `.gitignore`. Paths are normalized first (backslashes to `/`, leading `./` and trailing `/` stripped) and rejected — before anything is changed — when they are `.`, `..`, absolute, or escape the repository root. Then all checks run: git repository, not on `main`, attached HEAD, clean working tree.

- **Default is a dry run:** prints file count and total size per path, changes nothing, and tells you to re-run with `--apply`.
- **`--apply`:** `git rm -r --cached` each tracked path, appends the missing lines to `.gitignore` (created if missing, never duplicated — idempotent). For `uploads`/`storage` a `.gitkeep` is created — or re-added if it exists but is no longer tracked — and force-added so the directory survives in git. Nothing is committed; run `nad commit "<message>"` next.
- Paths that are not tracked are ignored; if none are tracked the command succeeds with "Nothing to untrack".
- **Warnings printed after `--apply`:** untracking only affects future commits (files stay in old history, the repo does not shrink, and any secret ever committed must be considered leaked and rotated), and anyone who `git pull`s after you commit will have those files deleted from their working directory — back up `uploads`/`storage` on servers first.

### `nad feat <name> [--base <branch>]`

Creates a standard feature branch named `feature/<name>`.

| Option | Default | Description |
|---|---|---|
| `--base <branch>` | `main` | Branch to create the feature branch from |

All checks run **before** anything is changed:

1. The current folder is a Git repository.
2. The working tree is clean (no uncommitted changes). Nothing is stashed for you.
3. `feature/<name>` does not already exist.
4. The base branch exists.

Then it checks out the base branch, runs `git pull --ff-only` **only if** the base has an upstream, and creates and switches to `feature/<name>`.

### `nad commit <message>`

Commits all changes (including untracked files) to the **current** branch.

All checks run **before** anything is changed:

1. The current folder is a Git repository.
2. The message is not empty.
3. HEAD is attached — in detached HEAD state there is no branch to commit onto, so it stops.
4. The branch is not the protected `main`. Nothing commits onto `main` by accident.
5. The working tree is not clean.

Then it stages everything (`git add -A`), commits with your message and prints the short hash of the new commit.

### `nad pr <title>`

Opens a pull request from the current branch to the protected base (`main`, hard-coded until `nad.project.yml` is actually read).

All checks run **before** anything is changed:

1. Git repository, attached HEAD, not on `main`, clean working tree (same guards as `nad commit`).
2. At least one commit exists ahead of `main`.
3. The GitHub CLI (`gh`) is installed and logged in.

Then it reuses an already-open PR for the branch (idempotent — same URL, nothing re-created), pushes with `-u` **only if** the branch has no upstream yet, and creates the PR with the commit subjects as the body (`- <subject>` per commit; compared against `origin/main` after a fetch, so a stale local `main` cannot list wrong commits). Accepts any title (quotes and special characters are passed as argument arrays, never through a shell).

By default the PR is only opened. With `--merge` it also waits for CI checks (`gh pr checks --watch --fail-fast`), squash-merges, deletes the branch and syncs local `main`. If CI never reports any checks within the retry window, it stops with an error instead of merging untested code.

If the push fails you get the raw `git push` stderr, including permission errors.

### `nad init [options]`

Prepares the current project to run in a container. It makes no network calls and never runs your project's code; it reads files and the `origin` remote URL.

| Option | Description |
|---|---|
| `-t, --template <type>` | Project type: `php`, `next`, `node`, `python`, `static`. Auto-detected if omitted |
| `-n, --name <name>` | Container / image name (default: folder name) |
| `--dry-run` | Print what would be written, write nothing |
| `--force` | Overwrite files that differ. Originals are first copied to `.nad/backup/<timestamp>/` |

**Detection.** Priority is `next` > `php` > `node` > `python` > `static`. PHP wins over Node on purpose, because PHP projects often carry a `package.json` for frontend tooling — a `package.json` alone never adds `node` as an extra candidate when PHP already matched. When several types match, `init` says so and suggests `--template`.

**Files written.** Existing files are never overwritten silently. Each file is reported as `create`, `unchanged`, `skip` (exists and differs) or `overwrite` (only with `--force`).

| File | Written for |
|---|---|
| `Dockerfile` | every type |
| `.dockerignore` | every type |
| `docker-compose.yml` | every type |
| `docker/custom.ini`, `docker/remoteip.conf`, `docker/apache-tune.conf` | `php` only (PHP and Apache tuning, sized for a 512 MB container) |
| `.env.example` | `python` only (PHP projects keep their own) |
| `nad.project.yml` | every type |

**What the generated compose file assumes.**

- No published ports. A reverse proxy (Caddy) reaches the container by name over the external `proxy` Docker network. PHP projects also join `db_net`, where the shared database lives.
- The image is named `ghcr.io/<owner>/<repo>:latest`, taken from the `origin` remote (lowercased, as GHCR requires).
- `TZ=Asia/Tehran`, `mem_limit: 512m`, `restart: unless-stopped`.
- PHP mounts `./uploads`, `./storage/logs` and `./.env` (read-only) into the container.

On first use on a machine, create the networks once:

```bash
docker network create proxy
docker network create db_net      # PHP projects only
```

**Warnings** (the files are still written): missing `output: 'standalone'` in a Next.js config, a non-npm lockfile, PHP extensions from `composer.json` that the image does not install, a missing `build` (Next) or `start` (Node) script, a missing `./.env` for PHP (Docker would create a directory with that name), and — after a `--force` overwrite — a reminder to add `.nad/` to `.gitignore` if it is not ignored yet (nothing is edited for you).

### `nad inspect [--json]`

Shows what Nad detects about the project: type, the evidence for it, other matching types and whether `nad.project.yml` exists. `--json` prints the same data as JSON, which is the form AI agents and scripts should use.

## How it behaves

- **Safe by default.** Destructive or ambiguous operations stop and report instead of guessing.
- **One error path.** Every failure goes through a single handler that prints a red message plus an optional dimmed hint:

  ```text
  $ nad feat payment
  ✖ You have uncommitted changes.
    → Commit them first.
  ```

- **Exit codes.** `0` on success, `1` on any handled failure. Running `nad` or `nad git` with no subcommand prints help and exits `1`.
- **Debugging.** `--verbose` (or `DEBUG=nad`) prints full stack traces.
- **Missing Git.** If the `git` binary is not found, you get an explicit message, not a stack trace.
- **Colour.** Output is coloured by meaning (green success, red error, yellow warning, dim hint). Colour is removed automatically when output is piped or `NO_COLOR` is set.

## Project structure

```text
src/
├── cli.ts              # entry point: registers commands, wires error handling
├── commands/
│   ├── hi.ts           # nad hi
│   ├── git.ts          # nad git <subcommand>
│   ├── feat.ts         # nad feat
│   ├── commit.ts       # nad commit
│   ├── pr.ts           # nad pr
│   ├── init.ts         # nad init
│   └── inspect.ts      # nad inspect
└── core/
    ├── errors.ts       # NadError hierarchy + handleError()
    ├── git.ts          # Git primitives and startFeatureBranch()
    ├── github.ts       # gh CLI primitives (available/auth/list/create)
    ├── pr.ts           # createPullRequest(): guards, push, body
    ├── repair.ts       # git repair: detect grouping + untrack
    ├── detect.ts       # project-type detection (reads files only)
    ├── templates.ts    # renders Dockerfile / compose / support files
    ├── scaffold.ts     # plans and applies file writes, with backups
    └── ui.ts           # coloured terminal output helpers
.github/workflows/ci.yml
```

Rules the code follows:

- The logic modules in `core/` (`git`, `detect`, `templates`, `scaffold`) never print and never exit. They return results or throw a `NadError`.
- Command actions do not catch errors. `cli.ts` catches everything and hands it to `handleError`, the only place that prints a failure and exits.
- All output goes through `ui`.

## Development

```bash
npm run build     # one-off TypeScript compile (tsc)
npm run dev       # tsc --watch
```

After changing sources, rebuild (or keep `npm run dev` running) before invoking `nad`.

`tsconfig.json` targets **ES2022** with **NodeNext** module resolution, so relative imports must include the `.js` extension.

Work happens on branches and reaches `main` through pull requests. Start one with:

```bash
nad feat <name>
```

## Testing

```bash
npm test      # builds, then runs the test suite (node:test) against dist/
```

The suites live next to the code as `src/**/*.test.ts` and cover:

- `git.ts` — `commitAll` on real temp repositories: not-a-repo, empty message, clean tree, the protected `main` branch and detached HEAD each throw their own error, and a real commit on a feature branch stages everything and returns the short hash.
- `repair.ts` — the pure grouping helpers (ignored vs known-bad, `.env.example` exempt, secrets-like files flagged), `detectRepairIssues` on a real temp repo, and `untrack`: dry run changes nothing, `--apply` untracks while keeping files on disk and updates `.gitignore` idempotently, blocked on `main` / dirty tree / detached HEAD, and `uploads` gets a tracked `.gitkeep`.
- `pr.ts` — `createPullRequest` guards (not-a-repo, protected `main`, dirty tree, detached HEAD, no commits ahead) and `buildPrBody` bullet formatting, without touching `gh`.
- `detect.ts` — every project type, the empty folder, priority order, and `node` suppression when `php` already matched (a `package.json` alone no longer makes it an extra candidate).
- `scaffold.ts` — create / unchanged / skip / overwrite decisions (on temp folders), and that overwrites back up the original to `.nad/backup/`.
- `templates.ts` — the three PHP support files exist, and **no** generated compose file publishes `ports:`; every compose joins the external `proxy` network (plus `db_net` for PHP).

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request, every push to `main` and every `v*` tag:

1. Check out the code.
2. Install Node 22 (with npm caching).
3. `npm ci`
4. `npm test` (which builds with `tsc` first, then runs the suite)

When the tests pass and the run comes from a push, a second `docker` job builds the image with Buildx, pushes it to the GitHub Container Registry using `GITHUB_TOKEN` and tags it as `latest` (default branch) plus a semver tag for `v*` tag pushes. It never runs for pull requests. PR runs are cancelled when a newer push arrives; `main` and tag runs are not.

## Roadmap

Shipped items are checked.

- [x] **Phase 0 — Skeleton:** CLI bootstrap, command registry, central error handling, UI helpers
- [x] **Git basics:** `nad git status`, `nad feat`
- [x] **Phase 1 — Initialization (partial):** `nad init` and `nad inspect` with detection and Docker templates for PHP, Next.js, Node, Python and static sites
  - [ ] Generate GitHub Actions workflows from `init`
  - [ ] Read project settings from a config file in other commands
- [x] **CI for this repository:** build check on every PR
- [ ] **Phase 2 — Git standardization (partial):** `nad git repair` (detect + untrack)
  - [ ] `nad git branches`, `nad git protect`
- [x] **Phase 3 — Development workflow (partial):** `nad commit`, `nad pr` (GitHub CLI, idempotent, auto-push)
  - [ ] `nad merge`, CI gating
- [ ] **Phase 4 — CI/CD:** reusable workflows, GHCR publishing, automatic tagging
- [ ] **Phase 5 — Staging:** isolated environments, subdomains, database cloning, health checks
- [ ] **Phase 6 — Release management:** `nad release`, `nad rollback`, release history
- [ ] **Phase 7 — Agent integration:** controlled workspaces for AI agents

## Design principles

1. **Reuse over reinvention:** wrap existing tools, do not replace them.
2. **Automation first:** anything repeated should be a command.
3. **Safe by default:** destructive actions need explicit confirmation.
4. **Idempotency:** running a command twice must not corrupt state.
5. **Environment isolation:** staging never touches production.
6. **Artifact consistency:** the artifact tested in staging is the one deployed to production.
7. **Traceability and reproducibility:** every meaningful action and release is recorded and recoverable.

## Known limitations

- **Only one real deployment has used the generated files so far.** `nad init` output ran on a VPS and the image was pulled from GHCR (verified 2026-11-09 on one real service). Other types (`next`, `node`, `python`, `static`) are untested on a real server.
- `init` writes `nad.project.yml`, but no command reads it yet. `feat` still defaults to `main`.
- If PHP's `./.env` does not exist on the host, Docker creates a *directory* with that name. `init` warns about it, but you must create the file yourself.
- `init` never edits `.gitignore`; it only warns that `.nad/backup/` (written by `--force`) may want ignoring.
- When no `origin` remote exists, the image owner falls back to a hard-coded default.
- The Python template always starts `uvicorn` and does not detect Django or Flask.
- The compose `env_file` long form needs a recent Docker Compose (2.24 or newer).
- Not published to npm (`"private": true`).

## License

[MIT](LICENSE)
