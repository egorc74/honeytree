#!/bin/sh
# Restores a backup into a database. DESTRUCTIVE: existing objects in the target are replaced.
#
#   restore.sh <backup> [target-url]
#
# <backup>      a local file, or a file name / "latest" taken from BACKUP_DIR or the backup bucket
# [target-url]  defaults to $DATABASE_URL
# Pass --yes to skip the confirmation (needed when there is no terminal).
set -eu

YES=0
[ "${1:-}" = "--yes" ] && { YES=1; shift; }
SRC="${1:?usage: restore.sh [--yes] <backup-file|name|latest> [target-url]}"
TARGET="${2:-${DATABASE_URL:?DATABASE_URL or a target-url is required}}"
PREFIX="${BACKUP_PREFIX:-postgres}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

aws_s3() {
  AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}" \
  AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}" \
  AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-${S3_REGION:-auto}}" \
  AWS_EC2_METADATA_DISABLED=true \
  aws ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} "$@"
}

FILE="$SRC"
if [ ! -f "$SRC" ]; then
  if [ -n "${BACKUP_DIR:-}" ]; then
    [ "$SRC" = latest ] && SRC="$(ls -1 "$BACKUP_DIR" | grep -E '^honeytree-.*\.dump$' | sort | tail -n1)"
    FILE="$BACKUP_DIR/$SRC"
  else
    : "${BACKUP_BUCKET:?set BACKUP_BUCKET or BACKUP_DIR}"
    if [ "$SRC" = latest ]; then
      SRC="$(aws_s3 s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$PREFIX/" \
              --query 'Contents[].Key' --output text | tr '\t' '\n' | sed "s#^$PREFIX/##" \
              | grep -E '^honeytree-.*\.dump$' | sort | tail -n1)"
    fi
    [ -n "$SRC" ] || { echo "no backups found" >&2; exit 1; }
    aws_s3 s3 cp --only-show-errors "s3://$BACKUP_BUCKET/$PREFIX/$SRC" "$TMP/$SRC"
    FILE="$TMP/$SRC"
  fi
fi
[ -f "$FILE" ] || { echo "backup not found: $FILE" >&2; exit 1; }
pg_restore --list "$FILE" >/dev/null

if [ "$YES" -ne 1 ]; then
  printf 'Restore %s into %s? Existing objects will be replaced. Type "restore" to continue: ' \
    "$(basename "$FILE")" "$(echo "$TARGET" | sed -E 's#://[^@]*@#://***@#')"
  read -r answer
  [ "$answer" = restore ] || { echo "aborted"; exit 1; }
fi

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname="$TARGET" "$FILE"
echo "restored $(basename "$FILE")"
