#!/bin/bash
set -e

PORT=${PORT:-8001}
echo "========================================================"
echo " Starting MinerU RAG ETL Studio on :$PORT"
echo "========================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure venv exists
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment with uv..."
    uv venv --python 3.12
    uv pip install -r pyproject.toml
fi

# Ensure frontend is built
if [ ! -d "frontend/dist" ]; then
    echo "Building React frontend..."
    (cd frontend && npm install && npm run build)
fi

# Ensure packages/rag_embed_core is in PYTHONPATH
export PYTHONPATH="$SCRIPT_DIR:$SCRIPT_DIR/packages/rag_embed_core:${PYTHONPATH:-}"

echo "Launching MinerU RAG ETL Studio..."
exec .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port "$PORT" --reload

