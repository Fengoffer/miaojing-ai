# 妙境 AI 创作平台部署、备份、升级操作文档

本文档用于生产环境的一键部署、日常备份、安全升级和故障回滚。所有命令默认在服务器源码目录执行。

## 1. 适用范围

适用于 Linux 服务器本地化部署架构：

- 前端访问服务：`miaojing-web`
- 后端 API 服务：`miaojing-api`
- 管理后台服务：`miaojing-console`
- 数据库：PostgreSQL
- 文件持久化：本地存储目录
- 进程管理：PM2

默认路径和端口：

| 项目 | 默认值 |
| --- | --- |
| 项目部署目录 | `/opt/miaojingAI` |
| 数据存储目录 | `/var/lib/miaojingAI` |
| 前端访问端口 | `5000` |
| 后端 API 内部端口 | `5100` |
| 管理后台内部端口 | `5200` |
| 管理后台访问路径 | `/console` |
| 本地存储目录 | `/var/lib/miaojingAI/storage` |
| 备份目录 | `/var/lib/miaojingAI/backups` |

## 2. 部署前准备

### 2.1 推荐服务器配置与操作系统

生产环境推荐使用稳定版 Linux 发行版，不建议直接使用 Windows Server 运行生产服务。Windows 可以作为开发环境，生产环境建议使用 Ubuntu/Debian 系服务器，便于安装 PostgreSQL、PM2、Nginx、Certbot 和系统级守护服务。

推荐操作系统：

| 操作系统 | 推荐版本 | 适用场景 | 说明 |
| --- | --- | --- | --- |
| Ubuntu Server | `24.04 LTS` | 首选生产环境 | 生态成熟，Node.js、PostgreSQL、Nginx、Certbot 支持完整 |
| Ubuntu Server | `26.04 LTS` | 新服务器可选 | 适合全新环境，部署前先在测试机完成一次完整构建和功能验证 |
| Ubuntu Server | `22.04 LTS` | 旧服务器可继续使用 | 仍可运行，但新采购服务器优先选择更新 LTS |
| Debian | `13` | 稳定生产环境 | 当前稳定版，适合长期运行 |
| Debian | `12` | 旧服务器可继续使用 | 已进入旧稳定版周期，可用但新部署优先 Debian 13 |
| CentOS Stream / Rocky Linux / AlmaLinux | `9` | 企业内网环境 | 可用，但脚本和文档示例默认以 Ubuntu/Debian 为主 |

服务器配置建议：

| 场景 | CPU | 内存 | 磁盘 | 带宽 | 适用说明 |
| --- | --- | --- | --- | --- | --- |
| 最低测试环境 | 2 核 | 4 GB | 40 GB SSD | 5 Mbps | 仅用于功能验证和少量测试用户，不建议正式上线 |
| 小型生产环境 | 4 核 | 8 GB | 100 GB SSD | 10 Mbps 以上 | 适合早期上线、低到中等访问量，是推荐起步配置 |
| 标准生产环境 | 8 核 | 16 GB | 200 GB SSD | 20 Mbps 以上 | 适合多人同时使用、较多图片/视频结果持久化 |
| 高并发/商用环境 | 16 核以上 | 32 GB 以上 | 500 GB SSD 或独立对象存储 | 50 Mbps 以上 | 建议拆分数据库、对象存储、反向代理和应用服务 |

磁盘规划建议：

| 目录 | 推荐大小 | 用途 |
| --- | --- | --- |
| 项目部署目录，如 `/opt/miaojingAI` | 20 GB 以上 | 源码、依赖、构建产物 |
| 数据存储目录，如 `/var/lib/miaojingAI` | 80 GB 以上 | 上传文件、生成结果、备份、部署日志 |
| PostgreSQL 数据目录 | 50 GB 以上 | 用户、作品、订单、配置、日志等业务数据 |

生产环境基础要求：

- CPU 架构：`x86_64/amd64`
- Node.js：推荐 `24.x LTS`；可使用 `22.x LTS`；不建议新生产环境继续使用已过维护周期的 Node.js 20
- PostgreSQL：`16+`，推荐 `17` 或 `18`；最低可用 `14+`，但需要确认仍在安全维护期
- pnpm：`9.x+`
- PM2：最新版稳定版
- Nginx：建议用于域名反向代理、HTTPS、静态压缩和访问日志
- HTTPS：正式上线必须配置有效 TLS 证书
- 时区：建议设置为 `Asia/Shanghai`
- 防火墙：只开放 `80/443` 和必要的 SSH 端口，`5100/5200` 保持内网访问
- 应用服务默认绑定 `127.0.0.1`，通过 Nginx 对外提供访问；不要把 `APP_BIND_HOST` 改为 `0.0.0.0`，除非已有上层网络隔离
- 备份：数据库和 `/var/lib/miaojingAI/storage` 必须有定期离线或异地备份

