import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, FARM_ID } from './firebase-config.js';
import { calculate, r2 } from './calc.js';

const $ = id => document.getElementById(id);
const money = v => 'Rp' + Math.round(v || 0).toLocaleString('id-ID');
const num = v => Number(v || 0);
const fmt = v => r2(v || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const names = {
  feed_buy: 'Belanja pakan',
  feed_use: 'Pemakaian pakan',
  production: 'Produksi telur',
  expense: 'Pengeluaran',
  sale: 'Penjualan telur',
  sale_payment: 'Pembayaran piutang',
  tray_buy: 'Belanja tray',
  tray_loss: 'Tray rusak/hilang',
  flock: 'Populasi ayam',
  other_income: 'Pendapatan tambahan'
};

const typeHints = {
  feed_buy: 'Masukkan pakan yang baru dibeli agar stok gudang bertambah. Ongkos kirim akan menambah nilai perolehan pakan.',
  feed_use: 'Masukkan pemakaian bersih pakan hari ini. Sistem akan mengambil nilai biaya dengan metode FIFO dari stok yang tersedia.',
  production: 'Catat telur layak jual hasil produksi hari ini. Telur rusak dicatat terpisah agar HPP tetap konsisten.',
  expense: 'Untuk biaya harian, isi satu tanggal. Untuk biaya periode seperti listrik atau gaji, isi tanggal awal dan akhir periode.',
  sale: 'Catat jumlah telur terjual, harga jual per kg, jumlah tray yang dipakai untuk pertukaran, dan pembayaran awal bila ada.',
  sale_payment: 'Gunakan menu ini saat agen melunasi penjualan yang sebelumnya belum dibayar penuh.',
  tray_buy: 'Tambah stok tray kosong dari pembelian baru. Biaya pembelian tidak otomatis menjadi HPP produksi.',
  tray_loss: 'Catat tray yang rusak atau hilang agar stok fisik dan nilai biaya tetap sesuai.',
  flock: 'Gunakan untuk menambah ayam masuk atau mencatat ayam mati / afkir.',
  other_income: 'Pendapatan tambahan seperti pupuk, ayam afkir, atau sumber lain dicatat di sini.'
};

let db, ref, records = [], derived, ready = false, working = false;

function toast(text) {
  $('toast').textContent = text;
  $('toast').style.display = 'block';
  setTimeout(() => $('toast').style.display = 'none', 4500);
}

function status(text) {
  $('connection').textContent = text;
}

function field(name, label, type = 'number', opts = {}) {
  const min = type === 'number' ? 'min="0" step="any"' : '';
  return `<label>${label}<input name="${name}" type="${type}" ${min} ${opts.required === false ? '' : 'required'} ${opts.value !== undefined ? 'value="' + escape(opts.value) + '"' : ''} ${opts.placeholder ? 'placeholder="' + escape(opts.placeholder) + '"' : ''}></label>`;
}

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function select(name, label, options) {
  return `<label>${label}<select name="${name}">${options.map(([v, l]) => `<option value="${escape(v)}">${escape(l)}</option>`).join('')}</select></label>`;
}

function renderFields() {
  const t = $('type').value;
  const common = field('date', 'Tanggal', 'date', { value: today() });
  let html = common;

  if (t === 'feed_buy') html += field('name', 'Nama pakan', 'text', { placeholder: 'Jagung, konsentrat, dll' }) + field('qty', 'Jumlah dibeli (kg)') + field('price', 'Harga beli (Rp/kg)') + field('shipping', 'Ongkos kirim pembelian (Rp)', 'number', { value: 0 });
  if (t === 'feed_use') {
    const options = Object.keys(derived?.feedStock || {}).map(k => [k, k]);
    html += select('name', 'Jenis pakan', options.length ? options : [['', 'Belum ada stok pakan']]) + field('qty', 'Jumlah benar-benar digunakan (kg)') + `<p class="muted">Catat pemakaian bersih setelah sisa pakan diketahui. Bila stok baru dibeli, simpan pembeliannya lebih dahulu.</p>`;
  }
  if (t === 'production') html += field('qty', 'Telur layak jual dihasilkan (kg)') + field('spoiled', 'Telur rusak/tidak layak jual (kg)', 'number', { value: 0 });
  if (t === 'expense') html += field('name', 'Nama biaya', 'text', { placeholder: 'Gaji, listrik, obat, dll' }) + field('price', 'Nominal biaya/pembayaran (Rp)') + field('endDate', 'Tanggal akhir periode biaya (opsional)', 'date', { required: false }) + `<p class="muted">Kosongkan tanggal akhir untuk biaya harian. Untuk listrik/gaji bulanan: tanggal utama = awal periode, tanggal akhir = akhir periode. Jangan masukkan lagi saat membayar.</p>`;
  if (t === 'sale') html += field('name', 'Nama agen/pembeli', 'text') + field('qty', 'Berat telur terjual (kg)') + field('price', 'Harga jual telur (Rp/kg)') + field('trays', 'Tray ditukar langsung (buah)', 'number', { value: 0 }) + field('paid', 'Dibayar sekarang (Rp)', 'number', { value: 0 });
  if (t === 'sale_payment') {
    const opts = records.filter(e => e.type === 'sale').map(e => [e.id, `${e.date} · ${e.name} · ${fmt(e.qty)} kg`]);
    html += select('saleId', 'Penjualan yang dibayar', opts.length ? opts : [['', 'Belum ada penjualan']]) + field('price', 'Jumlah pembayaran (Rp)');
  }
  if (t === 'tray_buy') html += field('qty', 'Jumlah tray dibeli (buah)') + field('price', 'Harga beli (Rp/buah)');
  if (t === 'tray_loss') html += field('qty', 'Jumlah tray rusak/hilang (buah)') + field('price', 'Nilai kerugian per tray (Rp)', 'number', { value: 0 });
  if (t === 'flock') html += select('direction', 'Jenis perubahan', [['in', 'Penambahan ayam'], ['out', 'Ayam mati / afkir']]) + field('qty', 'Jumlah ayam (ekor)');
  if (t === 'other_income') html += field('name', 'Sumber pendapatan', 'text', { placeholder: 'Pupuk, ayam afkir, dll' }) + field('price', 'Uang diterima (Rp)');

  $('fields').innerHTML = html;
  updateTransactionPreview();
  $('form-notice').innerHTML = `<span class="muted">${typeHints[t] || ''}</span>`;
}

// Pratinjau tidak menulis ke Firestore. Stok dihitung sampai tanggal transaksi
// sehingga input bertanggal lampau tidak mengambil stok yang baru masuk kemudian.
const EPS = 1e-7;
function stockAt(date) {
  const lots = new Map();
  let tray = 0;
  const events = [...records].filter(e => e.date <= date).sort((a,b) =>
    a.date.localeCompare(b.date) || ({feed_buy:0,tray_buy:0,production:1,feed_use:2,sale:4,tray_loss:5}[a.type]??3) - ({feed_buy:0,tray_buy:0,production:1,feed_use:2,sale:4,tray_loss:5}[b.type]??3) || String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  for (const e of events) {
    if (e.type === 'feed_buy') {
      const key=String(e.name||'').trim().toLowerCase();
      if (!lots.has(key)) lots.set(key,[]);
      lots.get(key).push({qty:Number(e.qty),cost:Number(e.price)+(Number(e.shipping||0)/Number(e.qty))});
    }
    if (e.type === 'feed_use') {
      const key=String(e.name||'').trim().toLowerCase();
      let left=Number(e.qty||0);
      for (const lot of lots.get(key)||[]) {
        const take=Math.min(left,lot.qty); lot.qty-=take; left-=take;
        if(left<EPS) break;
      }
    }
    if(e.type==='tray_buy') tray+=Number(e.qty||0);
    if(e.type==='tray_loss') tray-=Number(e.qty||0);
  }
  const feed=Object.fromEntries([...lots].map(([k,ls])=>[k,{qty:ls.reduce((a,x)=>a+x.qty,0),lots:ls}]));
  // Setiap penjualan menggunakan pertukaran langsung tray dalam jumlah sama.
  return {feed,tray};
}
function eggsAt(date){
  const dates=Object.entries(derived?.day||{}).filter(([d,v])=>d<=date&&v.produced>0).sort((a,b)=>a[0].localeCompare(b[0]));
  const lots=dates.map(([d,v])=>({date:d,qty:v.produced,cost:v.hpp}));
  const sold=records.filter(e=>e.type==='sale'&&e.date<=date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  for(const sale of sold){
    let remaining=Number(sale.qty||0);
    for(const lot of lots){
      const take=Math.min(remaining,lot.qty);lot.qty-=take;remaining-=take;
      if(remaining<EPS)break;
    }
  }
  return lots;
}
function showStock(items,headline='Stok tersedia sebelum transaksi'){
  $('transaction-stock').innerHTML=`<div class="stock-title">${headline}</div><div class="inline-stocks">${items.map(([label,value,detail])=>`<div class="inline-stock"><span>${label}</span><strong>${value}</strong>${detail?`<small>${detail}</small>`:''}</div>`).join('')}</div>`;
}
function showPreview(html,alert=false){
  $('transaction-preview').innerHTML=html?`<div class="live-preview ${alert?'preview-warning':''}">${html}</div>`:'';
}
function updateTransactionPreview(){
  if(!derived)return;
  const t=$('type').value;
  const data=Object.fromEntries(new FormData($('transaction-form')).entries());
  const date=data.date||today();
  const stock=stockAt(date);
  const eggLots=eggsAt(date);
  const eggQty=eggLots.reduce((n,x)=>n+x.qty,0);
  const feedEntries=Object.entries(stock.feed).filter(([,v])=>v.qty>EPS);
  const summary=[['Telur tersedia',fmt(eggQty)+' kg','Sampai '+date],['Tray kosong',fmt(stock.tray)+' buah','Pertukaran langsung']];
  if(t==='feed_buy'||t==='feed_use')summary.unshift(['Pakan tersedia',fmt(feedEntries.reduce((n,[,v])=>n+v.qty,0))+' kg',feedEntries.map(([k,v])=>escape(k)+': '+fmt(v.qty)+' kg').join(' · ')||'Belum ada stok']);
  showStock(summary,t==='sale'?'Stok sebelum penjualan':'Stok pada tanggal transaksi');
  if(t==='sale'){
    const qty=Number(data.qty||0),price=Number(data.price||0),trays=Number(data.trays||0),paid=Number(data.paid||0);
    let left=Math.max(0,qty),cogs=0;
    for(const lot of eggLots){const take=Math.min(left,lot.qty);cogs+=take*lot.cost;left-=take;if(left<EPS)break;}
    const enough=left<EPS;
    const revenue=qty*price;
    const {hpp,month}=current();
    const refHpp=hpp===null?'Belum tersedia':money(hpp)+'/kg';
    const details=`<div class="preview-head"><span>Perhitungan transaksi penjualan</span><strong>${qty>0&&enough?money(cogs/qty)+'/kg':'—'}</strong></div>
      <div class="preview-caption">HPP persediaan telur yang akan keluar (FIFO); HPP rata-rata bulan ${escape(month)}: ${refHpp}.</div>
      <div class="preview-grid"><div><span>Stok telur</span><strong>${fmt(eggQty)} kg</strong></div><div><span>Sisa setelah jual</span><strong>${qty>0&&enough?fmt(eggQty-qty)+' kg':'—'}</strong></div><div><span>Nilai penjualan</span><strong>${money(revenue)}</strong></div><div><span>Biaya telur terjual</span><strong>${qty>0&&enough?money(cogs):'—'}</strong></div><div><span>Selisih sebelum biaya jual</span><strong>${qty>0&&enough?money(revenue-cogs):'—'}</strong></div><div><span>Piutang transaksi</span><strong>${qty>0?money(revenue-paid):'—'}</strong></div></div>
      <div class="preview-caption">Selisih di atas belum dikurangi ongkos antar, kemasan yang habis, dan biaya jual lainnya. Tidak otomatis menjadi laba bersih.</div>`;
    const errors=[];
    if(qty>eggQty+EPS)errors.push(`Stok telur kurang ${fmt(qty-eggQty)} kg.`);
    if(trays>stock.tray+EPS)errors.push(`Tray kosong kurang ${fmt(trays-stock.tray)} buah.`);
    if(paid>revenue+EPS)errors.push('Pembayaran awal melebihi nilai penjualan.');
    showPreview((errors.length?`<div class="preview-alert">${errors.join(' ')}</div>`:'')+details,errors.length>0);
    return;
  }
  if(t==='feed_use'){
    const key=String(data.name||'').trim().toLowerCase();const available=stock.feed[key]?.qty||0,qty=Number(data.qty||0);
    let remaining=Math.max(0,qty),cost=0;
    for(const lot of stock.feed[key]?.lots||[]){const take=Math.min(remaining,lot.qty);cost+=take*lot.cost;remaining-=take;if(remaining<EPS)break;}
    showPreview(`<div class="preview-head"><span>Stok ${escape(key||'pakan')} tersedia</span><strong>${fmt(available)} kg</strong></div><div class="preview-grid"><div><span>Biaya pemakaian FIFO</span><strong>${qty>0&&remaining<EPS?money(cost):'—'}</strong></div><div><span>Sisa setelah pengambilan</span><strong>${qty>0&&remaining<EPS?fmt(available-qty)+' kg':'—'}</strong></div></div>${qty>available+EPS?`<div class="preview-alert">Stok tidak cukup. Kurang ${fmt(qty-available)} kg.</div>`:''}`,qty>available+EPS);
    return;
  }
  if(t==='tray_buy'||t==='tray_loss'){
    const qty=Number(data.qty||0);
    showPreview(`<div class="preview-head"><span>Stok tray sebelum transaksi</span><strong>${fmt(stock.tray)} buah</strong></div><div class="preview-grid"><div><span>Perubahan stok</span><strong>${t==='tray_buy'?'+':'−'}${fmt(qty)} buah</strong></div><div><span>Stok setelah transaksi</span><strong>${fmt(stock.tray+(t==='tray_buy'?qty:-qty))} buah</strong></div></div>${t==='tray_loss'&&qty>stock.tray?'<div class="preview-alert">Jumlah tray rusak/hilang melebihi stok yang tersedia.</div>':''}`,t==='tray_loss'&&qty>stock.tray);
    return;
  }
  showPreview('');
}

function metric(label, value, detail = '', tone = '', icon = '•') {
  return `<div class="metric ${tone ? 'metric-' + tone : ''}">
    <div class="metric-top">
      <div class="label">${label}</div>
      <div class="metric-icon">${icon}</div>
    </div>
    <strong>${value}</strong>
    <small>${detail}</small>
  </div>`;
}

function current() {
  const month = $('month').value || today().slice(0, 7);
  const m = derived.monthly[month] || { production: 0, feed: 0, other: 0, allocated: 0, sales: 0, cogs: 0, paid: 0, spent: 0, otherIncome: 0, qtySold: 0 };
  return { m, month, hpp: m.production ? m.allocated / m.production : null };
}

function renderDashboard() {
  const { m, hpp, month } = current();
  $('metrics').innerHTML =
    metric('HPP operasional', hpp === null ? '—' : money(hpp) + '/kg', 'Produksi bulan ' + month, 'primary', '₨') +
    metric('Produksi layak jual', fmt(m.production) + ' kg', 'Periode terpilih', '', '🥚') +
    metric('Biaya pakan digunakan', money(m.feed), 'Belanja pakan ≠ biaya pemakaian', 'warm', '🌾') +
    metric('Biaya operasional dialokasikan', money(m.allocated), 'Termasuk biaya hari tanpa produksi', 'cool', '📘') +
    metric('Nilai penjualan', money(m.sales), fmt(m.qtySold) + ' kg terjual', '', '🛒') +
    metric('Margin penjualan operasional', money(m.sales - m.cogs + m.otherIncome), 'Sementara; lihat laporan untuk rincian', 'primary', '📈');

  const profit = num($('target-profit').value);
  const selling = num($('selling-cost').value);
  const rate = num($('selling-rate').value) / 100;
  const market = num($('market-price').value);

  $('price-result').innerHTML = hpp === null
    ? '<strong>HPP belum tersedia</strong><br>Masukkan produksi dan biaya terlebih dahulu agar harga jual bisa disimulasikan.'
    : rate >= 1
      ? '<strong>Biaya persentase harus di bawah 100%.</strong>'
      : `Harga target: <strong>${money((hpp + selling + profit) / (1 - rate))}/kg</strong><br>Margin pada harga pasar: <b>${money(market * (1 - rate) - hpp - selling)}/kg</b>`;

  $('pending-cost').textContent = derived.pendingCost > 0
    ? `Ada biaya ${money(derived.pendingCost)} dari hari tanpa produksi yang belum dialokasikan ke telur berikutnya.`
    : 'Tidak ada biaya tertunda dari hari tanpa produksi.';
}

function renderStocks() {
  const feed = Object.entries(derived.feedStock).map(([k, v]) => `${escape(k)}: ${fmt(v.qty)} kg`).join(' · ') || 'Belum ada stok pakan';
  $('stock-cards').innerHTML =
    metric('Stok pakan', fmt(derived.feedQty) + ' kg', feed, 'warm', '🌾') +
    metric('Stok telur', fmt(derived.eggStock) + ' kg', 'Nilai stok: ' + money(derived.eggValue), '', '🥚') +
    metric('Tray kosong', fmt(derived.trays) + ' buah', 'Pertukaran setara tidak mengubah total', 'cool', '🧺') +
    metric('Populasi ayam', fmt(derived.flock) + ' ekor', 'Sesuai perubahan yang dicatat', '', '🐔') +
    metric('Piutang agen', money(derived.receivables), 'Penjualan belum lunas', 'primary', '💳');

  const filter = $('filter-type').value;
  $('transactions').innerHTML = [...derived.events].reverse().filter(e => !filter || e.type === filter).map(e => `
    <tr>
      <td>${escape(e.date)}</td>
      <td>${names[e.type]}</td>
      <td>${escape(e.name || '')} ${e.qty !== undefined ? '· ' + fmt(e.qty) : ''} ${e.endDate ? '(sampai ' + escape(e.endDate) + ')' : ''}</td>
      <td>${money(e.value)}</td>
      <td><button class="danger" data-remove="${escape(e.id)}">Hapus</button></td>
    </tr>`).join('') || '<tr><td colspan="5">Belum ada transaksi.</td></tr>';
}

function reportCard(label, value, detail = '') {
  return `<div class="report-card"><div class="report-label">${label}</div><strong>${value}</strong><small>${detail}</small></div>`;
}

function renderReport() {
  const { m, month, hpp } = current();
  const reportSummary = [
    reportCard('Produksi layak jual', fmt(m.production) + ' kg', 'Periode ' + month),
    reportCard('HPP operasional', hpp === null ? 'Tidak tersedia' : money(hpp) + '/kg', 'Biaya dialokasikan ÷ produksi'),
    reportCard('Penjualan telur', money(m.sales), fmt(m.qtySold) + ' kg terjual'),
    reportCard('Biaya telur terjual', money(m.cogs), 'FIFO dari stok telur'),
    reportCard('Pendapatan lain', money(m.otherIncome), 'Pupuk, ayam afkir, dll'),
    reportCard('Selisih arus kas', money(m.paid - m.spent), 'Uang masuk - uang keluar yang dicatat')
  ].join('');

  const rows = [
    ['Produksi telur layak jual', fmt(m.production) + ' kg'],
    ['Biaya pakan yang digunakan', money(m.feed)],
    ['Biaya operasional lainnya', money(m.other)],
    ['Biaya dialokasikan ke produksi', money(m.allocated)],
    ['HPP operasional produksi', hpp === null ? 'Tidak tersedia' : money(hpp) + '/kg'],
    ['Telur terjual', fmt(m.qtySold) + ' kg'],
    ['Penjualan telur', money(m.sales)],
    ['Biaya persediaan telur yang terjual (FIFO)', money(m.cogs)],
    ['Pendapatan tambahan', money(m.otherIncome)],
    ['Margin penjualan operasional', money(m.sales - m.cogs + m.otherIncome)],
    ['Uang masuk yang dicatat', money(m.paid)],
    ['Uang keluar pembelian dan biaya yang dicatat', money(m.spent)],
    ['Selisih arus kas tercatat', money(m.paid - m.spent)]
  ];

  $('report').innerHTML = `
    <div class="report-grid">${reportSummary}</div>
    <div class="card">
      <div class="card-head">
        <div>
          <div class="section-kicker">Rincian periode</div>
          <h3>Laporan bulan ${escape(month)}</h3>
        </div>
      </div>
      <table class="report-table">
        <tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody>
      </table>
      <small>Margin penjualan adalah hasil penjualan dikurangi biaya telur terjual, ditambah pendapatan tambahan; tidak memasukkan biaya penjualan yang belum dicatat maupun biaya ayam dan aset.</small>
    </div>`;
}

function render() {
  try {
    derived = calculate(records);
    ready = true;
    renderFields();
    renderStocks();
    renderReport();
    renderDashboard();
    status('Firebase tersambung · ' + records.length + ' transaksi');
    $('app').classList.remove('hidden');
  } catch (err) {
    ready = false;
    status('Data memerlukan perbaikan');
    toast('Perhitungan tidak valid: ' + err.message);
  }
}

async function mutate(update) {
  if (!ready || working) throw Error('Tunggu sinkronisasi data selesai.');
  working = true;
  $('save').disabled = true;
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const old = snap.exists() ? (snap.data().records || []) : [];
      const next = update(old);
      if (!Array.isArray(next) || next.length > 5000) throw Error('Batas versi uji: 5.000 transaksi. Cadangkan data dan pindahkan ke struktur database per-transaksi.');
      calculate(next);
      tx.set(ref, { records: next, updatedAt: new Date().toISOString() });
    });
  } finally {
    working = false;
    $('save').disabled = false;
  }
}

