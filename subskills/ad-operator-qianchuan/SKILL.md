---
name: ad-operator-qianchuan
description: "统一投流助手的千川子Skill：读取千川授权账户、报表、计划和素材，准备与执行明确授权的计划预算、ROI、启停及素材移除。不用于随心推订单或本地推对象。"
---

# 千川子Skill

共用[主Skill](../../SKILL.md)的授权、临时运行和托管规则。子入口是本目录 `scripts/ad.mjs`，平台已固定为 `qianchuan`，不能用参数覆盖。所有脚本路径相对本子Skill目录；在其他工作目录运行时使用脚本绝对路径。

```sh
node scripts/ad.mjs actions
node scripts/ad.mjs describe plan.budget.set
```

用 `accounts.list` 从千川PC应用本次真实授权中定位单一账户；不能把随心推应用可见的同ID账户当作千川已授权。

- 报表：`overview.get`按明确的 `dim` 和 `scene` 查询。`all`为整体但不含标准；标准报表用 `dim=standard`，不能混作全账户所有业务总额。
- 配置：`plans.list`当前用于全域、乘方配置，`plan.detail`需要真实 `ad_id`。标准计划或主播汇总ID不能传给全域计划修改接口。
- 资金：`balance.get`明确给出余额元值和千分之一分原值；账户预算读取与计划预算操作分别处理。
- 修改：`plan.budget.set`、`plan.roi.set`、`plan.status.set`先准备并回读当前计划；执行遵循主Skill已经取得的明确用户授权。参数以describe为准，不从网页默认账户继承。
- 素材：`materials.list`、`materials.remove`按指定账户和计划处理，移除需确认实际成员及用户明确允许的精确ID，不能以账户素材库表现冒充计划内单素材表现。

官方支付/净成交ROI与计算值分开。缺失单位、金额或官方ROI时不补零、不猜比例，不用实付金额/消耗比较官方目标。托管仅使用已授权计划预算、ROI及启停动作，策略、预算和期限由用户明确，不能自动迁移旧策略。
