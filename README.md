# 妙境 AI 创作平台

妙境是一个面向个人创作者、内容团队和私有化部署场景的 AI 多模态创作平台。平台围绕“文生图、图生图、文生视频、图生视频、图片反推提示词”构建完整创作链路，提供用户体系、积分/会员、订单支付、作品历史、公开画廊、模型供应商管理、系统配置、数据备份和在线升级能力。

项目基于 Next.js App Router、React、PostgreSQL、本地文件存储和 PM2 运行，支持本地 PostgreSQL 部署，也兼容 Supabase 作为数据库/认证底座。AI 生成能力既支持系统默认供应商，也支持用户自定义 OpenAI/New API 兼容接口。

## 项目截图

以下截图来自开发服务器的真实页面，用于快速了解平台界面和核心工作流。

### 首页

![妙境首页](docs/images/home.png)

### 创作中心

![创作中心](docs/images/create.png)

### 作品画廊

![作品画廊](docs/images/gallery.png)

## 核心能力

### 创作能力

- 文生图：根据文本提示词生成图片，支持尺寸、比例、模型和提示词参数。
- 图生图：上传参考图后进行风格迁移、场景变换、细节重绘和创意延展。
- 文生视频：根据文字描述生成动态视频内容。
- 图生视频：基于静态图片生成动态视频。
- 图片反推提示词：从图片中提取提示词，支持普通提示词、复刻级像素提示词、像素级图生图、像素级文生图等模式。
- 生成任务队列：生成任务写入 `generation_jobs`，前端可轮询任务状态并从历史记录中查看结果。
- 作品管理：保存创作历史、生成参数、结果链接、尺寸、时长、消耗积分等信息。
- 画廊发布：用户可将作品公开到画廊，支持点赞、复制提示词、全屏预览和下载。

### 管理后台

管理后台入口为 `/console`，管理员登录后可进入仪表盘和各类管理模块。

- 仪表盘：统计用户、作品、任务、订单、供应商、公告、日志和系统健康状态。
- API 管理：配置系统供应商、模型推荐、系统 API、New API/OpenAI 兼容站点。
- 用户管理：管理用户资料、角色、会员、积分、账号状态。
- 价格设置：维护会员套餐、积分规则和付费能力。
- 订单管理：查看订单、支付状态和收入统计。
- 支付配置：配置微信、支付宝、Stripe 等支付方式的展示和密钥。
- 公告管理：创建站点公告、弹窗公告、有效期和展示策略。
- 数据管理：导出/导入业务数据，适合迁移和人工备份。
- 系统升级：支持热更新和冷更新，自动备份、失败回滚、中文日志和历史记录。
- 系统日志：查看登录、安全、运行、管理操作等平台日志。
- 系统设置：维护站点名称、Logo、页脚、邮箱、通知和站点政策内容。

### 运维能力

- 一键部署/升级脚本：`scripts/deploy-or-upgrade.sh`
- 构建脚本：`scripts/build.sh`
- 数据备份：`scripts/backup-create.sh`
- 数据恢复：`scripts/backup-restore.sh`
- 备份列表：`scripts/backup-list.sh`
- 数据库初始化：`scripts/init-database.sql`
- 数据库补丁：`scripts/apply-database-patch.sh`
- 管理后台在线升级 runner：`scripts/admin-upgrade-runner.mjs`
- PM2 运行配置：`ecosystem.config.cjs`

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | Next.js 16 App Router、React 19、TypeScript |
| UI 组件 | Radix UI、Tailwind CSS、lucide-react、sonner |
| 服务端 | Next.js Route Handlers、自定义 Node HTTP server、tsup |
| 数据库 | PostgreSQL 14+，可接 Supabase |
| 存储 | 本地文件存储，生产推荐 `LOCAL_STORAGE_DIR=/var/lib/miaojingAI/storage` |
| 认证 | 本地 auth schema + session/JWT，兼容 Supabase 风格表结构 |
| AI 调用 | coze-coding-dev-sdk、用户自定义 API、系统 API、New API/OpenAI compatible |
| 进程管理 | PM2 |
| 构建工具 | pnpm、Turbopack、tsup、TypeScript |

## 系统架构