function formData() {
  const data = Object.fromEntries(new FormData($('transaction-form')).entries());
  const t = $('type').value;
  const out = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), type: t, date: data.date };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'date' || v === '') continue;
    out[k] = ['qty', 'price', 'paid', 'shipping', 'spoiled', 'trays'].includes(k) ? Number(v) : v;
  }
  if (!out.date) throw Error('Tanggal wajib diisi.');
  if (t === 'flock' && !Number.isInteger(out.qty)) throw Error('Jumlah ayam harus bulat.');
  if (['tray_buy', 'tray_loss'].includes(t) && !Number.isInteger(out.qty)) throw Error('Jumlah tray harus bulat.');
  return out;
}

function csvCell(x) {
  return '"' + String(x ?? '').replaceAll('"', '""') + '"';
}

function download(name, body, type) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([body], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function wire() {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach(b => b.onclick = () => {
    tabs.forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== b.dataset.tab));
    if(b.dataset.tab==='input') updateTransactionPreview();
  });

  $('type').onchange = renderFields;
  $('transaction-form').addEventListener('input', updateTransactionPreview);
  $('transaction-form').addEventListener('change', updateTransactionPreview);
  $('month').value = today().slice(0, 7);
  $('month').onchange = () => { renderDashboard(); renderReport(); };
  ['target-profit', 'selling-cost', 'selling-rate', 'market-price'].forEach(id => $(id).oninput = renderDashboard);

  $('filter-type').innerHTML += [...Object.entries(names)].map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('filter-type').onchange = renderStocks;

  $('transaction-form').onsubmit = async e => {
    e.preventDefault();
    try {
      const event = formData();
      await mutate(old => [...old, event]);
      toast('Transaksi berhasil disimpan.');
      renderFields();
      $('transaction-form').reset();
      renderFields();
    } catch (err) {
      toast('Tidak tersimpan: ' + err.message);
    }
  };

  $('transactions').onclick = async e => {
    const id = e.target.dataset.remove;
    if (!id || !confirm('Hapus transaksi ini? Penghitungan stok dan HPP akan divalidasi ulang.')) return;
    try {
      await mutate(old => old.filter(x => x.id !== id));
      toast('Transaksi dihapus.');
    } catch (err) {
      toast('Gagal menghapus: ' + err.message);
    }
  };

  $('export-json').onclick = () => download('cadangan-hpp-telur-' + today() + '.json', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2), 'application/json');

  $('import-json').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (obj.version !== 1 || !Array.isArray(obj.records)) throw Error('Format cadangan tidak sesuai.');
      calculate(obj.records);
      if (!confirm('GANTI semua data Firebase dengan isi cadangan? Tindakan ini tidak dapat dibatalkan.')) return;
      await mutate(() => obj.records);
      toast('Cadangan berhasil diimpor.');
    } catch (err) {
      toast('Impor gagal: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };

  $('export-csv').onclick = () => {
    const { m, month, hpp } = current();
    const rows = [
      ['Periode', 'Produksi kg', 'Pakan Rp', 'Operasional lain Rp', 'Biaya alokasi Rp', 'HPP Rp/kg', 'Terjual kg', 'Penjualan Rp', 'Biaya telur terjual Rp', 'Pendapatan lain Rp', 'Uang masuk Rp', 'Uang keluar Rp'],
      [month, m.production, m.feed, m.other, m.allocated, hpp ?? '', m.qtySold, m.sales, m.cogs, m.otherIncome, m.paid, m.spent]
    ];
    download('laporan-hpp-' + month + '.csv', '\ufeff' + rows.map(x => x.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  };
}

async function start() {
  wire();
  if (firebaseConfig.apiKey === 'ISI_API_KEY' || firebaseConfig.projectId === 'ISI_PROJECT_ID') {
    $('setup').classList.remove('hidden');
    status('Konfigurasi Firebase belum diisi');
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    status('Menghubungkan tanpa formulir login…');
    await signInAnonymously(auth);
    db = getFirestore(app);
    ref = doc(db, 'farms', FARM_ID);
    onSnapshot(ref, snap => {
      records = snap.exists() ? (snap.data().records || []) : [];
      render();
    }, err => {
      status('Firebase gagal: ' + err.code);
      toast(err.message);
    });
  } catch (err) {
    status('Koneksi gagal');
    $('setup').classList.remove('hidden');
    $('setup').innerHTML = `<h2>Firebase tidak dapat dihubungkan</h2><p>${escape(err.message)}</p><p>Periksa konfigurasi Firebase, Anonymous Authentication, Firestore, dan aturan akses.</p>`;
  }
}

start();
