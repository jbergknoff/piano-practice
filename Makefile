# Netlify (https://docs.netlify.com/build/configure-builds/environment-variables/)
# sets CI=true in its build environment, where Docker isn't available but tools
# like bun are installed directly.
ifdef CI
run = $(1)
else
run = docker-compose run --rm $(2) main $(1)
endif

bun = $(call run,bun)
biome = $(call run,./node_modules/.bin/biome)
tsc = $(call run,./node_modules/.bin/tsc)

node_modules: package.json
	$(bun) install

format: node_modules
	$(biome) format --write .
	git diff --exit-code

lint: node_modules
	$(biome) lint .

typecheck: node_modules
	$(tsc) --noEmit

build: node_modules
	$(bun) build src/main.tsx --outdir dist --minify