不建议用于正式生产的环境：

- 非 LTS 版本 Linux，例如 Ubuntu 中间版本；这类系统生命周期短，适合测试，不适合长期生产。
- 低于 4 核 8 GB 的服务器；Next.js 构建、图片/视频结果持久化和 PostgreSQL 同机运行时容易出现资源不足。
- 只暴露裸 IP 和 HTTP 端口；正式上线必须使用域名、Nginx 反向代理和 HTTPS。
- 将数据库、上传文件、生成结果和备份放在项目代码目录内；升级和回滚时容易误删。
- 使用默认管理员密码、默认数据库密码或公开的 SSH 密码。

### 2.2 必需软件

部署脚本会自动安装或切换 Node.js 到生产推荐版本，默认使用 `24.x LTS`。如需固定为 `22.x LTS`，执行脚本前设置：

```bash
DEPLOY_NODE_MAJOR=22 bash scripts/deploy-or-upgrade.sh
```

Node.js 会优先从国内可访问镜像源下载，顺序包括 npmmirror、清华、腾讯、华为，最后回退到官方源。默认安装目录为数据目录下的 `node` 子目录，例如 `/var/lib/miaojingAI/node`，不会覆盖系统自带 Node.js。

部署脚本会检查以下命令是否存在：

- `node` / `npm`：没有或版本不符合目标 LTS 时，脚本会自动安装/切换
- `pnpm`
- `pm2`
- `psql`
- `pg_dump`
- `tar`
- `rsync`
- `curl`

Ubuntu/Debian 可参考：

```bash
sudo apt update
sudo apt install -y postgresql-client tar rsync curl
node -v
npm -v
```

如果未安装 `pnpm` 或 `pm2`，一键脚本会通过当前 Node.js 对应的 npm 自动安装，并使用国内可访问镜像源。

### 2.3 PostgreSQL 数据库

部署前需要准备好 PostgreSQL 数据库，并确认服务器可以连接。

示例连接地址：

```text
postgresql://postgres:postgres@localhost:5432/miaojing
```

可先手动验证：

```bash
psql "postgresql://postgres:postgres@localhost:5432/miaojing" -c "SELECT 1;"
```

## 3. 首次部署

### 3.1 执行一键部署脚本

在服务器源码目录执行：

```bash
bash scripts/deploy-or-upgrade.sh
```

脚本会自动检测目标部署目录。如果目标目录没有部署记录，会进入首次部署流程。

### 3.2 按提示填写参数

首次部署时需要填写：

| 参数 | 说明 |
| --- | --- |
| 项目部署目录 | 生产运行目录，例如 `/opt/miaojingAI` |
| 数据存储目录 | 持久化数据根目录，例如 `/var/lib/miaojingAI` |
| 前端访问端口 | 浏览器访问端口，例如 `5000` |
| 后端 API 内部端口 | 后端服务端口，例如 `5100` |
| 管理后台内部端口 | 管理后台服务端口，例如 `5200` |
| 管理员账号/昵称 | 管理员登录账号展示名 |
| 管理员邮箱 | 管理员登录邮箱 |
| 管理员密码 | 管理员初始密码 |
| 正式访问地址 | 有域名时填写 `https://域名`，没有域名时可留空使用服务器 IP 和端口 |
| PostgreSQL 连接地址 | 数据库连接字符串 |

### 3.3 部署完成后的输出

部署成功后，脚本会输出：

- 前台访问地址
- 管理后台地址
- 管理员账号
- 管理员邮箱
- 管理员密码
- 项目目录
- 数据目录
- 日志文件路径

管理后台访问地址示例：

```text
https://你的域名/console
```

只有管理员账号可以登录管理后台。

## 4. Nginx、HTTPS 与防火墙

正式上线必须使用 Nginx 反向代理和 HTTPS，不建议把 `5000/5100/5200` 直接暴露到公网。仓库已提供生产模板：

```text
deploy/nginx/miaojing-production.conf
```

### 4.1 配置 Nginx

