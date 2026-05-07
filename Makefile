# Netlify sets NETLIFY=true; use tools directly there since Docker isn't available.
ifdef NETLIFY
run = $(1)
else
run = docker compose run --rm $(2) main $(1)
endif

bun = $(call run,bun)
biome = $(call run,./node_modules/.bin/biome)
tsc = $(call run,./node_modules/.bin/tsc)

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
	$(bun) build src/main.tsx --outdir dist --minify

pr-ready: format lint typecheck test build
