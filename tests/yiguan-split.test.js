import test from 'node:test';
import assert from 'node:assert/strict';
import {statementCustomerKey} from '../firebase-signature/functions/lib/logistics-items.js';
import {createInvoiceEngine} from '../firebase-signature/functions/lib/invoice-engine.js';
import {caseDocumentId,renderStatementHtml,buildStatementTables,statementFileBase,publishSnapshot} from '../statement-case.js';
test('驛館及餐廳共用統編、分開明細與金額及案件',async()=>{
 const raw=[{parentCompany:'驛館',hotel:'驛館 房務',item:'床單',qty:10,savedPrice:20,date:'2026-10-03'},{parentCompany:'驛館',hotel:'驛館 餐廳',item:'口布',qty:5,savedPrice:8,date:'2026-10-03'},{parentCompany:'驛館',hotel:'驛館 制服',item:'襯衫',qty:2,savedPrice:30,date:'2026-10-03'}];
 const engine=createInvoiceEngine({rawLogisticsData:raw,logisticsMasterItems:[{baseName:'驛館',deptName:'房務',item:'床單'},{baseName:'驛館',deptName:'餐廳',item:'口布'}],pricingRules:{holidays:[],rebates:[],managementFees:[]},effectivePriceRules:[],sheetPrices:{},customPrices:{},sheetClients:{驛館:{name:'共用法人',taxId:'92165561'}}});
 const main=engine.build('驛館','2026-10-01','2026-10-31'),restaurant=engine.build('驛館-餐廳','2026-10-01','2026-10-31');
 assert.equal(main.totals.rounded,260);assert.equal(restaurant.totals.rounded,40);
 assert.equal(main.departments.length,2);assert.equal(restaurant.departments.length,1);
 assert.equal(main.profile.taxId,restaurant.profile.taxId);
 assert.notEqual(await caseDocumentId(main.customerKey,main.startDate,main.endDate),await caseDocumentId(restaurant.customerKey,restaurant.startDate,restaurant.endDate));
 assert.notEqual(statementFileBase(main),statementFileBase(restaurant));
 assert.match(renderStatementHtml(restaurant),/客戶名稱<\/td><td>驛館餐廳/);
 assert.match(buildStatementTables(restaurant).totalRows[1][1],/^驛館餐廳\n發票抬頭：共用法人/);
 const a=await publishSnapshot(null,main),b=await publishSnapshot(null,restaurant);
 assert.equal(a.doc.customerKey,'驛館');assert.equal(b.doc.customerKey,'驛館-餐廳');
});
test('名稱別稱及既有然一分單維持獨立',()=>{
 for(const name of ['驛館-餐廳','驛館餐廳','驛館 餐廳'])assert.equal(statementCustomerKey(name),'驛館-餐廳');
 for(const dept of ['餐廳','餐飲','餐飲部'])assert.equal(statementCustomerKey('驛館','驛館 '+dept,dept),'驛館-餐廳');
 assert.equal(statementCustomerKey('驛館','驛館 制服'),'驛館');
 assert.equal(statementCustomerKey('然一','然一 客衣'),'然一-客衣');
 assert.equal(statementCustomerKey('然一','然一 制服'),'然一');
});