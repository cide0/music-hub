DC := docker compose

.DEFAULT_GOAL := list
.PHONY: list env-check build-dev npm-install install up down cleanup generate-secret

list: ## List all available make targets
	@echo "Available targets:"
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

env-check:
	@test -f .env || { \
		echo "No .env found - creating one from .env.example."; \
		cp .env.example .env; \
		echo "Fill in the real values in .env before starting the app."; \
	}

build-dev: env-check ## Build the Docker image
	$(DC) build

npm-install: env-check ## Install npm dependencies (inside the container)
	$(DC) run --rm --no-deps music-hub npm install

install: build-dev npm-install ## Build the image and install npm dependencies

up: env-check ## Start the container
	$(DC) up -d
	@echo "Music Hub is running - http://127.0.0.1:$${PORT:-8080}"

down: ## Stop the container
	$(DC) down

cleanup: ## Remove all of the project's containers, images and volumes
	$(DC) down --volumes --rmi all --remove-orphans

generate-secret: ## Print a random value to use as SESSION_SECRET
	@openssl rand -hex 32
