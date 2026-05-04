# Agent notes

## Local development

The only local requirements are `make` and `docker`. Bun, Node, and Biome are all run inside a Docker container via `docker-compose`; nothing needs to be installed on the host.

```sh
make build      # compile src/ → dist/main.js
make format     # auto-format all JS/TS files
make lint       # run Biome linter
make typecheck  # run tsc --noEmit (type-checks without building)
make pr-ready   # runs format, lint, typecheck, build
```

Run `make pr-ready` before committing to ensure formatting, linting, type-checking, and build all pass.

The first run of any target will install dependencies into `node_modules/` (which is mounted from the host, so subsequent runs skip reinstall).

## Build output

`dist/` is gitignored and excluded from Biome linting/formatting. `make build` must be run before `index.html` will work — it produces `dist/main.js`, which the page loads.

## Code style

Always use braces around conditional and loop bodies, even for single-line statements:

```ts
// correct
if (!value) {
  return;
}

// wrong
if (!value) return;
```

## Dependencies

`bun.lock` is committed. When adding or removing packages, commit the updated `bun.lock` alongside `package.json`.

## CI

GitHub Actions runs `make pr-ready` on every push and pull request (`.github/workflows/ci.yml`), followed by `git diff --exit-code` to fail with a visible diff if files weren't pre-formatted.

## Deployment

Netlify is connected to this repo:

- **Production** — deploys automatically from `main`
- **PR previews** — every pull request gets a unique deploy preview URL, posted as a PR comment by the Netlify bot

## Bun version

The Bun version is pinned via `BUN_VERSION` in `netlify.toml`. `docker-compose.yml` reads that same env var (defaulting to the same value), so changing it in one place keeps both environments in sync.