```bash
sudo cp deploy/nginx/miaojing-production.conf /etc/nginx/sites-available/miaojing.conf
sudo nano /etc/nginx/sites-available/miaojing.conf
sudo ln -sf /etc/nginx/sites-available/miaojing.conf /etc/nginx/sites-enabled/miaojing.conf
sudo nginx -t
sudo systemctl reload nginx
```

需要替换模板中的：

- `example.com` 和 `www.example.com`
- 证书路径
- 如果一键脚本中修改过前端端口，同步替换 `proxy_pass http://127.0.0.1:5000`

### 4.2 配置 HTTPS 证书

推荐使用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
sudo certbot renew --dry-run
```

### 4.3 防火墙要求

生产环境只开放 `80/443` 和必要 SSH 端口，应用内部端口只允许本机访问。

Ubuntu UFW 示例：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 5000/tcp
sudo ufw deny 5100/tcp
sudo ufw deny 5200/tcp
sudo ufw enable
sudo ufw status verbose
```

云服务器安全组也必须同步只开放 `80/443/SSH`。

## 5. 部署后的检查

### 5.1 检查 PM2 服务

```bash
pm2 list
```

正常情况下应看到：

- `miaojing-web`
- `miaojing-api`
- `miaojing-console`

状态应为 `online`。

### 5.2 检查访问地址

```bash
curl -I http://127.0.0.1:5000
curl -fsS http://127.0.0.1:5000/api/health
curl -I http://127.0.0.1:5000/console
```

### 5.3 检查日志

```bash
pm2 logs miaojing-web --lines 100
pm2 logs miaojing-api --lines 100
pm2 logs miaojing-console --lines 100
```

部署脚本日志位于：

```text
数据存储目录/logs/deploy-日期时间.log
```

示例：

```text
/var/lib/miaojingAI/logs/deploy-20260503-120000.log
```

## 6. 备份操作

### 6.1 自动备份

执行升级流程时，一键脚本会自动创建升级前备份，备份内容包括：

- PostgreSQL 数据库 dump
- `.env.local`
- 本地存储文件
- `package.json`
- 备份清单 `manifest.json`

默认备份目录：

```text
/var/lib/miaojingAI/backups
```

### 6.2 手动创建备份

进入生产部署目录：

```bash
cd /opt/miaojingAI
pnpm backup:create
```

或直接执行：

```bash
cd /opt/miaojingAI
bash scripts/backup-create.sh
```

如果需要指定备份目录：

```bash
cd /opt/miaojingAI
BACKUP_DIR=/var/lib/miaojingAI/backups bash scripts/backup-create.sh
```

脚本成功后会输出备份文件路径，例如：

```text
/var/lib/miaojingAI/backups/miaojing-backup-20260503-120000.tar.gz
```

### 6.3 查看备份文件

```bash
ls -lh /var/lib/miaojingAI/backups
```

备份脚本默认保留最近 10 个 `miaojing-backup-*.tar.gz` 文件。

## 7. 升级操作

### 7.1 升级前确认

升级前确认：

- 数据库可连接
- 当前服务可访问
- 磁盘空间充足
- 已拿到新版本源码
- 没有正在进行的重要生成任务

建议检查：

```bash
df -h
pm2 list
psql "postgresql://postgres:postgres@localhost:5432/miaojing" -c "SELECT 1;"
```

### 7.2 执行升级

在新版本源码目录执行：

```bash
bash scripts/deploy-or-upgrade.sh
```

当脚本检测到目标部署目录已有 `package.json` 且存在 `.env.local` 或 `.miaojing-deployment` 时，会进入升级流程。

升级流程会自动执行：

1. 读取旧部署配置作为默认值
2. 创建升级前备份
3. 迁移旧本地存储到持久化目录
4. 同步新版本代码到部署目录
5. 保留 `.env.local` 中原有非部署配置，只更新数据库、端口、持久化目录和密钥等必要项
6. 补齐数据库结构和索引
7. 可选更新管理员密码
8. 安装依赖
9. 生产构建
10. 执行生产依赖漏洞扫描；`high/critical` 级别漏洞会阻断上线
11. 通过 PM2 重载前端、后端、管理后台
12. 检查 `/api/health` 和 `/console`

### 7.3 升级参数说明

升级时管理员密码可以留空：

- 留空：不修改管理员密码
- 输入新密码：更新管理员密码

升级不会删除或覆盖以下数据：

