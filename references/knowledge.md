# 三平台知识库调用

知识库位于本机 wiki001；配置字段 `knowledgeRoot` 可指定其他库。正文缓存通过 `knowledgeCaches` 指向已取得的官方文档文件夹，保留在私人配置中。

## 入口

| 平台 | 默认入口 |
|---|---|
| 千川 | `02-知识资产/05-投流/巨量千川官方知识链.md`；`03-资料来源/网页/巨量千川官方/千川乘方/千川乘方五层总索引.md` |
| 随心推 | `03-资料来源/网页/巨量千川官方/千川乘方/场景/随心推.md` |
| 本地推 | `02-知识资产/05-投流/巨量本地推官方知识链.md` |

随心推现有索引包含普通投放、全域商品、全域直播、订单数据、续费追投及迁移资料。标题已标明废弃的资料默认从检索结果中排除。

## 查询与阅读全文

```sh
node scripts/ad.mjs knowledge status --platform suixin
node scripts/ad.mjs knowledge search --platform qianchuan --query '乘方 综合营销 ROI'
node scripts/ad.mjs knowledge read --platform qianchuan --path '结果中的库内相对路径.md' --start-line 1 --max-lines 160
```

`search` 返回标题、来源 ID、原始链接、版本、摘要及库内路径。`read` 返回正文、行号、总行数和 `hasMore`；按行继续读取问题所在章节及相邻条件。

`bodySource` 为 `configured_official_document_cache` 时，正文从已配置缓存中的官方文档取得；`vault_text` 为库内正文；`source_navigation_card` 为章节与来源导航卡。导航卡对应的完整正文可通过缓存或原始官方链接读取。

规则解释先读来源原文，按产品、场景、对象和生效时间采用。官方建议保留建议身份；预算、利润目标、筛选阈值和托管期限由用户确定。对当前接口、账户开放状态和实际金额，读取该账户的接口返回。

## 本机配置

```json
{
  "backendRoot": "/absolute/path/to/qianchuan-console",
  "knowledgeRoot": "/absolute/path/to/wiki001",
  "knowledgeCaches": ["/absolute/path/to/official-document-crawl"]
}
```

缓存读取 `docx-文档ID.json` 或 `wiki-文档ID.json` 中的 `data.document.content`，并保留修订号。检索沿三平台入口的库内链接读取；文档与正文缓存通过底层文档 ID 关联。知识查询不会启动广告后台。
