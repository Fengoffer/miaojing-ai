#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
REQUESTED_BACKUP_DIR="${BACKUP_DIR:-}"
REQUESTED_LOCAL_DB_URL="${LOCAL_DB_URL:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

cd "${COZE_WORKSPACE_PATH}"

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f ".env.local" ]; then
  set +u
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
  set -u
fi

[ -n "${REQUESTED_LOCAL_DB_URL}" ] && LOCAL_DB_URL="${REQUESTED_LOCAL_DB_URL}"
BACKUP_DIR="${REQUESTED_BACKUP_DIR:-${BACKUP_DIR:-${COZE_WORKSPACE_PATH}/backups}}"
BACKUP_FILE="${BACKUP_DIR}/miaojing-backup-${TIMESTAMP}.tar.gz"
MANIFEST_INCLUDES='"database.dump"'
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

if [ -z "${LOCAL_DB_URL:-}" ]; then
  echo "LOCAL_DB_URL is required in .env.local or environment." >&2
  exit 1
fi

command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump is required to create backups." >&2
  exit 1
}
command -v pg_restore >/dev/null 2>&1 || {
  echo "pg_restore is required to verify backups." >&2
  exit 1
}

pg_dump "${LOCAL_DB_URL}" --format=custom --file "${TMP_DIR}/database.dump"
pg_restore --list "${TMP_DIR}/database.dump" >/dev/null

STORAGE_SOURCE="${LOCAL_STORAGE_DIR:-${COZE_WORKSPACE_PATH}/local-storage}"
if [ -d "${STORAGE_SOURCE}" ]; then
  cp -a "${STORAGE_SOURCE}" "${TMP_DIR}/local-storage"
  MANIFEST_INCLUDES="${MANIFEST_INCLUDES}, \"local-storage\""
fi

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f ".env.local" ]; then
  cp ".env.local" "${TMP_DIR}/.env.local"
  MANIFEST_INCLUDES="${MANIFEST_INCLUDES}, \".env.local\""
fi

if [ -f "package.json" ]; then
  cp "package.json" "${TMP_DIR}/package.json"
  MANIFEST_INCLUDES="${MANIFEST_INCLUDES}, \"package.json\""
fi

cat > "${TMP_DIR}/manifest.json" <<EOF
{
  "app": "miaojingAI",
  "formatVersion": 2,
  "createdAt": "$(date -Iseconds)",
  "hostname": "$(hostname)",
  "storagePath": "${STORAGE_SOURCE}",
  "includes": [${MANIFEST_INCLUDES}]
}
EOF

tar -czf "${BACKUP_FILE}" -C "${TMP_DIR}" .
tar -tzf "${BACKUP_FILE}" >/dev/null
chmod 600 "${BACKUP_FILE}"

find "${BACKUP_DIR}" -maxdepth 1 -name 'miaojing-backup-*.tar.gz' -type f \
  -printf '%T@ %p\n' | sort -rn | awk 'NR>10 {print $2}' | xargs -r rm -f

echo "${BACKUP_FILE}"
