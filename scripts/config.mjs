import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
export const configFile=()=>process.env.AD_OPERATOR_CONFIG||path.join(homedir(),'.config','ad-operator','config.json');
export async function loadConfig(){
 const c=JSON.parse(await readFile(configFile(),'utf8'));
 if(typeof c.backendRoot!=='string'||!path.isAbsolute(c.backendRoot))throw Error('本地配置需要绝对路径 backendRoot');
 return {...c,stateRoot:c.stateRoot||path.join(homedir(),'.local','state','ad-operator')};
}
export function invokeBackend(config,input,{signal,timeoutMs=180000}={}){
 return new Promise((resolve,reject)=>{
  const runner=`import {pathToFileURL} from 'node:url';try{let s='';for await(const c of process.stdin)s+=c;const {runHeadless}=await import(pathToFileURL(process.argv[1]));console.log(JSON.stringify(await runHeadless(JSON.parse(s))));}catch(e){console.log(JSON.stringify({ok:false,error:String(e.message).replace(/(?:access_token|refresh_token|cookie|secret|authorization)\\s*[:=]\\s*\\S+/gi,'[凭据已隐藏]'),code:e.code||'BACKEND_FAILED',...(e.requestDispatched===false?{requestDispatched:false}:{})}));process.exitCode=1;}`;
  const args=['--input-type=module','-e',runner,path.join(config.backendRoot,'headless-runtime.mjs')];
  const child=spawn(process.execPath,args,{cwd:config.backendRoot,stdio:['pipe','pipe','pipe'],env:{...process.env,WORKBENCH_TEST:'1',DISABLE_BACKGROUND:'1',...(config.stateRoot?{AD_OPERATOR_TASK_STATE_DIR:path.join(config.stateRoot,'task-receipts')}:{})},signal});
  let stdout='',stderr='',tooLarge=false;
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
  child.stdout.on('data',b=>{stdout+=b;if(stdout.length>4*1024*1024){tooLarge=true;child.kill('SIGTERM');}});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-3000);});
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',(code,termination)=>{
   clearTimeout(timer);if(tooLarge)return reject(Error('后台返回超过输出上限'));
   let result;try{result=JSON.parse(stdout.trim());}catch{return reject(Object.assign(Error(termination?'临时后台已停止，若写入已经发出需查询核实':'临时后台未返回有效JSON'),{code:'BACKEND_RESPONSE_UNKNOWN'}));}
   if(code!==0||result.ok!==true)return reject(Object.assign(Error(result.error?.message||result.error||'后台操作失败'),{code:result.code||result.error?.code||'BACKEND_FAILED',...(result.requestDispatched===false?{requestDispatched:false}:{})}));
   resolve(result);
  });
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });
}
export async function readInput(){let text='';for await(const part of process.stdin){text+=part;if(text.length>1024*1024)throw Error('输入超过1MiB');}return text.trim()?JSON.parse(text):{};}
export const redactError=e=>String(e?.message||e).replace(/(?:access_token|refresh_token|api[_-]?key|password|secret|cookie|authorization)\s*[:=]\s*\S+/gi,'[凭据已隐藏]');
