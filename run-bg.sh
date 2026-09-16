#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=${PORT:-8001}
FRONTEND_PORT=${FRONTEND_PORT:-5174}
HOST_IP=${HOST_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")}

BACKEND_PID_FILE="$SCRIPT_DIR/backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/frontend.pid"
BACKEND_LOG="$SCRIPT_DIR/backend.log"
FRONTEND_LOG="$SCRIPT_DIR/frontend.log"

echo "========================================================"
echo " Starting MinerU Studio (Backend + Frontend Dev Server)"
echo "========================================================"

# --- Check running Backend ---
if [ -f "$BACKEND_PID_FILE" ]; then
    PID=$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "Backend is already running (PID: $PID)."
    else
        rm -f "$BACKEND_PID_FILE"
    fi
fi

# Check backend port
if [ ! -f "$BACKEND_PID_FILE" ]; then
    B_PORT_PID=$(lsof -ti :"$BACKEND_PORT" 2>/dev/null || true)
    if [ -n "$B_PORT_PID" ]; then
        echo "Error: Backend port $BACKEND_PORT is already in use by process $B_PORT_PID."
        echo "Please run ./stop-bg.sh or check running processes."
        exit 1
    fi
fi

# --- Check running Frontend ---
if [ -f "$FRONTEND_PID_FILE" ]; then
    PID=$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "Frontend is already running (PID: $PID)."
    else
        rm -f "$FRONTEND_PID_FILE"
    fi
fi

# Check frontend port
if [ ! -f "$FRONTEND_PID_FILE" ]; then
    F_PORT_PID=$(lsof -ti :"$FRONTEND_PORT" 2>/dev/null || true)
    if [ -n "$F_PORT_PID" ]; then
        echo "Error: Frontend port $FRONTEND_PORT is already in use by process $F_PORT_PID."
        echo "Please run ./stop-bg.sh or check running processes."
        exit 1
    fi
fi

# --- Ensure Python virtual environment exists ---
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment with uv..."
    uv venv --python 3.12
    uv pip install -r pyproject.toml
fi

# --- Ensure Frontend node_modules exist ---
if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd frontend && npm install)
fi

# Ensure packages/rag_embed_core is in PYTHONPATH
export PYTHONPATH="$SCRIPT_DIR:$SCRIPT_DIR/packages/rag_embed_core:${PYTHONPATH:-}"

# --- Start Backend if not already running ---
if [ ! -f "$BACKEND_PID_FILE" ]; then
    echo "Starting Backend (FastAPI) on port $BACKEND_PORT..."
    nohup .venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" > "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$BACKEND_PID_FILE"
else
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
fi

# --- Start Frontend if not already running ---
if [ ! -f "$FRONTEND_PID_FILE" ]; then
    echo "Starting Frontend (Vite) on port $FRONTEND_PORT..."
    (cd frontend && nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$FRONTEND_LOG" 2>&1 & echo $! > "$FRONTEND_PID_FILE")
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
else
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
fi

# Brief wait to verify processes didn't immediately crash
sleep 2

BACKEND_OK=0
FRONTEND_OK=0

if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    BACKEND_OK=1
fi

if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    FRONTEND_OK=1
fi

echo "========================================================"
if [ "$BACKEND_OK" -eq 1 ] && [ "$FRONTEND_OK" -eq 1 ]; then
    echo " MinerU Studio started successfully in background!"
    echo "--------------------------------------------------------"
    echo " Frontend UI : http://$HOST_IP:$FRONTEND_PORT (Local: http://localhost:$FRONTEND_PORT)"
    echo " Backend API : http://$HOST_IP:$BACKEND_PORT (Local: http://localhost:$BACKEND_PORT)"
    echo " Swagger Docs: http://$HOST_IP:$BACKEND_PORT/docs"
    echo "--------------------------------------------------------"
    echo " Backend  PID: $BACKEND_PID | Log: $BACKEND_LOG"
    echo " Frontend PID: $FRONTEND_PID | Log: $FRONTEND_LOG"
    echo " Stop script : ./stop-bg.sh"
    echo "========================================================"
else
    echo "Warning: One or more services failed to start."
    if [ "$BACKEND_OK" -ne 1 ]; then
        echo "[Backend Error Logs ($BACKEND_LOG)]:"
        tail -n 15 "$BACKEND_LOG" 2>/dev/null || true
    fi
    if [ "$FRONTEND_OK" -ne 1 ]; then
        echo "[Frontend Error Logs ($FRONTEND_LOG)]:"
        tail -n 15 "$FRONTEND_LOG" 2>/dev/null || true
    fi
    echo "Run ./stop-bg.sh to clean up."
    exit 1
fi
