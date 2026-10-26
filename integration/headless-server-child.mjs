// This child is owned by one temporary command or an explicitly started managed worker.
process.env.WORKBENCH_TEST='1';
process.env.WORKBENCH_READONLY_PREVIEW='1';
process.env.DISABLE_BACKGROUND='1';
let backend,closing=false;
async function close(){
 if(closing)return;closing=true;
 if(backend?.server.listening){backend.server.closeIdleConnections?.();await new Promise(resolve=>{backend.server.close(resolve);backend.server.closeAllConnections?.();});}
 backend?.watchStore?.close();
 if(process.connected)process.disconnect();
 process.exit(0);
}
process.on('message',message=>{if(message?.type==='shutdown')void close();});
process.on('disconnect',()=>void close());
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
try{
 if(!/^[a-f0-9]{64}$/.test(process.env.WORKBENCH_HEADLESS_KEY||''))throw Error('private runtime key required');
 backend=await import('./server.mjs');
 await new Promise((resolve,reject)=>{backend.server.once('error',reject);backend.server.listen(0,'127.0.0.1',()=>{backend.server.removeListener('error',reject);resolve();});});
 if(process.connected)process.send({type:'ready',port:backend.server.address().port,pid:process.pid});else await close();
}catch{if(process.connected)process.send({type:'startup_failed'});await close();}
