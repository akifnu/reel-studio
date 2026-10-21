#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
pipeline_dir="${REEL_PIPELINE_PATH:-../DSprojects/reel-pipeline}"
if [[ ! -f "$pipeline_dir/reelkit/orchestrator.py" ]]; then
  echo "Clone DSprojects alongside reel-studio, or export REEL_PIPELINE_PATH first." >&2
  exit 1
fi
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt -r "$pipeline_dir/requirements.txt" -r "$pipeline_dir/requirements-url.txt"
.venv/bin/python -m pip install --force-reinstall --no-deps opencv-python-headless==5.0.0.93
npm --prefix frontend ci
npm --prefix frontend run build
echo "Studio is installed. Run ./run.sh to open it."
echo "If engine tools/models are missing, activate .venv and run: bash $pipeline_dir/setup.sh"