```text
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│  首页 / 创作中心 / 画廊 / 个人中心 / 管理后台 Console          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP
┌──────────────────────────────▼──────────────────────────────┐
│                    Next.js App Router                        │
│  app pages + route handlers + middleware + server components │
└───────────────┬──────────────────────┬──────────────────────┘
                │                      │
┌───────────────▼──────────────┐       │
│        API Route 层           │       │
│ /api/generate/image           │       │
│ /api/generate/video           │       │
│ /api/generation-jobs          │       │
│ /api/admin/*                  │       │
│ /api/local-storage/*          │       │
└───────────────┬──────────────┘       │
                │                      │
┌───────────────▼──────────────┐       │
│        业务服务层             │       │
│ auth / model config / jobs    │       │
│ credits / orders / storage    │       │
│ platform logs / upgrade       │       │
└───────┬──────────────┬───────┘       │
        │              │               │
┌───────▼──────┐ ┌─────▼────────┐ ┌────▼──────────────────┐
│ PostgreSQL   │ │ 本地文件存储  │ │ 上游 AI / New API 站点 │
│ profiles     │ │ images/videos│ │ OpenAI compatible     │
│ works        │ │ avatars      │ │ image/video providers │
│ jobs/orders  │ │ backups      │ │                      │
└──────────────┘ └──────────────┘ └───────────────────────┘
```

## 目录结构

```text
.
├── assets/                         # 项目内置图片资源
├── docs/images/                    # README 使用的项目截图
├── public/                         # favicon、logo、公开静态文件
├── scripts/
│   ├── admin-upgrade-runner.mjs     # 管理后台热/冷更新执行器
│   ├── apply-database-patch.sh      # 执行数据库补丁
│   ├── backup-create.sh             # 创建数据库/存储/.env 备份
│   ├── backup-list.sh               # 查看备份列表
│   ├── backup-restore.sh            # 恢复备份
│   ├── build.sh                     # Next.js + server 构建
│   ├── deploy-or-upgrade.sh         # 一键部署/升级
│   ├── dev.sh                       # 本地开发启动脚本
│   ├── init-database.sql            # PostgreSQL 初始化脚本
│   └── start.sh                     # 生产启动脚本
├── src/
│   ├── app/                         # Next.js App Router 页面与 API
│   ├── components/                  # 页面组件、创作组件、管理后台组件、UI 组件
│   ├── hooks/                       # 前端 hooks
│   ├── lib/                         # 业务逻辑、认证、模型、存储、日志、支付等
│   ├── modules/                     # api / console / web 模块入口
│   ├── server.ts                    # 自定义 Node HTTP server 入口
│   └── storage/                     # 数据库客户端和存储适配
├── .env.example                     # 环境变量模板
├── ecosystem.config.cjs             # PM2 配置
├── package.json
└── README.md
```

## 环境要求

### 基础环境

- Linux 服务器，推荐 Ubuntu 22.04+ / Debian 12+
- Node.js 22 或 24，部署脚本默认安装/使用 Node.js 24 LTS
- pnpm 9+
- PostgreSQL 14+
- PM2
- curl、tar、rsync
- PostgreSQL 客户端工具：`psql`、`pg_dump`、`pg_restore`

### 推荐生产目录

```text
/opt/miaojingAI                 # 项目代码目录
/var/lib/miaojingAI/storage     # 上传文件、生成结果、本地存储
/var/lib/miaojingAI/backups     # 数据备份
/var/lib/miaojingAI/upgrade     # 管理后台升级状态和升级包
/var/lib/miaojingAI/logs        # 部署日志
```

## 环境变量

复制模板：

```bash
cp .env.example .env.local
```

常用变量：

| 变量 | 说明 |
| --- | --- |
| `LOCAL_DB_URL` | PostgreSQL 连接地址，例如 `postgresql://postgres:postgres@localhost:5432/miaojing` |
| `LOCAL_DB_ANON_KEY` | 本地模式 anon key，可自定义 |
| `LOCAL_DB_SERVICE_ROLE_KEY` | 本地模式 service role key，可自定义 |
| `DATA_ENCRYPTION_KEY` | 生产环境必填，用于加密 API Key 等敏感数据 |
| `JWT_SECRET` | 生产环境必填，用于会话/JWT 签名 |
| `GENERATION_INTERNAL_SECRET` | 生成任务内部密钥 |
| `LOCAL_STORAGE_DIR` | 本地文件存储路径 |
| `BACKUP_DIR` | 备份目录 |
| `DEPLOY_RUN_PORT` | 当前运行角色监听端口 |
| `MIAOJING_API_PORT` | 后端 API 内部端口 |
| `MIAOJING_CONSOLE_PORT` | 管理后台内部端口 |
| `NEXT_PUBLIC_APP_URL` | 前端公开访问地址 |
| `APP_BASE_URL` | 服务端使用的站点地址 |
| `ADMIN_INVITE_CODE` | 管理员邀请码 |
| `ENABLE_DANGER_ADMIN_CLEAR_USERS` | 危险清理功能开关，生产环境应保持 `false` |
| `UPGRADE_STATE_DIR` | 管理后台升级状态目录，默认基于存储目录推导 |
| `UPGRADE_HEALTH_URL` | 冷更新重启后的健康检查 URL |
| `UPGRADE_RESTART_COMMAND` | 冷更新使用的重启命令 |

