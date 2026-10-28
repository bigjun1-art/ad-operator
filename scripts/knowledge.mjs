import {readFile,realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const KNOWLEDGE_ENTRIES=Object.freeze({
 qianchuan:['02-知识资产/05-投流/巨量千川官方知识链.md','03-资料来源/网页/巨量千川官方/千川乘方/千川乘方五层总索引.md'],
 local:['02-知识资产/05-投流/巨量本地推官方知识链.md'],
 suixin:['03-资料来源/网页/巨量千川官方/千川乘方/场景/随心推.md'],
});
const err=(message,code='KNOWLEDGE_INPUT')=>Object.assign(Error(message),{code});
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
const digest=text=>createHash('sha256').update(text).digest('hex');
const defaultRoot=()=>path.join(homedir(),'Library','Mobile Documents','iCloud~md~obsidian','Documents','wiki001');
const yaml=(text,key)=>text.match(new RegExp('^'+key+':\\s*["\']?([^\\n"\']+)','m'))?.[1]?.trim()||null;
const terms=q=>[...new Set(String(q||'').toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu)||[])];
const decode=s=>s.replace(/&#(x[0-9a-f]+|\d+);/gi,(_m,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function documentText(xml){
 return decode(String(xml).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:p|h[1-6]|ul|ol|li|tr|table|grid|column|blockquote|callout)>/gi,'\n').replace(/<\/(?:td|th)>/gi,' | ').replace(/<[^>]+>/g,'')).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
