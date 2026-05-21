# Netlify sets NETLIFY=true; use tools directly there since Docker isn't available.
ifdef NETLIFY
run = $(1)
else
run = docker compose run --rm $(2) main $(1)
endif

bun = $(call run,bun)
biome = $(call run,./node_modules/.bin/biome)
tsc = $(call run,./node_modules/.bin/tsc)

# Netlify Deploy Previews (PR builds) set CONTEXT=deploy-preview; emit source
# maps there so PR previews are debuggable. Production stays map-free.
ifeq ($(CONTEXT),deploy-preview)
sourcemap = --sourcemap=linked
endif

node_modules: package.json
	$(bun) install

format: node_modules
	$(biome) format --write .

lint: node_modules
	$(biome) lint .

typecheck: node_modules
	$(tsc) --noEmit

test: node_modules
	$(bun) test

build: node_modules
	mkdir -p dist
	$(bun) build src/main.tsx --outdir dist --minify $(sourcemap) --define 'GIT_COMMIT="$(shell git rev-parse --short HEAD)"'
	cp node_modules/@fontsource/bravura/files/bravura-latin-400-normal.woff2 dist/bravura.woff2

pr-ready: format lint typecheck test build
