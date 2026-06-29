#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="妙境 AI 创作平台"
APP_MARKER=".miaojing-deployment"
DEFAULT_PROJECT_DIR="/opt/miaojingAI"
DEFAULT_DATA_DIR="/var/lib/miaojingAI"
DEFAULT_WEB_PORT="5000"
DEFAULT_API_PORT="5100"
DEFAULT_CONSOLE_PORT="5200"
DEFAULT_ADMIN_ACCOUNT="admin"
DEFAULT_ADMIN_EMAIL="admin@example.com"
DEFAULT_DOMAIN=""
DEFAULT_NODE_MAJOR="24"
MIRRORS=(
  "https://registry.npmmirror.com"
  "https://registry.npmjs.org"
  "https://mirrors.cloud.tencent.com/npm/"
  "https://mirrors.huaweicloud.com/repository/npm/"
)
NODE_DIST_MIRRORS=(
  "https://npmmirror.com/mirrors/node"
  "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release"
  "https://mirrors.cloud.tencent.com/nodejs-release"
  "https://mirrors.huaweicloud.com/nodejs"
  "https://nodejs.org/dist"
)

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE=""
PROJECT_DIR=""
DATA_DIR=""
WEB_PORT=""
API_PORT=""
CONSOLE_PORT=""
ADMIN_ACCOUNT=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
LOCAL_DB_URL_INPUT=""
MODE=""
BACKUP_FILE=""
SERVER_HOST_IP=""
EXISTING_LOCAL_STORAGE_DIR=""
APP_PUBLIC_URL=""
NODE_MAJOR="${DEPLOY_NODE_MAJOR:-${DEFAULT_NODE_MAJOR}}"
NODE_INSTALL_ROOT="${DEPLOY_NODE_INSTALL_DIR:-}"
NODE_BIN_DIR=""
NODE_VERSION=""
NPM_BIN="npm"

log() {
  local message="$*"
  if [ -n "${LOG_FILE:-}" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${message}" | tee -a "${LOG_FILE}"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${message}"
  fi
}

log_pipe() {
  if [ -n "${LOG_FILE:-}" ]; then
    tee -a "${LOG_FILE}"
  else
    cat
  fi
}

fail() {
  local message="$*"
  echo
  echo "❌ 部署失败：${message}" | tee -a "${LOG_FILE:-/dev/null}" >&2
  if [ -n "${LOG_FILE:-}" ]; then
    echo "详细日志：${LOG_FILE}" >&2
  fi
  if [ -n "${BACKUP_FILE:-}" ]; then
    echo "已生成升级前备份：${BACKUP_FILE}" >&2
    echo "如需回滚，可在部署目录执行：pnpm backup:restore \"${BACKUP_FILE}\"" >&2
  fi
  exit 1
}

trap 'fail "脚本执行中断，请查看上方错误日志。"' ERR

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    fail "缺少命令 ${command_name}。${install_hint}"
  fi
}

prompt_value() {
  local var_name="$1"
  local label="$2"
  local default_value="$3"
  local value=""
  read -r -p "${label} [${default_value}]: " value
  printf -v "${var_name}" '%s' "${value:-$default_value}"
}

prompt_secret() {
  local var_name="$1"
  local label="$2"
  local value=""
  while [ -z "${value}" ]; do
    read -r -s -p "${label}: " value
    echo
    if [ -z "${value}" ]; then
      echo "该项不能为空，请重新输入。"
    fi
  done
  printf -v "${var_name}" '%s' "${value}"
}

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

env_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\\$}"
  value="${value//\`/\\\`}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "${value}"
}

env_get_value() {
  local key="$1"
  local file="$2"
  local line value
  if [ ! -f "${file}" ]; then
    return 1
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      "${key}="*)
        value="${line#*=}"
        value="${value%$'\r'}"
        if [[ "${value}" == \"*\" ]] && [[ "${value}" == *\" ]]; then
          value="${value:1:${#value}-2}"
          value="${value//\\\"/\"}"
          value="${value//\\\\/\\}"
        fi
        printf '%s\n' "${value}"
        return 0
        ;;
    esac
  done < "${file}"

  return 1
}

env_set_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  local quoted tmp_file
  quoted="$(env_quote "${value}")"
  tmp_file="$(mktemp)"

  if [ -f "${file}" ]; then
    awk -v key="${key}" -v replacement="${key}=${quoted}" '
      BEGIN { found = 0 }
      $0 ~ "^" key "=" {
        if (found == 0) print replacement
        found = 1
        next
      }
      { print }
      END {
        if (found == 0) print replacement
      }
    ' "${file}" > "${tmp_file}"
  else
    printf '%s=%s\n' "${key}" "${quoted}" > "${tmp_file}"
  fi

  mv "${tmp_file}" "${file}"
}

js_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  value="${value//$'\n'/\\n}"
  printf "'%s'" "${value}"
}

detect_host_ip() {
  SERVER_HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  SERVER_HOST_IP="${SERVER_HOST_IP:-127.0.0.1}"
}

prepend_node_path() {
  if [ -n "${NODE_BIN_DIR:-}" ] && [ -d "${NODE_BIN_DIR}" ]; then
    case ":${PATH}:" in
      *":${NODE_BIN_DIR}:"*) ;;
      *) export PATH="${NODE_BIN_DIR}:${PATH}" ;;
    esac
    NPM_BIN="${NODE_BIN_DIR}/npm"
  else
    NPM_BIN="npm"
  fi
}

node_major_version() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0'
}

node_version_matches_target() {
  command -v node >/dev/null 2>&1 && [ "$(node_major_version)" = "${NODE_MAJOR}" ]
}

node_platform_arch() {
  local machine
  machine="$(uname -m)"
  case "${machine}" in
    x86_64|amd64)
      printf 'linux-x64'
      ;;
    aarch64|arm64)
      printf 'linux-arm64'
      ;;
    *)
      fail "暂不支持当前 CPU 架构：${machine}。部署脚本支持 x86_64/amd64 和 arm64/aarch64。"
      ;;
  esac
}

