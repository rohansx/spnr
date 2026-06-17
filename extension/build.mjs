// Two-target build: the service worker (ESM, can carry the WASM BLAKE3 dep) and the
// content script (IIFE, classic — content scripts cannot be ES modules). Mirrors the
// CLI's split: worker = daemon (network + keys), content = the fast hooks (DOM only).
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");
const outdir = "dist";

const common = {
  bundle: true,
  sourcemap: true,
  target: ["chrome120"],
  logLevel: "info",
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const targets = [
  // Service worker: ES module so hash-wasm (BLAKE3) bundles cleanly; MV3 sets
  // background.type = "module".
  { entryPoints: ["src/worker/index.ts"], outfile: `${outdir}/worker.js`, format: "esm", ...common },
  // Content script: IIFE, runs in the page's isolated world, no imports at runtime.
  { entryPoints: ["src/content/index.ts"], outfile: `${outdir}/content.js`, format: "iife", ...common },
];

async function copyStatic() {
  await cp("src/manifest.json", `${outdir}/manifest.json`);
}

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatic();
  console.log("[spnr] watching…");
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  await copyStatic();
  console.log("[spnr] build complete → dist/");
}