- 用户账号
- 用户资料
- 管理员账号
- 作品记录
- 积分记录
- 订单记录
- 网站配置
- API 供应商配置
- 系统 API 配置
- 用户自定义 API 密钥
- 支付配置
- 公告
- 邮件配置
- 本地存储文件

## 8. 安全与漏洞扫描

一键脚本在构建后会执行：

```bash
pnpm audit --prod --audit-level=high
```

发现 `high` 或 `critical` 级别生产依赖漏洞时，脚本会直接失败，必须先升级依赖链并重新构建。`moderate` 级别漏洞会记录在部署日志中，正式上线前仍建议处理。

可手动执行完整审计：

```bash
cd /opt/miaojingAI
pnpm audit --prod --registry=https://registry.npmjs.org
```

项目内置的生产安全措施：

- `/api/admin/clear-users` 默认禁用，只有临时设置 `ENABLE_DANGER_ADMIN_CLEAR_USERS=true` 才能使用。
- `/console` 管理后台登录要求管理员角色，普通用户不能登录。
- 登录、注册、邮箱验证码、生成、下载、管理 API 均有应用层基础限流。
- Nginx 模板提供边缘限流，建议正式生产同时启用应用层和 Nginx 层限流。
- 全局安全响应头包括 `Content-Security-Policy`、`HSTS`、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy` 和 `Origin-Agent-Cluster`。
- 生产构建关闭 `X-Powered-By` 技术指纹，并设置 Node HTTP 请求、请求头、Keep-Alive 超时。
- 下载代理和远程文件持久化会阻断内网、回环和本地地址，降低 SSRF 风险。
- API Key、SMTP 密码等敏感配置采用服务端加密存储，生产环境必须设置 `DATA_ENCRYPTION_KEY` 和 `JWT_SECRET`。

上线前必须确认：

- `ENABLE_DANGER_ADMIN_CLEAR_USERS=false`
- `.env.local` 权限为 `600`
- 管理员密码不是默认值，也不是弱口令
- 用户注册密码规则至少 8 位，并同时包含字母和数字
- 数据库密码不是默认值
- SSH 禁止公开弱密码，建议使用密钥登录并限制来源 IP
- 云安全组和系统防火墙均未开放 `5000/5100/5200`
- 备份文件目录权限为 `700`，备份文件权限为 `600`

## 9. 回滚操作

### 9.1 使用备份回滚

进入生产部署目录：

```bash
cd /opt/miaojingAI
pnpm backup:restore /var/lib/miaojingAI/backups/miaojing-backup-YYYYMMDD-HHMMSS.tar.gz
```

或直接执行：

```bash
cd /opt/miaojingAI
bash scripts/backup-restore.sh /var/lib/miaojingAI/backups/miaojing-backup-YYYYMMDD-HHMMSS.tar.gz
```

回滚会恢复：

- 数据库
- `.env.local`
- 本地存储文件

### 9.2 回滚后重启服务

```bash
cd /opt/miaojingAI
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

### 9.3 回滚后验证

```bash
curl -fsS http://127.0.0.1:5000/api/health
curl -I http://127.0.0.1:5000/console
pm2 list
```

## 10. 数据持久化说明

生产部署中，代码目录和数据目录分离。

代码目录示例：

```text
/opt/miaojingAI
```

数据目录示例：

```text
/var/lib/miaojingAI
```

关键持久化路径：

| 数据 | 路径 |
| --- | --- |
| 本地上传和生成文件 | `/var/lib/miaojingAI/storage` |
| 备份文件 | `/var/lib/miaojingAI/backups` |
| 部署日志 | `/var/lib/miaojingAI/logs` |
| 生产环境变量 | `/opt/miaojingAI/.env.local` |
| 部署标记 | `/opt/miaojingAI/.miaojing-deployment` |

升级同步代码时会排除：

- `.env.local`
- `node_modules`
- `.next`
- `dist`
- `backups`
- `local-storage`
- `.git`
- `.codex_tmp`

因此正常升级不会覆盖用户数据和持久化文件。

## 11. 常用运维命令

### 11.1 查看服务状态

```bash
pm2 list
```

### 11.2 查看服务日志

```bash
pm2 logs miaojing-web --lines 100
pm2 logs miaojing-api --lines 100
pm2 logs miaojing-console --lines 100
```

### 11.3 重启服务

