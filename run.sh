#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo "Run ./setup.sh first." >&2
  exit 1
fi
if [[ ! -f frontend/dist/index.html ]]; then
  echo "Build the interface first: npm --prefix frontend ci && npm --prefix frontend run build" >&2
  exit 1
fi
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
exec .venv/bin/python -m studio "$@"
