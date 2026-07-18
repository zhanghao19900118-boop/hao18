# 2026 DG 世界杯全纪录 V2 发布说明

当前交付版本：`2.0.0-rc.1`（候选测试版）

## 一、先保存当前线上版本

1. 打开 GitHub 项目 `zhanghao19900118-boop/hao18`。
2. 点击右侧 `Releases`，再点击 `Draft a new release`。
3. 在 `Choose a tag` 中输入 `v1.0.0`，选择 `Create new tag: v1.0.0 on publish`。
4. Target 选择 `main`，标题填写 `V1 稳定版备份`。
5. 点击 `Publish release`。

这样以后即使 V2 有问题，也能找到 V1 的全部文件。

## 二、创建 V2 功能分支

1. 回到项目的 `Code` 页面。
2. 点击左上角显示 `main` 的分支按钮。
3. 在输入框填写 `feature/v2-worldcup-records`。
4. 点击 `Create branch: feature/v2-worldcup-records from main`。
5. 确认左上角分支已经变成 `feature/v2-worldcup-records`。

## 三、上传 V2 文件

把交付 ZIP 解压后，将这些文件按原目录上传到 V2 分支：

- `index.html`
- `app.js`
- `styles.css`
- `VERSION`
- `data/matches.json`
- `data/players.json`
- `scripts/update_data.py`
- `.github/workflows/update-data.yml`

不要上传原始 Excel、客户姓名、余额文件或其他个人信息。

上传时填写提交说明：

```text
feat: build 2026 DG World Cup V2
```

## 四、创建 Pull Request

1. 上传完成后进入 `Pull requests`。
2. 点击 `New pull request`。
3. Base 选择 `main`，Compare 选择 `feature/v2-worldcup-records`。
4. 点击 `Create pull request`。
5. 标题填写 `V2: 首页重构、淘汰赛树和比赛详情升级`。

Pull Request 不会立即改变线上网页，它用于比较 V1 和 V2 的差异。

## 五、验收后正式发布

1. 在 Pull Request 中确认文件无误。
2. 点击 `Merge pull request`，再点击 `Confirm merge`。
3. 等待 GitHub Pages 的 Actions 任务变成绿色。
4. 打开网页并按 `Ctrl + Shift + R` 强制刷新。
5. 确认线上 V2 正常后进入 `Releases`，新建标签 `v2.0.0`。
6. Target 选择 `main`，标题填写 `2026 DG 世界杯全纪录 V2.0.0`，然后发布。

## 六、出现问题时回退

不要删除仓库。进入 `Releases` 找到 `v1.0.0`，下载 V1 文件，然后通过一个新的修复分支和 Pull Request 恢复。不要直接覆盖或删除 `main` 的历史记录。
