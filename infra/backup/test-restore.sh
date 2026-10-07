#!/bin/sh
# Proves that the newest backup can actually be restored: restores it into a scratch database
# on the same server, checks that the data is there, then drops the scratch database.
# Exits non-zero (and the weekly cron run shows up as an error in the logs) when it cannot.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
SCRATCH="honeytree_restore_check"
ADMIN_URL="${RESTORE_ADMIN_URL:-$(echo "$DATABASE_URL" | sed -E 's#/[^/?]+(\?|$)#/postgres\1#')}"
SCRATCH_URL="$(echo "$ADMIN_URL" | sed -E "s#/postgres(\?|\$)#/$SCRATCH\1#")"
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { echo "[restore-test] $(date -u +%FT%TZ) $*"; }

cleanup() { psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
psql "$ADMIN_URL" -qv ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCH"
"$HERE/restore.sh" --yes latest "$SCRATCH_URL"

TABLES="$(psql "$SCRATCH_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
USERS="$(psql "$SCRATCH_URL" -Atc "SELECT count(*) FROM users")"
GAMES="$(psql "$SCRATCH_URL" -Atc "SELECT count(*) FROM games")"
[ "$TABLES" -ge 5 ] || { log "FAILED: only $TABLES tables restored"; exit 1; }
log "OK: $TABLES tables, $USERS users, $GAMES games restored from the latest backup"