生成生产密钥示例：

```bash
openssl rand -hex 32
```

## 本地开发

### 1. 安装依赖

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

### 2. 初始化数据库

创建数据库：

```bash
createdb miaojing
```

执行初始化脚本：

```bash
psql "postgresql://postgres:postgres@localhost:5432/miaojing" -f scripts/init-database.sql
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
```

至少填写：

```env
LOCAL_DB_URL=postgresql://postgres:postgres@localhost:5432/miaojing
LOCAL_DB_ANON_KEY=local-anon-key
LOCAL_DB_SERVICE_ROLE_KEY=local-service-role-key
LOCAL_STORAGE_DIR=./local-storage
DATA_ENCRYPTION_KEY=替换为 openssl rand -hex 32 的结果
JWT_SECRET=替换为 openssl rand -hex 32 的结果
GENERATION_INTERNAL_SECRET=替换为 openssl rand -hex 32 的结果
```

### 4. 启动开发服务

```bash
corepack pnpm run dev
```

默认开发端口由 `scripts/dev.sh` 控制，可传入端口：

```bash
corepack pnpm run dev -- 5000
```

### 5. 常用开发命令

```bash
# TypeScript 检查
corepack pnpm run ts-check

# ESLint
corepack pnpm run lint

# 完整构建
corepack pnpm run build

# 边界检查
corepack pnpm run check:boundaries
```

## 生产部署

### 方式一：Docker / NAS 部署

适合在本地 NAS、家用服务器或任意支持 Docker Compose 的 Linux 主机上运行。Compose 默认启动两个容器：

- `miaojing-postgres`：PostgreSQL 16，首次启动会执行 `scripts/init-database.sql` 初始化数据库。
- `miaojing-app`：妙境单容器完整服务，监听容器内 `5000` 端口，使用 `/data/storage`、`/data/backups`、`/data/upgrade` 作为持久化目录。

准备环境文件：

```bash
cp .env.docker.example .env.docker
```

至少修改：

- `POSTGRES_PASSWORD`，并同步更新 `LOCAL_DB_URL` 中的密码。
- `DATA_ENCRYPTION_KEY`、`JWT_SECRET`、`GENERATION_INTERNAL_SECRET`，建议用 `openssl rand -hex 32` 分别生成。
- `ADMIN_DEFAULT_PASSWORD`。
- `NEXT_PUBLIC_APP_URL` 和 `APP_BASE_URL`，改成 NAS 的实际访问地址，例如 `http://192.168.1.20:5000`。

启动：

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
curl http://127.0.0.1:5000/api/health
```

数据会落在：

```text
docker-data/postgres   # PostgreSQL 数据
docker-data/storage    # 生成结果、上传文件、Manifest、缩略图
docker-data/backups    # 备份包
docker-data/upgrade    # 升级状态
```

从现有 PM2/服务器部署迁移到 NAS：

```bash
# 旧服务器/旧目录中创建完整备份
corepack pnpm run backup:create

# 将生成的 miaojing-backup-YYYYMMDD-HHMMSS.tar.gz 放到 NAS 项目目录：
# docker-data/backups/miaojing-backup-YYYYMMDD-HHMMSS.tar.gz

# NAS 上停止应用容器，仅保留数据库
docker compose --env-file .env.docker up -d postgres
docker compose --env-file .env.docker stop app

# 恢复数据库和本地存储；Docker 模式使用 .env.docker，默认不会读取备份里的 .env.local
docker compose --env-file .env.docker run --rm app \
  bash scripts/backup-restore.sh /data/backups/miaojing-backup-YYYYMMDD-HHMMSS.tar.gz

