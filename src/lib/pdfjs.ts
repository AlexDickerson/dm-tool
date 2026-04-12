// pdfjs-dist setup — centralizes the worker-source configuration so every
// consumer (BookReader, cover ingest) imports from here instead of
// duplicating the `new URL()` magic.
//
// The workerSrc is set via Vite's `new URL(..., import.meta.url)` pattern,
// which tells the Vite bundler to copy the worker file into the build
// output and rewrite the URL at compile time. This means the worker loads
// from the bundled asset — not from a CDN or network URL.

import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export { pdfjsLib };
