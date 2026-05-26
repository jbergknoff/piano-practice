#!/bin/bash
# Brings up Docker for Claude Code on the web sessions.
#
# This project runs its entire toolchain (bun, biome, tsc, playwright) inside
# containers via `docker compose` (see Makefile / docker-compose.yml). The web
# sandbox ships the Docker CLI + daemon but does not start the daemon, and
# Docker Hub's blob CDN (production.cloudflare.docker.com) is not in the
# network allowlist. So we: start dockerd, point it at a reachable Docker Hub
# mirror (mirror.gcr.io), and pre-pull the compose images so `make` targets
# (and the commit-time `make pr-ready` gate) work without pulling mid-task.
set -euo pipefail

# Only needed in the remote web sandbox; locally you use your own Docker.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

log() { echo "[session-start] $*"; }

if ! command -v dockerd >/dev/null 2>&1; then
  log "dockerd not present in this image; skipping Docker setup"
  exit 0
fi

# Docker Hub serves manifests from an allowlisted host but redirects layer
# blobs to a CDN that is blocked; mirror.gcr.io is a reachable pull-through
# cache for Docker Hub.
mkdir -p /etc/docker
if ! grep -qs "mirror.gcr.io" /etc/docker/daemon.json; then
  printf '{\n  "registry-mirrors": ["https://mirror.gcr.io"]\n}\n' > /etc/docker/daemon.json
  log "configured Docker Hub mirror (mirror.gcr.io)"
fi

if ! docker info >/dev/null 2>&1; then
  log "starting dockerd..."
  nohup dockerd >/var/log/dockerd.log 2>&1 &
  disown || true
  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
  if ! docker info >/dev/null 2>&1; then
    log "dockerd did not become ready; recent log:"
    tail -n 20 /var/log/dockerd.log || true
    exit 1
  fi
fi
log "docker is up ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"

# The sandbox routes outbound traffic through a TLS-intercepting egress proxy.
# The host trusts its CA bundle, but the compose images do not, so `bun install`
# inside the `main` container fails with SELF_SIGNED_CERT_IN_CHAIN. Write a
# gitignored compose override (auto-merged by `docker compose`) that mounts the
# host CA bundle into the container and points the toolchain at it, so installs
# work in-container. The base docker-compose.yml stays clean for local/Mac dev,
# which has no such proxy.
host_ca="/etc/ssl/certs/ca-certificates.crt"
if [ -f "$host_ca" ]; then
  cat > docker-compose.override.yml <<EOF
services:
  main:
    volumes:
      - $host_ca:$host_ca:ro
    environment:
      - NODE_EXTRA_CA_CERTS=$host_ca
      - SSL_CERT_FILE=$host_ca
EOF
  log "wrote docker-compose.override.yml (host CA for in-container installs)"
else
  log "warning: host CA bundle not found at $host_ca; in-container installs may fail"
fi

# Pre-pull compose images (cached into container state for future sessions).
docker compose pull --quiet || log "warning: failed to pull one or more compose images"

# Pre-install node_modules now that in-container installs trust the proxy CA, so
# the first `make` target (and the commit-time `make pr-ready` gate) doesn't
# install mid-task.
make node_modules >/dev/null 2>&1 || log "warning: failed to pre-install node_modules"

log "setup complete"
