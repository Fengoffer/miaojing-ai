#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f "${COZE_WORKSPACE_PATH}/.env.local" ]; then
    set +u
    set -a
    # shellcheck disable=SC1091
    source "${COZE_WORKSPACE_PATH}/.env.local"
    set +a
    set -u
fi

if [ -z "${LOCAL_DB_URL:-}" ]; then
    echo "LOCAL_DB_URL is not set" >&2
    exit 1
fi

psql "${LOCAL_DB_URL}" -v ON_ERROR_STOP=1 -f "${COZE_WORKSPACE_PATH}/scripts/database-optimization-patch.sql"
