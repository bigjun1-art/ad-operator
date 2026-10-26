import {readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createManagedRunner,newManagedState,validateManagedPolicy,unresolvedAction} from './managed-core.mjs';
import {invokeBackend,redactError} from './config.mjs';
import {saveJson} from './managed.mjs';
const [directory,nonce]=process.argv.slice(2);
if(!directory||!nonce)throw Error('托管进程缺少会话标识');
const config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));
const policy=validateManagedPolicy(JSON.parse(await readFile(path.join(directory,'policy.json'),'utf8')));
const lockRoot=path.join(config.stateRoot,'account-locks');await mkdir(lockRoot,{recursive:true,mode:0o700});
const key=createHash('sha256').update(policy.platform+':'+policy.accountId).digest('hex'),lock=path.join(lockRoot,key+'.json');
let acquired=false,stopping=false,expired=false,runner,controller=new AbortController(),deadlineTimer;
function deadline(){const remaining=Date.parse(policy.expiresAt)-Date.now();if(remaining<=0){expired=true;stopping=true;controller.abort();}else deadlineTimer=setTimeout(deadline,Math.min(remaining,2147483647));}
deadline();
const persist=s=>saveJson(path.join(directory,'state.json'),{...s,updatedAt:new Date().toISOString()});
const delay=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
process.on('SIGTERM',()=>{stopping=true;controller.abort();});process.on('SIGINT',()=>{stopping=true;controller.abort();});
try{
 try{await writeFile(lock,JSON.stringify({pid:process.pid,nonce,directory}),{flag:'wx',mode:0o600});acquired=true;}catch{
  let old;try{old=JSON.parse(await readFile(lock,'utf8'));}catch{}
  let alive=true;try{if(!Number.isSafeInteger(old?.pid)||old.pid<1)throw Error('bad pid');process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
  if(alive)throw Error('该账户已有持续会话或尚未核实的锁，未启动第二个托管');
  // A stale lease is not resumed; retain the prior state for manual reconciliation.
  const former=JSON.parse(await readFile(path.join(old.directory,'state.json'),'utf8'));
  if(former.actions?.some(unresolvedAction))throw Error('旧会话有未核实动作，请先查明结果，未新开托管');
  const recovery=lock+'.recovery';await mkdir(recovery,{mode:0o700});
  try{const current=JSON.parse(await readFile(lock,'utf8'));if(current.nonce!==old.nonce)throw Error('账户锁已变化，未启动托管');await renameLock(lock);await writeFile(lock,JSON.stringify({pid:process.pid,nonce,directory}),{flag:'wx',mode:0o600});acquired=true;}finally{await rm(recovery,{recursive:true,force:true});}
 }
 runner=createManagedRunner(policy,{read:({platform,accountId,scope})=>invokeBackend(config,{mode:'read',action:'overview.get',platform,accountId,params:platform==='local'?{range:'realtime',...(scope.mgoal?{mgoal:scope.mgoal}:{}),...(scope.delivery?{delivery:scope.delivery}:{})}:scope},{signal:controller.signal}),
  prepare:a=>invokeBackend(config,{mode:'prepare',platform:policy.platform,accountId:policy.accountId,action:a.name,params:a.params},{signal:controller.signal}),
  execute:async(a,prepared)=>{
   const plan=prepared.prepared;if(!plan||plan.platform!==policy.platform||plan.accountId!==policy.accountId||plan.action!==a.name)throw Error('准备结果与托管授权不一致');
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),midnight=Date.parse(day+'T00:00:00+08:00')+86400000;
   const expiresAt=new Date(Math.min(Date.parse(policy.expiresAt),midnight)).toISOString();
   return invokeBackend(config,{mode:'execute',platform:policy.platform,accountId:policy.accountId,action:a.name,params:a.params,authorization:{authorized:true,basis:'explicit_user_instruction',platform:policy.platform,accountId:policy.accountId,action:a.name,intentHash:plan.intentHash,expiresAt,userInstruction:policy.userInstruction}},{signal:controller.signal});
  },persist});
 while(!stopping){
  const state=await runner.tick();
  if(['expired','cost_limit_reached','action_limit_reached','needs_reconciliation','not_submitted'].includes(state.status))break;
  if(policy.rules.every(r=>state.completedRuleIds.includes(r.id))){runner.state.status=policy.mode==='recommend'?'recommendations_ready':'rules_completed';await persist(runner.state);break;}
  await delay(Math.min(policy.intervalSeconds*1000,Math.max(0,Date.parse(policy.expiresAt)-Date.now())));
 }
 if(stopping){runner.state.status=runner.state.actions.some(unresolvedAction)?'needs_reconciliation':expired?'expired':'stopped';await persist(runner.state);}
}catch(e){const state=runner?.state||newManagedState();await persist({...state,status:state.actions.some(unresolvedAction)?'needs_reconciliation':'blocked',error:redactError(e)});}
finally{clearTimeout(deadlineTimer);if(acquired&&!runner?.state?.actions?.some(unresolvedAction)){try{const current=JSON.parse(await readFile(lock,'utf8'));if(current.nonce===nonce)await rm(lock);}catch{}}}

async function renameLock(file){const {rename}=await import('node:fs/promises');const old=file+'.stale-'+nonce;await rename(file,old);await rm(old);}
