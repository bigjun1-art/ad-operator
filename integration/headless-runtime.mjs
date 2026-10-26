import {normalizeHeadlessRequest,assertHeadlessAuthorization,headlessIntentHash,headlessRoute,getHeadlessAction} from './headless-actions.mjs';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const error=(message,code='HEADLESS_BACKEND')=>Object.assign(Error(message),{code});
export async function startHeadlessChild({startupTimeoutMs=15000}={}){
 const accessKey=randomBytes(32).toString('hex');
 const child=fork(new URL('./headless-server-child.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,WORKBENCH_TEST:'1',WORKBENCH_READONLY_PREVIEW:'1',DISABLE_BACKGROUND:'1',WORKBENCH_HEADLESS_KEY:accessKey},execArgv:[]});
 let exited=false;const exit=new Promise(resolve=>{child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{if(!child.pid){exited=true;resolve();}});});
 const close=async()=>{
  if(exited)return;
  if(child.connected)child.send({type:'shutdown'});else child.kill('SIGTERM');
  const timer=setTimeout(()=>child.kill('SIGTERM'),3000),force=setTimeout(()=>child.kill('SIGKILL'),6000);
  try{await exit;}finally{clearTimeout(timer);clearTimeout(force);}
 };
 try{
  const ready=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(error('临时后台启动超时','HEADLESS_START_TIMEOUT')),startupTimeoutMs);
   child.once('error',()=>{clearTimeout(timer);reject(error('临时后台进程未能启动'));});
   child.once('exit',()=>{clearTimeout(timer);reject(error('临时后台在就绪前已退出'));});
   child.on('message',message=>{if(message?.type==='ready'&&Number.isInteger(message.port)&&message.port>0){clearTimeout(timer);resolve(message);}else if(message?.type==='startup_failed'){clearTimeout(timer);reject(error('临时后台初始化失败'));}});
  });
  return {origin:'http://127.0.0.1:'+ready.port,pid:child.pid,requestHeaders:()=>({'x-workbench-headless-key':accessKey}),close};
 }catch(e){await close();throw e;}
}
export async function withTemporaryBackend(run,{loadBackend,timeoutMs=120000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000)throw error('临时请求超时范围应为100–300000毫秒','HEADLESS_INPUT');
 let backend,started=false,ownedBackend=false,childRuntime;
 try{
  if(loadBackend)backend=await loadBackend();
  else childRuntime=await startHeadlessChild();
  if(backend){const {server}=backend;if(server.listening)throw error('临时入口不会接管已有监听实例','HEADLESS_EXISTING_SERVER');ownedBackend=true;
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});started=true;
  }
  const origin=childRuntime?.origin||'http://127.0.0.1:'+backend.server.address().port;
  const request=async({method='GET',path,body,writeDeadline})=>{
   const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',origin,'x-workbench-execution-mode':'live',...(childRuntime?.requestHeaders()||backend?.requestHeaders?.()||{}),...(method==='POST'&&writeDeadline!==undefined?{'x-workbench-headless-expires-at':String(writeDeadline)}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});
   let result;try{result=await response.json();}catch{throw error('工作台未返回有效JSON，不能确认操作结果','HEADLESS_RESPONSE_UNKNOWN');}
   if(!response.ok||result?.ok!==true)throw Object.assign(error(result?.error||'工作台请求失败',result?.code||'HEADLESS_BACKEND'),{httpStatus:response.status,writeAttempted:method==='POST',...(typeof result?.requestDispatched==='boolean'?{requestDispatched:result.requestDispatched}:{})});
   return result.data;
  };
  return await run({request,origin,backend,pid:childRuntime?.pid});
 }finally{
  if(started){backend.server.closeIdleConnections?.();await new Promise(resolve=>{backend.server.close(resolve);backend.server.closeAllConnections?.();});}
  if(ownedBackend&&backend?.watchStore)backend.watchStore.close();
  if(childRuntime)await childRuntime.close();
 }
}
async function authorizedAccount(request,platform,accountId){
 const data=await request({path:platform==='local'?'/api/local/accounts?workbench=local':'/api/accounts?workbench=qianchuan'});
 const rows=platform==='local'?data?.accounts:data?.tree?.flatMap(group=>group.children||[]);
 if(!Array.isArray(rows))throw error('授权账户列表未完整取得','HEADLESS_ACCOUNT_DISCOVERY');
 const match=rows.find(row=>String(platform==='local'?row.local_account_id:row.id)===accountId);
 if(!match)throw error('目标账户不在本次取得的授权列表中','HEADLESS_ACCOUNT_UNAUTHORIZED');return match;
}
function preflightParams(action,params){
 if(action.preflight==='plan.detail'||action.preflight==='materials.list')return {ad_id:params.ad_id};
 if(action.preflight==='project.detail')return {project_id:params.project_id};return {};
}
const numberOrNull=value=>['number','string'].includes(typeof value)&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
function readableData(platform,action,data){
 if(platform==='qianchuan'&&action==='balance.get'){
  const raw=numberOrNull(data?.account_general_total);return {balance_yuan:raw===null?null:raw/100000,source_field:'account_general_total',source_unit:'thousandth_fen',divisor:100000,raw_account_general_total:raw};
 }
 if(platform==='local'&&action==='project.detail'){
  const budget=numberOrNull(data?.budget),bid=numberOrNull(data?.bid);return {...data,budget_yuan:budget===null?null:budget/100,bid_yuan:bid===null?null:bid/100,money_units:{budget:'fen',bid:'fen',budget_yuan:'yuan',bid_yuan:'yuan'}};
 }
 return data;
}
export async function runHeadless(input,{withBackend=withTemporaryBackend,now=Date.now,timeoutMs}={}){
 const normalized=normalizeHeadlessRequest(input),{definition,mode,platform,accountId,params}=normalized;
 if(mode==='execute')assertHeadlessAuthorization(normalized,{now:now()});
 return withBackend(async({request})=>{
  const account=definition.accountRequired===false?null:await authorizedAccount(request,platform,accountId);
  const route=headlessRoute(normalized);
  if(mode==='read')return {ok:true,mode,platform,accountId:accountId??null,action:input.action,data:readableData(platform,input.action,await request(route)),runtime:{temporary:true,browserOpened:false,backgroundStarted:false}};
  const preflightDefinition=getHeadlessAction(platform,definition.preflight),before=readableData(platform,definition.preflight,await request(headlessRoute({...normalized,definition:preflightDefinition,params:preflightParams(definition,params)})));
  if(definition.name==='account.budget.set'&&(before.budget_mode!==params.expected.budget_mode||before.budget!==params.expected.budget))throw error('账户预算已变化，请重新读取并确认','HEADLESS_STALE');
  if(definition.name==='materials.remove'&&(!Array.isArray(before)||params.material_ids.some(id=>!before.some(row=>String(row.material_id)===id))))throw error('待移除素材未全部出现在该账户计划的完整素材列表中','HEADLESS_OBJECT_UNAUTHORIZED');
  if(definition.name==='project.status.set'||definition.name==='promotion.status.set'){
   const key=definition.name.startsWith('project.')?'project':'promotion',rows=before[key+'_list'];
   if(!Array.isArray(rows)||params.data.some(row=>!rows.some(current=>String(current[key+'_id'])===row[key+'_id'])))throw error('操作对象不在所选账户的当前完整配置列表中','HEADLESS_OBJECT_UNAUTHORIZED');
  }
  const prepared={platform,accountId,action:input.action,params,accountName:account?.name||account?.account_name||account?.local_account_name||accountId,before,intentHash:headlessIntentHash(normalized),request:route,destructive:definition.destructive===true};
  if(mode==='prepare')return {ok:true,mode,submitted:false,prepared,runtime:{temporary:true,browserOpened:false,backgroundStarted:false}};
  // Reads can outlive the approval window; validate again at the write boundary.
  assertHeadlessAuthorization(normalized,{now:now()});
  let data=await request({...route,writeDeadline:Date.parse(normalized.authorization.expiresAt)});
  if(definition.name==='materials.remove'){
   try{const after=await request(headlessRoute({...normalized,definition:preflightDefinition,params:preflightParams(definition,params)}));
    if(!Array.isArray(after)||params.material_ids.some(id=>after.some(row=>String(row.material_id)===id)))throw Error('目标素材仍在返回列表中');
    data={verified:true,removedMaterialIds:[...params.material_ids],remainingCount:after.length,platformReceipt:data};
   }catch{throw Object.assign(error('移除请求已尝试提交，但素材列表尚未核实；只查询，不自动重发','WRITE_RESULT_UNKNOWN'),{writeAttempted:true});}
  }
  return {ok:true,mode,platform,accountId,action:input.action,executionAttempted:true,data,runtime:{temporary:true,browserOpened:false,backgroundStarted:false}};
 },{timeoutMs});
}
