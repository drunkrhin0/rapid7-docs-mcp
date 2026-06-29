#!/usr/bin/env bash
# Run the .forgejo/workflows/ jobs locally with act, mirroring the
# dockhand runner's environment as closely as possible.
#
# This is the local pre-push check for CI changes. Run it after
# editing any file under .forgejo/workflows/ or .github/workflows/.
# Catches the "works on my machine, fails on the runner" class of
# bugs before they cost a push-and-wait cycle.
#
# Usage: ./scripts/ci-local.sh [job1 job2 ...]
#        ./scripts/ci-local.sh          # run all 5 PR jobs
set -euo pipefail

cd "$(dirname "$0")/.."

SECRETS=(--secret GHCR_TOKEN=dummy --secret GH_PAT=dummy)
IMAGES=(
  -P ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest
  -P ubuntu-22.04=ghcr.io/catthehacker/ubuntu:act-latest
  -P docker=ghcr.io/catthehacker/ubuntu:act-latest
)
ARCH=(--container-architecture linux/amd64)

ALL_JOBS=(lint typecheck test stemmer-parity audit)
JOBS=("${@:-${ALL_JOBS[@]}}")

for job in "${JOBS[@]}"; do
  echo
  echo "=========================================="
  echo "  Running job: $job"
  echo "=========================================="
  act -j "$job" -W .forgejo/workflows/pr.yml \
    "${SECRETS[@]}" "${IMAGES[@]}" \
    "${ARCH[@]}"
done
