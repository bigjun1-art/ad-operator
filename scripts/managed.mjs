import {readFile,writeFile,mkdir,rename,access,rm} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {validateManagedPolicy,policyDigest,unresolvedAction} from './managed-core.mjs';
import {invokeBackend} from './config.mjs';
const exec=promisify(execFile),worker=fileURLToPath(new URL('./managed-worker.mjs',import.meta.url));
export async function saveJson(file,data){const temp=file+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temp,file);}
const sessionPath=(config,id)=>{if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('会话ID无效');return path.join(config.stateRoot,'sessions',id);};
async function ownedProcess(record,directory){
 if(!Number.isSafeInteger(record?.pid)||record.pid<1)return false;
 try{const {stdout}=await exec('ps',['-p',String(record.pid),'-o','command=']);return stdout.includes(worker)&&stdout.includes(directory)&&stdout.includes(record.nonce);}catch{return false;}
}
export async function managedStatus(config,id){const directory=sessionPath(config,id),record=JSON.parse(await readFile(path.join(directory,'process.json'),'utf8')),state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));const running=await ownedProcess(record,directory);return {sessionId:id,...state,...(!running&&['starting','running','read_error','cooldown','day_boundary_recheck'].includes(state.status)?{status:state.actions?.some(unresolvedAction)?'needs_reconciliation':'stopped_unexpectedly'}:{}),processRunning:running};}
export async function startManaged(config,policy,{confirmed=false}={}){
 const checked=validateManagedPolicy(policy);if(!confirmed)throw Error('启动常驻需要明确的 --confirm-managed，并来自用户本轮开启托管的指令');
 const {normalizeHeadlessRequest}=await import(pathToFileURL(path.join(config.backendRoot,'headless-actions.mjs')));
 for(const r of checked.rules)normalizeHeadlessRequest({mode:'prepare',platform:checked.platform,accountId:checked.accountId,action:r.action.name,params:r.action.params});
 const id=randomUUID(),directory=sessionPath(config,id);await mkdir(directory,{recursive:true,mode:0o700});
 const nonce=randomUUID();await saveJson(path.join(directory,'policy.json'),checked);await saveJson(path.join(directory,'config.json'),config);
 await saveJson(path.join(directory,'state.json'),{version:1,status:'starting',actions:[],completedRuleIds:[],proposals:[],policyDigest:policyDigest(checked)});
 const child=spawn(process.execPath,[worker,directory,nonce],{detached:true,stdio:'ignore',env:{...process.env,DISABLE_BACKGROUND:'1'}});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 await saveJson(path.join(directory,'process.json'),{pid:child.pid,nonce,createdAt:new Date().toISOString()});child.unref();
 return {sessionId:id,status:'starting',pid:child.pid,expiresAt:checked.expiresAt,mode:checked.mode,browserOpened:false};
}
export async function stopManaged(config,id){
 const directory=sessionPath(config,id),record=JSON.parse(await readFile(path.join(directory,'process.json'),'utf8'));
 if(!await ownedProcess(record,directory))return {sessionId:id,stopped:true,processRunning:false,stopDoesNotPauseAds:true};
 await saveJson(path.join(directory,'stop.json'),{requestedAt:new Date().toISOString()});
 // The worker and its transient children share this owned process group.
 process.kill(-record.pid,'SIGTERM');
 for(let n=0;n<40&&await ownedProcess(record,directory);n++)await new Promise(r=>setTimeout(r,100));
 const running=await ownedProcess(record,directory);
 return {sessionId:id,stopRequested:true,stopped:!running,processRunning:running,stopDoesNotPauseAds:true};
}
export async function reconcileManaged(config,id){
 const directory=sessionPath(config,id),record=JSON.parse(await readFile(path.join(directory,'process.json'),'utf8'));
 if(await ownedProcess(record,directory))throw Error('请先停止这个持续会话，再核对未明动作');
 const policy=JSON.parse(await readFile(path.join(directory,'policy.json'),'utf8')),state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));
 const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
 for(const a of state.actions.filter(unresolvedAction)){
  const p=a.action.params,name=a.action.name;let action,params={},matches=false;
  if(name.startsWith('boost.')){action='boost.receipt.get';params={ad_id:p.ad_id,requestKey:p.requestKey,...(p.range?{range:p.range}:{}),...(p.start?{start:p.start}:{}),...(p.end?{end:p.end}:{})};}
  else if(name.startsWith('plan.')){action='plan.detail';params={ad_id:p.ad_id};}
  else if(name==='order.terminate'){action='order.get';params={order_id:p.order_id};}
  else if(name==='project.budget.set'){action='project.detail';params={project_id:p.project_id};}
  else if(name==='project.status.set')action='projects.list';else if(name==='promotion.status.set')action='promotions.list';else if(name==='account.budget.set')action='account.budget.get';else continue;
  const result=await invokeBackend(config,{mode:'read',platform:policy.platform,accountId:policy.accountId,action,params}),d=result.data;
  if(name==='boost.status.set'&&d.status==='superseded'&&d.accountId===policy.accountId&&d.ad_id===p.ad_id&&d.requestKey===p.requestKey&&d.task_id===p.task_id&&typeof d.supersededBy==='string'){
   a.status='superseded';a.reconciledAt=new Date().toISOString();a.resolvedBy=d.supersededBy;continue;
  }
  if(name.startsWith('boost.'))matches=d.status==='verified'&&d.accountId===policy.accountId&&d.ad_id===p.ad_id&&d.requestKey===p.requestKey&&(!p.task_id||d.task_id===p.task_id);
  else if(name==='plan.budget.set')matches=num(d.delivery_setting?.budget)===p.budget;
  else if(name==='plan.roi.set')matches=num(d.delivery_setting?.roi2_goal)===p.roi2_goal;
  else if(name==='plan.status.set')matches=d.opt_status===p.opt_status;
  else if(name==='order.terminate')matches=d.mode==='normal'&&String(d.order?.order_id||'')===p.order_id&&['FROZEN','FINISHED','OVER','TIMEOUT','UNPAIDCANCEL'].includes(d.order?.status);
  else if(name==='project.budget.set')matches=num(d.budget_yuan)===p.budget&&d.budget_mode===p.budget_mode;
  else if(name==='account.budget.set'){
   if(p.effective_mode==='EFFECTIVE_NEXT_DAY'){
    const original=a.result?.data,observed=d.operation;
    const dates=[original,observed].filter(v=>v?.requestKey===p.requestKey).map(v=>v.requestedEffectiveDate).filter(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
    if(!dates.length||today<dates.sort().at(-1))continue;
   }
   matches=d.budget_mode===p.budget_mode&&num(d.budget)===(p.budget_mode==='BUDGET_MODE_INFINITE'?0:p.budget);
  }else{
   const kind=name.startsWith('project.')?'project':'promotion',list=d[kind+'_list'];
   matches=Array.isArray(list)&&p.data.every(row=>{const found=list.find(x=>String(x[kind+'_id'])===row[kind+'_id']),status=found?.[kind+'_status_first']||found?.status_first||found?.status;return row.opt_status==='ENABLE'?status===kind.toUpperCase()+'_STATUS_ENABLE':[kind.toUpperCase()+'_STATUS_DISABLE',kind.toUpperCase()+'_STATUS_PAUSED'].includes(status);});
  }
  if(matches){a.status='verified';a.reconciledAt=new Date().toISOString();a.observation='平台当前读取值匹配原目标；未重新提交';}
 }
 const unresolved=state.actions.some(unresolvedAction);state.status=unresolved?'needs_reconciliation':'reconciled';await saveJson(path.join(directory,'state.json'),state);
 if(!unresolved){const key=createHash('sha256').update(policy.platform+':'+policy.accountId).digest('hex'),file=path.join(config.stateRoot,'account-locks',key+'.json');try{const lock=JSON.parse(await readFile(file,'utf8'));if(lock.directory===directory&&lock.nonce===record.nonce)await rm(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return {sessionId:id,status:state.status,submitted:false,unresolvedActions:state.actions.filter(unresolvedAction).length};
}
