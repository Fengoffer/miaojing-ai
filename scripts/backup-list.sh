#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"
REQUESTED_BACKUP_DIR="${BACKUP_DIR:-}"

cd "${COZE_WORKSPACE_PATH}"

if [ "${MIAOJING_LOAD_ENV_FILE:-1}" != "0" ] && [ -f ".env.local" ]; then
  set +u
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
  set -u
fi

BACKUP_DIR="${REQUESTED_BACKUP_DIR:-${BACKUP_DIR:-${COZE_WORKSPACE_PATH}/backups}}"

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

if ! compgen -G "${BACKUP_DIR}/miaojing-backup-*.tar.gz" >/dev/null; then
  echo "No backups found in ${BACKUP_DIR}"
  exit 0
fi

printf '%-40s %-12s %s\n' "FILE" "SIZE" "MODIFIED"
find "${BACKUP_DIR}" -maxdepth 1 -name 'miaojing-backup-*.tar.gz' -type f \
  -printf '%T@ %f %s %TY-%Tm-%Td %TH:%TM\n' \
  | sort -rn \
  | awk '{printf "%-40s %-12s %s %s\n", $2, $3, $4, $5}'
