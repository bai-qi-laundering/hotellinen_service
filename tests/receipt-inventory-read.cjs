const test = require('node:test'), assert = require('node:assert/strict');
const {read} = require('../receipt-inventory-read.js');
test('quantity read requests no plant signatures and retains legacy names, explicit zero, notes and outlet metadata', async () => {
    let body;
    const snapshot = await read({projectId:'fixture',date:'2026-10-22',fetchImpl:async (url, options) => {
        body=JSON.parse(options.body);
        assert.equal(options.cache,'no-store');
        return {ok:true,json:async()=>[{document:{name:'projects/fixture/databases/(default)/documents/inventory_records/row',fields:{
            hotelName:{stringValue:'洲際 餐廳'},item:{stringValue:'【CLUB】雞尾酒巾'},count:{integerValue:'0'},
            doubleCount:{stringValue:'0'},note:{stringValue:'備註'},outlet:{stringValue:'CLUB'},sourceItem:{stringValue:'雞尾酒巾'},
            items:{arrayValue:{values:[{mapValue:{fields:{itemName:{stringValue:'方巾'},qty:{integerValue:'0'}}}}]}}
        }}}]};
    }});
    assert.equal(body.structuredQuery.where.fieldFilter.value.stringValue,'2026-10-22');
    const fields=body.structuredQuery.select.fields.map(field=>field.fieldPath);
    assert(!fields.includes('signature'));assert(!fields.includes('doubleSignature'));assert(fields.includes('hotelKeyword'));assert(fields.includes('items'));
    assert.equal(snapshot.size,1);assert.equal(snapshot.docs[0].id,'row');
    let row;snapshot.forEach(doc=>row=doc.data());
    assert.equal(row.count,0);assert.equal(row.doubleCount,'0');assert.equal(row.hotelName,'洲際 餐廳');assert.equal(row.sourceItem,'雞尾酒巾');assert.equal(row.items[0].qty,0);assert.equal(row.note,'備註');
});
test('empty server result is empty; failed or malformed responses use server fallback instead of claiming an empty receipt', async () => {
    const empty=await read({projectId:'fixture',date:'2026-10-22',fetchImpl:async()=>({ok:true,json:async()=>[{readTime:'now'}]})});assert.equal(empty.empty,true);
    for (const response of [{ok:false,status:403},{ok:true,json:async()=>({error:{message:'offline'}})}]) {
        let calls=0;const expected={confirmed:true};
        const actual=await read({projectId:'fixture',date:'2026-10-22',fetchImpl:async()=>response,fallback:async()=>{calls++;return expected;}});
        assert.equal(actual,expected);assert.equal(calls,1);
    }
});
test('a stalled HTTP read aborts and falls back; if both reads fail the receipt remains failed', async () => {
    let aborted=false;
    const result=await read({projectId:'fixture',date:'2026-10-22',timeoutMs:5,
        fetchImpl:(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));})),
        fallback:async()=>({confirmed:true})});
    assert.equal(aborted,true);assert.equal(result.confirmed,true);
    await assert.rejects(read({projectId:'fixture',date:'2026-10-22',fetchImpl:async()=>{throw new Error('offline');},fallback:async()=>{throw new Error('still offline');}}),/still offline/);
});
