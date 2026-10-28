import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKnowledgeClient,KNOWLEDGE_ENTRIES,documentText} from './knowledge.mjs';

test('three platform routes read linked official bodies, preserve versions and exclude retired material',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ad-knowledge-')),cache=path.join(root,'cache');await mkdir(cache);
 try{
  for(const platform of Object.keys(KNOWLEDGE_ENTRIES)){
   const entry=path.join(root,KNOWLEDGE_ENTRIES[platform][0]);await mkdir(path.dirname(entry),{recursive:true});
   const folder='03-资料来源/网页/'+(platform==='local'?'巨量本地推官方':'巨量千川官方')+'/'+platform,p=folder+'/官方说明.md',retired=folder+'/已废弃.md';await mkdir(path.join(root,folder),{recursive:true});
   await writeFile(entry,`# 入口\n[[${p.slice(0,-3)}]]\n[[${retired.slice(0,-3)}]]`);
   await writeFile(path.join(root,p),`---\ntitle: 官方${platform}预算说明\nupdated: 2026-10-28\n---\n底层文档：\`Document${platform}\`\nhttps://official.example/docx/Document${platform}\n## 原文章节定位\n预算`);
   await writeFile(path.join(root,retired),'---\ntitle: 已废弃的预算手册\n---\n预算');
   await writeFile(path.join(cache,`docx-Document${platform}.json`),JSON.stringify({ok:true,data:{document:{document_id:'Document'+platform,revision_id:19,content:'<h1>预算规则</h1><p>主预算与追加预算分别记录。</p>'}}}));
  }
  const client=await createKnowledgeClient({knowledgeRoot:root,knowledgeCaches:[cache]});
  for(const platform of Object.keys(KNOWLEDGE_ENTRIES)){
   const found=await client.search(platform,'预算');assert.equal(found.results.length,1);assert.equal(found.results[0].version,19);assert.equal(found.results[0].bodySource,'configured_official_document_cache');
   const body=await client.read(platform,found.results[0].path,{maxLines:1});assert.equal(body.text,'预算规则');assert.equal(body.hasMore,true);assert.equal(body.advertisingRequests,0);
  }
  await assert.rejects(()=>client.read('suixin','03-资料来源/网页/巨量本地推官方/local/官方说明.md'),/本平台/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('knowledge traversal rejects links escaping the configured vault and external symlinks',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ad-knowledge-boundary-')),outside=await mkdtemp(path.join(tmpdir(),'ad-knowledge-outside-'));
 try{
  const entry=path.join(root,KNOWLEDGE_ENTRIES.local[0]);await mkdir(path.dirname(entry),{recursive:true});await writeFile(entry,'[[03-资料来源/网页/巨量本地推官方/escape]]');
  await mkdir(path.join(root,'03-资料来源/网页/巨量本地推官方'),{recursive:true});await writeFile(path.join(outside,'escape.md'),'outside');await symlink(path.join(outside,'escape.md'),path.join(root,'03-资料来源/网页/巨量本地推官方/escape.md'));
  const c=await createKnowledgeClient({knowledgeRoot:root});await assert.rejects(()=>c.status('local'),/超出/);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('source XML becomes plain text with separate paragraph and table-cell relations',()=>{
 assert.equal(documentText('<h1>公式</h1><p>净额 &divide; 成本</p><table><tr><td>A</td><td>B</td></tr></table>'),'公式\n净额 &divide; 成本\nA | B |');
});
