# spnr — convenience targets. Thin wrappers over the real build/test/e2e commands.
#
#   make build         cargo build --release (all client crates + the backend)
#   make test          cargo test + server-ts vitest + web typecheck
#   make e2e           full-stack E2E (backend + daemon + Playwright + auth)
#   make e2e-install   hermetic install/uninstall integration test
#   make install       one-command local demo install (build + backend + daemon + wire)
#   make uninstall     stop the daemon/backend and restore Claude Code settings
#   make web           run the React dev server (vite)
#   make clean         cargo clean
#
# Requires: Rust (cargo). The test/web targets also need Node 18+; the e2e
# targets additionally need jq + curl.

.PHONY: build test test-rust test-ts test-web e2e e2e-install install uninstall web clean help

help:
	@echo "spnr targets:"
	@echo "  make build         cargo build --release (clients + backend)"
	@echo "  make test          cargo test + server-ts tests + web typecheck"
	@echo "  make e2e           full-stack E2E (bash e2e/run.sh)"
	@echo "  make e2e-install   hermetic install test (bash e2e/install.sh)"
	@echo "  make install       local demo install (bash install/install.sh)"
	@echo "  make uninstall     reverse the install (bash install/uninstall.sh)"
	@echo "  make web           React dev server (vite)"
	@echo "  make clean         cargo clean"

build:
	cargo build --release

# Full test sweep: Rust suites, the TS portal vitest suite, and the web typecheck.
test: test-rust test-ts test-web

test-rust:
	cargo test

test-ts:
	npm --prefix server-ts test

test-web:
	npm --prefix web run typecheck

e2e:
	bash e2e/run.sh

e2e-install:
	bash e2e/install.sh

install:
	bash install/install.sh

uninstall:
	bash install/uninstall.sh

web:
	npm --prefix web run dev

clean:
	cargo clean
