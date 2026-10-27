#!/bin/bash
# Nightly Swag Bullion database backup. Read-only on the DB: it only runs pg_dump, nothing is deleted from the DB.
# Keeps the last 14 daily dumps. Put the folder on a disk/location that is NOT only on this VM if you can.
set -euo pipefail
DB_CONTAINER="swag-bullion-test-db-1"
BACKUP_DIR="$HOME/bullion-backups"
KEEP_DAYS=14
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F_%H%M)
OUT="$BACKUP_DIR/bullion_$STAMP.sql.gz"
# DB user / name are read from inside the container, so nothing is hard-coded here.
docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$OUT"
# refuse to keep an empty/tiny dump, and say so
if [ "$(stat -c%s "$OUT")" -lt 2000 ]; then echo "BACKUP TOO SMALL, check it: $OUT" >&2; exit 1; fi
find "$BACKUP_DIR" -name 'bullion_*.sql.gz' -mtime +$KEEP_DAYS -delete
echo "OK $OUT ($(du -h "$OUT" | cut -f1))"
