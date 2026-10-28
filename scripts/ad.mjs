#!/usr/bin/env node
import {access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {loadConfig,readInput,invokeBackend,redactError} from './config.mjs';
import {validateManagedPolicy} from './managed-core.mjs';
import {startManaged,managedStatus,stopManaged,reconcileManaged} from './managed.mjs';
import {createKnowledgeClient} from './knowledge.mjs';
export async function adMain(args=process.argv.slice(2),{inputReader=readInput,print=value=>console.log(JSON.stringify(value,null,2))}={}){
const [mode,action,...tail]=args,flags={};
try{
 if(!(mode==='managed'&&['status','stop','reconcile'].includes(action)))for(let i=0;i<tail.length;i++){const key=tail[i];if(key==='--confirm-managed'){flags[key]=true;continue;}if(!['--platform','--account',...(mode==='knowledge'?['--query','--path','--start-line','--max-lines']:[]),...(mode==='report'?['--file','--encoding','--snapshot','--baseline','--details','--report','--tool','--metric','--limit','--order','--text','--format','--output']:[])].includes(key)||!tail[i+1]||flags[key])throw Error('未知或重复参数');flags[key]=tail[++i];}
 let result;
 if(!mode||['help','--help'].includes(mode))result={commands:['doctor','capabilities [PLATFORM]','report import|capture|build|query|compare|merge-details|export','actions [PLATFORM]','describe ACTION --platform PLATFORM','read ACTION --platform PLATFORM [--account ID]','prepare ACTION --platform PLATFORM --account ID','execute ACTION --platform PLATFORM --account ID','knowledge status --platform PLATFORM','knowledge search --platform PLATFORM --query TEXT','knowledge read --platform PLATFORM --path RELATIVE_MD','assess supply|diagnose|marketing --platform qianchuan','managed validate','managed start --confirm-managed','managed status SESSION_ID','managed stop SESSION_ID','managed reconcile SESSION_ID'],input:'read/prepare/execute stdin={params,authorization?}; managed validate/start stdin=explicit user policy',default:'一次操作结束即关闭临时后台；不会打开网页或恢复旧托管。'};
 else if(mode==='assess'){
  if(flags['--platform']!=='qianchuan')throw Error('乘方规则评估请选择qianchuan');const config=await loadConfig();
  const module=await import(pathToFileURL(path.join(config.backendRoot,'chengfang-policy.mjs'))),method={supply:'assessChengfangSupply',diagnose:'diagnoseChengfang',marketing:'buildChengfangMetrics'}[action];
  if(!method)throw Error('规则评估命令为supply、diagnose或marketing');result={ok:true,source:'provided_evidence',assessment:module[method](await inputReader()),advertisingRequests:0};
 }else if(mode==='report'){
  const config=await loadConfig({requireBackend:action==='capture'}),service=await import('./report-service.mjs');
  const input=await inputReader(),platform=flags['--platform'];
  const assertPlatform=async(kind,value)=>{if(platform){const stored=await (kind==='snapshot'?service.loadSnapshot:service.loadReport)(config,value);if(stored.profile.platform!==platform)throw Error('报表平台与本子Skill不一致');}};
  if(input.profile&&platform&&input.profile.platform!==platform)throw Error('导入资料平台与本子Skill不一致');
  if(action==='import')result=await service.importReport(config,{...input,file:flags['--file']||input.file,encoding:flags['--encoding']||input.encoding});
  else if(action==='capture')result=await service.captureReport(config,{...input,platform:platform||input.platform,accountId:flags['--account']||input.accountId},invokeBackend);
  else if(action==='build'){await assertPlatform('snapshot',flags['--snapshot']);result=await service.createReport(config,flags['--snapshot'],input);}
  else if(action==='query'){await assertPlatform('snapshot',flags['--snapshot']);result=await service.queryReport(config,flags['--snapshot'],{...input,tool:flags['--tool']||input.tool,metric:flags['--metric']||input.metric,limit:Number(flags['--limit']||input.limit||10),order:flags['--order']||input.order||'desc',text:flags['--text']||input.text||''});}
  else if(action==='compare'){await assertPlatform('snapshot',flags['--snapshot']);await assertPlatform('snapshot',flags['--baseline']);result=await service.compareReportSnapshots(config,flags['--snapshot'],flags['--baseline'],input);}
  else if(action==='merge-details'){await assertPlatform('snapshot',flags['--snapshot']);await assertPlatform('snapshot',flags['--details']);result=await service.mergeReportDetails(config,flags['--snapshot'],flags['--details']);}
  else if(action==='export'){await assertPlatform('report',flags['--report']);result=await service.exportReport(config,flags['--report'],{...input,format:flags['--format']||input.format||'json',output:flags['--output']||input.output});}
  else throw Error('未知report命令');result={ok:true,...result};
 }else if(mode==='knowledge'){
  const config=await loadConfig({requireBackend:false}),client=await createKnowledgeClient(config),platform=flags['--platform'];
  if(action==='status')result={ok:true,...await client.status(platform)};
  else if(action==='search')result={ok:true,...await client.search(platform,flags['--query'])};
  else if(action==='read')result={ok:true,...await client.read(platform,flags['--path'],{startLine:Number(flags['--start-line']||1),maxLines:Number(flags['--max-lines']||160)})};
  else throw Error('知识库命令为 status、search 或 read');
 }else if(mode==='managed'){
  if(action==='validate'){const p=await inputReader();result={ok:true,policy:validateManagedPolicy(p,{requireAuthorization:false}),authorizationStillRequired:p.explicitManagedAuthorization!==true,started:false};}
  else {const config=await loadConfig();if(action==='start'){
    // start has a flag but no positional entity; parse the token consumed as action separately.
    result={ok:true,...await startManaged(config,await inputReader(),{confirmed:flags['--confirm-managed']===true})};
   }else if(['status','stop','reconcile'].includes(action)){const id=tail[0];result={ok:true,...await ({status:managedStatus,stop:stopManaged,reconcile:reconcileManaged})[action](config,id)};}else throw Error('未知托管命令');}
 }else{
  const config=await loadConfig();
  if(mode==='doctor'){await access(path.join(config.backendRoot,'headless-runtime.mjs'));await access(path.join(config.backendRoot,'headless-actions.mjs'));result={ok:true,configured:true,node:process.version,credentialsRead:false,started:false};}
  else if(mode==='capabilities'){const catalog=await import(pathToFileURL(path.join(config.backendRoot,'headless-actions.mjs')));result={ok:true,capabilities:catalog.describeHeadlessActions(action),localTools:['knowledge.status','knowledge.search','knowledge.read','report.import','report.build','report.query','report.compare','report.merge-details','report.export'],started:false,advertisingRequests:0};}
  else if(mode==='actions'||mode==='describe'){const catalog=await import(pathToFileURL(path.join(config.backendRoot,'headless-actions.mjs')));result=mode==='actions'?catalog.describeHeadlessActions(action):catalog.getHeadlessAction(flags['--platform'],action);}
  else if(['read','prepare','execute'].includes(mode)){const input=await inputReader();result=await invokeBackend(config,{mode,platform:flags['--platform'],accountId:flags['--account'],action,params:input.params||{},authorization:input.authorization});}
  else throw Error('未知命令；使用help查看');
 }
 print(result);return 0;
}catch(e){print({ok:false,error:redactError(e),code:e.code||'AD_OPERATOR_FAILED',...(e.requestDispatched===false?{requestDispatched:false}:{}),...(e.runtime?{runtime:e.runtime}:{}),automaticRetry:false});return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await adMain();
