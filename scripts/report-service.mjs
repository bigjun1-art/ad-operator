import {readFile,writeFile,mkdir,link,unlink,rename} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseCsv,decodeCsv,createReportSnapshot} from './report-input.mjs';
import {METRICS,buildReport,querySnapshot,compareReports,mergeSessionDetails,workbookTables,reportMarkdown} from './report-analysis.mjs';
const id=value=>{if(!/^[a-f0-9]{64}$/.test(value||''))throw Error('快照或报告ID需要64位内容摘要');return value;};
const fileFor=(config,kind,value)=>path.join(config.stateRoot,kind,id(value)+'.json');
async function store(config,kind,value){const file=fileFor(config,kind,value.id);await mkdir(path.dirname(file),{recursive:true,mode:0o700});try{await writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const old=JSON.parse(await readFile(file,'utf8'));if(old.id!==value.id)throw Error('已有快照的ID不匹配');}return file;}
export async function loadSnapshot(config,value){const snapshot=JSON.parse(await readFile(fileFor(config,'report-snapshots',value),'utf8'));if(snapshot.id!==value)throw Error('快照ID不匹配');return snapshot;}
export async function loadReport(config,value){const report=JSON.parse(await readFile(fileFor(config,'reports',value),'utf8'));if(report.id!==value)throw Error('报告ID不匹配');return report;}
export async function importReport(config,{file,encoding,profile}){
 if(!file||!path.isAbsolute(file))throw Error('CSV文件需要绝对路径');const bytes=await readFile(file);if(bytes.length>32*1024*1024)throw Error('CSV超过32MiB');
 const {headers,rows}=parseCsv(decodeCsv(bytes,{encoding}));
 const snapshot=createReportSnapshot({rows,headers,profile,source:{kind:'csv_import',fileName:path.basename(file),encoding}});
 const stored=await store(config,'report-snapshots',snapshot);return {snapshotId:snapshot.id,file:stored,rowCount:snapshot.rows.length,rejected:snapshot.rejected,complete:snapshot.complete,advertisingRequests:0};
}
function extractRows(data,rowsPath){let rows=data;if(rowsPath){if(!/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)*$/.test(rowsPath)||rowsPath.split('.').some(v=>['__proto__','constructor','prototype'].includes(v)))throw Error('rowsPath无效');for(const key of rowsPath.split('.'))rows=rows?.[key];}if(!Array.isArray(rows))throw Error('指定位置不是报表行数组，请指定实际rowsPath');return rows;}
export async function captureReport(config,{platform,accountId,action,params={},rowsPath='',profile},invoke){
 if(!config.backendRoot)throw Error('实时采集需要backendRoot');
 const catalog=await import(pathToFileURL(path.join(config.backendRoot,'headless-actions.mjs'))),entry=catalog.getHeadlessAction(platform,action);
 if(entry.method!=='GET'||action!=='marketing.report.get'||platform!=='qianchuan')throw Error('报表采集需要具体账户的只读报表动作');
 if(typeof accountId!=='string'||!/^\d{1,20}$/.test(accountId))throw Error('报表采集需要精确账户ID字符串');
 if(profile.platform!==platform||profile.identity?.advertiserId!==accountId)throw Error('采集账户与报表profile.identity.advertiserId需完全一致');
 const supported={cost:'cost',orders:'orders',reported_payment_roi:'payment_roi',reported_net_roi:'net_roi',reported_marketing_roi:'marketing_roi',campaignId:'ad_id',materialId:'material_id',anchorId:'anchor_id'};
 for(const[k,v]of Object.entries(profile.fieldMap||{}))if((METRICS[k]||supported[k])&&supported[k]!==v)throw Error('该采集动作未提供此字段映射：'+k);
 if(profile.moneyUnit&&profile.moneyUnit!=='yuan'||Object.values(profile.unitByField||{}).some(v=>v!=='yuan'))throw Error('当前采集动作的规范金额单位为yuan');
 const response=await invoke(config,{mode:'read',platform,accountId,action,params});if(response.ok!==true||response.data?.complete!==true||response.data?.paginationComplete===false)throw Error('采集结果未确认完整，未保存报表');
 const d=response.data,scope=d.scope,range=d.range;
 const expectedLevel=profile.level==='campaign'?'plan':profile.level;
 if(!scope||scope.accountId!==accountId||scope.level!==expectedLevel)throw Error('采集结果账户或统计层级与profile不一致');
 if(!range||typeof range.startTime!=='string'||typeof range.endTime!=='string')throw Error('采集结果缺少实际统计起止时间');
 const bound=(value,edge)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value+' '+(edge==='start'?'00:00:00':'23:59:59'):value.replace('T',' ').replace(/\+08:00$/,'');
 if(profile.period.timezone!=='Asia/Shanghai'||bound(profile.period.start,'start')!==bound(range.startTime,'start')||bound(profile.period.end,'end')!==bound(range.endTime,'end'))throw Error('采集实际期间与profile.period不一致');
 if(d.dataPeriod!==undefined&&profile.dataPeriod!==d.dataPeriod)throw Error('采集期间分区与profile.dataPeriod不一致');
 if(!profile.scene||profile.scene!==scope.scene)throw Error('采集场景与profile.scene不一致');
 const rows=extractRows(response.data,rowsPath),headers=Object.keys(rows[0]||{});if(!rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)))throw Error('平台报表行需要对象字段');
 for(const[role,value]of Object.entries(profile.identity)){if(role==='advertiserId')continue;const scoped={anchorId:'anchor_id',douyinId:'douyin_id',anchorShowId:'anchor_show_id'}[role];if(scope[scoped]!==value&&(!profile.fieldMap[role]||!rows.length||!rows.every(row=>row[profile.fieldMap[role]]===value)))throw Error('采集结果未证明profile身份角色：'+role);}
 const snapshot=createReportSnapshot({rows,headers,profile,source:{scene:scope.scene,kind:'live_read',action,params,responseScope:scope,responseRange:range,dataPeriod:d.dataPeriod??null,metricBasis:d.metricBasis??null,requestMetrics:response.runtime?.requestMetrics||null,observedAt:response.data?.observedAt??null,rowsPath}});
 const file=await store(config,'report-snapshots',snapshot);return {snapshotId:snapshot.id,file,rowCount:snapshot.rows.length,rejected:snapshot.rejected,complete:snapshot.complete,requestMetrics:response.runtime?.requestMetrics||null};
}
export async function createReport(config,snapshotId,options={}){const snapshot=await loadSnapshot(config,snapshotId),report=buildReport(snapshot,options),file=await store(config,'reports',report);return {reportId:report.id,snapshotId:report.snapshotId,file,complete:report.complete,summary:report.summary,findingCount:report.findingCount,affectedObjectCount:report.affectedObjectCount,advertisingRequests:0};}
export async function queryReport(config,snapshotId,options){const result=querySnapshot(await loadSnapshot(config,snapshotId),options);const directory=path.join(config.stateRoot,'report-query-traces');await mkdir(directory,{recursive:true,mode:0o700});const traceId=randomUUID(),traceFile=path.join(directory,traceId+'.json');await writeFile(traceFile,JSON.stringify(result.trace,null,2)+'\n',{mode:0o600,flag:'wx'});return {...result,trace:{...result.trace,sourceRowNumbers:result.trace.sourceRowNumbers.slice(0,200),candidateRowNumbers:result.trace.candidateRowNumbers.slice(0,200),sourceRowCount:result.trace.sourceRowNumbers.length,candidateRowCount:result.trace.candidateRowNumbers.length,rowNumberDisplayTruncated:result.trace.sourceRowNumbers.length>200||result.trace.candidateRowNumbers.length>200,traceId,traceFile},advertisingRequests:0};}
export async function compareReportSnapshots(config,current,baseline,options){return {...compareReports(await loadSnapshot(config,current),await loadSnapshot(config,baseline),options),advertisingRequests:0};}
export async function mergeReportDetails(config,snapshotId,detailsId){const snapshot=mergeSessionDetails(await loadSnapshot(config,snapshotId),await loadSnapshot(config,detailsId)),file=await store(config,'report-snapshots',snapshot);return {snapshotId:snapshot.id,file,complete:snapshot.complete,detailJoin:snapshot.detailJoin,advertisingRequests:0};}
async function publish(file,content,overwrite){if(!path.isAbsolute(file))throw Error('导出文件需要绝对路径');await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,content,{mode:0o600,flag:'wx'});if(overwrite)await rename(temp,file);else{await link(temp,file);await unlink(temp);}}catch(e){await unlink(temp).catch(()=>{});throw e;}}
export async function exportReport(config,reportId,{format='json',output,overwrite=false,previewDir,verificationFile}={}){
 const report=await loadReport(config,reportId),snapshot=await loadSnapshot(config,report.snapshotId);if(!['json','md','xlsx'].includes(format))throw Error('支持json、md或xlsx导出');if(!output||!path.isAbsolute(output))throw Error('导出位置需要绝对路径');
 if(format==='xlsx'){const {writeReportWorkbook}=await import('./report-workbook.mjs');return {...await writeReportWorkbook(workbookTables(snapshot,report),output,{artifactModule:config.artifactModule,overwrite,previewDir,verificationFile}),advertisingRequests:0};}
 await publish(output,format==='md'?reportMarkdown(report):JSON.stringify({report,snapshot},null,2)+'\n',overwrite);return {file:output,reportId,snapshotId:snapshot.id,advertisingRequests:0};
}
