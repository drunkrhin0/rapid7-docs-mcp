#!/bin/sh
set -e

CRAWL_SECTIONS="${CRAWL_SECTIONS:-insightidr}"
CRAWL_SCHEDULE="${CRAWL_SCHEDULE:-0 2 * * 0}"

# Initial crawl if docs haven't been indexed yet
if [ ! -f /app/docs/index.json ]; then
  echo "No docs found — running initial crawl for: $CRAWL_SECTIONS"
  for section in $CRAWL_SECTIONS; do
    npx tsx crawl.ts --section "$section"
  done
fi

# Set up weekly cron (Sunday 2am) for each section
CRON_CMD=""
for section in $CRAWL_SECTIONS; do
  CRON_CMD="${CRON_CMD}${CRAWL_SCHEDULE} cd /app && npx tsx crawl.ts --section $section >> /proc/1/fd/1 2>&1
"
done
echo "$CRON_CMD" | crontab -
crond

echo "Cron scheduled: weekly crawl for $CRAWL_SECTIONS"

# Start MCP server as PID 1
exec node dist/index.js
