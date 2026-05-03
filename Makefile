IMAGE := oven/bun:1
RUN := docker run --rm -v $(PWD):/app -w /app $(IMAGE)

.PHONY: format lint build

format:
	$(RUN) bun install
	$(RUN) bun run format

lint:
	$(RUN) bun install
	$(RUN) bun run lint

build:
	$(RUN) bun install
	$(RUN) bun run build
