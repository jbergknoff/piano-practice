/**
 * Minimal static file server for Playwright tests.
 * Serves the project root (index.html + dist/) on port 3456.
 * Run with: bun scripts/serve.ts
 */
const ROOT = `${import.meta.dir}/..`;
const PORT = 3456;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${ROOT}${pathname}`);
    if (await file.exists()) {
      return new Response(file);
    }
    // SPA fallback — serve index.html for unknown paths
    return new Response(Bun.file(`${ROOT}/index.html`));
  },
});

console.log(`Serving on http://localhost:${PORT}`);
