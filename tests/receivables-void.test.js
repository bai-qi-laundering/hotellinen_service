import test from 'node:test';
import assert from 'node:assert/strict';
import {publishSnapshot,applySentRegistration,deriveState} from '../statement-case.js';
import {applyLedger,invoiceState,ledger} from '../receivables-core.js';
const snapshot=(amount=100)=>({customerKey:'日航',startDate:'2026-10-01',endDate:'2026-10-31',profile:{name:'日航'},departments:[{name:'房務',summary:[],records:[]}],totals:{afterRebate:amount,tax:5}});
async function invoiced(method='electronic'){
 let {doc}=await publishSnapshot(null,snapshot(),'2026-10-31T01:00:00Z');
 doc=applySentRegistration(doc,1,'xlsx','2026-10-31T02:00:00Z');
 return applyLedger(doc,1,'invoice',{number:'AB12345678',method,date:'2026-10-31'},'2026-10-31T03:00:00Z');
}
const payload=latestVersion=>({latestVersion,number:'AB12345678',reason:'金額更正',date:'2026-11-02',confirmed:'yes'});
test('Changed invoice: external void registration unlocks resend and permits a new invoice',async()=>{
 for(const method of ['manual','electronic']){
  const old=await invoiced(method);
  const changed=(await publishSnapshot(old,snapshot(200),'2026-11-01T01:00:00Z')).doc;
  assert.equal(changed.state,'needs_review');
  assert.throws(()=>applySentRegistration(changed,2,'xlsx','now'));
  const next=applyLedger(changed,1,'voidInvoice',payload(2),'2026-11-02T01:00:00Z');
  assert.equal(next.state,'resend');assert.equal(deriveState(next),'resend');
  assert.equal(invoiceState(next),'未開票');
  assert.equal(next.invoiceHistory[0].number,'AB12345678');
  assert.equal(next.invoiceHistory[0].amount,105);
  assert.equal(next.invoiceHistory[0].method,method);
  assert.deepEqual(next.versions[0].snapshot,old.versions[0].snapshot);
  assert.equal(next.versions[0].sentAt,old.versions[0].sentAt);
  assert.equal(changed.invoiceRecord.number,'AB12345678');
  assert.throws(()=>applyLedger(next,1,'voidInvoice',payload(2),'now'));
  const sent=applySentRegistration(next,2,'pdf','2026-11-02T02:00:00Z');
  assert.equal(ledger(sent).amount,205);
  assert.throws(()=>applyLedger(sent,2,'invoice',{number:'AB12345678',method,date:'2026-11-02'},'now'));
  const reissued=applyLedger(sent,2,'invoice',{number:'CD12345678',method,date:'2026-11-02'},'now');
  assert.equal(reissued.invoiceRecord.amount,205);
  assert.equal(reissued.invoiceHistory.length,1);
 }
});
test('Void requires confirmation, matching number, reason, date and a fresh version',async()=>{
 const old=await invoiced();
 for(const patch of [{confirmed:''},{number:'CD12345678'},{reason:' '},{date:''},{latestVersion:2}]){
  assert.throws(()=>applyLedger(old,1,'voidInvoice',{...payload(1),...patch},'now'));
 }
 assert.throws(()=>applyLedger(old,2,'voidInvoice',payload(1),'now'));
});
test('Voiding an unchanged sent invoice retains delivery and payment data',async()=>{
 const old=await invoiced();old.collectionRecord={receivedAmount:25,bank:'原銀行'};
 const next=applyLedger(old,1,'voidInvoice',payload(1),'2026-11-02T01:00:00Z');
 assert.equal(next.state,'sent');assert.equal(next.invoiceStatus,'ready');
 assert.deepEqual(next.collectionRecord,old.collectionRecord);
 assert.equal(deriveState(next),'sent');
});
