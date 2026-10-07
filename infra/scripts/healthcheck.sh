#!/usr/bin/env bash
# Cheap external-style check for cron or a monitoring agent:
#   */5 * * * * /srv/honeytree/infra/scripts/healthcheck.sh
# Exits non-zero (and prints why) if the site, the API or the job queue is unhealthy.
# If HEALTHCHECK_PING_URL is set (healthchecks.io, Better Stack heartbeat, Uptime Kuma push),
# it is pinged only when everything is fine, so a missing ping raises the alert.
set -uo pipefail
cd "$(dirname "$0")/../.."
envval() { grep -E "^$1=" .env.production 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
SITE_DOMAIN="${SITE_DOMAIN:-$(envval SITE_DOMAIN)}"
HEALTHCHECK_PING_URL="${HEALTHCHECK_PING_URL:-$(envval HEALTHCHECK_PING_URL)}"
: "${SITE_DOMAIN:?SITE_DOMAIN is not set}"
fail=0
check() { # name, url
  if ! curl -fsS -m 10 -o /dev/null "$2"; then echo "FAIL $1 ($2)"; fail=1; fi
}
check "web" "https://${SITE_DOMAIN}/"
check "api" "https://${SITE_DOMAIN}/healthz"
# The worker has no HTTP port: it must be running and Redis must answer.
compose=(docker compose --env-file .env.production -f infra/docker-compose.prod.yml)
if [ "$("${compose[@]}" ps --status running -q worker | wc -l)" -lt 1 ]; then echo "FAIL worker is not running"; fail=1; fi
if ! "${compose[@]}" exec -T redis redis-cli ping | grep -q PONG; then echo "FAIL redis"; fail=1; fi
if [ "$fail" = 0 ] && [ -n "${HEALTHCHECK_PING_URL:-}" ]; then curl -fsS -m 10 -o /dev/null "$HEALTHCHECK_PING_URL" || true; fi
exit "$fail"
