import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdtempSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {platformCommand,runPlatformEntry} from './platform-entry.mjs';
test('each subskill fixes its platform without spawning another wrapper process',()=>{
 for(const p of ['qianchuan','suixin','local']){assert.deepEqual(platformCommand(p,['actions']),['actions',p]);assert.deepEqual(platformCommand(p,['read','accounts.list']),['read','accounts.list','--platform',p]);assert.throws(()=>platformCommand(p,['read','accounts.list','--platform','other']));}
});
test('a subskill cannot start or validate continuous policy for another platform',async()=>{
 let reads=0;const code=await runPlatformEntry('suixin',['managed','validate'],{read:async()=>({platform:'qianchuan'}),run:async(_args,{inputReader})=>{try{await inputReader();return 0;}catch{reads++;return 1;}}});assert.equal(code,1);assert.equal(reads,1);
});
test('all three real subskill entrypoints expose matching action schemas without ad calls',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'platform-entry-')),config=path.join(directory,'config.json');writeFileSync(config,JSON.stringify({backendRoot:fileURLToPath(new URL('../integration/',import.meta.url))}));
 for(const p of ['qianchuan','suixin','local']){
  const file=new URL('../subskills/ad-operator-'+p+'/scripts/ad.mjs',import.meta.url);const result=JSON.parse(execFileSync(process.execPath,[file.pathname,'actions'],{encoding:'utf8',env:{...process.env,AD_OPERATOR_CONFIG:config}}));assert.ok(result.actions.length>0);assert.ok(result.actions.every(a=>a.platform===p));
  const skill=readFileSync(new URL('../subskills/ad-operator-'+p+'/SKILL.md',import.meta.url),'utf8');assert.ok(skill.startsWith('---\nname: ad-operator-'+p+'\n'));
 }
});
test('subskill installation is portable and idempotent in an isolated skills directory',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'subskill-install-')),installer=fileURLToPath(new URL('./install-subskills.mjs',import.meta.url));
 const first=JSON.parse(execFileSync(process.execPath,[installer,directory],{encoding:'utf8'})),second=JSON.parse(execFileSync(process.execPath,[installer,directory],{encoding:'utf8'}));
 assert.ok(first.installed.every(s=>s.status==='installed'));assert.ok(second.installed.every(s=>s.status==='already_installed'));
 for(const p of ['qianchuan','suixin','local'])assert.equal(realpathSync(path.join(directory,'ad-operator-'+p)),fileURLToPath(new URL('../subskills/ad-operator-'+p,import.meta.url)));
});
