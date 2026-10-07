#!/bin/sh
# Dumps the database and stores it, then deletes backups older than 14 days.
#
#   DATABASE_URL       database to dump (required)
#   BACKUP_DIR         store in this directory (local mode; used by tests and as a fallback)
#   BACKUP_BUCKET      store in this S3/R2 bucket instead (BACKUP_PREFIX, default "postgres")
#   BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_REGION
#                      credentials for the bucket (default to the S3_* media credentials)
#   BACKUP_RETENTION_DAYS (14) and BACKUP_MIN_KEEP (3, never prune below this many backups)
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
MIN_KEEP="${BACKUP_MIN_KEEP:-3}"
PREFIX="${BACKUP_PREFIX:-postgres}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="honeytree-$STAMP.dump"
CUTOFF="honeytree-$(date -u -d "@$(( $(date +%s) - RETENTION_DAYS * 86400 ))" +%Y%m%dT%H%M%SZ).dump"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }

aws_s3() {
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}" \
  AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-${S3_REGION:-auto}}" \
  AWS_EC2_METADATA_DISABLED=true \
  aws ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} "$@"
}

log "dumping to $NAME"
pg_dump --format=custom --no-owner --no-privileges --file="$TMP/$NAME" "$DATABASE_URL"
# A dump that cannot even be listed is worthless: fail loudly now rather than at restore time.
pg_restore --list "$TMP/$NAME" >/dev/null
SIZE="$(wc -c < "$TMP/$NAME" | tr -d ' ')"
[ "$SIZE" -gt 0 ] || { log "ERROR: empty dump"; exit 1; }

if [ -n "${BACKUP_DIR:-}" ]; then
  mkdir -p "$BACKUP_DIR"
  cp "$TMP/$NAME" "$BACKUP_DIR/$NAME"
  log "stored $BACKUP_DIR/$NAME ($SIZE bytes)"
  ALL="$(ls -1 "$BACKUP_DIR" | grep -E '^honeytree-[0-9]{8}T[0-9]{6}Z\.dump$' | sort || true)"
else
  : "${BACKUP_BUCKET:?set BACKUP_BUCKET (or BACKUP_DIR for local mode)}"
  aws_s3 s3 cp --only-show-errors "$TMP/$NAME" "s3://$BACKUP_BUCKET/$PREFIX/$NAME"
  log "stored s3://$BACKUP_BUCKET/$PREFIX/$NAME ($SIZE bytes)"
  ALL="$(aws_s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$PREFIX/" \
          --query 'Contents[].Key' --output text | tr '\t' '\n' | sed "s#^$PREFIX/##" \
          | grep -E '^honeytree-[0-9]{8}T[0-9]{6}Z\.dump$' | sort || true)"
fi

# Retention: delete what is older than the cutoff, but always keep the newest MIN_KEEP.
TOTAL="$(printf '%s\n' "$ALL" | grep -c . || true)"
printf '%s\n' "$ALL" | grep . | while read -r f; do
  if [ "$f" \< "$CUTOFF" ] && [ "$TOTAL" -gt "$MIN_KEEP" ]; then
    if [ -n "${BACKUP_DIR:-}" ]; then rm -f "$BACKUP_DIR/$f"
    else aws_s3 s3 rm --only-show-errors "s3://$BACKUP_BUCKET/$PREFIX/$f"; fi
    TOTAL=$((TOTAL - 1))
    log "pruned $f"
  fi
done
log "done"
