#!/bin/sh
set -e

CRAWL_SCHEDULE="${CRAWL_SCHEDULE:-0 2 * * 0}"
CRAWL_EXTENSIONS="${CRAWL_EXTENSIONS:-true}"
EXTENSIONS_CRAWL_SCHEDULE="${EXTENSIONS_CRAWL_SCHEDULE:-0 3 * * 0}"
CRAWL_SITE="${CRAWL_SITE:-true}"
SITE_CRAWL_SCHEDULE="${SITE_CRAWL_SCHEDULE:-0 4 * * 0}"
CRAWL_EXTERNAL="${CRAWL_EXTERNAL:-false}"
EXTERNAL_CRAWL_SCHEDULE="${EXTERNAL_CRAWL_SCHEDULE:-0 5 * * 0}"

# Build the crawl command — no CRAWL_SECTIONS means crawl everything
if [ -n "$CRAWL_SECTIONS" ]; then
  INITIAL_CRAWL() {
    for section in $CRAWL_SECTIONS; do
      npx tsx crawl.ts --section "$section"
    done
  }
  CRON_ENTRIES() {
    for section in $CRAWL_SECTIONS; do
      echo "${CRAWL_SCHEDULE} cd /app && npx tsx crawl.ts --section \"$section\" >> /proc/1/fd/1 2>&1"
    done
  }
else
  INITIAL_CRAWL() { npx tsx crawl.ts; }
  CRON_ENTRIES() { echo "${CRAWL_SCHEDULE} cd /app && npx tsx crawl.ts >> /proc/1/fd/1 2>&1"; }
fi

# Initial crawl if docs haven't been indexed yet
if [ ! -f /app/docs/index.json ]; then
  echo "No docs found — running initial crawl${CRAWL_SECTIONS:+ for: $CRAWL_SECTIONS}"
  INITIAL_CRAWL
fi

# Initial extensions crawl if enabled and not yet indexed
if [ "$CRAWL_EXTENSIONS" = "true" ] && [ ! -d /app/docs/extensions ]; then
  echo "No extensions found — running initial extensions crawl"
  npx tsx crawl-extensions.ts
fi

# Initial site crawl if enabled and not yet indexed
if [ "$CRAWL_SITE" = "true" ] && [ ! -d /app/data/products ]; then
  echo "No site data found — running initial site crawl"
  npx tsx crawl-site.ts
fi

# Initial external crawl if enabled and not yet indexed
if [ "$CRAWL_EXTERNAL" = "true" ] && [ ! -d /app/docs/insightvm-api ]; then
  echo "No external API docs found — running initial external crawl"
  npx tsx crawl-external.ts
fi

# Set up cron entries
{
  CRON_ENTRIES
  # Extensions cron (if enabled)
  if [ "$CRAWL_EXTENSIONS" = "true" ]; then
    echo "${EXTENSIONS_CRAWL_SCHEDULE} cd /app && npx tsx crawl-extensions.ts >> /proc/1/fd/1 2>&1"
  fi
  # Site crawl cron (if enabled)
  if [ "$CRAWL_SITE" = "true" ]; then
    echo "${SITE_CRAWL_SCHEDULE} cd /app && npx tsx crawl-site.ts >> /proc/1/fd/1 2>&1"
  fi
  # External crawl cron (if enabled)
  if [ "$CRAWL_EXTERNAL" = "true" ]; then
    echo "${EXTERNAL_CRAWL_SCHEDULE} cd /app && npx tsx crawl-external.ts >> /proc/1/fd/1 2>&1"
  fi
} | crontab -
crond

echo "Cron scheduled: ${CRAWL_SCHEDULE}${CRAWL_SECTIONS:+ for $CRAWL_SECTIONS}"
if [ "$CRAWL_EXTENSIONS" = "true" ]; then
  echo "Extensions cron: ${EXTENSIONS_CRAWL_SCHEDULE}"
fi
if [ "$CRAWL_SITE" = "true" ]; then
  echo "Site crawl cron: ${SITE_CRAWL_SCHEDULE}"
fi
if [ "$CRAWL_EXTERNAL" = "true" ]; then
  echo "External crawl cron: ${EXTERNAL_CRAWL_SCHEDULE}"
fi

# Keep crond running as PID 1 (no MCP server—separate container)
exec crond -f
