---
name: ad-operator-suixin
description: "通过自然对话检索随心推官方知识，读取自身应用授权账户、普通订单、商品全域订单和报表，执行明确授权的普通订单终止及限时监控。"
---

# 随心推子 Skill

遵循[主 Skill](../../SKILL.md)的账户、授权和运行规则。本目录 `scripts/ad.mjs` 固定平台为 `suixin`。随心推使用自身应用授权，先取得本次账户列表。

产品规则、订单含义和投放方法先检索[随心推知识库](../../references/knowledge.md)并读取正文：

```sh
node scripts/ad.mjs knowledge search --query '随心推 全域 推商品'
node scripts/ad.mjs knowledge read --path '结果中的库内相对路径.md'
node scripts/ad.mjs actions
node scripts/ad.mjs describe order.terminate
```

## 订单和报表

- `orders.list`获取完整普通订单库存，`order.get`按精确`order_id`定位。库存范围与所选日期的报表订单范围分别保留。
- `uni.orders.list/uni.report.get`查询商品全域订单与报表。当前订单列表入口范围为商品全域；直播全域订单列表尚未接入。
- `overview.get`选择`dim=normal/uni`及直播或视频场景；普通趋势使用`trend.get`。数据完整性状态随结果返回。
- `suggest.roi.get/suggest.bid.get/estimate.get`读取建议与预估。整数预算参数保留平台原始含义；当前元金额与该整数参数的换算尚未确认。

## 终止和连续监控

`order.terminate`终止当前账户完整普通库存中的指定`order_id`，核对成功ID和后续状态。终止会结束订单，恢复动作尚未接入。用户要求暂停或恢复时，说明可用的订单动作并按用户实际授权执行。

持续监控使用`scope.dim=normal`、明确`scene`和普通订单ID，允许明确授权的终止动作。监控指标来自所选账户与场景的普通订单汇总，订单列表限定允许终止的对象。

普通报表金额保留原值和`unitKnown:false`。用户未设置金额条件时，可按订单数运行终止规则；用户给出的金额条件保留在策略中，相关规则待金额单位确认后使用。期限、停止和结果核实见[持续运行](../../references/managed.md)。
