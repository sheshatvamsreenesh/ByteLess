import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteDocument, exportDocument, getActiveDocument, getSavedDocuments, saveDocument, searchDocuments, setActiveDocument, type ConvertedDocument } from './documents';

class MemoryStorage {
  private values = new Map<string,string>();
  getItem(key:string) { return this.values.get(key) ?? null; }
  setItem(key:string,value:string) { this.values.set(key,String(value)); }
  removeItem(key:string) { this.values.delete(key); }
}
Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:new MemoryStorage()});
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:new MemoryStorage()});

function sample(id:string,title='Sample Article'):ConvertedDocument {
  return {id,title,source:'https://example.test/story',html:'<h1>Sample Article</h1><p>Offline words &amp; detail &mdash; saved.</p><ul><li>First item</li></ul><ol><li>Second item</li></ol><table><tr><th>Name</th><th>Value</th></tr><tr><td>Mode</td><td>Light</td></tr></table><a href="https://example.test/ref?q=1&amp;mode=go">Reference</a>',text:'Sample Article\nOffline words & detail — saved.\nFirst item\nSecond item\nName Value\nMode Light\nReference',originalBytes:300,convertedBytes:120,removed:2,trackers:0,createdAt:100,mode:'light',imagesDeferred:0,contentType:'webpage'};
}

test('saves one IndexedDB row, can reload the active document, and deletes it', async()=>{
  const doc=sample(`doc-${crypto.randomUUID()}`);
  await setActiveDocument(doc);
  await saveDocument(doc);
  await saveDocument({...doc,title:'Updated title'});
  const listed=await getSavedDocuments();
  assert.equal(listed.filter(x=>x.id===doc.id).length,1);
  assert.equal((await getActiveDocument())?.title,'Updated title');
  await deleteDocument(doc.id);
  assert.equal((await getSavedDocuments()).some(x=>x.id===doc.id),false);
});

test('search matches title, source, and converted text case-insensitively',()=>{
  const documents=[sample('search-one'),sample('search-two','Other')];
  assert.equal(searchDocuments(documents,'OFFLINE').length,2);
  assert.equal(searchDocuments(documents,'example.test').length,2);
  assert.equal(searchDocuments(documents,'missing').length,0);
});

test('migrates legacy local saved documents into IndexedDB',async()=>{
  const doc=sample(`legacy-${crypto.randomUUID()}`);
  localStorage.setItem('byteless.saved.v1',JSON.stringify([doc]));
  const listed=await getSavedDocuments();
  assert.ok(listed.some(x=>x.id===doc.id));
  assert.equal(localStorage.getItem('byteless.saved.v1'),null);
  await deleteDocument(doc.id);
});

test('TXT and Markdown exports preserve document content and MIME types',async()=>{
  const doc=sample('export-one','A Test / Title');
  const txt=exportDocument(doc,'txt');
  const markdown=exportDocument(doc,'md');
  assert.equal(txt.filename,'A-Test-Title.txt');
  assert.equal(txt.blob.type,'text/plain;charset=utf-8');
  assert.equal(await txt.blob.text(),doc.text);
  assert.equal(markdown.filename,'A-Test-Title.md');
  assert.equal(markdown.blob.type,'text/markdown;charset=utf-8');
  const value=await markdown.blob.text();
  assert.match(value,/# Sample Article/);
  assert.match(value,/- First item/);
  assert.match(value,/1\. Second item/);
  assert.match(value,/\| Name \| Value \|/);
  assert.ok(value.includes('[Reference](https://example.test/ref?q=1&mode=go)'));
  assert.ok(value.includes('detail — saved'));
});
