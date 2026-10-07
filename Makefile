.PHONY: dev infra down reset logs test lint typecheck check install

install:
	pnpm install

## Start backing services (postgres, redis, minio, clamav, mailpit) and every app on the host.
dev:
	pnpm dev

## Start only the backing services.
infra:
	pnpm infra:up

down:
	pnpm infra:down

## Stop everything and delete all local data (database, buckets, redis).
reset:
	pnpm infra:reset

logs:
	pnpm infra:logs

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

check:
	pnpm check