detect_latest_node_version() {
  local mirror="$1"
  curl -fsSL "${mirror}/index.json" \
    | sed -n "s/.*\"version\"[[:space:]]*:[[:space:]]*\"\\(v${NODE_MAJOR}\\.[0-9][^\"]*\\)\".*/\\1/p" \
    | head -n 1
}

install_node_from_mirrors() {
  local platform_arch version mirror archive_url tmp_dir archive install_dir node_bin
  platform_arch="$(node_platform_arch)"
  NODE_INSTALL_ROOT="${NODE_INSTALL_ROOT:-${DATA_DIR}/node}"

  mkdir -p "${NODE_INSTALL_ROOT}"
  tmp_dir="$(mktemp -d)"

  for mirror in "${NODE_DIST_MIRRORS[@]}"; do
    log "尝试从 Node.js 镜像源获取 ${NODE_MAJOR}.x LTS：${mirror}"
    version="$(NODE_MAJOR="${NODE_MAJOR}" detect_latest_node_version "${mirror}" || true)"
    if [ -z "${version}" ]; then
      log "当前镜像源未获取到 Node.js ${NODE_MAJOR}.x 版本索引，切换下一个源。"
      continue
    fi

    archive="node-${version}-${platform_arch}.tar.xz"
    archive_url="${mirror}/${version}/${archive}"
    log "准备下载 Node.js ${version}：${archive_url}"
    if ! curl -fL --retry 2 --connect-timeout 15 -o "${tmp_dir}/${archive}" "${archive_url}" 2>&1 | log_pipe; then
      log "Node.js 下载失败，切换下一个镜像源。"
      continue
    fi

    install_dir="${NODE_INSTALL_ROOT}/node-${version}-${platform_arch}"
    rm -rf "${install_dir}"
    mkdir -p "${install_dir}"
    tar -xJf "${tmp_dir}/${archive}" -C "${NODE_INSTALL_ROOT}"
    NODE_BIN_DIR="${install_dir}/bin"
    node_bin="${NODE_BIN_DIR}/node"
    if [ -x "${node_bin}" ]; then
      prepend_node_path
      NODE_VERSION="$("${node_bin}" -v)"
      log "Node.js ${NODE_VERSION} 安装完成，路径：${NODE_BIN_DIR}"
      rm -rf "${tmp_dir}"
      return 0
    fi
  done

  rm -rf "${tmp_dir}"
  return 1
}

ensure_node_runtime() {
  if ! [[ "${NODE_MAJOR}" =~ ^(22|24)$ ]]; then
    fail "DEPLOY_NODE_MAJOR 只允许设置为 22 或 24，当前值：${NODE_MAJOR}"
  fi

  if node_version_matches_target; then
    NODE_VERSION="$(node -v)"
    log "Node.js 版本符合生产要求：${NODE_VERSION}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    log "当前 Node.js 版本为 $(node -v)，将自动安装并切换到 Node.js ${NODE_MAJOR}.x LTS。"
  else
    log "未检测到 Node.js，将自动安装 Node.js ${NODE_MAJOR}.x LTS。"
  fi

  install_node_from_mirrors || fail "Node.js ${NODE_MAJOR}.x LTS 自动安装失败，请检查网络或手动安装后重试。"

  if ! node_version_matches_target; then
    fail "Node.js 已安装但版本校验失败，当前版本：$(node -v 2>/dev/null || printf '未检测到')"
  fi
}

normalize_data_dir_from_storage() {
  local storage_dir="$1"
  if [ -z "${storage_dir}" ]; then
    return 1
  fi

  storage_dir="$(realpath -m "${storage_dir}")"
  if [ "$(basename "${storage_dir}")" = "storage" ]; then
    dirname "${storage_dir}"
  else
    printf '%s\n' "${storage_dir}"
  fi
}

read_marker_value() {
  local key="$1"
  local file="$2"
  local marker_key marker_value
  if [ ! -f "${file}" ]; then
    return 1
  fi

  while IFS='=' read -r marker_key marker_value; do
    if [ "${marker_key}" = "${key}" ]; then
      printf '%s\n' "${marker_value}"
      return 0
    fi
  done < "${file}"

  return 1
}

detect_existing_deployment() {
  if [ -f "${PROJECT_DIR}/package.json" ] && { [ -f "${PROJECT_DIR}/${APP_MARKER}" ] || [ -f "${PROJECT_DIR}/.env.local" ]; }; then
    MODE="upgrade"
  else
    MODE="install"
  fi
}

load_existing_defaults() {
  local marker_data_dir=""
  if [ -f "${PROJECT_DIR}/${APP_MARKER}" ]; then
    marker_data_dir="$(read_marker_value "data_dir" "${PROJECT_DIR}/${APP_MARKER}" || true)"
  fi

  if [ -f "${PROJECT_DIR}/.env.local" ]; then
    # shellcheck disable=SC1090
    set +u; set -a; source "${PROJECT_DIR}/.env.local"; set +a; set -u
    if [ -n "${LOCAL_STORAGE_DIR:-}" ]; then
      EXISTING_LOCAL_STORAGE_DIR="$(realpath -m "${LOCAL_STORAGE_DIR}")"
      DATA_DIR="$(normalize_data_dir_from_storage "${LOCAL_STORAGE_DIR}")"
    elif [ -n "${BACKUP_DIR:-}" ]; then
      DATA_DIR="$(dirname "$(realpath -m "${BACKUP_DIR}")")"
    elif [ -n "${marker_data_dir}" ]; then
      DATA_DIR="${marker_data_dir}"
    fi
    LOCAL_DB_URL_INPUT="${LOCAL_DB_URL:-${LOCAL_DB_URL_INPUT:-postgresql://postgres:postgres@localhost:5432/miaojing}}"
    WEB_PORT="${DEPLOY_RUN_PORT:-${WEB_PORT:-$DEFAULT_WEB_PORT}}"
    API_PORT="${MIAOJING_API_PORT:-${API_PORT:-$DEFAULT_API_PORT}}"
    CONSOLE_PORT="${MIAOJING_CONSOLE_PORT:-${CONSOLE_PORT:-$DEFAULT_CONSOLE_PORT}}"
    ADMIN_EMAIL="${ADMIN_EMAIL:-${DEFAULT_ADMIN_EMAIL}}"
  elif [ -n "${marker_data_dir}" ]; then
    DATA_DIR="${marker_data_dir}"
  fi

  if [ -z "${APP_PUBLIC_URL}" ] && [ -f "${PROJECT_DIR}/.env.local" ]; then
    APP_PUBLIC_URL="$(env_get_value "NEXT_PUBLIC_APP_URL" "${PROJECT_DIR}/.env.local" || true)"
  fi
  if [ -z "${APP_PUBLIC_URL}" ] && [ -f "${PROJECT_DIR}/.env.local" ]; then
    APP_PUBLIC_URL="$(env_get_value "APP_BASE_URL" "${PROJECT_DIR}/.env.local" || true)"
  fi

  if [ -z "${EXISTING_LOCAL_STORAGE_DIR}" ] && [ -d "${PROJECT_DIR}/local-storage" ]; then
    EXISTING_LOCAL_STORAGE_DIR="$(realpath -m "${PROJECT_DIR}/local-storage")"
  elif [ -z "${EXISTING_LOCAL_STORAGE_DIR}" ] && [ -n "${marker_data_dir}" ] && [ -d "${marker_data_dir}/storage" ]; then
    EXISTING_LOCAL_STORAGE_DIR="$(realpath -m "${marker_data_dir}/storage")"
  fi
}

