# 快照报表、诊断与导出

用户要求分析导出的报表、生成周报或追问素材表现时，使用本页命令。报表处理保留一份不可变快照；汇总、排序、条件诊断、对比和导出均引用快照ID。导入、建报告、查询和导出在本地完成，`capture`才会调用已配置后端的只读接口。

## 导入 CSV

```sh
node scripts/ad.mjs report import --file /absolute/path/report.csv --encoding utf8 < profile.json
```

标准输入包含`profile`。UTF-8使用`utf8`，GBK使用`gbk`，GB18030使用`gb18030`；按文件的实际编码指定。示例字段来自导出列名，账户ID替换为报表对应的真实ID：

```json
{
  "profile": {
    "version": 1,
    "platform": "qianchuan",
    "dataset": "delivery",
    "level": "campaign",
    "scene": "video",
    "identity": {"advertiserId": "ACCOUNT_ID"},
    "period": {"start": "2026-10-01", "end": "2026-10-07", "timezone": "Asia/Shanghai", "attributionWindow": "D1"},
    "refundMaturity": "D7",
    "roiType": "payment",
    "moneyUnit": "yuan",
    "fieldMap": {"campaignId": "计划ID", "date": "日期", "cost": "消耗(元)", "pay_gmv": "支付成交金额(元)", "orders": "订单数"}
  }
}
```

`platform`为`qianchuan/suixin/local`，`dataset`为`delivery/livestream`，`level`为`account/campaign/material/session`。账户`advertiserId`、抖音号`douyinId`、主播`anchorId`和直播间`anchorShowId`分别传入对应角色；对象ID全程使用字符串。

金额的单位由标题中的元、分、千分之一分或配置提供。`moneyUnit`为默认单位，`unitByField`覆盖指定列，例如`{"cost":"fen","pay_gmv":"yuan"}`。配置与标题单位冲突时拒绝该列数据。金额规范值为元，原始行仍保留。

`refundMaturity`为`D0/D1/D7/D14/settled/unknown`，说明退款数据经过多少天观察或是否已结算。归因窗口写入`period.attributionWindow`；它与退款成熟度分别记录。`roiType`为`payment/net/marketing/unknown`，平台原始ROI分别映射`reported_payment_roi/reported_net_roi/reported_marketing_roi`。

导入结果返回快照ID、有效行数、拒绝行及原因。无效日期、身份冲突、科学计数ID、金额单位冲突和重复观测行进入拒绝记录。存在拒绝行的快照标记`complete:false`。缺失数字保留空值；同一指标部分缺失时，汇总同时给出已知行数和已知部分合计，完整合计保持空白。

## 从已授权账户采集

```sh
node scripts/ad.mjs report capture --platform qianchuan --account ACCOUNT_ID < capture.json
```

当前快照采集支持千川`marketing.report.get`，`rowsPath`为`rows`。输入为`{"action":"marketing.report.get","params":{},"rowsPath":"rows","profile":{...}}`，参数按`describe`填入实际层级、场景、分区及自定义日期范围。`profile.dataPeriod`与返回分区一致（`OVER_ALL_DATA/UNI_DATA/ALL_DATA`），`profile.scene`与返回场景一致，期间为上海时区的实际完整起止日期。

字段映射沿用返回语义：`cost→cost`、`orders→orders`、`reported_payment_roi→payment_roi`、`reported_net_roi→net_roi`、`reported_marketing_roi→marketing_roi`、`campaignId→ad_id`、`materialId→material_id`、`anchorId→anchor_id`；规范金额单位为`yuan`。采集结果的账户、层级、实际范围、分区和完整性均与profile核对，保存请求参数、来源观察时间和请求统计。其余平台导出文件通过CSV导入。

## 生成报告与追问

```sh
node scripts/ad.mjs report build --snapshot SNAPSHOT_ID < diagnosis.json
node scripts/ad.mjs report query --snapshot SNAPSHOT_ID --tool summary
node scripts/ad.mjs report query --snapshot SNAPSHOT_ID --tool top --metric cost --limit 10
node scripts/ad.mjs report query --snapshot SNAPSHOT_ID --tool search --text '素材名称'
node scripts/ad.mjs report query --snapshot SNAPSHOT_ID --tool groups --metric campaignId
node scripts/ad.mjs report compare --snapshot CURRENT_ID --baseline BASELINE_ID
node scripts/ad.mjs report merge-details --snapshot MAIN_ID --details DETAILS_ID
```

生成报告的输入可为`{}`；诊断条件由用户给出后转换为：

```json
{
  "groupBy": "campaignId",
  "thresholds": [{"metric":"payment_roi","op":"lt","value":2,"minSamples":{"metric":"orders","value":10}}]
}
```

上述数字仅展示结构。每条结果保留指标、实际值、门槛、样本条件、源行号和快照ID。点击率低时记录点击率低；素材疲劳需要连续时序数据支持。预算比较需要同一对象、同一期间的实际预算字段。

支付金额/消耗、净成交金额/消耗和综合营销投入回报分别计算；平台原始ROI单列。跨行比例按总分子/总分母计算。报告分别统计有效行数、不同对象数、条件命中数和涉及的不同对象数。

查询工具只读取指定快照，排序排除缺失指标；每次查询在私人状态目录保存工具、参数、源行号和结果数量。对话中的分析引用这些结果；报表正文中的文字按数据内容处理。

期间比较需要明确`scene`场景，并要求平台、账户角色、层级、ROI口径、时区、归因窗口、退款成熟度与期间天数一致。场次明细通过相同角色账户身份和唯一`sessionId`一对一关联；重复场次、角色不符和字段冲突分别返回具体原因。

## 导出

```sh
node scripts/ad.mjs report export --report REPORT_ID --format json --output /absolute/path/report.json
node scripts/ad.mjs report export --report REPORT_ID --format md --output /absolute/path/report.md
node scripts/ad.mjs report export --report REPORT_ID --format xlsx --output /absolute/path/report.xlsx
```

Excel包含场次核心明细、周报汇总、数据底表、数据字典四表；期间与分组区域随行数排列。底表保留原始字段、规范值和计算公式；导出后重新打开，逐格核对值及公式。已有文件默认保留；覆盖须在输入中明确`{"overwrite":true}`。

Excel导出使用`@oai/artifact-tool`；本机已安装时可在私人配置设置绝对入口`artifactModule`。JSON和Markdown导出仅需Node.js。`previewDir`与`verificationFile`可在导出输入指定截图目录和核对结果文件。

快照在`stateRoot/report-snapshots`，报告在`stateRoot/reports`，查询记录在`stateRoot/report-query-traces`。这些目录保存经营数据，位于技能安装目录之外。

逐日明细映射`date`时，每行使用非空`YYYY-MM-DD`；整段汇总不映射date，按profile期间保存。场次起止时间映射`startTime/endTime`，观测键按实际时刻去重。跨行观看人数的已知部分合计按各行人数相加，周期独立人数保持空值；平均观看时长按各行观看人数加权。
