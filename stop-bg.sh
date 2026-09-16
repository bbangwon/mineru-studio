#!/bin/bash

BACKEND_PORT=${PORT:-8001}
FRONTEND_PORT=${FRONTEND_PORT:-5174}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PID_FILE="$SCRIPT_DIR/backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/frontend.pid"
LEGACY_PID_FILE="$SCRIPT_DIR/app.pid"

STOPPED=0

echo "========================================================"
echo " Stopping MinerU Studio (Backend & Frontend)"
echo "========================================================"

# Helper function to stop a process by PID (including its child processes)
stop_pid() {
    local target_pid=$1
    local name=$2

    if [ -n "$target_pid" ] && kill -0 "$target_pid" 2>/dev/null; then
        echo "Stopping $name (PID: $target_pid)..."
        
        # Kill child processes if any (especially npm -> vite or uvicorn reload workers)
        pkill -P "$target_pid" 2>/dev/null || true
        kill "$target_pid" 2>/dev/null || true

        # Wait up to 5 seconds for graceful shutdown
        for i in {1..5}; do
            if ! kill -0 "$target_pid" 2>/dev/null; then
                break
            fi
            sleep 1
        done

        # Force kill if still alive
        if kill -0 "$target_pid" 2>/dev/null; then
            echo "Force killing $name (PID: $target_pid)..."
            pkill -9 -P "$target_pid" 2>/dev/null || true
            kill -9 "$target_pid" 2>/dev/null || true
            sleep 0.5
        fi
        STOPPED=1
    fi
}

# 1. Stop Backend
if [ -f "$BACKEND_PID_FILE" ]; then
    PID=$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)
    stop_pid "$PID" "Backend"
    rm -f "$BACKEND_PID_FILE"
fi

# 2. Stop Frontend
if [ -f "$FRONTEND_PID_FILE" ]; then
    PID=$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)
    stop_pid "$PID" "Frontend"
    rm -f "$FRONTEND_PID_FILE"
fi

# Legacy app.pid cleanup if exists
if [ -f "$LEGACY_PID_FILE" ]; then
    PID=$(cat "$LEGACY_PID_FILE" 2>/dev/null || true)
    stop_pid "$PID" "App"
    rm -f "$LEGACY_PID_FILE"
fi

# 3. Check for any remaining processes by port
B_PORT_PID=$(lsof -ti :"$BACKEND_PORT" 2>/dev/null || true)
if [ -n "$B_PORT_PID" ]; then
    echo "Cleaning up lingering process on backend port :$BACKEND_PORT (PID: $B_PORT_PID)..."
    stop_pid "$B_PORT_PID" "Port $BACKEND_PORT process"
fi

F_PORT_PID=$(lsof -ti :"$FRONTEND_PORT" 2>/dev/null || true)
if [ -n "$F_PORT_PID" ]; then
    echo "Cleaning up lingering process on frontend port :$FRONTEND_PORT (PID: $F_PORT_PID)..."
    stop_pid "$F_PORT_PID" "Port $FRONTEND_PORT process"
fi

echo "--------------------------------------------------------"
if [ "$STOPPED" -eq 1 ]; then
    echo "All MinerU Studio services have been stopped."
else
    echo "No running MinerU Studio services were found."
fi
echo "========================================================"
