# 四个参考仓库与融合代码

比较版本固定在2026-10-28下载的提交。下面列出参考机制、对应源码和本技能的实际接入点。

| 仓库与提交 | 参考代码 | 已融入现有技能 |
|---|---|---|
| [westng/ocean-watch](https://github.com/westng/ocean-watch/tree/9b05b3b51c1dba8a8f95937976e95162b5e748e3) | `runtime/ocean-watch-go/internal/platform/pagination/page.go`、`platform/requestcontrol/control.go`、`contracts/capabilities.go` | 后端`data-core.mjs`检查分页页码、稳定总量、重复观测和缺页，保留逐页请求回执；`command-request-context.mjs`统计单命令实际请求并控制上限；`headless-actions.mjs`统一读写属性与预检关系。 |
| [fengx8534-tech/qianchuan-ads-automation](https://github.com/fengx8534-tech/qianchuan-ads-automation/tree/476360308b1ed581b130be80b6a6ed338ff79069) | `local-backend/lib/collection-integrity.js`、`lib/single-flight.js`、`local-backend/server.js`的采集与建议流程 | `managed-core.mjs`、`observation-integrity.mjs`绑定采集时间与建议有效期，记录采集健康状态；证据过期后停止规则判断，建议保留策略、对象及意图绑定。 |
| [ChenYouXin8/ad-review-analyst](https://github.com/ChenYouXin8/ad-review-analyst/tree/aff02814ad597a638be92d247b78eda89b104381) | `CsvImportService.java`、`ReportService.java`、`AdDataAnalyticsTools.java`、`AnalysisService.java` | `report-input.mjs`导入CSV并保留原始行；`report-service.mjs`保存单次快照；`report-analysis.mjs`提供汇总、排序、搜索、分组与按指定条件诊断，每次查询保留独立轨迹。 |
| [639happy/qianchuan-live-weekly-report-skill](https://github.com/639happy/qianchuan-live-weekly-report-skill/tree/aa3a811f0d17d5c0e299634c0ebe4b1b551abe2d) | `qianchuan-live-weekly-report/scripts/normalize-inputs.mjs`、`metrics.mjs`、`build-weekly-report.mjs`、`verify-weekly-report.mjs` | 角色明确的账户身份、统计期间与退款成熟度进入快照；场次按精确ID一对一关联；同一指标定义生成计算值、底表公式和字典，四表导出后逐格回读。 |

## 比较中定位到的具体问题

| 位置 | 原实现现象 | 融合实现 |
|---|---|---|
| ad-review 的ID解析 | ID经double转换，大整数可能失去精度 | ID作为字符串校验和保存 |
| ad-review 的空值与排序 | 缺失数字补零，未知指标回退ROI | 空值传播，未知指标报错，排序排除缺失值 |
| ad-review 的汇总计数 | 行数作为计划数、异常条目数作为异常计划数 | 行数、不同对象数、命中条件数和涉及对象数分别计算 |
| ad-review 的异常标签 | 横截面低CTR被称为素材疲劳，相对高消耗被称为超预算 | 记录指标与条件命中现象，诊断门槛来自用户配置 |
| 周报的场次关联 | 同分钟候选可能跨账户、错场次或重复消费详情 | 账户角色和唯一sessionId一对一关联，字段冲突拒绝 |
| 周报的日期与分组 | 无效日历日期可通过，六组数据与固定期间区域覆盖 | 真日历校验，区域随分组行数排列 |
| 周报的自定义列公式 | 字段映射变化可生成null列地址 | 规范字段映射同时驱动计算、列地址和字典 |
| 自动化的采集依赖 | 采集失败后仍可能继续分析旧文件 | 读取完整性、来源时间和有效期通过后才判断规则 |
| OceanWatch 的授权与请求控制 | submit标记不含本技能的意图及截止绑定，Retry-After有截断 | 沿用现有用户授权、配置指纹与平台限流处理，吸收请求计数和目录校验 |

## 代码与许可

融合代码按现有Node.js接口重新实现。三个仓库包含MIT许可：OceanWatch版权`2026 westng`，自动化仓库版权`2026`，周报仓库版权`2026 Mark He`。ad-review-analyst的README声明MIT，但该提交没有LICENSE文件；本技能参考其机制，自行实现CSV、规则和查询代码。

现有账户授权、金额校验、广告动作和回执机制继续由统一投流后端提供。新增报表功能使用本地快照；实际广告调整通过`prepare/execute`或用户明确开启的托管执行。
