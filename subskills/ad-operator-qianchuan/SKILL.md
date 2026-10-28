---
name: ad-operator-qianchuan
description: "通过自然对话管理千川标准、全域和乘方投放：检索官方知识，读取分区报表、素材和计划配置，执行授权的预算、ROI、启停与素材追投，支持指定对象的分钟跟踪。"
---

# 千川子 Skill

遵循[主 Skill](../../SKILL.md)的账户授权、执行和运行规则。本目录 `scripts/ad.mjs` 固定平台为 `qianchuan`；其他目录使用绝对脚本路径。

## 先读本次业务资料

乘方指标、星选、达人合作、素材追投及策略问题先检索知识库并读正文：

```sh
node scripts/ad.mjs knowledge search --query '乘方 综合营销 ROI'
node scripts/ad.mjs knowledge search --query '星选 素材 授权'
node scripts/ad.mjs knowledge read --path '结果中的库内相对路径.md'
```

按来源的产品、场景和日期采用规则。官方建议作为建议，经营预算、ROI目标、阈值和期限来自用户。

## 查询和操作

- `accounts.list` 取得千川PC应用授权；`plans.list` 取得全域和乘方的真实计划ID与产品类型；`plan.detail`读取配置。
- 乘方使用 `marketing.fields.get` 与 `marketing.report.get`。明确直播或商品、期间与跟踪层级，按配置返回的实际字段和单位读取综合营销ROI、佣金及素材表现。详细字段见[乘方操作](../../references/chengfang.md)。
- 标准及既有汇总入口用 `overview.get`。`dim=all` 汇总标准以外的整体投放，标准使用 `dim=standard`；直播汇总对象为主播。
- `logs.list`按账户或精确计划读取近期操作记录；`marketing.diagnose`结合报表、配置和余额给出当前发现。
- `marketing.context.get`读取计划佣金、星选和商品等配置；`assess supply`按实际素材来源、绑定和授权证据检查投放条件。
- `plan.budget.set`、`plan.roi.set`、`plan.status.set`按用户指定的真实计划执行。保持当前优化目标，查询修改后的值。
- `materials.list`提供计划素材名称、ID和状态；`marketing.report.get`用于素材表现；`materials.remove`按精确素材清单移除。
- 追投使用 `boost.create/update/status.set`，查询使用 `boost.tasks.list/task.get/receipt.get`。先 `describe`、再准备与执行，按原requestKey查询不明结果。

连续监控用 `monitor` 绑定账户、商品计划、主播、素材或任务。选择对应期间的官方ROI或具名计算值，设置观察窗口、连续命中、冷却、预算与允许动作，见[持续运行](../../references/managed.md)。

## 报表分析

用户提供本平台CSV或要求生成复盘时，使用[快照报表操作](../../references/reports.md)。子Skill沿用本平台参数，保留账户身份、金额单位、归因窗口与退款成熟度，支持查询、分组、期间对比和四表导出。
