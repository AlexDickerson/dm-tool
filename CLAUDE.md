# DM Tool

Electron desktop app for Pathfinder 2e game masters. Manages maps, books, encounters, and provides AI-assisted chat with rules knowledge.

## Tech Stack

- Electron + electron-vite
- React 18 + TailwindCSS (renderer)
- TypeScript (strict mode)
- better-sqlite3 (local database)
- Vercel AI SDK + Anthropic (chat features)
- electron-builder (packaging)

## Build & Run

- `npm run dev` — Start dev server with hot reload
- `npm run build` — Production build
- `npm run typecheck` — TypeScript type checking
- `npm run start` — Run built app
- `npm run package` — Package installer

## Project Structure

npm-workspaces monorepo:

- `apps/dm-tool/` — Electron app (main process under `electron/`, React renderer under `src/`)
- `apps/player-portal/` — Player-facing web app + its Fastify live-sync server (under `server/`), single process (`@dm-tool/player-portal`)
- `packages/shared/` — Types + shared UI components used by the apps (`@dm-tool/shared`)
- `tagger/` — Python map indexing subtool (built separately)
- `resources/` — App icons and assets
- `apps/dm-tool/electron.vite.config.ts` — Electron build configuration

## Subtools

- **tagger**: Python tool that indexes map files. Built via `npm run build:tagger` → `tagger/dist/map-tagger.exe`
- **Auto-Wall**: Bundled from the auto-wall project. Downloaded during CI build.

## Git Workflow

- All work MUST be done in git worktrees. Never work directly on main.
- Worktree directory: `.claude/worktrees/<branch-name>`
- Push work to the remote frequently — at minimum after every logical unit of work, and always before ending a session.
- All changes go through PRs to main. Never commit directly to main.
- Run linting before committing. Fix lint errors before pushing.

## Key Decisions

- Electron main process handles all Node.js APIs; renderer is pure React
- Path aliases: `@/` → `apps/dm-tool/src/`. Shared types are imported as `@dm-tool/shared/types` (workspace package, not a path alias).
- config.json is gitignored (contains user-specific absolute paths)
- Tailwind JIT: newly introduced classes can fail during HMR — prefer inline styles for layout-critical sizing
