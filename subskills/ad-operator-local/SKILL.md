---
name: ad-operator-local
description: "统一投流助手的巨量本地推子Skill：查询授权账户、标准项目和单元、素材及历史受众，准备与执行明确授权的账户日预算、标准项目预算及项目/单元启停。区分标准对象与LIVE_ROI2、POI_ROI2全域对象。"
---

# 本地推子Skill

遵循[主Skill](../../SKILL.md)的授权与运行规则。本目录 `scripts/ad.mjs`固定平台 `local`；跨平台操作回主Skill重新路由，不覆盖子入口的平台参数。

```sh
node scripts/ad.mjs actions
node scripts/ad.mjs describe account.budget.set
```

用 `accounts.list`定位本次授权的精确单一账户。`projects.list`、`promotions.list`、`project.detail`属于标准对象配置；不能把网页全域计划ID直接作为标准项目ID。

- 账户预算：`account.budget.get/set`管理整个账户，单位元、最多两位小数，不等于整场或项目预算。读取ALL且预算0的已核验别名保留原值并显示不限预算；更新只发送DAY/INFINITE对应枚举。不限预算省略金额。
- 立即与隔日：先读取原预算供prepare核对；隔日受理不称已生效，未到可靠提交回执中的申请日期时不解除待核实。未知请求不重发，关闭后操作回执仍由原后端保留。
- 项目预算：`project.detail`保留分原值并给出元值；`project.budget.set`参数为元，后端精确转分，不能把账户预算元值规则套到项目原值。
- 启停：`project.status.set`、`promotion.status.set`只操作该账户完整配置中实际存在的标准对象。只取得逐项受理回执、未核对实际状态时，不称已经生效。
- 素材与受众：按`materials.list`和`global.audience.get`当前字段执行；直播全域历史必须明确本账户已授权的 `aweme_id`，门店按相应门店筛选。历史受众为T-1及以前，不是实时账户主报表。

当前公开MAPI没有已确认的本地推全域对象预算、目标ROI与素材生命周期专用写入；全域启停与标准对象映射也未明确。保持具体不可用说明，不转用标准项目或历史网页接口冒充。

连续监控限定标准投放实时范围，允许的自动动作是已授权标准项目预算、项目/单元启停及账户预算。范围不完整、金额或官方ROI缺失时不产生对应动作。