validate_port() {
  local label="$1"
  local value="$2"
  if ! [[ "${value}" =~ ^[0-9]+$ ]] || [ "${value}" -lt 1 ] || [ "${value}" -gt 65535 ]; then
    fail "${label}必须是 1-65535 之间的数字。"
  fi
}

validate_inputs() {
  validate_port "前端访问端口" "${WEB_PORT}"
  validate_port "后端 API 内部端口" "${API_PORT}"
  validate_port "管理后台内部端口" "${CONSOLE_PORT}"

  if [ "${WEB_PORT}" = "${API_PORT}" ] || [ "${WEB_PORT}" = "${CONSOLE_PORT}" ] || [ "${API_PORT}" = "${CONSOLE_PORT}" ]; then
    fail "前端、后端 API、管理后台端口不能重复。"
  fi

  if [ -z "${ADMIN_ACCOUNT}" ] || [ -z "${ADMIN_EMAIL}" ]; then
    fail "管理员账号和管理员邮箱不能为空。"
  fi

  if ! [[ "${ADMIN_EMAIL}" =~ ^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$ ]]; then
    fail "管理员邮箱格式不正确。"
  fi

  if [ -z "${LOCAL_DB_URL_INPUT}" ]; then
    fail "PostgreSQL 连接地址不能为空。"
  fi

  if [ -n "${APP_PUBLIC_URL}" ] && ! [[ "${APP_PUBLIC_URL}" =~ ^https?://[^[:space:]]+$ ]]; then
    fail "正式访问地址必须是 http:// 或 https:// 开头的完整地址。"
  fi

  if [ "${MODE}" = "install" ] && [ "${ADMIN_PASSWORD}" = "admin123" ]; then
    fail "生产环境不允许使用默认管理员密码 admin123，请设置高强度密码。"
  fi
}

collect_inputs() {
  echo "=============================================="
  echo "${APP_NAME} 一键部署/升级脚本"
  echo "=============================================="
  echo "请按提示填写部署参数。直接回车将使用默认值。"
  echo

  prompt_value PROJECT_DIR "项目部署目录" "${DEPLOY_PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"
  PROJECT_DIR="$(realpath -m "${PROJECT_DIR}")"
  DATA_DIR="${DEPLOY_DATA_DIR:-$DEFAULT_DATA_DIR}"
  WEB_PORT="${DEPLOY_WEB_PORT:-$DEFAULT_WEB_PORT}"
  API_PORT="${DEPLOY_API_PORT:-$DEFAULT_API_PORT}"
  CONSOLE_PORT="${DEPLOY_CONSOLE_PORT:-$DEFAULT_CONSOLE_PORT}"
  ADMIN_ACCOUNT="${DEPLOY_ADMIN_ACCOUNT:-$DEFAULT_ADMIN_ACCOUNT}"
  ADMIN_EMAIL="${DEPLOY_ADMIN_EMAIL:-$DEFAULT_ADMIN_EMAIL}"
  LOCAL_DB_URL_INPUT="${DEPLOY_LOCAL_DB_URL:-postgresql://postgres:postgres@localhost:5432/miaojing}"

  detect_existing_deployment
  load_existing_defaults

  if [ "${MODE}" = "install" ]; then
    echo
    echo "检测结果：目标目录未部署项目，将执行首次部署流程。"
  else
    echo
    echo "检测结果：目标目录已存在部署，将执行安全升级流程。"
  fi

  prompt_value DATA_DIR "数据存储目录" "${DATA_DIR}"
  DATA_DIR="$(realpath -m "${DATA_DIR}")"
  prompt_value WEB_PORT "前端访问端口" "${WEB_PORT}"
  prompt_value API_PORT "后端 API 内部端口" "${API_PORT}"
  prompt_value CONSOLE_PORT "管理后台内部端口" "${CONSOLE_PORT}"
  prompt_value ADMIN_ACCOUNT "管理员账号/昵称" "${ADMIN_ACCOUNT}"
  prompt_value ADMIN_EMAIL "管理员邮箱" "${ADMIN_EMAIL}"
  prompt_value APP_PUBLIC_URL "正式访问地址（有域名请填 https://域名，留空则使用服务器IP和端口）" "${APP_PUBLIC_URL:-$DEFAULT_DOMAIN}"

  if [ "${MODE}" = "install" ]; then
    prompt_secret ADMIN_PASSWORD "管理员密码"
    prompt_value LOCAL_DB_URL_INPUT "PostgreSQL 连接地址" "${LOCAL_DB_URL_INPUT}"
  else
    read -r -s -p "管理员密码（升级时可留空表示不修改）: " ADMIN_PASSWORD
    echo
    prompt_value LOCAL_DB_URL_INPUT "PostgreSQL 连接地址" "${LOCAL_DB_URL_INPUT}"
  fi

  validate_inputs
}

prepare_log() {
  mkdir -p "${DATA_DIR}/logs"
  LOG_FILE="${DATA_DIR}/logs/deploy-$(date +%Y%m%d-%H%M%S).log"
  touch "${LOG_FILE}"
  chmod 600 "${LOG_FILE}"
  log "日志文件：${LOG_FILE}"
}

check_prerequisites() {
  log "检查运行依赖..."
  require_command tar "请安装 tar。"
  require_command rsync "请安装 rsync。"
  require_command curl "请安装 curl。"
  ensure_node_runtime
  prepend_node_path
  require_command node "Node.js 自动安装后仍不可用，请检查 PATH。"
  require_command npm "Node.js 自动安装后 npm 仍不可用，请检查 Node.js 安装包。"
  require_command psql "请安装 PostgreSQL 客户端，例如 postgresql-client。"
  require_command pg_dump "请安装 PostgreSQL 客户端，例如 postgresql-client。"

  log "当前使用 Node.js：$(node -v)，npm：$(npm -v)"

  if ! command -v pnpm >/dev/null 2>&1; then
    log "未检测到 pnpm，准备通过 npm 安装 pnpm@9..."
    install_pnpm
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    log "未检测到 pm2，准备通过 npm 安装 pm2..."
    install_pm2
  fi
}

npm_install_global_with_mirrors() {
  local package_name="$1"
  local mirror
  for mirror in "${MIRRORS[@]}"; do
    log "尝试使用镜像源安装 ${package_name}：${mirror}"
    if "${NPM_BIN}" --registry="${mirror}" install -g "${package_name}" 2>&1 | log_pipe; then
      log "${package_name} 安装成功。"
      return 0
    fi
    log "镜像源不可用或安装失败，切换下一个源。"
  done
  return 1
}

install_pnpm() {
  npm_install_global_with_mirrors "pnpm@9" || fail "pnpm 安装失败，请检查网络或手动安装。"
}

install_pm2() {
  npm_install_global_with_mirrors "pm2" || fail "pm2 安装失败，请检查网络或手动安装。"
}

install_dependencies_with_mirrors() {
  local mirror
  for mirror in "${MIRRORS[@]}"; do
    log "尝试使用依赖镜像源：${mirror}"
    pnpm config set registry "${mirror}" >/dev/null 2>&1 || true
    if pnpm install --frozen-lockfile --prod=false --reporter=append-only 2>&1 | log_pipe; then
      log "依赖安装成功，使用源：${mirror}"
      return 0
    fi
    log "依赖安装失败，切换下一个镜像源。"
  done
  fail "所有依赖镜像源均安装失败，请检查网络。"
}

sync_project_files() {
  if [ "${SOURCE_DIR}" = "${PROJECT_DIR}" ]; then
    log "源码目录与部署目录一致，跳过代码同步。"
    return 0
  fi

  log "同步项目代码到部署目录：${PROJECT_DIR}"
  mkdir -p "${PROJECT_DIR}"
  rsync -a --delete \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude ".next" \
    --exclude "dist" \
    --exclude "backups" \
    --exclude "/local-storage" \
    --exclude ".env.local" \
    --exclude ".codex_tmp" \
    "${SOURCE_DIR}/" "${PROJECT_DIR}/" 2>&1 | log_pipe
}

migrate_local_storage() {
  if [ "${MODE}" != "upgrade" ]; then
    return 0
  fi

  local target_storage="${DATA_DIR}/storage"
  if [ -z "${EXISTING_LOCAL_STORAGE_DIR}" ] || [ ! -d "${EXISTING_LOCAL_STORAGE_DIR}" ]; then
    log "未检测到旧版本地存储目录，跳过本地存储迁移。"
    return 0
  fi

  if [ "$(realpath -m "${EXISTING_LOCAL_STORAGE_DIR}")" = "$(realpath -m "${target_storage}")" ]; then
    log "本地存储目录未变化，跳过迁移：${target_storage}"
    return 0
  fi

  log "同步旧本地存储到新的持久化目录：${EXISTING_LOCAL_STORAGE_DIR} -> ${target_storage}"
  mkdir -p "${target_storage}"
  rsync -a "${EXISTING_LOCAL_STORAGE_DIR}/" "${target_storage}/" 2>&1 | log_pipe
}

write_env_file() {
  local env_file encryption_key jwt_secret generation_secret invite_code admin_default_password app_base_url existing_admin_password
  env_file="${PROJECT_DIR}/.env.local"
  encryption_key="$(env_get_value "DATA_ENCRYPTION_KEY" "${env_file}" || random_hex)"
  jwt_secret="$(env_get_value "JWT_SECRET" "${env_file}" || random_hex)"
  generation_secret="$(env_get_value "GENERATION_INTERNAL_SECRET" "${env_file}" || random_hex)"
  invite_code="$(env_get_value "ADMIN_INVITE_CODE" "${env_file}" || true)"
  invite_code="${invite_code:-miaojing-admin-$(random_hex | cut -c1-8)}"
  existing_admin_password="$(env_get_value "ADMIN_DEFAULT_PASSWORD" "${env_file}" || true)"
  admin_default_password="${ADMIN_PASSWORD:-${existing_admin_password}}"
  app_base_url="${APP_PUBLIC_URL:-http://${SERVER_HOST_IP}:${WEB_PORT}}"

  mkdir -p "${DATA_DIR}/storage" "${DATA_DIR}/backups"

  if [ ! -f "${env_file}" ]; then
    cat > "${env_file}" <<EOF
# ${APP_NAME} 生产环境配置
EOF
  fi

  env_set_value "LOCAL_DB_URL" "${LOCAL_DB_URL_INPUT}" "${env_file}"
  env_set_value "LOCAL_DB_ANON_KEY" "$(env_get_value "LOCAL_DB_ANON_KEY" "${env_file}" || printf '%s' "local-anon-key")" "${env_file}"
  env_set_value "LOCAL_DB_SERVICE_ROLE_KEY" "$(env_get_value "LOCAL_DB_SERVICE_ROLE_KEY" "${env_file}" || printf '%s' "local-service-role-key")" "${env_file}"
  env_set_value "LOCAL_STORAGE_DIR" "${DATA_DIR}/storage" "${env_file}"
  env_set_value "BACKUP_DIR" "${DATA_DIR}/backups" "${env_file}"
  env_set_value "DEPLOY_RUN_PORT" "${WEB_PORT}" "${env_file}"
  env_set_value "MIAOJING_API_PORT" "${API_PORT}" "${env_file}"
  env_set_value "MIAOJING_CONSOLE_PORT" "${CONSOLE_PORT}" "${env_file}"
  env_set_value "ADMIN_INVITE_CODE" "${invite_code}" "${env_file}"
  env_set_value "ADMIN_DEFAULT_PASSWORD" "${admin_default_password}" "${env_file}"
  env_set_value "DATA_ENCRYPTION_KEY" "${encryption_key}" "${env_file}"
  env_set_value "JWT_SECRET" "${jwt_secret}" "${env_file}"
  env_set_value "GENERATION_INTERNAL_SECRET" "${generation_secret}" "${env_file}"
  env_set_value "COZE_PROJECT_ENV" "PROD" "${env_file}"
  env_set_value "NODE_ENV" "production" "${env_file}"
  env_set_value "APP_BIND_HOST" "$(env_get_value "APP_BIND_HOST" "${env_file}" || printf '%s' "127.0.0.1")" "${env_file}"
  env_set_value "NEXT_PUBLIC_APP_URL" "${app_base_url}" "${env_file}"
  env_set_value "APP_BASE_URL" "${app_base_url}" "${env_file}"
  env_set_value "ENABLE_DANGER_ADMIN_CLEAR_USERS" "$(env_get_value "ENABLE_DANGER_ADMIN_CLEAR_USERS" "${env_file}" || printf '%s' "false")" "${env_file}"
  env_set_value "DB_POOL_MAX" "$(env_get_value "DB_POOL_MAX" "${env_file}" || printf '%s' "20")" "${env_file}"
  env_set_value "DB_CONNECTION_TIMEOUT_MS" "$(env_get_value "DB_CONNECTION_TIMEOUT_MS" "${env_file}" || printf '%s' "5000")" "${env_file}"
  env_set_value "DB_IDLE_TIMEOUT_MS" "$(env_get_value "DB_IDLE_TIMEOUT_MS" "${env_file}" || printf '%s' "30000")" "${env_file}"
  env_set_value "HTTP_REQUEST_TIMEOUT_MS" "$(env_get_value "HTTP_REQUEST_TIMEOUT_MS" "${env_file}" || printf '%s' "190000")" "${env_file}"
  env_set_value "HTTP_HEADERS_TIMEOUT_MS" "$(env_get_value "HTTP_HEADERS_TIMEOUT_MS" "${env_file}" || printf '%s' "65000")" "${env_file}"
  env_set_value "HTTP_KEEP_ALIVE_TIMEOUT_MS" "$(env_get_value "HTTP_KEEP_ALIVE_TIMEOUT_MS" "${env_file}" || printf '%s' "5000")" "${env_file}"
  env_set_value "HTTP_MAX_HEADERS_COUNT" "$(env_get_value "HTTP_MAX_HEADERS_COUNT" "${env_file}" || printf '%s' "200")" "${env_file}"
  env_set_value "DEPLOY_NODE_MAJOR" "${NODE_MAJOR}" "${env_file}"
  if [ -n "${NODE_BIN_DIR:-}" ]; then
    env_set_value "DEPLOY_NODE_BIN_DIR" "${NODE_BIN_DIR}" "${env_file}"
  fi

  chmod 600 "${env_file}"
  log "已写入环境配置：${env_file}（保留原有非部署配置项）"
}

write_ecosystem_file() {
  local npm_path pm2_path
  npm_path="$(command -v npm)"
  pm2_path="${PATH}"
  cat > "${PROJECT_DIR}/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [
    {
      name: 'miaojing-api',
      cwd: $(js_quote "${PROJECT_DIR}"),
      script: $(js_quote "${npm_path}"),
      args: 'run start',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        COZE_PROJECT_ENV: 'PROD',
        APP_RUNTIME_ROLE: 'backend',
        DEPLOY_RUN_PORT: '${API_PORT}',
        DEPLOY_NODE_BIN_DIR: $(js_quote "${NODE_BIN_DIR:-}"),
        PATH: $(js_quote "${pm2_path}"),
      },
    },
    {
      name: 'miaojing-web',
      cwd: $(js_quote "${PROJECT_DIR}"),
      script: $(js_quote "${npm_path}"),
      args: 'run start',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        COZE_PROJECT_ENV: 'PROD',
        APP_RUNTIME_ROLE: 'frontend',
        BACKEND_INTERNAL_URL: 'http://127.0.0.1:${API_PORT}',
        CONSOLE_INTERNAL_URL: 'http://127.0.0.1:${CONSOLE_PORT}',
        DEPLOY_RUN_PORT: '${WEB_PORT}',
        DEPLOY_NODE_BIN_DIR: $(js_quote "${NODE_BIN_DIR:-}"),
        PATH: $(js_quote "${pm2_path}"),
      },
    },
    {
      name: 'miaojing-console',
      cwd: $(js_quote "${PROJECT_DIR}"),
      script: $(js_quote "${npm_path}"),
      args: 'run start',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        COZE_PROJECT_ENV: 'PROD',
        APP_RUNTIME_ROLE: 'console',
        DEPLOY_RUN_PORT: '${CONSOLE_PORT}',
        DEPLOY_NODE_BIN_DIR: $(js_quote "${NODE_BIN_DIR:-}"),
        PATH: $(js_quote "${pm2_path}"),
      },
    },
  ],
};
EOF
  log "已生成 PM2 配置。"
}

