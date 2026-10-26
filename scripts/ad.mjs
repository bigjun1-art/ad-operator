#!/usr/bin/env node
import {access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig,readInput,invokeBackend,redactError} from './config.mjs';
import {validateManagedPolicy} from './managed-core.mjs';
import {startManaged,managedStatus,stopManaged,reconcileManaged} from './managed.mjs';
const args=process.argv.slice(2),[mode,action,...tail]=args,flags={};
try{
 if(!(mode==='managed'&&['status','stop','reconcile'].includes(action)))for(let i=0;i<tail.length;i++){const key=tail[i];if(key==='--confirm-managed'){flags[key]=true;continue;}if(!['--platform','--account'].includes(key)||!tail[i+1]||flags[key])throw Error('未知或重复参数');flags[key]=tail[++i];}
 let result;
 if(!mode||['help','--help'].includes(mode))result={commands:['doctor','actions [PLATFORM]','describe ACTION --platform PLATFORM','read ACTION --platform PLATFORM [--account ID]','prepare ACTION --platform PLATFORM --account ID','execute ACTION --platform PLATFORM --account ID','managed validate','managed start --confirm-managed','managed status SESSION_ID','managed stop SESSION_ID','managed reconcile SESSION_ID'],input:'read/prepare/execute stdin={params,authorization?}; managed validate/start stdin=explicit user policy',default:'一次操作结束即关闭临时后台；不会打开网页或恢复旧托管。'};
 else if(mode==='managed'){
  if(action==='validate'){const p=await readInput();result={ok:true,policy:validateManagedPolicy(p,{requireAuthorization:false}),authorizationStillRequired:p.explicitManagedAuthorization!==true,started:false};}
  else {const config=await loadConfig();if(action==='start'){
    // start has a flag but no positional entity; parse the token consumed as action separately.
    result={ok:true,...await startManaged(config,await readInput(),{confirmed:flags['--confirm-managed']===true})};
   }else if(['status','stop','reconcile'].includes(action)){const id=tail[0];result={ok:true,...await ({status:managedStatus,stop:stopManaged,reconcile:reconcileManaged})[action](config,id)};}else throw Error('未知托管命令');}
 }else{
  const config=await loadConfig();
  if(mode==='doctor'){await access(path.join(config.backendRoot,'headless-runtime.mjs'));await access(path.join(config.backendRoot,'headless-actions.mjs'));result={ok:true,configured:true,node:process.version,credentialsRead:false,started:false};}
  else if(mode==='actions'||mode==='describe'){const catalog=await import(pathToFileURL(path.join(config.backendRoot,'headless-actions.mjs')));result=mode==='actions'?catalog.describeHeadlessActions(action):catalog.getHeadlessAction(flags['--platform'],action);}
  else if(['read','prepare','execute'].includes(mode)){const input=await readInput();result=await invokeBackend(config,{mode,platform:flags['--platform'],accountId:flags['--account'],action,params:input.params||{},authorization:input.authorization});}
  else throw Error('未知命令；使用help查看');
 }
 console.log(JSON.stringify(result,null,2));
}catch(e){console.log(JSON.stringify({ok:false,error:redactError(e),code:e.code||'AD_OPERATOR_FAILED',...(e.requestDispatched===false?{requestDispatched:false}:{}),automaticRetry:false}));process.exitCode=1;}
