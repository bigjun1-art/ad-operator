import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {adMain} from './ad.mjs';
import {loadConfig,readInput,redactError} from './config.mjs';
export function platformCommand(platform,argv){
 if(!['qianchuan','suixin','local'].includes(platform))throw Error('子Skill平台无效');
 if(argv.some(v=>v==='--platform'||v.startsWith('--platform=')))throw Error('子Skill的平台已固定，不能覆盖；跨平台请回到主Skill重新路由');
 const [mode,...args]=argv;
 if(!mode||['help','--help','doctor','managed'].includes(mode))return [...argv];
 if(mode==='actions'){if(args.length)throw Error('子Skill actions不接受另一个平台');return ['actions',platform];}
 return [...argv,'--platform',platform];
}
export async function runPlatformEntry(platform,argv=process.argv.slice(2),{read=readInput,run=adMain}={}){
 try{
  const command=platformCommand(platform,argv);
  if(argv[0]==='managed'&&['status','stop','reconcile'].includes(argv[1])){
   const id=argv[2];if(!/^[a-f0-9-]{36}$/.test(id||''))throw Error('会话ID无效');
   const config=await loadConfig(),policy=JSON.parse(await readFile(path.join(config.stateRoot,'sessions',id,'policy.json'),'utf8'));
   if(policy.platform!==platform)throw Error('该持续会话不属于本子Skill平台，请回到主Skill选择对应平台');
  }
  return await run(command,{inputReader:async()=>{const input=await read();if(argv[0]==='managed'&&input.platform!==platform)throw Error('托管政策的平台与本子Skill不一致');return input;}});
 }catch(e){console.log(JSON.stringify({ok:false,error:redactError(e),automaticRetry:false}));return 1;}
}
