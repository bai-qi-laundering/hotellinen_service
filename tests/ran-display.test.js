import test from 'node:test';
import assert from 'node:assert/strict';
import {statementCustomerKey} from '../logistics-items.js';
import {publishSnapshot,renderStatementHtml,buildStatementTables,caseDocumentId,statementFileBase} from '../statement-case.js';
test('同統編不同出帳對象保留各自明細、金額、案件、檔名及顯示名稱',async()=>{
 const records=[{parent:'然一',hotel:'然一 房務',dept:'房務',qty:20},{parent:'然一',hotel:'然一 客衣',dept:'客衣',qty:3},{parent:'然ㄧ',hotel:'然ㄧ 制服',dept:'制服',qty:5}];
 const make=key=>{const rows=records.filter(r=>statementCustomerKey(r.parent,r.hotel,r.dept)===key);return {customerKey:key,startDate:'2026-10-01',endDate:'2026-10-31',profile:{name:'相同法人抬頭',taxId:'12345678'},departments:rows.map(r=>({name:r.hotel,total:r.qty*10,summary:[{item:r.dept,qty:r.qty,price:10,amt:r.qty*10}],records:[{date:'2026-10-02',item:r.dept,qty:r.qty,price:10,amt:r.qty*10}]})),totals:{grandTotal:rows.reduce((n,r)=>n+r.qty*10,0)}};};
 const main=make('然一'),guest=make('然一-客衣');
 assert.equal(main.totals.grandTotal,250);assert.equal(guest.totals.grandTotal,30);
 assert.equal(main.departments.length,2);assert.equal(guest.departments.length,1);
 assert.notEqual(await caseDocumentId(main.customerKey,main.startDate,main.endDate),await caseDocumentId(guest.customerKey,guest.startDate,guest.endDate));
 assert.notEqual(statementFileBase(main),statementFileBase(guest));
 const a=await publishSnapshot(null,main),b=await publishSnapshot(null,guest);
 assert.equal(a.doc.customerKey,'然一');assert.equal(b.doc.customerKey,'然一-客衣');
 assert.match(renderStatementHtml(guest),/客戶名稱<\/td><td>然一客衣/);
 assert.match(renderStatementHtml(main),/客戶名稱<\/td><td>然一<\/td>/);
 for(const s of [main,guest]){assert.match(renderStatementHtml(s),/相同法人抬頭/);assert.match(renderStatementHtml(s),/12345678/);}
 assert.match(buildStatementTables(guest).totalRows[1][1],/^然一客衣\n發票抬頭：相同法人抬頭/);
 assert.match(buildStatementTables(main).totalRows[1][1],/^然一\n發票抬頭：相同法人抬頭/);
});
