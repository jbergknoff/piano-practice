# Netlify sets NETLIFY=true; use tools directly there since Docker isn't available.
ifdef NETLIFY
run = $(1)
playwright = SKIP_SCREENSHOTS=1 node_modules/.bin/playwright
else
run = docker compose run --rm $(2) main $(1)
playwright = docker compose run --rm playwright node_modules/.bin/playwright
endif

bun = $(call run,bun)
biome = $(call run,./node_modules/.bin/biome)
tsc = $(call run,./node_modules/.bin/tsc)

# Netlify Deploy Previews (PR builds) set CONTEXT=deploy-preview; emit source
# maps there so PR previews are debuggable. Production stays map-free.
ifeq ($(CONTEXT),deploy-preview)
sourcemap = --sourcemap=linked
endif

# Pre-create node_modules before Docker runs so the directory is owned by the
# host user (Docker would otherwise create it as root).
node_modules: package.json
	mkdir -p node_modules
	$(bun) install

format: node_modules
	$(biome) format --write .

lint: node_modules
	$(biome) lint .

typecheck: node_modules
	$(tsc) --noEmit

unit-test: node_modules
	$(bun) test src lib

build: node_modules
	mkdir -p dist
	$(bun) build src/main.tsx --outdir dist --minify $(sourcemap) --define 'GIT_COMMIT="$(shell git rev-parse --short HEAD)"'
	cp node_modules/@fontsource/bravura/files/bravura-latin-400-normal.woff2 dist/bravura.woff2
	cp node_modules/@fontsource/geist/files/geist-latin-400-normal.woff2 dist/geist-400.woff2
	cp node_modules/@fontsource/geist/files/geist-latin-500-normal.woff2 dist/geist-500.woff2
	cp node_modules/@fontsource/geist/files/geist-latin-600-normal.woff2 dist/geist-600.woff2
	cp node_modules/@fontsource/geist/files/geist-latin-700-normal.woff2 dist/geist-700.woff2
	cp node_modules/@fontsource/geist-mono/files/geist-mono-latin-400-normal.woff2 dist/geist-mono-400.woff2
	cp node_modules/@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2 dist/geist-mono-500.woff2
	cp node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2 dist/instrument-serif-italic.woff2

# Pre-create output directories as the host user so Docker (running as root)
# writes into them rather than creating root-owned directories.
tests/integration/results:
	mkdir -p tests/integration/results

tests/integration/fixtures/screenshots:
	mkdir -p tests/integration/fixtures/screenshots

integration-test: build node_modules tests/integration/results tests/integration/fixtures/screenshots
	$(playwright) test

# Re-generate screenshot baselines (run after intentional visual changes).
update-screenshots: build node_modules tests/integration/results tests/integration/fixtures/screenshots
	$(playwright) test --update-snapshots

test: unit-test integration-test

up:
	docker compose up -d

down:
	docker compose down

hot-reload: build
	$(bun) build src/main.tsx --outdir dist --define 'GIT_COMMIT="$(shell git rev-parse --short HEAD)"' --watch

pr-ready: format lint typecheck build test
