#!/bin/sh
set -e

CRAWL_SCHEDULE="${CRAWL_SCHEDULE:-0 2 * * 0}"

# Build the crawl command — no CRAWL_SECTIONS means crawl everything
if [ -n "$CRAWL_SECTIONS" ]; then
  CRAWL_CMD_ARGS="--section $(echo $CRAWL_SECTIONS | tr ' ' '\n' | head -1)"
  # will loop below for cron; for initial crawl run each section
  INITIAL_CRAWL() {
    for section in $CRAWL_SECTIONS; do
      npx tsx crawl.ts --section "$section"
    done
  }
  CRON_ENTRIES() {
    for section in $CRAWL_SECTIONS; do
      echo "${CRAWL_SCHEDULE} cd /app && npx tsx crawl.ts --section $section >> /proc/1/fd/1 2>&1"
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

# Set up cron
CRON_ENTRIES | crontab -
crond

echo "Cron scheduled: ${CRAWL_SCHEDULE}${CRAWL_SECTIONS:+ for $CRAWL_SECTIONS}"

# Start MCP server as PID 1
exec node dist/index.js
