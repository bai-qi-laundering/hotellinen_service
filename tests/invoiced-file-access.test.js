import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../statement-dispatch.html',import.meta.url),'utf8');
const flow=html.slice(html.indexOf('async function prepareAndContinue()'),html.indexOf('function showSentConfirm('));
function harness(state,fail=false){
 const item={id:'case',state,latestVersion:2,invoiceStatus:'invoiced',invoicedVersion:1,invoiceRecord:{number:'AB12345678'},versions:[{version:1,sentAt:'old'},{version:2,snapshot:{totals:{afterRebate:200}}}]};
 const original=structuredClone(item),calls={recipient:0,register:0,confirm:0,reload:0,file:[],alerts:[]},nodes={};
 const node=id=>nodes[id]??=(id==='recipientName'?{value:state==='needs_review'?'':'飯店'}:id==='format'?{value:'xlsx'}:{classList:{remove(){}},replaceChildren(){},append(){},hidden:false});
 const context={fixture:item,node,calls,repo:{saveRecipient:async()=>{calls.recipient++;},register:async()=>{calls.register++;}},
 document:{createElement:()=>({})},beginPrepareFile:(selected,format)=>{calls.file.push({version:selected.latestVersion,format});return fail?Promise.reject(Error('download failed')):Promise.resolve();},
 alert:message=>calls.alerts.push(message),reload:async()=>{calls.reload++;},showSentConfirm:()=>{calls.confirm++;}};
 const api=vm.runInNewContext('(function(){const $=node;let selected=fixture,busy=false,chosenFormat="xlsx";'+flow+';return {run:prepareAndContinue};})()',context);
 return {api,item,original,calls,nodes};
}
test('Changed invoiced statement can retrieve current Excel without saving recipient or registering delivery',async()=>{
 const h=harness('needs_review');await h.api.run();
 assert.deepEqual(h.calls.file,[{version:2,format:'xlsx'}]);
 assert.equal(h.calls.recipient,0);assert.equal(h.calls.register,0);assert.equal(h.calls.confirm,0);assert.equal(h.calls.reload,0);
 assert.deepEqual(h.item,h.original);
 assert.equal(h.nodes.next.hidden,true);
 assert.match(h.nodes.dialogTitle.textContent,/檔案已準備好/);
});
test('File retrieval failure retains pending invoice and exposes retry',async()=>{
 const h=harness('needs_review',true);await h.api.run();
 assert.deepEqual(h.item,h.original);
 assert.equal(h.calls.confirm,0);assert.equal(h.calls.recipient,0);
 assert.equal(h.nodes.next.disabled,false);
 assert.deepEqual(h.calls.alerts,['download failed']);
});
test('Normal pending delivery still requires its separate sent confirmation',async()=>{
 const h=harness('pending');await h.api.run();
 assert.equal(h.calls.recipient,1);assert.equal(h.calls.confirm,1);assert.equal(h.calls.register,0);
});
