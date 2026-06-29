#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

# Load environment variables from .env.local if it exists. PM2 role-specific
# values are restored afterwards so backend/console services keep their ports.
PM2_DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-}"
PM2_APP_RUNTIME_ROLE="${APP_RUNTIME_ROLE:-}"
PM2_BACKEND_INTERNAL_URL="${BACKEND_INTERNAL_URL:-}"
PM2_CONSOLE_INTERNAL_URL="${CONSOLE_INTERNAL_URL:-}"

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f "${COZE_WORKSPACE_PATH}/.env.local" ]; then
    set +u
    set -a
    # shellcheck disable=SC1091
    source "${COZE_WORKSPACE_PATH}/.env.local"
    set +a
    set -u
fi

[ -n "${PM2_DEPLOY_RUN_PORT}" ] && DEPLOY_RUN_PORT="${PM2_DEPLOY_RUN_PORT}"
[ -n "${PM2_APP_RUNTIME_ROLE}" ] && APP_RUNTIME_ROLE="${PM2_APP_RUNTIME_ROLE}"
[ -n "${PM2_BACKEND_INTERNAL_URL}" ] && BACKEND_INTERNAL_URL="${PM2_BACKEND_INTERNAL_URL}"
[ -n "${PM2_CONSOLE_INTERNAL_URL}" ] && CONSOLE_INTERNAL_URL="${PM2_CONSOLE_INTERNAL_URL}"

if [ -n "${DEPLOY_NODE_BIN_DIR:-}" ] && [ -d "${DEPLOY_NODE_BIN_DIR}" ]; then
    export PATH="${DEPLOY_NODE_BIN_DIR}:${PATH}"
fi

PORT=${1:-5000}
DEPLOY_RUN_PORT="${DEPLOY_RUN_PORT:-$PORT}"
APP_RUNTIME_ROLE="${APP_RUNTIME_ROLE:-full}"


start_service() {
    cd "${COZE_WORKSPACE_PATH}"
    echo "Starting ${APP_RUNTIME_ROLE} HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
    echo "COZE_PROJECT_ENV: ${COZE_PROJECT_ENV}"
    export NODE_ENV="${NODE_ENV:-production}"
    export APP_RUNTIME_ROLE
    PORT=${DEPLOY_RUN_PORT} node dist/server.js
}

echo "Starting ${APP_RUNTIME_ROLE} HTTP service on port ${DEPLOY_RUN_PORT} for deploy..."
start_service
