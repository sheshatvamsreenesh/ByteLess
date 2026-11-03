import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

function makeWorker() {
  const listeners:Record<string,(event:any)=>void>={};
  const added:string[]=[];
  const put:string[]=[];
  const cache={add:async(path:string)=>{added.push(path);},put:async(request:any)=>{put.push(typeof request==='string'?request:request.url);}};
  const caches={open:async()=>cache,keys:async()=>[],match:async()=>undefined};
  const self={location:{origin:'https://byteless.test'},addEventListener:(name:string,fn:(event:any)=>void)=>{listeners[name]=fn;},skipWaiting:()=>Promise.resolve(),clients:{claim:()=>Promise.resolve()}};
  const source=readFileSync(fileURLToPath(new URL('../../public/sw.js',import.meta.url)),'utf8');
  vm.runInNewContext(source,{self,caches,URL,fetch:async(request:any)=>{const path=typeof request==='string'?request:request.url;return {type:'basic',ok:true,headers:{get:(name:string)=>name==='content-type'?(path==='/'?'text/html':path.endsWith('.css')?'text/css':'text/javascript'):null},text:async()=>'<script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">',clone(){return this;}};}});
  return {listeners,added,put};
}

test('service worker pre-caches the app shell and referenced built assets',async()=>{
  const worker=makeWorker();let waited:Promise<unknown>|undefined;
  worker.listeners.install({waitUntil:(promise:Promise<unknown>)=>{waited=promise;}});
  await waited;
  assert.deepEqual(worker.added,[]);
  assert.deepEqual(worker.put,['/','/assets/app.js','/assets/app.css']);
});

test('service worker bypasses API and cross-origin requests, caches built assets only',async()=>{
  const worker=makeWorker();
  const dispatch=(url:string)=>{let response:Promise<unknown>|undefined;worker.listeners.fetch({request:{method:'GET',url,mode:'cors'},respondWith:(promise:Promise<unknown>)=>{response=promise;}});return response;};
  assert.equal(dispatch('https://byteless.test/api/pdf/extract'),undefined);
  assert.equal(dispatch('https://fonts.example.test/font.woff2'),undefined);
  assert.equal(dispatch('https://byteless.test/private/profile.json'),undefined);
  worker.put.length=0;
  await dispatch('https://byteless.test/assets/app.js');
  assert.deepEqual(worker.put,['https://byteless.test/assets/app.js']);
});
