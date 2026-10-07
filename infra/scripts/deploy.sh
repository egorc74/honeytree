#!/usr/bin/env bash
# Deploys the current git ref to this server: pull -> build -> backup -> migrate -> restart.
#
#   infra/scripts/deploy.sh                 normal deploy of the latest origin/main
#   infra/scripts/deploy.sh --no-backup     skip the pre-deploy database backup
#   infra/scripts/deploy.sh --rollback      go back to the previously deployed images
#   infra/scripts/deploy.sh --dry-run       print what would run, change nothing
#
# Downtime: images are built before anything is touched; migrations run against the live
# database, so they must be backward compatible with the old code (add columns, do not drop
# or rename in the same release). Only api, worker and web are recreated, and Caddy holds
# requests for up to 15 s while the API restarts, so a deploy shows up as a slow request, not
# as errors.
set -euo pipefail
cd "$(dirname "$0")/../.."

BACKUP=1 ROLLBACK=0 DRY=0
for arg in "$@"; do
  case "$arg" in
    --no-backup) BACKUP=0 ;;
    --rollback) ROLLBACK=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-.env.production}"
STATE_DIR=".deploy"
log() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then echo "+ $*"; else "$@"; fi; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found (copy .env.production.example and fill it in)"
if grep -q 'CHANGE_ME' "$ENV_FILE"; then die "$ENV_FILE still contains CHANGE_ME placeholders"; fi
perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo 600)"
[ "$perm" = 600 ] || [ "$perm" = 400 ] || log "warning: $ENV_FILE is mode $perm, run: chmod 600 $ENV_FILE"

# The env file is in Docker format (unquoted values with spaces), so it is read, not sourced.
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
SITE_DOMAIN="$(envval SITE_DOMAIN)"
S3_ENDPOINT="$(envval S3_ENDPOINT)"
MIGRATE_COMMAND="$(envval MIGRATE_COMMAND)"
HONEYTREE_IMAGE_PREFIX="$(envval HONEYTREE_IMAGE_PREFIX)"
for key in SITE_DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB; do
  [ -n "$(envval "$key")" ] || die "$key is empty in $ENV_FILE"
done

COMPOSE=(docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml)
case "${S3_ENDPOINT:-}" in http://minio*) COMPOSE+=(-f infra/docker-compose.minio.yml) ;; esac
mkdir -p "$STATE_DIR"

wait_healthy() { # service, seconds
  local svc="$1" deadline=$((SECONDS + $2)) id status
  [ "$DRY" = 1 ] && { echo "+ wait for $svc to be healthy"; return 0; }
  id="$("${COMPOSE[@]}" ps -q "$svc")"
  while [ $SECONDS -lt $deadline ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
    case "$status" in healthy|running) return 0 ;; esac
    sleep 2
  done
  return 1
}

smoke_test() {
  local url="https://${SITE_DOMAIN}/healthz"
  [ "$DRY" = 1 ] && { echo "+ curl $url"; return 0; }
  for _ in $(seq 1 30); do
    curl -fsS -m 5 -o /dev/null "$url" && return 0
    sleep 2
  done
  return 1
}

start_apps() { # tag
  export TAG="$1"
  run "${COMPOSE[@]}" up -d postgres redis clamav
  wait_healthy postgres 120 || die "postgres is not healthy"
  wait_healthy redis 60 || die "redis is not healthy"
  run "${COMPOSE[@]}" up -d --no-deps api
  wait_healthy api 120 || return 1
  run "${COMPOSE[@]}" up -d --remove-orphans
}

if [ "$ROLLBACK" = 1 ]; then
  [ -f "$STATE_DIR/previous" ] || die "no previous deployment recorded"
  PREV="$(cat "$STATE_DIR/previous")"
  log "rolling back to $PREV (database migrations are NOT reverted)"
  start_apps "$PREV" || die "api did not become healthy after rollback"
  smoke_test || die "smoke test failed after rollback"
  [ "$DRY" = 1 ] || { cp "$STATE_DIR/current" "$STATE_DIR/rolled-back-from"; echo "$PREV" > "$STATE_DIR/current"; }
  log "rolled back to $PREV"
  exit 0
fi

# 1. Get the code.
if [ -z "${DEPLOY_SKIP_GIT:-}" ]; then
  log "pulling latest code"
  run git fetch --prune origin
  run git pull --ff-only
fi
NEW_TAG="$(git rev-parse --short=12 HEAD)"
OLD_TAG="$(cat "$STATE_DIR/current" 2>/dev/null || true)"
log "deploying $NEW_TAG (currently: ${OLD_TAG:-nothing})"

# 2. Build before touching anything running.
export TAG="$NEW_TAG"
if [ "${DEPLOY_MODE:-build}" = pull ]; then
  run "${COMPOSE[@]}" pull api worker web
else
  run "${COMPOSE[@]}" build api worker web backup
fi

# 3. Backing services and a fresh backup, so a bad migration can be undone.
run "${COMPOSE[@]}" up -d postgres redis
wait_healthy postgres 120 || die "postgres is not healthy"
if [ "$BACKUP" = 1 ]; then
  log "backing up the database"
  run "${COMPOSE[@]}" run --rm backup /opt/backup/backup.sh || die "backup failed (use --no-backup to skip)"
fi

# 4. Migrate with the NEW image, then switch over.
log "running migrations"
run "${COMPOSE[@]}" run --rm --no-deps api sh -c "${MIGRATE_COMMAND:?set MIGRATE_COMMAND in $ENV_FILE}"

log "restarting services"
if ! start_apps "$NEW_TAG" || ! smoke_test; then
  log "new version is unhealthy:"
  [ "$DRY" = 1 ] || "${COMPOSE[@]}" logs --tail=50 api || true
  if [ -n "$OLD_TAG" ]; then
    log "rolling the code back to $OLD_TAG (migrations stay applied)"
    start_apps "$OLD_TAG" || true
  fi
  die "deploy of $NEW_TAG failed"
fi

# 5. Record state and clean up old images (keep the current and previous release).
if [ "$DRY" != 1 ]; then
  [ -n "$OLD_TAG" ] && [ "$OLD_TAG" != "$NEW_TAG" ] && echo "$OLD_TAG" > "$STATE_DIR/previous"
  echo "$NEW_TAG" > "$STATE_DIR/current"
  keep="$(cat "$STATE_DIR/current" "$STATE_DIR/previous" 2>/dev/null | sort -u | paste -sd'|')"
  docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E "^${HONEYTREE_IMAGE_PREFIX:-honeytree}/" | grep -Ev ":(${keep}|latest)$" \
    | xargs -r docker rmi >/dev/null 2>&1 || true
  docker image prune -f >/dev/null
fi
log "deployed $NEW_TAG to https://${SITE_DOMAIN}"
