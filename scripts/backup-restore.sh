#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
BACKUP_FILE="${1:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TMP_DIR="$(mktemp -d)"
RESTORE_SAFETY_DIR="${RESTORE_SAFETY_DIR:-}"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: pnpm backup:restore <backup-file.tar.gz>" >&2
  exit 2
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 2
fi

cd "${COZE_WORKSPACE_PATH}"

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f ".env.local" ]; then
  set +u
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
  set -u
fi

if [ -z "${LOCAL_DB_URL:-}" ]; then
  echo "LOCAL_DB_URL is required in .env.local or environment." >&2
  exit 1
fi

command -v pg_restore >/dev/null 2>&1 || {
  echo "pg_restore is required to restore backups." >&2
  exit 1
}
command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump is required to create restore safety backups." >&2
  exit 1
}

tar -tzf "${BACKUP_FILE}" >/dev/null
tar -xzf "${BACKUP_FILE}" -C "${TMP_DIR}"

if [ ! -f "${TMP_DIR}/database.dump" ]; then
  echo "Invalid backup: missing database.dump." >&2
  exit 2
fi
pg_restore --list "${TMP_DIR}/database.dump" >/dev/null

SAFETY_ROOT="${RESTORE_SAFETY_DIR:-${COZE_WORKSPACE_PATH}/backups/restore-safety}"
SAFETY_DIR="${SAFETY_ROOT}/pre-restore-${TIMESTAMP}"
mkdir -p "${SAFETY_DIR}"
chmod 700 "${SAFETY_ROOT}" "${SAFETY_DIR}"

pg_dump "${LOCAL_DB_URL}" --format=custom --file "${SAFETY_DIR}/database-before-restore.dump"
pg_restore --list "${SAFETY_DIR}/database-before-restore.dump" >/dev/null

STORAGE_TARGET="${LOCAL_STORAGE_DIR:-${COZE_WORKSPACE_PATH}/local-storage}"
if [ -e "${STORAGE_TARGET}" ]; then
  mkdir -p "${SAFETY_DIR}/storage-parent"
  cp -a "${STORAGE_TARGET}" "${SAFETY_DIR}/storage-parent/$(basename "${STORAGE_TARGET}")"
fi
STORAGE_PARENT="$(dirname "${STORAGE_TARGET}")"
STORAGE_NAME="$(basename "${STORAGE_TARGET}")"
PREVIOUS_STORAGE="${SAFETY_DIR}/${STORAGE_NAME}.previous"
STAGED_STORAGE="${TMP_DIR}/${STORAGE_NAME}.staged"
if [ -d "${TMP_DIR}/local-storage" ]; then
  rm -rf "${STAGED_STORAGE}"
  cp -a "${TMP_DIR}/local-storage" "${STAGED_STORAGE}"
fi

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f ".env.local" ]; then
  cp ".env.local" "${SAFETY_DIR}/.env.local.before-restore"
  chmod 600 "${SAFETY_DIR}/.env.local.before-restore"
fi

pg_restore --clean --if-exists --no-owner --single-transaction --dbname "${LOCAL_DB_URL}" "${TMP_DIR}/database.dump"

if [ -d "${TMP_DIR}/local-storage" ]; then
  mkdir -p "${STORAGE_PARENT}"
  if [ -e "${STORAGE_TARGET}" ]; then
    mv "${STORAGE_TARGET}" "${PREVIOUS_STORAGE}"
  fi
  if ! mv "${STAGED_STORAGE}" "${STORAGE_PARENT}/${STORAGE_NAME}"; then
    rm -rf "${STORAGE_PARENT:?}/${STORAGE_NAME}"
    if [ -e "${PREVIOUS_STORAGE}" ]; then
      mv "${PREVIOUS_STORAGE}" "${STORAGE_PARENT}/${STORAGE_NAME}"
    fi
    echo "Storage restore failed; previous storage was restored." >&2
    exit 1
  fi
fi

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f "${TMP_DIR}/.env.local" ]; then
  cp "${TMP_DIR}/.env.local" ".env.local.restore-next"
  mv ".env.local.restore-next" ".env.local"
  chmod 600 ".env.local"
fi

find "${SAFETY_ROOT}" -maxdepth 1 -type d -name 'pre-restore-*' \
  -printf '%T@ %p\n' | sort -rn | awk 'NR>10 {print $2}' | xargs -r rm -rf

echo "Restore completed from ${BACKUP_FILE}"
echo "Pre-restore safety backup: ${SAFETY_DIR}"
