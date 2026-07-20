# DG 世界杯全纪录 V3.1

V3 将原静态赛程站升级为动态应用：用户登录、管理员权限、无现金积分预测、比赛评论、排行榜与审计备份。

V3.1 增加不可变用户代码、管理员修改用户名、世界杯届次模型、CSV 初始记录导入、0–100 两位小数置信度、本地国旗资源，以及比赛与球员数据的完整空状态框架。

## 本地启动

需要 Node.js 22。

```bash
npm ci
npm run migrate
SEED_USER_PASSWORD=ChangeMe2026 npm run seed
COOKIE_SECURE=false npm run dev
```

浏览器打开 `http://127.0.0.1:3000`。样本账号为 `user-01`、`user-02`，初始密码来自 `SEED_USER_PASSWORD`，首次登录必须修改。

## 创建首个管理员

只在首次初始化时临时传入变量，不要把密码写入 GitHub：

```bash
ADMIN_USERNAME=admin \
ADMIN_DISPLAY_NAME=管理员 \
ADMIN_INITIAL_PASSWORD='临时强密码' \
npm run seed
```

管理员初始密码至少 10 位，并同时包含字母和数字。系统只保存 bcrypt 哈希。

## 数据位置

- 开发默认：项目根目录 `worldcup-v3.db`（已被 `.gitignore` 排除）
- 生产默认：`/var/lib/worldcup/worldcup.db`
- 生产备份：`/var/backups/worldcup`

正式数据库、`.env`、密码、会话和备份都不能提交 GitHub。

## 测试

```bash
npm test
node --check app.js
node --check v3-ui.js
node --check server/app.js
```

## Vultr

1. 先配置域名和 HTTPS；账号密码不能在普通 HTTP 上正式使用。
2. 在测试分支执行 `sudo BRANCH=feature/v3-auth-comments bash deploy/deploy-v3.sh`。
3. 安装 Nginx 配置并用 Certbot 申请证书。
4. 健康检查：`curl http://127.0.0.1:3000/api/health`。
5. 后续更新：`sudo update-worldcup-v3`。

## 版本管理

- 生产分支：`main`
- V3 开发分支：`feature/v3-auth-comments`
- 当前候选版本：`v3.1.1-rc.1`

V3.1 增加不可变用户代码、可修改用户名、多届世界杯数据模型、积分预测 CSV 导入，以及离线国旗资源。比赛技术统计或球员数据尚未导入时，详情页仍会保留完整框架并显示“待更新”。

合并前先查看 Pull Request、CI 和 Vultr 测试环境。发布与迁移细节见 `RELEASE-V3.md`。