backup_before_upgrade() {
  if [ "${MODE}" != "upgrade" ]; then
    return 0
  fi

  log "升级前开始备份数据库、环境配置和本地存储..."
  cd "${PROJECT_DIR}"
  mkdir -p "${DATA_DIR}/backups"

  if [ -f "${PROJECT_DIR}/.env.local" ]; then
    set +u; set -a
    # shellcheck disable=SC1091
    source "${PROJECT_DIR}/.env.local"
    set +a; set -u
  fi

  if [ -f "${SOURCE_DIR}/scripts/backup-create.sh" ]; then
    LOCAL_DB_URL="${LOCAL_DB_URL:-$LOCAL_DB_URL_INPUT}" BACKUP_DIR="${DATA_DIR}/backups" COZE_WORKSPACE_PATH="${PROJECT_DIR}" \
      bash "${SOURCE_DIR}/scripts/backup-create.sh" 2>&1 | log_pipe > "${DATA_DIR}/logs/.last-backup-path"
    BACKUP_FILE="$(tail -n 1 "${DATA_DIR}/logs/.last-backup-path" || true)"
    log "升级前备份完成：${BACKUP_FILE}"
  else
    log "未找到旧版备份脚本，执行基础文件备份。"
    BACKUP_FILE="${DATA_DIR}/backups/miaojing-files-$(date +%Y%m%d-%H%M%S).tar.gz"
    if [ -d "${DATA_DIR}/storage" ]; then
      tar -czf "${BACKUP_FILE}" -C "${PROJECT_DIR}" .env.local -C "${DATA_DIR}" storage
    else
      tar -czf "${BACKUP_FILE}" -C "${PROJECT_DIR}" .env.local
    fi
    log "基础备份完成：${BACKUP_FILE}"
  fi
}

