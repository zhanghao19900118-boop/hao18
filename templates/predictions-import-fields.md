# 初始互动记录导入字段

本模板只用于无现金、不可兑换的站内积分预测记录。

| 字段 | 类型 | 规则 |
|---|---|---|
| record_id | 文本 | 必填、全局唯一；重复值会跳过 |
| profile_id | 文本 | 必填；用户唯一代码、用户名或显示名 |
| created_at | 日期时间 | ISO 日期或日期时间 |
| match_ids | 文本 | 比赛 ID；多场用分号分隔，系统关联第一个有效 ID |
| game | 文本 | 原始比赛描述，保留用于追溯 |
| score | 文本 | 原始比分字段 |
| prediction | 文本 | 必填，1–50 字 |
| supported_team | 文本 | 可空，球队名称 |
| weight | 整数 | 1–100 |
| confidence_percent | 小数 | 0.00–100.00，最多两位小数 |
| result | 枚举 | correct / incorrect / pending |
| points_change | 整数 | 本条积分变化 |
| total_points | 整数 | 本条记录后的累计积分 |
| watched | 布尔 | true / false |

请使用 UTF-8 CSV。不要修改第一行字段名。
