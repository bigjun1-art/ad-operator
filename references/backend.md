# 本地配置与后端接入

运行环境为Node.js 24或更新版本，以及已有广告授权、精确ID传输、报表单位处理和日期范围处理的投流工作台后端。将 `integration/` 中的适配模块复制到后端，并按[接入说明](../integration/backend-patch.md)合并路由和请求校验。

## 配置文件

默认读取 `~/.config/ad-operator/config.json`，也可通过 `AD_OPERATOR_CONFIG` 指定：

```json
{
  "backendRoot": "/absolute/path/to/qianchuan-console",
  "stateRoot": "/absolute/path/to/private-ad-operator-state",
  "maxRequests": 1000,
  "knowledgeRoot": "/absolute/path/to/wiki001",
  "knowledgeCaches": ["/absolute/path/to/official-document-crawl"]
}
```

`stateRoot`默认`~/.local/state/ad-operator`，托管保存在`sessions`，追投回执在`task-receipts`中按账户和计划分隔。`knowledgeRoot`和`knowledgeCaches`指向本机知识库及已有官方正文缓存，调用方法见[知识库说明](knowledge.md)。

凭据由后端已有适配器获取。配置、账户数据、回执和托管记录保存在私人目录，公开仓库发布技能和通用适配代码。

## 调用

`doctor`检查配置与入口文件，`actions/describe`返回当前后端动作及字段。查询账户时取得当前应用的授权列表；查询实际对象和报表时验证范围、单位和完整性。

临时调用启动所属后台的随机本机端口，关闭时释放进程与数据库。持续运行由明确授权的托管命令启动，按期限及停止指令退出。

乘方适配依赖 `chengfang-policy/report/http/tasks/task-store`、配置指纹和已有报表模块。公开集成目录提供新增源码和后端接线差异；完整后端由使用者本机部署。

`maxRequests`限制一次命令实际派发的广告请求数，重试也计数；默认1000，可按业务调用量调整。返回的`runtime.requestMetrics`保留数量、耗时、HTTP状态、平台响应码及请求ID。报表导入与本地知识读取可在未配置backendRoot时独立运行；Excel引擎可通过私人配置`artifactModule`指定绝对入口。
