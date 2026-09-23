// Pure calculation engine; Firebase and browser UI are separate.
export const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
export const sum = a => a.reduce((v,x)=>v+x,0);
export const isoDays = (start,end) => {
  if (!/^\d{4}-\d\d-\d\d$/.test(start)||!/^\d{4}-\d\d-\d\d$/.test(end)||start>end) throw Error('Periode biaya tidak valid.');
  const out=[]; let t=Date.parse(start+'T12:00:00Z'), until=Date.parse(end+'T12:00:00Z');
  if((until-t)/86400000>366)throw Error('Periode maksimal 367 hari.');
  for(;t<=until;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));
  return out;
};
const safeNumber = (v,name,positive=false) => {const x=Number(v);if(!Number.isFinite(x)||(positive?x<=0:x<0))throw Error(`${name} harus ${positive?'lebih dari nol':'nol atau lebih'}.`);return x;};
const addStock=(map,key,q,cost)=>{map[key]??=[];map[key].push({q,cost});};
const stockQty=map=>Object.values(map).flat().reduce((a,x)=>a+x.q,0);
const take=(batches,qty,item)=>{let left=qty,cost=0;for(const b of batches){const q=Math.min(b.q,left);cost+=q*b.cost;b.q-=q;left-=q;if(left<=0.0000001)break;}if(left>0.0000001)throw Error(`Stok ${item} kurang ${r2(left)}.`);return cost;};
const typeOrder={feed_buy:0,tray_buy:0,flock:0,production:1,feed_use:2,expense:3,tray_loss:3,sale:4,sale_payment:5,other_income:5};
const monthOf=d=>d.slice(0,7);
const dayRec=(map,date)=>map[date]??=( {feed:0,other:0,produced:0,spoiled:0,allocated:0,hpp:null} );
export function calculate(records){
 const events=[...records].sort((a,b)=>a.date.localeCompare(b.date)||(typeOrder[a.type]??9)-(typeOrder[b.type]??9)||(a.createdAt??'').localeCompare(b.createdAt??''));
 const feed={},day={},sales=[],payments=[],errors=[];let trays=0,flock=0,cashIn=0,cashOut=0,otherIncome=0,feedBought=0,trayBought=0,disposedEggCost=0;
 const valued=[]; const production=[]; const saleEvents=[];
 for(const e of events){
  if(!/^\d{4}-\d\d-\d\d$/.test(e.date))throw Error('Tanggal tidak valid.');
  const q=safeNumber(e.qty??0,'Jumlah'); const money=safeNumber(e.price??0,'Harga');
  switch(e.type){
   case 'feed_buy': {if(!e.name?.trim())throw Error('Nama pakan wajib diisi.');safeNumber(q,'Jumlah',true);safeNumber(money,'Harga',true);const shipping=safeNumber(e.shipping??0,'Ongkos angkut');addStock(feed,e.name.trim().toLowerCase(),q,money+shipping/q);feedBought+=q*money+shipping;cashOut+=q*money+shipping;valued.push({...e,value:q*money+shipping});break;}
   case 'feed_use': {safeNumber(q,'Jumlah',true);const key=e.name?.trim().toLowerCase();const c=take(feed[key]??[],q,`pakan ${e.name}`);dayRec(day,e.date).feed+=c;valued.push({...e,value:c});break;}
   case 'production': {safeNumber(q,'Produksi layak jual',true);const spoiled=safeNumber(e.spoiled??0,'Telur rusak');const d=dayRec(day,e.date);d.produced+=q;d.spoiled+=spoiled;production.push(e);valued.push({...e,value:0});break;}
   case 'expense': {safeNumber(money,'Nominal',true);const days=isoDays(e.date,e.endDate||e.date);for(const d of days)dayRec(day,d).other+=money/days.length;cashOut+=money;valued.push({...e,value:money});break;}
   case 'tray_buy': {safeNumber(q,'Jumlah',true);safeNumber(money,'Harga',true);trays+=q;trayBought+=q*money;cashOut+=q*money;valued.push({...e,value:q*money});break;}
   case 'tray_loss': {safeNumber(q,'Jumlah',true);trays-=q;if(trays<0)throw Error('Stok tray tidak cukup untuk mencatat kerusakan.');const c=q*money;dayRec(day,e.date).other+=c;valued.push({...e,value:c});break;}
   case 'flock': {if(!Number.isInteger(q))throw Error('Jumlah ayam harus bilangan bulat.');if(e.direction==='out')flock-=q;else flock+=q;if(flock<0)throw Error('Populasi ayam tidak boleh negatif.');valued.push({...e,value:0});break;}
   case 'sale': {safeNumber(q,'Telur terjual',true);safeNumber(money,'Harga jual',true);const tray=safeNumber(e.trays??0,'Jumlah tray');if(!Number.isInteger(tray))throw Error('Jumlah tray harus bilangan bulat.');if(tray>trays)throw Error('Tray kosong tidak cukup untuk pertukaran dengan agen.');const paid=safeNumber(e.paid??0,'Pembayaran awal');if(paid>q*money+0.00001)throw Error('Pembayaran melebihi total penjualan.');cashIn+=paid;saleEvents.push(e);valued.push({...e,value:q*money});break;}
   case 'sale_payment': {safeNumber(money,'Pembayaran',true);cashIn+=money;payments.push(e);valued.push({...e,value:money});break;}
   case 'other_income': {safeNumber(money,'Pendapatan',true);cashIn+=money;otherIncome+=money;valued.push({...e,value:money});break;}
   default:throw Error(`Jenis transaksi tidak dikenal: ${e.type}`);
  }
 }
 // Unproductive days accrue costs until next production day; carrying balances remain visible if no output occurs.
 let pending=0;
 for(const date of Object.keys(day).sort()){
  const d=day[date];const amount=d.feed+d.other+pending;
  if(d.produced>0){d.allocated=amount;d.hpp=amount/d.produced;pending=0;}else {d.allocated=0;pending=amount;}
 }
 // Each day's production is valued at its historical date cost, even if it was entered after sales.
 const eggLots=[];
 for(const date of Object.keys(day).sort())if(day[date].produced>0)eggLots.push({date,q:day[date].produced,cost:day[date].hpp});
 const sortedSales=saleEvents.sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt??'').localeCompare(b.createdAt??''));
 const saleDetails=[];let saleRevenue=0,cogs=0,paidAtSale=0;
 for(const e of sortedSales){
  // Prevent using future production to fill past orders, even if events were saved out of order.
  let left=e.qty,c=0;for(const lot of eggLots){if(lot.date>e.date)break;const used=Math.min(left,lot.q);lot.q-=used;left-=used;c+=used*lot.cost;if(left<0.0000001)break;}
  if(left>0.0000001)throw Error(`Stok telur tidak cukup pada ${e.date}; kurang ${r2(left)} kg.`);
  cogs+=c;saleRevenue+=e.qty*e.price;paidAtSale+=Number(e.paid??0);saleDetails.push({id:e.id,date:e.date,qty:e.qty,revenue:e.qty*e.price,cogs:c});
 }
 // Sum payments by sale; do not treat cash collection as new revenue.
 const paidBySale=new Map(saleEvents.map(e=>[e.id,Number(e.paid??0)]));
 for(const p of payments){if(!paidBySale.has(p.saleId))throw Error('Pembayaran mengacu ke penjualan yang tidak ditemukan.');const s=saleEvents.find(x=>x.id===p.saleId);const next=paidBySale.get(p.saleId)+p.price;if(next>s.qty*s.price+0.00001)throw Error('Total pembayaran melebihi nilai penjualan.');paidBySale.set(p.saleId,next);}
 const receivables=saleEvents.reduce((a,e)=>a+e.qty*e.price-(paidBySale.get(e.id)||0),0);
 const eggStock=sum(eggLots.map(x=>x.q));const feedStock=Object.fromEntries(Object.entries(feed).map(([k,lots])=>[k,{qty:sum(lots.map(x=>x.q)),value:sum(lots.map(x=>x.q*x.cost))}]));
 const monthly={}; const m=d=>monthly[monthOf(d)]??={production:0,feed:0,other:0,allocated:0,sales:0,cogs:0,paid:0,spent:0,otherIncome:0,qtySold:0};
 for(const [date,d] of Object.entries(day)){const x=m(date);x.production+=d.produced;x.feed+=d.feed;x.other+=d.other;x.allocated+=d.allocated;}
 for(const s of saleDetails){const x=m(s.date);x.sales+=s.revenue;x.cogs+=s.cogs;x.qtySold+=s.qty;}
 for(const e of events){const x=m(e.date);if(['feed_buy','tray_buy','expense'].includes(e.type))x.spent+=(e.type==='expense'?e.price:e.qty*e.price+(e.type==='feed_buy'?Number(e.shipping??0):0));if(e.type==='sale')x.paid+=Number(e.paid??0);if(e.type==='sale_payment')x.paid+=e.price;if(e.type==='other_income'){x.otherIncome+=e.price;x.paid+=e.price;}}
 return {events:valued,day,monthly,feedStock,feedQty:sum(Object.values(feedStock).map(x=>x.qty)),feedValue:sum(Object.values(feedStock).map(x=>x.value)),eggStock,eggValue:sum(eggLots.map(x=>x.q*x.cost)),trays,flock,cashIn,cashOut,saleRevenue,cogs,receivables,otherIncome,feedBought,trayBought,pendingCost:pending,saleDetails,eggLots,paidBySale};
}
