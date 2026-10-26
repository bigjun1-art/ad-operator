#!/usr/bin/env node
import {readFile,access} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {describeHeadlessActions,getHeadlessAction,headlessIntentHash} from './headless-actions.mjs';
import {runHeadless} from './headless-runtime.mjs';
const parseJSON=(text,label)=>{try{return JSON.parse(text);}catch{throw Error(label+'不是有效JSON，不输出原始内容');}};

export async function headlessMain(argv=process.argv.slice(2),{stdin=process.stdin,stdout=process.stdout,stderr=process.stderr,run=runHeadless}={}){
 const print=v=>stdout.write(JSON.stringify(v,null,2)+'\n');
 try{
  const [command,possibleAction,...tail]=argv;
  if(!command||['help','--help','-h'].includes(command)){print({commands:['actions [--platform qianchuan|suixin|local]','describe ACTION --platform PLATFORM','doctor','read ACTION --platform PLATFORM --account ID','prepare ACTION --platform PLATFORM --account ID','execute ACTION --platform PLATFORM --account ID --authorization-file FILE'],params:'read/prepare/execute参数从stdin传入一个JSON对象；账户列表可省略account。',authorization:'execute的授权文件须来自当前会话明确用户指令，绑定platform/accountId/action/intentHash/expiresAt；文件本身不证明真人授权。',temporary:'每次调用使用独立随机本机端口，finally关闭；不打开网页、不启后台、不恢复旧策略。'});return 0;}
  const action=possibleAction?.startsWith('--')?undefined:possibleAction,args=action?tail:[possibleAction,...tail].filter(Boolean),options={};
  for(let i=0;i<args.length;i+=2){if(!['--platform','--account','--authorization-file','--timeout-ms'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error('无效或重复的CLI参数');options[args[i]]=args[i+1];}
  const platform=options['--platform'];
  if(command==='actions'){print(describeHeadlessActions(platform));return 0;}
  if(command==='describe'){if(!action)throw Error('describe需要动作名称');print(getHeadlessAction(platform,action));return 0;}
  if(command==='doctor'){
   const backend=new URL('./server.mjs',import.meta.url),source=await readFile(backend,'utf8'),auth=source.match(/import\s*\{\s*getAccessToken\s*\}\s*from\s*["']([^"']+)["']/)?.[1];
   const checks=await Promise.all([{name:'backend',file:backend},{name:'existing_auth_adapter',file:auth}].map(async({name,file})=>{try{if(!file)throw Error('missing adapter');await access(file);return {name,readable:true};}catch{return {name,readable:false};}}));
   print({ok:checks.every(c=>c.readable),node:process.version,project:path.dirname(fileURLToPath(import.meta.url)),checks,credentialsRead:false,authorizationVerified:false,browserOpened:false,backgroundStarted:false});return checks.every(c=>c.readable)?0:1;
  }
  if(!['read','prepare','execute'].includes(command)||!action)throw Error('未知命令；使用help查看');
  const chunks=[];let size=0;for await(const chunk of stdin){size+=Buffer.byteLength(chunk);if(size>131072)throw Error('JSON参数超过128KiB');chunks.push(Buffer.from(chunk));}
  const params=parseJSON(Buffer.concat(chunks).toString('utf8').trim()||'{}','params'),authorization=options['--authorization-file']?parseJSON(await readFile(options['--authorization-file'],'utf8'),'授权记录'):undefined;
  if(command==='execute'&&!authorization)throw Error('execute需要--authorization-file；开发验证不要传真实投放授权');
  const request={mode:command,platform,accountId:options['--account'],action,params,...(authorization?{authorization}:{})};
  print(await run(request,{timeoutMs:options['--timeout-ms']?Number(options['--timeout-ms']):undefined}));return 0;
 }catch(e){stderr.write(JSON.stringify({ok:false,error:String(e.message).replace(/(?:access_token|refresh_token|cookie|secret|authorization|api[_-]?key|token|password)\s*[:=]\s*\S+/gi,'[敏感信息已省略]').replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{10,}/g,'[敏感信息已省略]'),code:e.code||'HEADLESS_FAILED',...(e.httpStatus?{httpStatus:e.httpStatus}:{}),...(typeof e.requestDispatched==='boolean'?{requestDispatched:e.requestDispatched}:{}),automaticRetry:false})+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)process.exitCode=await headlessMain();
export {headlessIntentHash};
