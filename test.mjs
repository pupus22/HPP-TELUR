import assert from 'node:assert/strict';
import {calculate} from './calc.js';
const e=(type,date,other={})=>({id:crypto.randomUUID(),createdAt:new Date().toISOString(),type,date,...other});
const date='2026-09-23';
const input=[e('feed_buy',date,{name:'Jagung',qty:100,price:6500}),e('feed_buy',date,{name:'Jagung',qty:200,price:7000}),e('feed_use',date,{name:'Jagung',qty:120}),e('expense',date,{name:'Listrik',price:100000}),e('production',date,{qty:50,spoiled:2}),e('tray_buy',date,{qty:100,price:2000}),e('sale',date,{name:'Agen A',qty:30,price:25000,trays:21,paid:250000})];
const r=calculate(input);assert.equal(r.day[date].feed,790000);assert.equal(r.feedStock.jagung.qty,180);assert.equal(r.day[date].hpp,17800);assert.equal(r.eggStock,20);assert.equal(r.eggValue,356000);assert.equal(r.saleRevenue,750000);assert.equal(r.cogs,534000);assert.equal(r.receivables,500000);assert.equal(r.trays,100);assert.equal(r.monthly['2026-09'].allocated,890000);console.log('PASS: FIFO pakan, HPP, FIFO telur, piutang, pertukaran tray, laporan bulanan');
assert.throws(()=>calculate([...input,e('feed_use',date,{name:'Jagung',qty:200})]),/Stok pakan/);console.log('PASS: stok pakan tidak boleh negatif');
assert.throws(()=>calculate([...input,e('sale',date,{name:'Agen B',qty:25,price:25000,trays:5,paid:0})]),/Stok telur/);console.log('PASS: stok telur tidak boleh negatif');
const lag=calculate([e('expense','2026-09-21',{name:'Listrik',price:60000,endDate:'2026-09-23'}),e('production','2026-09-23',{qty:10,spoiled:0})]);assert.equal(lag.day['2026-09-23'].hpp,6000);console.log('PASS: biaya pada hari tanpa produksi dibawa ke hari produksi berikutnya');
