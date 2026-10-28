import {mkdir,open,readFile,rename,readdir,unlink,rmdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const exact = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
/** Private state must be outside the checkout in production. A dead process's
 * OS lock can be recovered; its durable submitting record remains unresolved. */
export function createChengfangTaskStore({root,now=Date.now}={}) {
  if(typeof root !== 'string' || !isAbsolute(root)) throw Error('任务存储需要显式绝对 root');
  const plan=(accountId,ad_id)=>{
    if(!exact(accountId)||!exact(ad_id)) throw Error('账户及计划须为精确字符串 ID');
    return join(root,hash(`${accountId}:${ad_id}`));
  };
  const file=(accountId,ad_id,key)=>join(plan(accountId,ad_id),`${hash(key)}.json`);
  const read=async(accountId,ad_id,requestKey)=>{
    try {return JSON.parse(await readFile(file(accountId,ad_id,requestKey),'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  };
  async function write(record) {
    const dir=plan(record.accountId,record.ad_id);
    await mkdir(dir,{recursive:true,mode:0o700});
    const target=file(record.accountId,record.ad_id,record.requestKey),temp=`${target}.${randomUUID()}.tmp`;
    const handle=await open(temp,'wx',0o600);
    try {await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
    await rename(temp,target);
    const directory=await open(dir,'r');try{await directory.sync();}finally{await directory.close();}
  }
  async function findUnresolved(accountId,ad_id) {
    const dir=plan(accountId,ad_id);let files;
    try{files=await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const records=[];
    for(const name of files.filter(name=>name.endsWith('.json'))) {
      const record=JSON.parse(await readFile(join(dir,name),'utf8'));
      if(['submitting','unknown','accepted','receipt_only'].includes(record.status)) records.push(record);
    }
    return records;
  }
  async function withPlanLock(accountId,ad_id,fn) {
    const dir=plan(accountId,ad_id);await mkdir(dir,{recursive:true,mode:0o700});
    const lock=join(dir,'write.lock');let handle;
    try{handle=await open(lock,'wx',0o600);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const recovery=join(dir,'lock-recovery');
      try{await mkdir(recovery,{mode:0o700});}catch{throw Error('同计划正被其他进程锁定；需先核实原动作');}
      try {
        let owner;try{owner=JSON.parse(await readFile(lock,'utf8'));}catch{throw Error('计划锁归属无法确认，需核实原动作');}
        let dead=false;
        if(Number.isInteger(owner.pid)&&owner.pid>0)try{process.kill(owner.pid,0);}catch(error){dead=error.code==='ESRCH';}
        if(!dead)throw Error('同计划正被其他进程锁定；需先核实原动作');
        await unlink(lock);handle=await open(lock,'wx',0o600);
      }finally{await rmdir(recovery);}
    }
    try {
      await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:now()}));await handle.sync();
      return await fn();
    }finally{await handle.close();await unlink(lock);}
  }
  async function findVerifiedCreates(accountId,ad_id){
    const dir=plan(accountId,ad_id);let files;try{files=await readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const records=[];for(const name of files.filter(name=>name.endsWith('.json'))){const record=JSON.parse(await readFile(join(dir,name),'utf8'));if(record.status==='verified'&&record.prepared?.operation==='create'&&record.readback?.task?.id===record.task_id)records.push(record);}
    return records;
  }
  return {read,write,findUnresolved,withPlanLock,findVerifiedCreates};
}
