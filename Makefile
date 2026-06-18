# Invoice Maker — common commands. Run `make` (or `make help`) to list them.
# Dev is on Linux (WebKitGTK needs the dmabuf flag); the end user is on Windows.

.DEFAULT_GOAL := help
.PHONY: help install dev check test build verify bundle reset-db clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

dev: ## Run the desktop app in dev (Linux/Wayland: sets the WebKitGTK flag)
	WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev

check: ## Type/Svelte check (svelte-check)
	npm run check

test: ## Run unit tests (Vitest)
	npm test

build: ## Build the frontend (Vite)
	npm run build

verify: check test build ## Pre-commit gate: check + test + build

bundle: ## Build installers for THIS OS (Windows installers come from CI)
	npm run tauri build

reset-db: ## Delete the local dev database for a fresh first-run
	rm -f "$$HOME/.config/com.app.invoice/invoice.db" \
		"$$HOME/.config/com.app.invoice/invoice.db-wal" \
		"$$HOME/.config/com.app.invoice/invoice.db-shm"
	@echo "Local DB cleared — next launch starts at the setup wizard."

clean: ## Remove build artifacts (frontend + Rust target)
	rm -rf build .svelte-kit src-tauri/target
