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
 for(const name of ['驛館-餐廳','驛館餐廳','驛館 餐廳','驛館 法餐','驛館法餐','驛館-酒吧'])assert.equal(statementCustomerKey(name),'驛館-餐廳');
 for(const dept of ['餐廳','餐飲','餐飲部','法餐','酒吧'])assert.equal(statementCustomerKey('驛館','驛館 '+dept,dept),'驛館-餐廳');
 assert.equal(statementCustomerKey('驛館','驛館 制服'),'驛館');
 assert.equal(statementCustomerKey('驛館','驛館 客衣','客衣'),'驛館');
 assert.equal(statementCustomerKey('驛館','驛館 房務','房務'),'驛館');
 assert.equal(statementCustomerKey('洲際','洲際 法餐','法餐'),'洲際');
 assert.equal(statementCustomerKey('然一','然一 客衣'),'然一-客衣');
 assert.equal(statementCustomerKey('然一','然一 制服'),'然一');
});
test('法餐與酒吧歸驛館餐廳，抬頭優先用專用列',()=>{
 const raw=[
  {parentCompany:'驛館',hotel:'驛館 房務',deptName:'房務',item:'床單',qty:10,savedPrice:20,date:'2026-10-03'},
  {parentCompany:'驛館',hotel:'驛館 法餐',deptName:'法餐',item:'口布',qty:5,savedPrice:8,date:'2026-10-03'},
  {parentCompany:'驛館',hotel:'驛館 酒吧',deptName:'酒吧',item:'擦拭布',qty:1,savedPrice:8,date:'2026-10-04'},
  {parentCompany:'驛館',hotel:'驛館 客衣',deptName:'客衣',item:'襯衫',qty:2,savedPrice:30,date:'2026-10-04'},
 ];
 const shared={rawLogisticsData:raw,logisticsMasterItems:[{baseName:'驛館',deptName:'房務',item:'床單'},{baseName:'驛館',deptName:'法餐',item:'口布'},{baseName:'驛館',deptName:'酒吧',item:'擦拭布'}],pricingRules:{holidays:[],rebates:[],managementFees:[]},effectivePriceRules:[],sheetPrices:{},customPrices:{}};
 const dedicated=createInvoiceEngine({...shared,sheetClients:{驛館:{name:'館方抬頭',taxId:'92165561',email:'hotel@example.com'},'驛館 法餐':{name:'餐廳抬頭',taxId:'92165561',email:'dining@example.com'}}});
 const main=dedicated.build('驛館','2026-10-01','2026-10-31');
 const restaurant=dedicated.build('驛館-餐廳','2026-10-01','2026-10-31');
 assert.equal(main.totals.rounded,260);
 assert.deepEqual(main.departments.map(dept=>dept.name),['驛館 房務','驛館 客衣']);
 assert.equal(restaurant.totals.rounded,48);
 assert.deepEqual(restaurant.departments.map(dept=>dept.name),['驛館 法餐','驛館 酒吧']);
 assert.equal(restaurant.profile.name,'餐廳抬頭');
 assert.equal(restaurant.profile.email,'dining@example.com');
 const fallback=createInvoiceEngine({...shared,sheetClients:{驛館:{name:'館方抬頭',taxId:'92165561',email:'hotel@example.com'}}}).build('驛館-餐廳','2026-10-01','2026-10-31');
 assert.equal(fallback.profile.name,'館方抬頭');
 assert.equal(fallback.profile.email,'hotel@example.com');
});