---
name: ad-operator-local
description: "通过自然对话查询巨量本地推知识、账户、标准项目和单元、素材及历史受众，执行授权的账户日预算、标准项目预算和项目/单元启停。"
---

# 巨量本地推子 Skill

遵循[主 Skill](../../SKILL.md)的授权和运行规则。本目录 `scripts/ad.mjs` 固定平台为 `local`。

规则、产品用法和诊断先检索[本地推知识库](../../references/knowledge.md)，读取命中正文及适用日期：

```sh
node scripts/ad.mjs knowledge search --query '直播 全域'
node scripts/ad.mjs knowledge read --path '结果中的库内相对路径.md'
node scripts/ad.mjs actions
node scripts/ad.mjs describe account.budget.set
```

## 对象和金额

- `accounts.list`取得本次应用授权的账户，按精确账户ID查询。`projects.list/promotions.list/project.detail`读取标准项目和单元配置。
- `account.budget.get/set`管理账户日预算，单位元、最多两位小数。`BUDGET_MODE_DAY`设置金额，`BUDGET_MODE_INFINITE`省略金额；读取ALL且金额0的已确认别名显示不限预算。
- `project.detail`保留预算、出价的分原值，并给出元值；`project.budget.set`按元输入，由后端转换为分。
- `project.status.set/promotion.status.set`按完整配置中的精确项目或单元ID执行，保存逐项回执并核对实际状态。
- 隔日预算受理后，按原回执的生效日期查询结果。未明请求使用原requestKey核实。
- `materials.list`读取素材。`global.audience.get`查询前一天及更早日期的受众分布；直播使用本账户已授权`aweme_id`，门店按`poi_ids`筛选。

当前入口的预算和启停操作范围为账户及标准项目/单元。本地推全域对象的整场预算、目标ROI、素材生命周期与全域对象启停尚未接入。

连续监控选择标准投放范围及对应`mgoal/delivery`，使用已授权的项目预算、项目/单元启停和账户日预算动作。规则、金额边界与期限见[持续运行](../../references/managed.md)。

## 报表分析

用户提供本平台CSV或要求生成复盘时，使用[快照报表操作](../../references/reports.md)。子Skill沿用本平台参数，保留账户身份、金额单位、归因窗口与退款成熟度，支持查询、分组、期间对比和四表导出。