async function boundedText(root,relative){
 if(typeof relative!=='string'||path.isAbsolute(relative)||!relative.endsWith('.md'))throw err('知识路径需要库内 Markdown 相对路径');
 const full=await realpath(path.resolve(root,relative));if(!inside(root,full))throw err('知识路径超出已配置知识库');
 const info=await stat(full);if(!info.isFile())throw err('知识链接目标为目录：'+relative,'KNOWLEDGE_DIRECTORY');if(info.size>4*1024*1024)throw err('知识文件超过读取范围：'+relative,'KNOWLEDGE_FILE_SIZE');
 return readFile(full,'utf8');
}
function info(text,relative){
 return {path:relative,title:yaml(text,'title')||text.match(/^#\s+(.+)$/m)?.[1]||path.basename(relative,'.md'),sourceId:yaml(text,'source_id')||yaml(text,'id'),documentType:yaml(text,'type'),status:yaml(text,'status'),ingestStage:yaml(text,'stage'),updated:yaml(text,'updated')||yaml(text,'created'),version:yaml(text,'version')||text.match(/修订号[：:]\s*([^\n]+)/)?.[1]||null,uri:text.match(/(?:uri:\s*["']?|\]\()(https:\/\/[^\s"')]+)/)?.[1]||null,retired:/已废弃|已作废|已下线/.test(yaml(text,'title')||path.basename(relative)),sha256:digest(text)};
}
function links(text){return [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m=>m[1].endsWith('.md')?m[1]:m[1]+'.md');}
export async function createKnowledgeClient(config={}){
 const root=await realpath(config.knowledgeRoot||defaultRoot());
 async function catalog(platform){
  if(!Object.hasOwn(KNOWLEDGE_ENTRIES,platform))throw err('知识平台需要 qianchuan、suixin 或 local');
  const queue=KNOWLEDGE_ENTRIES[platform].map(p=>({p,depth:0})),seen=new Set(),docs=[],missing=[];
  while(queue.length&&docs.length<2500){
   const {p,depth}=queue.shift();if(seen.has(p))continue;seen.add(p);
   let text;try{text=await boundedText(root,p);}catch(e){if(['ENOENT','ENOTDIR','KNOWLEDGE_DIRECTORY','KNOWLEDGE_FILE_SIZE'].includes(e.code)){missing.push(p);continue;}throw e;}
   const meta=info(text,p);if(platform==='qianchuan'&&/随心推/.test(meta.title))continue;
   docs.push({...meta,text});
   if(depth>=3)continue;
   for(const next of links(text)){
    const official=platform==='local'?'巨量本地推官方':'巨量千川官方';
    if(!next.startsWith('02-知识资产/05-投流/')&&!next.startsWith('03-资料来源/网页/'+official+'/')&&!next.startsWith('03-资料来源/快照/'+official+'/'))continue;
    if(platform==='local'&&/巨量千川/.test(next))continue;
    if(platform!=='local'&&/巨量本地推/.test(next))continue;
    if(/(?:总索引|官方知识链|投流索引)\.md$/.test(next)&&!KNOWLEDGE_ENTRIES[platform].includes(next))continue;
    queue.push({p:next,depth:depth+1});
   }
  }
  return {docs,missing,truncated:queue.length>0};
 }
 async function bodyFor(doc){
  const ids=[...new Set([doc.text.match(/底层文档[：:]\s*`([A-Za-z0-9_-]+)`/)?.[1],...doc.text.matchAll(/https:\/\/(?:[a-z0-9.-]+)\/(?:docx|wiki)\/([A-Za-z0-9_-]+)/g)].map(x=>Array.isArray(x)?x[1]:x).filter(Boolean))];
  for(const cache of config.knowledgeCaches||[]){
   const cacheRoot=await realpath(typeof cache==='string'?cache:cache.root);
   for(const id of ids)for(const kind of ['docx','wiki']){
    try{
     const file=await realpath(path.join(cacheRoot,kind+'-'+id+'.json'));if(!inside(cacheRoot,file))throw err('正文缓存路径超出配置目录');
     const s=await stat(file);if(s.size>8*1024*1024)throw err('正文缓存超过8MiB');
     const parsed=JSON.parse(await readFile(file,'utf8')),d=parsed.data?.document;
     if(parsed.ok===true&&typeof d?.content==='string'&&(!d.document_id||ids.includes(d.document_id))){const text=documentText(d.content);return {text,version:d.revision_id??doc.version,bodySource:'configured_official_document_cache',sha256:digest(text)};}
    }catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}
   }
  }
  return {text:doc.text,version:doc.version,bodySource:/## 原文章节定位/.test(doc.text)?'source_navigation_card':'vault_text',sha256:doc.sha256};
 }
 return {
  async status(platform){const c=await catalog(platform);return {platform,entries:KNOWLEDGE_ENTRIES[platform],documents:c.docs.length,missing:c.missing,truncated:c.truncated,advertisingRequests:0};},
  async search(platform,query,{limit=10,includeRetired=false}={}){
   if(typeof query!=='string'||!query.trim()||query.length>200)throw err('请提供1至200字检索词');
   if(!Number.isInteger(limit)||limit<1||limit>30)throw err('结果数量为1至30');
   const c=await catalog(platform),keys=terms(query),ranked=[];
   for(const doc of c.docs){if(doc.retired&&!includeRetired)continue;const body=await bodyFor(doc),text=(doc.title+'\n'+body.text).toLowerCase();let score=0;
    for(const key of keys){if(doc.title.toLowerCase().includes(key))score+=8;if(text.includes(key))score+=2;}
    if(!score)continue;if(platform==='suixin'&&/随心推/.test(doc.title))score+=12;const at=Math.max(0,body.text.toLowerCase().indexOf(keys.find(k=>body.text.toLowerCase().includes(k))||'')-100);
    const {text:_t,...meta}=doc;ranked.push({...meta,score,bodySource:body.bodySource,version:body.version,excerpt:body.text.slice(at,at+700)});
   }
   ranked.sort((a,b)=>b.score-a.score||String(b.updated||'').localeCompare(String(a.updated||''))||a.path.localeCompare(b.path));
   return {platform,query,results:ranked.slice(0,limit),matched:ranked.length,scopeTruncated:c.truncated,missingEntries:c.missing,advertisingRequests:0};
  },
  async read(platform,relative,{startLine=1,maxLines=160}={}){
   if(!Number.isInteger(startLine)||startLine<1||!Number.isInteger(maxLines)||maxLines<1||maxLines>400)throw err('正文行号或读取行数无效');
   const c=await catalog(platform),doc=c.docs.find(d=>d.path===relative);if(!doc)throw err('该文档未在本平台知识入口中定位','KNOWLEDGE_PLATFORM_SCOPE');
   const body=await bodyFor(doc),lines=body.text.split('\n'),{text:_t,...meta}=doc;
   return {...meta,platform,version:body.version,bodySource:body.bodySource,bodySha256:body.sha256,startLine,endLine:Math.min(lines.length,startLine+maxLines-1),totalLines:lines.length,text:lines.slice(startLine-1,startLine-1+maxLines).join('\n'),hasMore:startLine+maxLines-1<lines.length,advertisingRequests:0};
  },
 };
}