initialize_database() {
  log "检查数据库连接..."
  psql "${LOCAL_DB_URL_INPUT}" -v ON_ERROR_STOP=1 -c "SELECT 1;" >/dev/null

  log "执行数据库结构初始化/升级 SQL（幂等，不会删除用户数据）..."
  psql "${LOCAL_DB_URL_INPUT}" -v ON_ERROR_STOP=1 -f "${PROJECT_DIR}/scripts/init-database.sql" 2>&1 | log_pipe

  if [ -f "${PROJECT_DIR}/scripts/database-optimization-patch.sql" ]; then
    psql "${LOCAL_DB_URL_INPUT}" -v ON_ERROR_STOP=1 -f "${PROJECT_DIR}/scripts/database-optimization-patch.sql" 2>&1 | log_pipe
  fi

  apply_runtime_schema_patch
}

apply_runtime_schema_patch() {
  log "补齐生产运行所需的动态配置表..."
  psql "${LOCAL_DB_URL_INPUT}" -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | log_pipe
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE 'CREATE FUNCTION auth.uid() RETURNS UUID AS $fn$ SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::UUID; $fn$ LANGUAGE SQL STABLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'role'
  ) THEN
    EXECUTE 'CREATE FUNCTION auth.role() RETURNS TEXT AS $fn$ SELECT COALESCE(NULLIF(current_setting(''request.jwt.claim.role'', true), ''''), ''anon''); $fn$ LANGUAGE SQL STABLE';
  END IF;
END $$;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_nickname VARCHAR(128),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_bound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_sender_domain VARCHAR(255),
  ADD COLUMN IF NOT EXISTS preferred_theme VARCHAR(16) NOT NULL DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS watermark_disabled BOOLEAN NOT NULL DEFAULT false;

UPDATE profiles
   SET display_nickname = COALESCE(NULLIF(display_nickname, ''), NULLIF(nickname, ''), split_part(email, '@', 1))
 WHERE display_nickname IS NULL OR display_nickname = '';

UPDATE profiles
   SET preferred_theme = 'dark'
 WHERE preferred_theme IS NULL
    OR preferred_theme NOT IN ('dark', 'light');

ALTER TABLE site_config
  ADD COLUMN IF NOT EXISTS site_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS site_keywords TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS announcement TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS membership_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS terms_of_service TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS privacy_policy TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS about_us TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS help_center TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS filing_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS filing_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_security_filing_info TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_security_filing_url TEXT NOT NULL DEFAULT '';

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'site';

ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(128);
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'image';

CREATE TABLE IF NOT EXISTS redeem_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) NOT NULL UNIQUE,
  normalized_code VARCHAR(64) NOT NULL UNIQUE,
  code_type VARCHAR(16) NOT NULL DEFAULT 'credits',
  credits_amount INTEGER NOT NULL DEFAULT 0,
  membership_tier VARCHAR(32),
  membership_duration_value INTEGER,
  membership_duration_unit VARCHAR(16),
  batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
  note VARCHAR(255) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  used_by UUID,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS code_type VARCHAR(16) NOT NULL DEFAULT 'credits';
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS membership_tier VARCHAR(32);
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS membership_duration_value INTEGER;
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS membership_duration_unit VARCHAR(16);
ALTER TABLE redeem_codes ALTER COLUMN credits_amount SET DEFAULT 0;
ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_credits_amount_check;
ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_payload_check;
ALTER TABLE redeem_codes
  ADD CONSTRAINT redeem_codes_payload_check CHECK (
    (code_type = 'credits' AND credits_amount > 0)
    OR (
      code_type = 'membership'
      AND credits_amount >= 0
      AND membership_tier IN ('pro', 'max', 'ultra', 'enterprise')
      AND membership_duration_value > 0
      AND membership_duration_unit IN ('day', 'month', 'year')
    )
  );
CREATE INDEX IF NOT EXISTS redeem_codes_created_at_idx ON redeem_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS redeem_codes_batch_id_idx ON redeem_codes (batch_id);
CREATE INDEX IF NOT EXISTS redeem_codes_used_by_idx ON redeem_codes (used_by);
CREATE INDEX IF NOT EXISTS redeem_codes_status_idx ON redeem_codes (is_active, used_at);
CREATE INDEX IF NOT EXISTS redeem_codes_type_idx ON redeem_codes (code_type);

CREATE TABLE IF NOT EXISTS system_api_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(128),
  name VARCHAR(255) NOT NULL,
  api_url TEXT NOT NULL DEFAULT '',
  model_name VARCHAR(255) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  manifest_path TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT true,
  allowed_membership_tiers JSONB NOT NULL DEFAULT '["free","pro","max","ultra"]'::jsonb,
  polling_mode VARCHAR(16) NOT NULL DEFAULT 'sequential',
  polling_order INTEGER NOT NULL DEFAULT 0,
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  api_key_preview VARCHAR(64) NOT NULL DEFAULT '',
  type VARCHAR(16) NOT NULL DEFAULT 'image',
  credits_per_use INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS system_api_configs_active_type_sort_idx ON system_api_configs (is_active, type, sort_order);
CREATE INDEX IF NOT EXISTS system_api_configs_default_sort_idx ON system_api_configs (is_default, is_active, sort_order);
CREATE INDEX IF NOT EXISTS system_api_configs_polling_idx ON system_api_configs (type, model_name, is_default, is_active, polling_order, sort_order);

CREATE TABLE IF NOT EXISTS payment_methods (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  public_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_config_encrypted JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_config_preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
INSERT INTO payment_methods (id, type, name, is_active) VALUES
  ('pm-alipay', 'alipay', '支付宝', true),
  ('pm-wechat', 'wechat', '微信支付', false),
  ('pm-manual', 'manual', '手动转账', false),
  ('pm-stripe', 'stripe', 'Stripe', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS provider VARCHAR(128);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS model_name VARCHAR(255);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS api_url TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS generation_jobs_user_created_idx ON generation_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_jobs_provider_model_created_idx ON generation_jobs (type, provider, model_name, created_at DESC);

CREATE TABLE IF NOT EXISTS model_call_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  source VARCHAR(64) NOT NULL DEFAULT '',
  operation VARCHAR(64) NOT NULL DEFAULT '',
  generation_job_id UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'text',
  provider VARCHAR(128) NOT NULL DEFAULT '',
  model_name VARCHAR(255) NOT NULL DEFAULT '',
  api_url TEXT NOT NULL DEFAULT '',
  system_api_id UUID,
  custom_api_key_id UUID,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  credits_cost INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS source VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS operation VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS generation_job_id UUID;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'text';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS provider VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS model_name VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS api_url TEXT NOT NULL DEFAULT '';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS system_api_id UUID;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS custom_api_key_id UUID;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'queued';
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS credits_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS result_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE model_call_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS model_call_records_generation_job_uidx
  ON model_call_records (generation_job_id)
  WHERE generation_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS model_call_records_created_idx ON model_call_records (created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_user_created_idx ON model_call_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_status_created_idx ON model_call_records (status, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_model_created_idx ON model_call_records (type, provider, model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_source_created_idx ON model_call_records (source, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_system_api_idx ON model_call_records (system_api_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_call_records_custom_api_idx ON model_call_records (custom_api_key_id, created_at DESC);

ALTER TABLE site_config ADD COLUMN IF NOT EXISTS log_retention_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE site_config ADD COLUMN IF NOT EXISTS image_composition_skill_enabled BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE site_config SET log_retention_days = LEAST(90, GREATEST(1, log_retention_days));

CREATE TABLE IF NOT EXISTS platform_log_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  retention_days INTEGER NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_log_settings (id, retention_days)
VALUES (1, 30)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL DEFAULT 'info',
  action VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  target_type VARCHAR(64),
  target_id VARCHAR(255),
  ip_address VARCHAR(64),
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS platform_logs_type_created_idx ON platform_logs (type, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_level_created_idx ON platform_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_user_created_idx ON platform_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_created_idx ON platform_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_logs_user_name_idx ON platform_logs (LOWER(COALESCE(user_name, '')));
CREATE INDEX IF NOT EXISTS platform_logs_user_email_idx ON platform_logs (LOWER(COALESCE(user_email, '')));

CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  smtp_host VARCHAR(255),
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_user VARCHAR(255),
  smtp_password_encrypted TEXT,
  smtp_password_preview VARCHAR(64),
  from_email VARCHAR(255),
  from_name VARCHAR(255),
  reply_to VARCHAR(255),
  app_name VARCHAR(120),
  app_base_url TEXT,
  logo_url TEXT,
  contact_email VARCHAR(255),
  copyright TEXT,
  code_length INTEGER NOT NULL DEFAULT 6,
  code_charset VARCHAR(32) NOT NULL DEFAULT 'alphanumeric',
  code_ttl_minutes INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  code_hash TEXT NOT NULL,
  type VARCHAR(32) NOT NULL,
  user_id UUID,
  ip_address VARCHAR(64),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  is_used BOOLEAN NOT NULL DEFAULT FALSE,
  locked_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_email_send_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode VARCHAR(32) NOT NULL,
  mail_kind VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'sending',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS email_send_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  recipient_user_id UUID,
  email VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  subject TEXT,
  ip_address VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_send_logs
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID,
  ADD COLUMN IF NOT EXISTS subject TEXT;

CREATE INDEX IF NOT EXISTS email_codes_email_type_idx ON email_verification_codes (LOWER(email), type, created_at DESC);
CREATE INDEX IF NOT EXISTS email_codes_ip_created_idx ON email_verification_codes (ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS email_send_logs_email_created_idx ON email_send_logs (LOWER(email), created_at DESC);
CREATE INDEX IF NOT EXISTS email_send_logs_ip_created_idx ON email_send_logs (ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS email_send_logs_batch_created_idx ON email_send_logs (batch_id, created_at DESC) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_email_send_batches_created_idx ON admin_email_send_batches (created_at DESC);
SQL
}

ensure_admin_user() {
  if [ -z "${ADMIN_PASSWORD:-}" ] && [ "${MODE}" = "upgrade" ]; then
    log "升级模式未输入管理员密码，跳过管理员密码更新。"
    return 0
  fi

  log "创建/更新管理员账号..."
  psql "${LOCAL_DB_URL_INPUT}" \
    -v ON_ERROR_STOP=1 \
    -v admin_email="${ADMIN_EMAIL}" \
    -v admin_account="${ADMIN_ACCOUNT}" \
    -v admin_password="${ADMIN_PASSWORD}" <<'SQL' 2>&1 | log_pipe
CREATE TEMP TABLE _deploy_admin_input (
  email TEXT NOT NULL,
  account TEXT NOT NULL,
  password TEXT NOT NULL
);

INSERT INTO _deploy_admin_input (email, account, password)
VALUES (:'admin_email', :'admin_account', :'admin_password');

DO $$
DECLARE
  r RECORD;
  v_admin_id UUID;
BEGIN
  SELECT * INTO r FROM _deploy_admin_input LIMIT 1;

  SELECT id INTO v_admin_id FROM profiles WHERE lower(email) = lower(r.email) LIMIT 1;
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM auth.users WHERE lower(email) = lower(r.email) LIMIT 1;
  END IF;
  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();
  END IF;

  INSERT INTO auth.users (id, email, password_hash, raw_user_meta_data, created_at)
  VALUES (
    v_admin_id,
    r.email,
    crypt(r.password, gen_salt('bf')),
    jsonb_build_object('nickname', r.account),
    NOW()
  )
  ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data;

  SELECT id INTO v_admin_id FROM auth.users WHERE lower(email) = lower(r.email) LIMIT 1;

  INSERT INTO profiles (
    id, email, nickname, display_nickname, role, membership_tier, credits_balance,
    daily_quota_limit, daily_quota_used, is_active,
    email_verified, email_verified_at, email_bound_at, email_sender_domain
  )
  VALUES (
    v_admin_id, r.email, r.account, r.account, 'admin', 'enterprise',
    9999, 999, 0, true, true, NOW(), NOW(), split_part(r.email, '@', 2)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nickname = EXCLUDED.nickname,
    display_nickname = COALESCE(NULLIF(profiles.display_nickname, ''), EXCLUDED.display_nickname),
    role = 'admin',
    membership_tier = 'enterprise',
    credits_balance = GREATEST(profiles.credits_balance, 9999),
    daily_quota_limit = GREATEST(profiles.daily_quota_limit, 999),
    is_active = true,
    email_verified = true,
    email_verified_at = COALESCE(profiles.email_verified_at, NOW()),
    email_bound_at = COALESCE(profiles.email_bound_at, NOW()),
    email_sender_domain = COALESCE(NULLIF(profiles.email_sender_domain, ''), EXCLUDED.email_sender_domain),
    updated_at = NOW();
END $$;
SQL
}

build_project() {
  log "开始安装依赖..."
  cd "${PROJECT_DIR}"
  install_dependencies_with_mirrors

  log "开始生产构建..."
  pnpm run check:boundaries 2>&1 | log_pipe
  pnpm run build 2>&1 | log_pipe
}

run_security_audit() {
  log "执行生产依赖漏洞扫描..."
  cd "${PROJECT_DIR}"
  local mirror audit_status
  audit_status=1

  for mirror in "${MIRRORS[@]}"; do
    log "尝试使用漏洞库源执行 pnpm audit：${mirror}"
    if pnpm audit --prod --audit-level=high --registry="${mirror}" 2>&1 | log_pipe; then
      audit_status=0
      break
    fi
    log "当前源审计失败或发现高危漏洞，继续尝试下一个源。"
  done

  if [ "${audit_status}" -ne 0 ]; then
    fail "生产依赖漏洞扫描未通过。请先处理 high/critical 级别漏洞后再上线。"
  fi

  if ! pnpm audit --prod --audit-level=moderate --registry="https://registry.npmjs.org" 2>&1 | log_pipe; then
    log "提醒：仍存在 moderate 级别漏洞。脚本不会阻断升级，但正式上线前建议升级相关依赖链并重新构建验证。"
  fi
}

start_services() {
  log "启动/重载 PM2 服务..."
  cd "${PROJECT_DIR}"
  pm2 startOrReload ecosystem.config.cjs --update-env 2>&1 | log_pipe
  pm2 save 2>&1 | log_pipe || true
}

wait_for_health() {
  log "等待服务启动并执行健康检查..."
  local api_url="http://127.0.0.1:${WEB_PORT}/api/health"
  local console_url="http://127.0.0.1:${WEB_PORT}/console"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS "${api_url}" >/dev/null 2>&1 && curl -fsS "${console_url}" >/dev/null 2>&1; then
      log "健康检查通过：前端、后端 API、管理后台均可访问。"
      return 0
    fi
    sleep 2
  done
  fail "健康检查失败，请检查 PM2 日志：pm2 logs miaojing-web"
}

mark_deployment() {
  cat > "${PROJECT_DIR}/${APP_MARKER}" <<EOF
deployed_at=$(date -Iseconds)
project_dir=${PROJECT_DIR}
data_dir=${DATA_DIR}
web_port=${WEB_PORT}
api_port=${API_PORT}
console_port=${CONSOLE_PORT}
EOF
}

print_success() {
  local mode_label
  mode_label="部署"
  if [ "${MODE}" = "upgrade" ]; then
    mode_label="升级"
  fi

  echo
  echo "=============================================="
  echo "✅ ${APP_NAME} ${mode_label}成功"
  echo "=============================================="
  echo "访问地址：http://${SERVER_HOST_IP}:${WEB_PORT}"
  echo "管理后台：http://${SERVER_HOST_IP}:${WEB_PORT}/console"
  echo "管理员账号：${ADMIN_ACCOUNT}"
  echo "管理员邮箱：${ADMIN_EMAIL}"
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    echo "管理员密码：${ADMIN_PASSWORD}"
  else
    echo "管理员密码：升级时未修改，请继续使用原密码"
  fi
  echo "项目目录：${PROJECT_DIR}"
  echo "数据目录：${DATA_DIR}"
  echo "日志文件：${LOG_FILE}"
  if [ -n "${BACKUP_FILE:-}" ]; then
    echo "升级前备份：${BACKUP_FILE}"
  fi
  echo "生产安全提醒：正式上线请通过 Nginx/HTTPS 访问，只开放 80/443/SSH，并禁止公网直连 ${API_PORT}/${CONSOLE_PORT}。"
  echo "=============================================="
}

main() {
  collect_inputs
  detect_host_ip
  prepare_log
  log "当前源码目录：${SOURCE_DIR}"
  log "执行模式：${MODE}"
  check_prerequisites
  backup_before_upgrade
  migrate_local_storage
  sync_project_files
  write_env_file
  write_ecosystem_file
  initialize_database
  ensure_admin_user
  build_project
  run_security_audit
  start_services
  wait_for_health
  mark_deployment
  print_success
}

main "$@"
