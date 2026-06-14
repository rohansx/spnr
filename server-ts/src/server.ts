// Entrypoint for the spnr v0.2 demand-side service.
//
// Listens on PORT (default 8790). Note the hermetic-E2E port map: the Rust backend
// runs on 8788 (E2E) / 8787 (live demo), Vite on 5174 (E2E) / 5173 (live). This
// TypeScript demand-side service defaults to 8790 so it never collides with either.

import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 8790;
const app = createApp();

app.listen(port, () => {
  // Single startup line; request logging belongs in a proper logger, not console.
  process.stdout.write(`spnr demand-side (ts) listening on :${port}\n`);
});
