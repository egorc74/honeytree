#!/bin/sh
# Runs the backup every night at 02:30 UTC and a restore test every Sunday at 04:00 UTC.
set -eu
# cron jobs do not inherit the container environment, so hand it over through a file.
export -p | grep -E 'DATABASE_URL|BACKUP_|S3_|RESTORE_' > /opt/backup/env || true
cat > /etc/crontabs/root <<CRON
30 2 * * * . /opt/backup/env; /opt/backup/backup.sh > /proc/1/fd/1 2>&1
0 4 * * 0 . /opt/backup/env; /opt/backup/test-restore.sh > /proc/1/fd/1 2>&1
CRON
echo "[backup] scheduler started: backup 02:30 UTC daily, restore test Sundays 04:00 UTC"
# `docker compose run --rm backup /opt/backup/backup.sh` runs a backup on demand.
if [ "$#" -gt 0 ]; then exec "$@"; fi
exec crond -f -l 8
