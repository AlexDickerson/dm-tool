// pdfjs-dist setup — centralizes the worker-source configuration so every
// consumer (BookReader, cover ingest) imports from here instead of
// duplicating the worker URL wiring.
//
// The `?url` import suffix tells Vite to resolve the module through its
// dependency pipeline and return a servable URL. This avoids the `@fs/`
// route that `new URL(...)` produces, which can be blocked by Vite's
// `server.fs.allow` when running from a git worktree.

import * as pdfjsLib from 'pdfjs-dist';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite handles the ?url suffix at build time
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export { pdfjsLib };