```bash
cd /opt/miaojingAI
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

### 11.4 停止服务

```bash
pm2 stop miaojing-web miaojing-api miaojing-console
```

### 11.5 启动服务

```bash
cd /opt/miaojingAI
pm2 start ecosystem.config.cjs --update-env
pm2 save
```

### 11.6 查看部署日志

```bash
ls -lh /var/lib/miaojingAI/logs
tail -n 200 /var/lib/miaojingAI/logs/deploy-*.log
```

## 12. 常见问题处理

### 12.1 Node.js 自动安装失败

脚本默认会自动安装或切换到 Node.js `24.x LTS`。如果服务器无法访问所有 Node.js 镜像源，会提示安装失败。

```bash
node -v
curl -I https://npmmirror.com/mirrors/node/index.json
```

可改用 Node.js `22.x LTS`：

```bash
DEPLOY_NODE_MAJOR=22 bash scripts/deploy-or-upgrade.sh
```

### 12.2 依赖安装失败

脚本会依次尝试以下源：

- `https://registry.npmmirror.com`
- `https://registry.npmjs.org`
- `https://mirrors.cloud.tencent.com/npm/`
- `https://mirrors.huaweicloud.com/repository/npm/`

如果全部失败，检查服务器网络和 DNS。

### 12.3 数据库连接失败

检查连接地址：

```bash
psql "postgresql://postgres:postgres@localhost:5432/miaojing" -c "SELECT 1;"
```

检查 PostgreSQL 服务：

```bash
systemctl status postgresql
```

### 12.4 健康检查失败

查看 PM2 日志：

```bash
pm2 logs miaojing-web --lines 120
pm2 logs miaojing-api --lines 120
pm2 logs miaojing-console --lines 120
```

检查端口是否被占用：

```bash
ss -lntp | grep -E ':5000|:5100|:5200'
```

### 12.5 管理后台无法登录

确认访问路径：

```text
http://服务器IP:5000/console
```

确认账号为管理员角色：

```sql
SELECT id, email, nickname, role, is_active FROM profiles WHERE role = 'admin';
```

升级时如果需要重置管理员密码，重新执行：

```bash
bash scripts/deploy-or-upgrade.sh
```

在提示“管理员密码（升级时可留空表示不修改）”时输入新密码。

### 12.6 作品图片或视频无法访问

检查 `.env.local` 中的本地存储目录：

```bash
grep LOCAL_STORAGE_DIR /opt/miaojingAI/.env.local
```

检查文件目录：

```bash
ls -lh /var/lib/miaojingAI/storage
```

升级脚本会自动将旧部署目录中的 `local-storage` 迁移到持久化目录。

## 13. 上线检查清单

上线前逐项确认：

- 数据库连接正常
- 一键部署脚本执行成功
- `pm2 list` 三个服务均为 `online`
- 首页可访问
- `/api/health` 返回正常
- `/console` 可访问
- 管理员可登录后台
- 网站设置可读取和保存
- API 管理配置可读取和保存
- 用户注册、登录正常
- 创作作品可以生成、保存和访问
- 本地存储目录存在且可写
- 手动备份可以成功生成
- 升级前备份路径已记录
- Nginx 已配置域名和 HTTPS
- 系统防火墙和云安全组只开放 `80/443/SSH`
- `5000/5100/5200` 未对公网开放
- `pnpm audit --prod` 无 `high/critical` 漏洞
- `.env.local` 中 `JWT_SECRET`、`DATA_ENCRYPTION_KEY`、`GENERATION_INTERNAL_SECRET` 均已设置
- `ENABLE_DANGER_ADMIN_CLEAR_USERS=false`
- `/console` 响应头不包含 `X-Powered-By`，并包含 `Content-Security-Policy`
- 管理后台“系统日志”可正常筛选查看
- 管理后台仪表盘中数据库、存储、日志状态正常

## 14. 关键文件

| 文件 | 用途 |
| --- | --- |
| `scripts/deploy-or-upgrade.sh` | 一键部署和升级 |
| `scripts/backup-create.sh` | 创建备份 |
| `scripts/backup-restore.sh` | 恢复备份 |
| `scripts/init-database.sql` | 初始化和补齐数据库结构 |
| `scripts/database-optimization-patch.sql` | 数据库优化补丁 |
| `scripts/start.sh` | PM2 调用的启动脚本 |
| `deploy/nginx/miaojing-production.conf` | Nginx 生产反向代理模板 |
| `.env.local` | 生产环境变量 |
| `ecosystem.config.cjs` | PM2 进程配置 |
