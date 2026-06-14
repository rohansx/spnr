# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# spnr-server — the Rust reference backend (axum + bundled SQLite).
# Multi-stage: compile the workspace binary, then ship a slim runtime image.
# Build context = repo root (the binary depends on the crates/* workspace members).
# ─────────────────────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS build
WORKDIR /app

# The Cargo workspace manifest references every member, so copy the whole set the
# backend needs to resolve + build. (.dockerignore keeps target/ + node_modules out.)
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
COPY server ./server

# bundled SQLite compiles from source here (the build image has a C toolchain).
RUN cargo build --release -p spnr-server

# ─────────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/spnr-server /usr/local/bin/spnr-server

# Container defaults: bind all interfaces (Traefik/Docker reach it) and persist the
# SQLite store to a mounted volume so data survives redeploys.
ENV SPNR_SERVER_HOST=0.0.0.0 \
    SPNR_SERVER_PORT=8787 \
    SPNR_DB=/data/spnr-server.db
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8787/health || exit 1

CMD ["spnr-server"]
