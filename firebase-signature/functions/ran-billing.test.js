import test from 'node:test';
import assert from 'node:assert/strict';
import { statementCustomerKey } from './lib/logistics-items.js';
import { customerOf, rowsForPeriod } from './lib/auto-close.js';
import { createInvoiceEngine } from './lib/invoice-engine.js';
import { buildUnsentBoard } from '../../unsent-dashboard.js';

const context={logisticsMasterItems:[{baseName:'然一',hotel:'然一 房務',deptName:'房務',item:'床單'}],pricingRules:{holidays:[],rebates:[],managementFees:[]},effectivePriceRules:[],sheetPrices:{},customPrices:{},sheetClients:{然一:{name:'御盟酒店股份有限公司灣區分公司',taxId:'59269713'}}};
const documents=[
 {id:'room',data:{hotelKeyword:'然一',deptName:'房務',date:'2026-10-10',items:[{itemName:'床單',actualQty:2,price:10}]}},
 {id:'uniform',data:{hotelKeyword:'然一',deptName:'制服',date:'2026-10-10',items:[{itemName:'襯衫',actualQty:3,price:20}]}},
 {id:'guest',data:{hotelKeyword:'然一',deptName:'客衣',date:'2026-10-10',items:[{itemName:'衣服',actualQty:4,price:30}]}}
];
test('Ran guest clothes have their own fixed customer key',()=>{
 for(const alias of ['然一-客衣','然一 客衣','然ㄧ客衣'])assert.equal(statementCustomerKey(alias),'然一-客衣');
 assert.equal(customerOf(documents[2].data),'然一-客衣');
 assert.equal(statementCustomerKey('然一','然一 制服'),'然一');
 assert.equal(statementCustomerKey('H2O','H2O 客衣'),'H2O');
 assert.equal(customerOf({hotelKeyword:'鼎王',deptName:'七賢'}),'鼎王 七賢');
});
test('Two statements use the same profile without sharing line items',()=>{
 const snapshots=['然一','然一-客衣'].map(customer=>{
  const rows=rowsForPeriod(documents,customer,'2026-09-26','2026-10-25');
  return createInvoiceEngine({...context,rawLogisticsData:rows}).build(customer,'2026-09-26','2026-10-25');
 });
 assert.deepEqual(snapshots.map(s=>s.customerKey),['然一','然一-客衣']);
 assert.deepEqual(snapshots.map(s=>s.totals.grandTotal),[80,120]);
 assert.deepEqual(snapshots.map(s=>s.profile.taxId),['59269713','59269713']);
 assert.deepEqual(snapshots.map(s=>s.departments.length),[2,1]);
});
test('Unsent board tracks Ran and guest clothes separately',()=>{
 const board=buildUnsentBoard({today:'2026-11-02',baseNames:['然一'],items:[],cases:[]});
 assert.deepEqual(board.groups[0].unsent.map(r=>r.name).sort(),['然一','然一-客衣'].sort());
});
