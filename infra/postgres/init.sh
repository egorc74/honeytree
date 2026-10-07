#!/bin/sh
# Runs once, the first time the postgres volume is created.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE DATABASE honeytree_test OWNER "$POSTGRES_USER";
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname honeytree_test \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