# 启动并检查
docker compose --env-file .env.docker up -d app
docker compose --env-file .env.docker exec app node scripts/migration-integrity-check.mjs
curl http://127.0.0.1:5000/api/health
```

容器模式下的代码更新建议走镜像重建和容器替换：

```bash
docker compose --env-file .env.docker build app
docker compose --env-file .env.docker up -d app
```

管理后台“系统升级”的冷更新流程仍然主要面向传统 PM2 部署。Docker/NAS 模式中，源码、依赖、运行配置变化应通过构建新镜像发布；数据库、存储和环境变量仍通过 `docker-data/*` 与 `.env.docker` 持久化。

### 方式二：一键部署/升级脚本

推荐使用：

```bash
bash scripts/deploy-or-upgrade.sh
```

脚本会提示填写：

- 项目部署目录
- 数据存储目录
- 前端访问端口
- 后端 API 内部端口
- 管理后台内部端口
- 管理员账号/邮箱/密码
- PostgreSQL 连接地址
- 正式访问地址

首次部署时，脚本会：

1. 检查 tar、rsync、curl、psql、pg_dump 等依赖。
2. 自动安装或切换 Node.js 22/24。
3. 安装 pnpm 和 PM2。
4. 准备 `.env.local`。
5. 初始化或检查数据库。
6. 构建 Next.js 和 Node server。
7. 写入 PM2 配置并启动服务。
8. 执行健康检查。

升级已有部署时，脚本会：

1. 检测已有部署目录。
2. 创建升级前备份。
3. 同步新代码。
4. 构建并重启服务。
5. 执行健康检查。
6. 失败时输出备份路径，方便手动恢复。

### 方式三：手动部署

安装依赖：

```bash
corepack enable
corepack pnpm install --frozen-lockfile --prod=false
```

构建：

```bash
corepack pnpm run build
```

启动 PM2：

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

健康检查：

```bash
curl http://127.0.0.1:5100/api/health
```

### PM2 服务说明

`ecosystem.config.cjs` 默认包含三个角色：

| PM2 名称 | 角色 | 默认端口 |
| --- | --- | --- |
| `miaojing-api` | 后端 API | `5100` |
| `miaojing-web` | 前端站点 | `5000` |
| `miaojing-console` | 管理后台 | `5200` |

在单进程开发部署中，也可以使用类似 `miaojing-dev` 的 PM2 进程直接运行完整服务。

## 数据库说明

数据库初始化脚本为：

```bash
scripts/init-database.sql
```

核心表包括：

| 表 | 说明 |
| --- | --- |
| `auth.users` | 本地认证用户 |
| `profiles` | 用户资料、角色、会员、积分 |
| `works` | 创作作品、提示词、结果 URL、尺寸、状态 |
| `generation_jobs` | 生成任务队列和进度 |
| `credit_transactions` | 积分流水 |
| `orders` | 订单和支付状态 |
| `user_api_keys` | 用户自定义 API 密钥 |
| `system_api_configs` | 系统默认 API 配置 |
| `api_providers` | 模型供应商 |
| `model_recommendations` | 模型推荐配置 |
| `announcements` | 公告 |
| `site_config` | 站点配置 |
| `platform_logs` | 平台日志 |

执行数据库补丁：

```bash
corepack pnpm run db:patch
```

## 备份与恢复

### 创建备份

```bash
corepack pnpm run backup:create
```

备份包包含：

- PostgreSQL dump：`database.dump`
- 本地存储目录：`local-storage`
- 环境变量：`.env.local`
- `package.json`
- 备份 manifest

默认只保留最近 10 个备份。

### 查看备份

```bash
corepack pnpm run backup:list
```

### 恢复备份

```bash
corepack pnpm run backup:restore /path/to/miaojing-backup-YYYYMMDD-HHMMSS.tar.gz
```

恢复动作会：

1. 使用 `pg_restore --clean --if-exists --no-owner` 恢复数据库。
2. 替换本地存储目录。
3. 恢复 `.env.local`。

生产环境恢复前建议先停服务，并额外复制当前数据目录。

## 管理后台在线升级

管理后台“系统升级”提供两类升级能力：

### 热更新

用于不影响运行时代码的小补丁，例如 `public/` 下的静态资源。

特点：

- 不重启平台。
- 升级前自动创建数据库/存储/环境备份。
- 升级前自动创建源码快照。
- 失败自动回滚。
- 升级界面实时显示中文日志。

### 冷更新

用于涉及源码、脚本、依赖、配置的大变更。

冷更新流程：

1. 上传升级包。
2. 校验升级包路径，拒绝 `.env`、`.git`、`node_modules`、`backups`、`local-storage` 等危险路径。
3. 创建数据库、存储、环境配置备份。
4. 创建源码快照。
5. 应用升级包文件。
6. 如依赖变化，执行 `pnpm install --frozen-lockfile --prod=false`。
7. 执行 `pnpm run ts-check`。
8. 执行 `pnpm run build`。
9. 重启平台。
10. 调用 `/api/health` 做健康检查。
11. 失败时自动恢复源码和数据。

升级日志会写入磁盘状态文件。即使冷更新过程中平台重启，管理后台恢复后也能续上日志和状态。升级完成后，当前页面刷新或切换页面会默认收起实时日志，但历史升级记录中可随时查看完整升级内容和日志。

升级包格式：

```text
.tar
.tar.gz
.tgz
```

推荐升级包结构：

```text
upgrade-package/
├── manifest.json
├── src/...
├── public/...
├── scripts/...
├── package.json
└── pnpm-lock.yaml
```

手动运行升级 runner 示例：

```bash
UPGRADE_STATE_DIR=/var/lib/miaojingAI/upgrade \
corepack pnpm run upgrade:run -- \
  --job-id manual-001 \
  --mode cold \
  --package /tmp/upgrade.tgz \
  --package-name upgrade.tgz \
  --project /opt/miaojingAI
```

## AI 模型与供应商

妙境支持多来源模型配置：

- 系统默认供应商。
- 用户自定义 API Key。
- New API / OpenAI-compatible API 站点。
- 图片模型、视频模型、文本模型分类型管理。

管理员可在管理后台配置供应商、默认模型、API 地址、模型推荐和启用状态。用户可在前端绑定自己的 API Key，平台会使用加密存储和尾号预览保护密钥。

## 存储与下载

生成结果会持久化到本地存储目录或配置的存储服务。推荐生产环境把存储放在项目目录之外：

```env
LOCAL_STORAGE_DIR=/var/lib/miaojingAI/storage
```

下载链路通过 `/api/download` 或本地存储路由读取原始文件，不应对图片进行二次压缩。作品历史、生成结果、画廊、全屏预览和下载应始终使用原始结果链接或持久化文件路径。

## 健康检查与运维命令

健康检查：

```bash
curl http://127.0.0.1:5100/api/health
```

查看 PM2：

```bash
pm2 list
pm2 logs miaojing-api --lines 100
pm2 logs miaojing-web --lines 100
pm2 logs miaojing-console --lines 100
```

重启服务：

```bash
corepack pnpm run pm2:restart
```

保存 PM2 开机配置：

```bash
corepack pnpm run pm2:save
```

## 安全建议

- 生产环境必须设置高强度 `DATA_ENCRYPTION_KEY`、`JWT_SECRET`、`GENERATION_INTERNAL_SECRET`。
- `.env.local` 不应提交到 git。
- 生产环境不要开启 `ENABLE_DANGER_ADMIN_CLEAR_USERS`。
- `LOCAL_STORAGE_DIR`、`BACKUP_DIR`、`UPGRADE_STATE_DIR` 建议放在项目目录外。
- 升级包不要包含 `.env`、数据库 dump、用户上传文件或备份目录。
- 对外暴露时建议在 Nginx/Caddy 后面启用 HTTPS。
- 管理后台账号应使用强密码，并限制管理员数量。
- 定期执行 `backup:create` 并把备份复制到异地。

## 常见问题

### 1. 构建时提示缺少 devDependencies

构建需要 devDependencies。部署或 CI 中不要只安装生产依赖，推荐：

```bash
corepack pnpm install --frozen-lockfile --prod=false
```

### 2. 管理后台修改后刷新丢失

优先检查对应接口是否成功写入数据库，再检查 `.env.local` 是否连接到了正确数据库。不要只看前端本地状态。

### 3. 图片下载尺寸不符合预期

排查顺序：

1. 检查上游请求参数是否为目标分辨率。
2. 检查生成任务结果中保存的原始文件尺寸。
3. 检查 `/api/download` 是否直接返回原始文件。
4. 检查前端是否使用缩略图地址下载。

### 4. 冷更新后页面仍是旧版本

检查：

```bash
pm2 list
pm2 describe miaojing-api
pm2 describe miaojing-web
pm2 describe miaojing-console
```

确认 PM2 的 `cwd` 是当前部署目录，并确认构建产物来自同一目录。

### 5. 数据恢复后作品图片丢失

确认备份包内是否包含 `local-storage`，并确认 `.env.local` 中的 `LOCAL_STORAGE_DIR` 指向恢复后的存储目录。

## 版本管理

推荐使用 `main` 作为稳定分支：

```bash
git clone https://github.com/Fengoffer/miaojing-ai.git
cd miaojing-ai
git checkout main
```

提交前建议执行：

```bash
corepack pnpm run ts-check
corepack pnpm run build
```

## License

MIT License. See [LICENSE](LICENSE).
