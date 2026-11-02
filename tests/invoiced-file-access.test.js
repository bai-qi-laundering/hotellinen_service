import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../statement-dispatch.html',import.meta.url),'utf8');
const flow=html.slice(html.indexOf('async function prepareAndContinue()'),html.indexOf('function showSentConfirm('));
function harness(state,fail=false){
 const item={id:'case',state,lineRecipient:'飯店',latestVersion:2,invoiceStatus:'invoiced',invoicedVersion:1,invoiceRecord:{number:'AB12345678'},versions:[{version:1,sentAt:'old'},{version:2,snapshot:{totals:{afterRebate:200}}}]};
 const original=structuredClone(item),calls={recipient:0,register:0,confirm:0,reload:0,file:[],alerts:[]},nodes={};
 const node=id=>nodes[id]??=(id==='recipientName'?{value:'飯店'}:id==='format'?{value:'xlsx'}:{classList:{remove(){}},replaceChildren(){},append(){},hidden:false});
 const context={fixture:item,node,calls,repo:{saveRecipient:async()=>{calls.recipient++;},register:async()=>{calls.register++;}},
 document:{createElement:()=>({})},beginPrepareFile:(selected,format)=>{calls.file.push({version:selected.latestVersion,format});return fail?Promise.reject(Error('download failed')):Promise.resolve();},
 alert:message=>calls.alerts.push(message),reload:async()=>{calls.reload++;},showSentConfirm:()=>{calls.confirm++;}};
 const api=vm.runInNewContext('(function(){const $=node;let selected=fixture,busy=false,chosenFormat="xlsx";'+flow+';return {run:prepareAndContinue};})()',context);
 return {api,item,original,calls,nodes};
}
test('Changed invoiced statement prompts sent confirmation after file retrieval and preserves invoice',async()=>{
 const h=harness('needs_review');await h.api.run();
 assert.deepEqual(h.calls.file,[{version:2,format:'xlsx'}]);
 assert.equal(h.calls.recipient,1);assert.equal(h.calls.register,0);assert.equal(h.calls.confirm,1);assert.equal(h.calls.reload,0);
 assert.deepEqual(h.item,h.original);
 assert.equal(h.nodes.next.disabled,false);
});
test('File retrieval failure retains pending invoice and exposes retry',async()=>{
 const h=harness('needs_review',true);await h.api.run();
 assert.deepEqual(h.item,h.original);
 assert.equal(h.calls.confirm,0);assert.equal(h.calls.recipient,1);
 assert.equal(h.nodes.next.disabled,false);
 assert.deepEqual(h.calls.alerts,['download failed']);
});
test('Normal pending delivery still requires its separate sent confirmation',async()=>{
 const h=harness('pending');await h.api.run();
 assert.equal(h.calls.recipient,1);assert.equal(h.calls.confirm,1);assert.equal(h.calls.register,0);
});

test('Sent revised statement appears in both sent and invoice review filters',()=>{
 const source=html.slice(html.indexOf('function invoiceReviewPending('),html.indexOf('function render()'));
 const row={state:'sent',invoiceStatus:'invoiced',invoicedVersion:1,latestVersion:2,endDate:'2026-10-31',versions:[{version:2,sentAt:'sent',review:'invoiced_diff'}]};
 const select=vm.runInNewContext('(function(){let cases=[row],activeFilter="all";const $=()=>({value:""});'+source+';return filter=>{activeFilter=filter;return visibleCases();};})()',{
  row,latestVersion:item=>item.versions.find(v=>v.version===item.latestVersion),dispatchHotelName:()=> '福客來'
 });
 assert.equal(select('sent').length,1);
 assert.equal(select('needs_review').length,1);
 assert.equal(select('pending').length,0);
});
