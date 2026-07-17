# 实时数据部署（小白版）

## 先理解架构

浏览器不能安全保存 API Key，所以网页不直接访问 API-Football。网页点击“手动刷新数据”时，请求 `/api/fixtures`；Cloudflare Worker 收到请求后，用服务器里的 `API_FOOTBALL_KEY` 调 API-Football，再把 JSON 返回网页。没有定时器、没有自动刷新，只有点击按钮才请求。

## 部署步骤

1. 注册 API-Football：<https://dashboard.api-football.com/register>，在 `Account → My Access` 复制 Key。
2. 注册 Cloudflare：<https://dash.cloudflare.com/sign-up>。
3. 进入 `Workers & Pages` → `Create application` → `Create Worker`。
4. 给 Worker 起名，例如 `world-cup-api`，点击部署。
5. 进入该 Worker → `Settings` → `Variables and Secrets` → `Add`。
6. 变量名填 `API_FOOTBALL_KEY`，值粘贴你的 Key，类型选择 Secret，然后保存并重新部署。
7. 在 Worker 的 `Edit code` 中，把本项目的 `worker.js` 全部复制进去并部署。
8. 复制 Worker 地址，例如 `https://world-cup-api.xxx.workers.dev`。
9. 在 `app.js` 中把 `fetch('/api/fixtures?...')` 改成 `fetch('你的Worker地址/api/fixtures?...')`。
10. 把更新后的 `index.html`、`styles.css`、`app.js` 重新上传 GitHub，Pages 会重新发布。

## 目前的限制

如果只部署前端到 GitHub Pages，`/api/fixtures` 不存在，按钮会安全地回退到演示数据。完成 Worker 部署并替换地址后，按钮才会读取实时接口。页面不会自动刷新。
