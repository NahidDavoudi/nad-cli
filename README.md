# Nad CLI

[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-7.0-blue)](https://www.typescriptlang.org)
[![commander](https://img.shields.io/badge/commander-15-blue)](https://github.com/tj/commander.js)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#license)

The command-line interface for the **Nad Platform** — a single, standardised workflow for developing, testing, shipping and operating every Nad project.

`nad` is the entry point developers (and AI agents) use to bootstrap a repository, normalise its Git structure, start feature branches and — in later phases — drive CI/CD, staging environments and production releases.

> **Status:** early development (`0.0.1`). Three commands are implemented; the rest are on the [roadmap](#roadmap).

---

## Table of contents

- [Why Nad CLI](#why-nad-cli)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Commands](#commands)
- [How it behaves](#how-it-behaves)
- [Project structure](#project-structure)
- [Development](#development)
- [Roadmap](#roadmap)
- [Design principles](#design-principles)
- [Known limitations](#known-limitations)
- [License](#license)

---

## Why Nad CLI

Every new project repeats the same setup work: repository layout, branch conventions, Dockerfiles, GitHub Actions, staging, backups, rollbacks. Nad CLI exists to define that workflow **once**, encode it as code, and reuse it across all Nad projects — so a project can be brought up to standard with a handful of commands instead of a checklist.

The CLI is deliberately an **orchestration layer**. It does not reimplement Git, GitHub, Docker or Caddy; it coordinates them behind a consistent, safe interface.

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | **≥ 22.12** | Required by `commander@15` and `execa@10` |
| Git | any recent version | Must be available on `PATH` |
| npm | ≥ 9 | For installation and scripts |

## Installation

The package is currently `private` and is **not published to npm**. Install it from source:

```bash
git clone <repository-url> nad-cli
cd nad-cli
npm install
npm run build
```

Then make the binary available globally:

```bash
npm link          # symlink into your global bin
# or
npm install -g .
```

Verify the install:

```bash
nad --version
nad --help
```

## Usage

```bash
# Greet someone (smoke test)
nad hi
nad hi Ada

# Inspect the current repository
nad git status

# Start a feature branch from main
nad feat payment

# Start a feature branch from a different base
nad feat dashboard --base develop
```

## Commands

### `nad hi [name]`

Prints a greeting. Defaults to `love` when no name is given. Useful as a smoke test after installation.

```text
$ nad hi Ada
✔ Hello there, Ada!
```

### `nad git status`

Prints the raw `git status --porcelain=v1 --branch` output for the current repository. Fails with a clear message if the current folder is not a Git repository.

```text
$ nad git status
## feature/payment...origin/feature/payment
 M src/commands/feat.ts
?? src/commands/merge.ts
```

### `nad feat <name> [--base <branch>]`

Creates a standard feature branch named `feature/<name>`.

| Option | Default | Description |
|---|---|---|
| `--base <branch>` | `main` | Branch to create the feature branch from |

What happens:

1. Verifies the current folder is a Git repository.
2. Verifies the working tree is clean (no uncommitted changes).
3. Verifies `feature/<name>` does not already exist.
4. Checks out the base branch.
5. Runs `git pull --ff-only` **if** the base branch has an upstream.
6. Creates and switches to `feature/<name>`.

```text
$ nad feat payment
✔ Switched to new branch: feature/payment
```

## How it behaves

- **Safe by default.** Destructive or ambiguous operations stop and report instead of guessing.
- **Readable errors.** All failures are funnelled through a single handler that prints a red message plus an optional dimmed hint, then exits with code `1`.

  ```text
  $ nad feat payment
  ✖ You have uncommitted changes.
    → Commit them first.
  ```

- **Exit codes.** `0` on success, `1` on any handled failure.
- **Missing Git.** If the `git` binary is not found, you get an explicit message rather than a stack trace.

## Project structure

```text
src/
├── cli.ts            # entry point — registers commands, wires error handling
├── commands/
│   ├── hi.ts         # nad hi
│   ├── git.ts        # nad git <subcommand>
│   └── feat.ts       # nad feat
└── core/
    ├── errors.ts     # NadError hierarchy + handleError()
    ├── git.ts        # Git primitives (isGitRepo, isClean, …)
    └── ui.ts         # terminal output helpers (picocolors)
```

Compiled output goes to `dist/`; the `nad` binary resolves to `dist/cli.js`.

## Development

```bash
npm run build     # one-off TypeScript compile (tsc)
npm run dev       # tsc --watch
```

After changing sources, re-run `npm run build` (or keep `npm run dev` running) before invoking `nad`.

`tsconfig.json` targets **ES2022** with **NodeNext** module resolution, so relative imports must include the `.js` extension.

## Roadmap

The platform is being built in phases. Shipped items are checked.

- [x] **Phase 0 — Skeleton:** CLI bootstrap, command registry, error handling, UI helpers
- [x] **Phase 1 (partial) — Git basics:** `nad git status`, `nad feat`
- [ ] **Phase 1 — Initialization:** `nad init` with project-type detection and templates (PHP, TypeScript, React, Static), idempotent file generation, `nad.project.yml`
- [ ] **Phase 2 — Git standardization:** `nad git repair`, `nad git branches`, `nad git protect`, backups before rewriting history
- [ ] **Phase 3 — Development workflow:** `nad commit`, `nad merge`, `nad merge --auto`, PR creation via GitHub CLI, CI gating
- [ ] **Phase 4 — CI/CD:** reusable workflows, artifacts, GHCR image publishing, automatic tagging
- [ ] **Phase 5 — Staging:** isolated Docker environments, subdomains, database cloning, health checks, reset
- [ ] **Phase 6 — Release management:** `nad release`, `nad rollback`, release history, migrations
- [ ] **Phase 7 — Agent integration:** controlled workspaces for AI agents on the VPS

## Design principles

1. **Reuse over reinvention** — wrap existing tools, don't replace them.
2. **Automation first** — anything repeated should be a command.
3. **Safe by default** — destructive actions require explicit confirmation.
4. **Idempotency** — running a command twice must not corrupt state.
5. **Environment isolation** — staging never touches production.
6. **Artifact consistency** — the artifact tested in staging is the artifact deployed to production.
7. **Traceability & reproducibility** — every meaningful action and release is recorded and recoverable.

## Known limitations

- Only `hi`, `git status` and `feat` are implemented.
- `package.json` declares `"engines": { "node": ">=18" }`, but `commander@15` and `execa@10` require **Node ≥ 22.12**. The engines field should be raised to match.
- No automated test suite yet.
- Not published to npm (`private: true`).

## License

Private and unpublished. All rights reserved unless a license file is added to the repository.