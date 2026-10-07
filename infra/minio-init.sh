#!/bin/sh
# Creates the two buckets and makes the public one readable by anyone. Idempotent.
set -eu
until mc alias set local "http://minio:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "waiting for minio..."; sleep 1
done
mc mb --ignore-existing "local/$S3_BUCKET_PRIVATE"
mc mb --ignore-existing "local/$S3_BUCKET_PUBLIC"
mc anonymous set download "local/$S3_BUCKET_PUBLIC"
# The app uses its own access key rather than the root credentials.
mc admin user add local "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" 2>/dev/null || true
mc admin policy attach local readwrite --user "$S3_ACCESS_KEY_ID" 2>/dev/null || true
echo "buckets ready"
