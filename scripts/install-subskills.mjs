#!/usr/bin/env node
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {access,lstat,realpath,symlink,mkdir} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url)),dest=process.argv[2]||path.join(homedir(),'.codex','skills');
await mkdir(dest,{recursive:true});const installed=[];
for(const name of ['ad-operator-qianchuan','ad-operator-suixin','ad-operator-local']){
 const source=path.join(root,'subskills',name),target=path.join(dest,name);await access(path.join(source,'SKILL.md'));
 let existing;try{existing=await lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(existing){if(!existing.isSymbolicLink()||await realpath(target)!==await realpath(source))throw Error('已有同名Skill，未覆盖：'+name);installed.push({name,status:'already_installed'});}
 else{await symlink(source,target,'dir');installed.push({name,status:'installed'});}
}
console.log(JSON.stringify({ok:true,installed},null,2));
