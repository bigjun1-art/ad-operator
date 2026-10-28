import {createHash} from 'node:crypto';
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const ratio=(a,b,k=1)=>n(a)!==null&&n(b)!==null&&b>0?a/b*k:null;
const canonical=v=>JSON.stringify(v,(_k,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const METRICS=Object.freeze({
 cost:{label:'消耗',unit:'元'},pay_gmv:{label:'支付成交金额',unit:'元'},net_gmv:{label:'净成交金额',unit:'元'},marketing_cost:{label:'综合营销投入',unit:'元'},estimated_commission:{label:'预估佣金',unit:'元'},estimated_leader_service_fee:{label:'预估团长服务费',unit:'元'},budget:{label:'对应期间预算',unit:'元'},
 impressions:{label:'展示次数',unit:'次'},clicks:{label:'点击次数',unit:'次'},conversions:{label:'转化次数',unit:'次'},orders:{label:'订单数',unit:'单'},viewers:{label:'观看人数',unit:'人'},views:{label:'观看次数',unit:'次'},natural_viewers:{label:'自然流量观看人数',unit:'人'},watch_seconds:{label:'累计观看时长',unit:'秒'},duration_seconds:{label:'直播时长',unit:'秒'},
 reported_payment_roi:{label:'平台支付ROI',unit:'比值',official:true},reported_net_roi:{label:'平台净成交ROI',unit:'比值',official:true},reported_marketing_roi:{label:'平台综合营销ROI',unit:'比值',official:true},
 payment_roi:{label:'支付金额/消耗',unit:'比值',numerator:'pay_gmv',denominator:'cost'},net_roi:{label:'净成交金额/消耗',unit:'比值',numerator:'net_gmv',denominator:'cost'},calculated_marketing_roi:{label:'净成交金额/综合营销投入',unit:'比值',numerator:'net_gmv',denominator:'marketing_cost'},
 ctr:{label:'点击率',unit:'%',numerator:'clicks',denominator:'impressions',factor:100},cpc:{label:'平均点击成本',unit:'元/次',numerator:'cost',denominator:'clicks'},cpm:{label:'千次展示成本',unit:'元/千次',numerator:'cost',denominator:'impressions',factor:1000},cpa:{label:'平均转化成本',unit:'元/次',numerator:'cost',denominator:'conversions'},cost_per_order:{label:'平均每单成本',unit:'元/单',numerator:'cost',denominator:'orders'},payment_per_1000_views:{label:'千次观看支付金额',unit:'元/千次',numerator:'pay_gmv',denominator:'views',factor:1000},average_watch_seconds:{label:'人均观看时长',unit:'秒/人',numerator:'watch_seconds',denominator:'viewers'}
});
const base=Object.entries(METRICS).filter(([,v])=>!v.numerator&&!v.official).map(([k])=>k);
export function deriveMetrics(values){const out={...values};for(const [k,m]of Object.entries(METRICS))if(m.numerator)out[k]=ratio(values[m.numerator],values[m.denominator],m.factor||1);return out;}
export function aggregateReportRows(rows){
 const values={},coverage={};
 for(const k of base){const present=rows.map(r=>n(r.values[k])).filter(v=>v!==null);coverage[k]={knownRows:present.length,totalRows:rows.length,knownTotal:present.length?present.reduce((a,b)=>a+b,0):null};values[k]=rows.length&&present.length===rows.length?coverage[k].knownTotal:null;}
 const result=deriveMetrics(values);for(const[k,m]of Object.entries(METRICS))if(m.official){result[k]=rows.length===1?n(rows[0].values[k]):null;coverage[k]={knownRows:rows.filter(r=>n(r.values[k])!==null).length,totalRows:rows.length,aggregation:rows.length===1?'single_source_row':'not_additive'};}
 for(const key of ['viewers','natural_viewers'])if(rows.length>1){result[key]=null;coverage[key].aggregation='row_sum_not_cross_row_deduplicated';}
 return {metrics:result,coverage,metricBasis:{viewers:'single_row_unique_viewers_only',natural_viewers:'single_row_unique_viewers_only',average_watch_seconds:'total_watch_seconds_divided_by_sum_of_row_viewers'},rowCount:rows.length,objectCount:new Set(rows.map(r=>r.objectKey)).size};
}
const projectRow=r=>({rowNumber:r.rowNumber,objectKey:r.objectKey,identity:r.identity,values:Object.fromEntries(Object.entries(deriveMetrics(r.values)).filter(([k])=>METRICS[k]||['campaignId','materialId','sessionId','date','name','materialName','campaignName'].includes(k)).map(([k,v])=>[k,typeof v==='string'?v.slice(0,500):v]))});
function selectedRows(snapshot,filter={}){return snapshot.rows.filter(r=>Object.entries(filter).every(([key,value])=>r.values[key]===value||r.identity?.[key]===value));}
export function buildReport(snapshot,{thresholds=[],groupBy}={}){
 if(!snapshot?.id||!Array.isArray(snapshot.rows)||!snapshot.profile)throw Error('报表需要有效快照');
 if(!Array.isArray(thresholds))throw Error('thresholds需要数组');
 for(const t of thresholds){if(!METRICS[t.metric]||!['lt','lte','gt','gte'].includes(t.op)||n(t.value)===null)throw Error('诊断阈值需要有效指标、比较符和数值');if(t.minSamples&&(!METRICS[t.minSamples.metric]||n(t.minSamples.value)===null||t.minSamples.value<0))throw Error('样本门槛字段或数值无效');}
 if(groupBy&&!['date','campaignId','materialId','sessionId','advertiserId','douyinId'].includes(groupBy))throw Error('不支持的分组字段');
 const findings=[];for(const row of snapshot.rows){const metrics=deriveMetrics(row.values);for(const t of thresholds){const value=n(metrics[t.metric]);if(value===null||t.minSamples&&(n(metrics[t.minSamples.metric])===null||metrics[t.minSamples.metric]<t.minSamples.value))continue;const hit={lt:value<t.value,lte:value<=t.value,gt:value>t.value,gte:value>=t.value}[t.op];if(hit)findings.push({rowNumber:row.rowNumber,objectKey:row.objectKey,metric:t.metric,value,identity:row.identity,objectId:row.values.materialId??row.values.campaignId??row.values.sessionId??row.identity?.advertiserId??null,sample:t.minSamples?{metric:t.minSamples.metric,value:metrics[t.minSamples.metric],minimum:t.minSamples.value}:null,condition:{op:t.op,value:t.value,minSamples:t.minSamples||null},kind:'configured_threshold',source:'user_configured',snapshotId:snapshot.id});}}
 const groups=[];if(groupBy){const map=new Map();for(const row of snapshot.rows){const key=row.values[groupBy]??row.identity?.[groupBy]??null;if(key===null)continue;if(!map.has(key))map.set(key,[]);map.get(key).push(row);}for(const[key,rows]of map)groups.push({key,...aggregateReportRows(rows)});}
 return {version:1,id:hash({snapshotId:snapshot.id,thresholds,groupBy:groupBy||null}),snapshotId:snapshot.id,profile:snapshot.profile,complete:snapshot.complete===true,rejectedRows:snapshot.rejected?.length||0,summary:aggregateReportRows(snapshot.rows),findingCount:findings.length,affectedObjectCount:new Set(findings.map(f=>f.objectKey)).size,findings,groups,configuration:{thresholds,groupBy:groupBy||null}};
}
export function querySnapshot(snapshot,{tool='summary',metric,limit=10,order='desc',text='',filter={}}={}){
 const started=Date.now();if(!['summary','top','search','groups','findings'].includes(tool))throw Error('未知报表查询工具');
 if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('limit需要1至200');if(!['asc','desc'].includes(order))throw Error('order需要asc或desc');
 const rows=selectedRows(snapshot,filter);let result;
 if(tool==='summary')result=aggregateReportRows(rows);
 else if(tool==='top'){if(!METRICS[metric])throw Error('排序指标不存在');result=rows.map(projectRow).filter(r=>n(r.values[metric])!==null).sort((a,b)=>(a.values[metric]-b.values[metric])*(order==='asc'?1:-1)).slice(0,limit);}
 else if(tool==='search'){if(!text.trim())throw Error('搜索内容不能为空');result=rows.filter(r=>JSON.stringify(r.raw||r.values).toLowerCase().includes(text.toLowerCase())).slice(0,limit).map(projectRow);}
 else if(tool==='groups'){if(!['date','campaignId','materialId','sessionId'].includes(metric))throw Error('分组请指定date、campaignId、materialId或sessionId');result=buildReport({...snapshot,rows},{groupBy:metric}).groups.slice(0,limit);}
 else throw Error('findings请使用已生成报告的findings，不在查询时猜测阈值');
 return {snapshotId:snapshot.id,result,trace:{tool,arguments:{metric:metric||null,limit,order,text,filter},snapshotId:snapshot.id,sourceRowNumbers:Array.isArray(result)&&['top','search'].includes(tool)?result.map(r=>r.rowNumber):rows.map(r=>r.rowNumber),candidateRowNumbers:rows.map(r=>r.rowNumber),matchedRows:rows.length,returnedCount:Array.isArray(result)?result.length:1,elapsedMs:Date.now()-started,status:'completed'}};
}
export function compareReports(current,baseline,{metrics=['cost','pay_gmv','payment_roi']}={}){
 if(current.complete!==true||baseline.complete!==true)throw Error('期间比较需要两份完整快照');
 const c=current.profile,b=baseline.profile;
 if(!c.scene||!b.scene)throw Error('期间比较需要明确两份资料的scene场景');for(const k of ['platform','dataset','level','roiType','refundMaturity','scene','dataPeriod'])if(c[k]!==b[k])throw Error('比较口径不一致：'+k);
 if(canonical(c.identity)!==canonical(b.identity))throw Error('比较账户身份不一致');
 for(const k of ['timezone','attributionWindow'])if(c.period[k]!==b.period[k])throw Error('比较期间口径不一致：'+k);
 const days=p=>(Date.parse(p.end)-Date.parse(p.start))/86400000+1;if(days(c.period)!==days(b.period))throw Error('比较期间天数不一致');
 const a=aggregateReportRows(current.rows),d=aggregateReportRows(baseline.rows);
 return {snapshotId:current.id,baselineSnapshotId:baseline.id,metrics:metrics.map(metric=>{if(!METRICS[metric])throw Error('比较指标不存在');const now=n(a.metrics[metric]),before=n(d.metrics[metric]);return {metric,current:now,baseline:before,delta:now!==null&&before!==null?now-before:null,changePercent:now!==null&&before!==null&&before!==0?(now-before)/Math.abs(before)*100:null};})};
}
export function mergeSessionDetails(snapshot,details){
 const a=snapshot.profile,b=details.profile;
 for(const k of ['platform','dataset','level','roiType','refundMaturity','scene','dataPeriod'])if(a[k]!==b[k])throw Error('场次资料口径不同：'+k);
 if(a.dataset!=='livestream'||a.level!=='session'||canonical(a.identity)!==canonical(b.identity)||canonical(a.period)!==canonical(b.period))throw Error('场次资料身份、粒度或期间不一致');
 const rows=snapshot.rows.map(r=>({...r,values:{...r.values}})),used=new Set(),matches=[],unmatched=[];
 for(const row of rows){const id=row.values.sessionId;if(!id){unmatched.push({rowNumber:row.rowNumber,reason:'missing_stable_session_id'});continue;}
  const candidates=details.rows.filter(d=>d.values.sessionId===id&&['advertiserId','douyinId','anchorId'].every(k=>{const a=row.identity?.[k]??row.values[k],b=d.identity?.[k]??d.values[k];return a===undefined&&b===undefined||a!==undefined&&a===b;}));
  if(candidates.length!==1||used.has(candidates[0]?.rowNumber)){unmatched.push({rowNumber:row.rowNumber,reason:candidates.length>1?'ambiguous_session':'missing_or_reused_session'});continue;}
  const detail=candidates[0];if((row.refundMaturity??snapshot.profile.refundMaturity)!==(detail.refundMaturity??details.profile.refundMaturity))throw Error('场次退款成熟度不一致');
  for(const[k,v]of Object.entries(detail.values)){if(v==null)continue;if(row.values[k]!=null&&row.values[k]!==v)throw Error('场次字段冲突：'+k);row.values[k]=v;}
  used.add(detail.rowNumber);matches.push({rowNumber:row.rowNumber,detailRowNumber:detail.rowNumber,sessionId:id});
 }
 const out={...snapshot,id:hash({main:snapshot.id,details:details.id,matches}),rows,complete:snapshot.complete&&details.complete&&unmatched.length===0,detailJoin:{snapshotId:details.id,matches,unmatched,unusedDetailRows:details.rows.filter(r=>!used.has(r.rowNumber)).map(r=>r.rowNumber)}};return out;
}
const col=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
export function workbookTables(snapshot,report){
 if(report.snapshotId!==snapshot.id)throw Error('报告与快照不匹配');
 const ids=['advertiserId','douyinId','anchorId','campaignId','materialId','sessionId','date'];
 const metrics=Object.keys(METRICS),columns=[...ids,...metrics],rawHeaders=snapshot.headers||[];
 const raw=[['原始行号',...rawHeaders,...columns.map(k=>METRICS[k]?.label||k)]];
 const detail=[['原始行号',...columns.map(k=>METRICS[k]?.label||k)]];
 for(const[rowIndex,r]of snapshot.rows.entries()){
  const derived=deriveMetrics(r.values),line=rowIndex+2,offset=1+rawHeaders.length;
  const sourceValues=rawHeaders.map(h=>Array.isArray(r.raw)?r.raw[rawHeaders.indexOf(h)]??null:r.raw?.[h]??null);
  const values=columns.map(k=>r.values[k]??r.identity?.[k]??null);
  for(const[k,m]of Object.entries(METRICS))if(m.numerator){const a=col(offset+columns.indexOf(m.numerator))+line,b=col(offset+columns.indexOf(m.denominator))+line;values[columns.indexOf(k)]={formula:`=IF(OR(${a}="",${b}="",${b}=0),"",${a}/${b}*${m.factor||1})`,value:derived[k]};}
  raw.push([r.rowNumber,...sourceValues,...values]);detail.push([r.rowNumber,...columns.map(k=>derived[k]??r.identity?.[k]??null)]);
 }
 const summary=[['统计项目','数值','统计口径'],['快照ID',snapshot.id,'单次导入或采集结果'],['数据完整',report.complete?'是':'否','含拒绝行或未匹配场次时为否'],['有效行数',report.summary.rowCount,'有效源数据行'],['不同投放对象',report.summary.objectCount,'objectKey去重'],['命中条件数',report.findingCount,'一对象可能命中多个条件'],['涉及不同对象',report.affectedObjectCount,'命中条件的objectKey去重']];
 for(const[k,m]of Object.entries(METRICS)){const cov=report.summary.coverage[k];summary.push([m.label,report.summary.metrics[k]??null,cov?`${cov.knownRows}/${cov.totalRows}行有值；${cov.aggregation||m.unit}`:`按总分子/总分母计算；${m.unit}`]);}
 if(report.groups.length){summary.push(['分组','行数','对象数',...metrics.map(k=>METRICS[k].label)]);for(const g of report.groups)summary.push([String(g.key),g.rowCount,g.objectCount,...metrics.map(k=>g.metrics[k]??null)]);}
 summary.push(['期间开始',snapshot.profile.period.start],['期间结束',snapshot.profile.period.end],['时区',snapshot.profile.period.timezone],['退款成熟度',snapshot.profile.refundMaturity||'unknown'],['ROI口径',snapshot.profile.roiType||'unknown']);
 const dict=[['字段ID','名称','单位','计算依据','来源'],...Object.entries(METRICS).map(([k,m])=>[k,m.label,m.unit,m.numerator?`${m.numerator}/${m.denominator}*${m.factor||1}`:'源字段',m.official?'平台原始指标':m.numerator?'本地计算':'原始字段单位换算']),['viewers汇总','多行人数保持空值，已知部分列给逐行人数之和；未跨行去重','','按逐行人数加权计算观看时长',''],['空值','未取得或不可计算','','保持空白，不补零',''],['归因窗口',snapshot.profile.period.attributionWindow||'未提供','','来源配置',''],['退款成熟度',snapshot.profile.refundMaturity||'unknown','','来源配置','']];
 return {snapshotId:snapshot.id,sheets:[{name:'场次核心明细',rows:detail},{name:'周报汇总',rows:summary},{name:'数据底表',rows:raw},{name:'数据字典',rows:dict}]};
}
export function reportMarkdown(report){
 const fmt=v=>v===null||v===undefined?'未取得':typeof v==='number'?Number(v.toFixed(6)).toString():String(v);
 const safe=v=>fmt(v).replaceAll('|','\\|').replaceAll('\n',' ');
 const lines=[`# 投放分析报告`,'',`快照：${report.snapshotId}`,`期间：${report.profile.period.start} 至 ${report.profile.period.end}（${report.profile.period.timezone}）`,`账户：${Object.entries(report.profile.identity).map(([k,v])=>k+'='+v).join('，')}`,`场景：${report.profile.scene||'未提供'}；退款成熟度：${report.profile.refundMaturity}；归因窗口：${report.profile.period.attributionWindow||'未提供'}。`,`数据完整性：${report.complete?'源行校验通过':'不完整（部分源数据被拒绝或场次未能关联）'}。`,`有效数据 ${report.summary.rowCount} 行、${report.summary.objectCount} 个不同对象；拒绝 ${report.rejectedRows} 行。`,'',`|指标|完整范围数值|单位|原始字段覆盖|已知部分合计|`,`|---|---:|---|---|---:|`];
 for(const[k,m]of Object.entries(METRICS)){const c=report.summary.coverage[k];lines.push(`|${m.label}|${fmt(report.summary.metrics[k])}|${m.unit}|${c?c.knownRows+'/'+c.totalRows+'行':m.numerator+' / '+m.denominator}|${!m.official&&c?fmt(c.knownTotal):'—'}|`);}
 lines.push('','比例按对应总分子除以总分母计算；所需字段有缺失时，完整范围数值保持空白。已知部分合计仅覆盖有值的源行。多行观看人数的已知合计为各行人数之和，未跨行去重；观看时长按各行观看人数加权。');
 if(report.groups.length){lines.push('','## 分组结果','',`分组字段：${report.configuration.groupBy}`,'','|分组|有效行|不同对象|消耗(元)|支付金额(元)|支付金额/消耗|','|---|---:|---:|---:|---:|---:|');for(const g of report.groups)lines.push(`|${safe(g.key)}|${g.rowCount}|${g.objectCount}|${fmt(g.metrics.cost)}|${fmt(g.metrics.pay_gmv)}|${fmt(g.metrics.payment_roi)}|`);}
 lines.push('','## 指定条件的命中结果','',`命中 ${report.findingCount} 条条件，涉及 ${report.affectedObjectCount} 个不同对象。`);
 for(const f of report.findings)lines.push(`- 对象 ${safe(f.objectId||f.objectKey)}，源数据第 ${f.rowNumber} 行：${METRICS[f.metric].label} ${fmt(f.value)}，条件 ${f.condition.op} ${f.condition.value}${f.sample?'；样本条件 '+METRICS[f.sample.metric].label+' ≥ '+f.sample.minimum+'，实际 '+fmt(f.sample.value):''}。`);
 return lines.join('\n')+'\n';
}
