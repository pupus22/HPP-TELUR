# HPP Telur — prototipe web + Firebase

Aplikasi satu peternakan, dapat dibuka melalui HP/laptop, tanpa formulir login. Menggunakan Cloud Firestore untuk menyimpan transaksi; Firebase Authentication anonim bekerja otomatis di belakang layar.

## Memasang ke Firebase dan GitHub Pages

1. Buat proyek di [Firebase Console](https://console.firebase.google.com/).
2. **Build → Authentication → Sign-in method:** aktifkan **Anonymous**.
3. **Build → Firestore Database:** buat database. Di tab **Rules**, salin isi `firestore.rules` lalu **Publish**. **PENTING:** rules contoh hanya untuk demo, tidak melindungi data dari orang lain yang membuka aplikasi.
4. **Project settings → Your apps → Web (</>)**: daftarkan web app dan salin nilai `firebaseConfig` ke `firebase-config.js` (apiKey, authDomain, projectId, appId).
5. Buat repository GitHub, unggah seluruh file pada folder ini ke root repository. Buka **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**. Buka URL Pages setelah terbit.
6. Gunakan HTTPS dari GitHub Pages. Jangan membuka `index.html` langsung lewat `file://`, karena modul JavaScript memerlukan server web. Untuk uji lokal gunakan `python -m http.server 8000` lalu buka `http://localhost:8000`.

## Peringatan keamanan

**Prototipe ini bukan aplikasi produksi.** Karena akses tanpa login, semua pengunjung yang memperoleh URL dapat membuat akun anonim otomatis dan, dengan aturan contoh, membaca/mengubah data peternakan bersama. Firebase config di frontend bukan kata sandi dan tidak bisa dipakai sebagai pengaman. Jangan isi data keuangan asli atau sebarkan URL hingga login pemilik, otorisasi per peternakan, rules pembatasan data, dan backend transaksi divalidasi. Untuk tahap pengujian, gunakan data contoh saja.

Seluruh record disimpan di **satu dokumen Firestore**, dan perubahan dijalankan dengan Firestore transaction untuk menghindari pembaruan serentak yang saling menimpa. Ini hanya cocok untuk demo kecil: ada batas dokumen Firestore 1 MiB, biaya baca/tulis dokumen tunggal, dan batas 5.000 transaksi yang diterapkan aplikasi. Saat siap produksi, migrasikan ke koleksi transaksi terpisah, indeks, ledger stok yang dapat diaudit, dan aturan akses yang ketat.

## Cara mencatat

- **Belanja pakan:** nama pakan, berat, harga satuan, ongkos angkut. Menambah stok bernilai per batch; tidak langsung menambah HPP.
- **Pakan digunakan:** masukkan jumlah bersih yang benar-benar digunakan hari itu; FIFO dari batch terlama. Bila pakan sisa dikembalikan, masukkan jumlah bersih saja. Koreksi transaksi yang salah dengan hapus dan input ulang.
- **Produksi:** catat berat telur layak jual (kg) dan berat telur rusak; biaya normal telur rusak ditanggung telur layak jual. Untuk demo, produksi per hari bernilai satu HPP rata-rata harian.
- **Pengeluaran:** nominal + tanggal awal dan opsional tanggal akhir. Beban dibagi rata sepanjang periode; satu entri mencatat uang keluar dan biaya (tidak diduplikasi saat pembayaran).
- **Penjualan:** berat kg aktual, harga/kg, nama agen, tray ditukar, pembayaran awal. Penjualan mengambil telur FIFO berdasarkan tanggal produksi; tray ditukar langsung jumlah sama dan tidak mengubah stok tray kosong akhir. Batas jumlah tray tersedia tetap diperiksa.
- **Pembayaran piutang:** pilih penjualan dan isi dana diterima. Tidak dihitung sebagai pendapatan kedua kali.
- **Tray:** pembelian menambah stok dan kas keluar; tray rusak/hilang mengurangi stok dan nilai kerugiannya bisa dicatat manual.
- **Populasi ayam:** penambahan dan pengurangan ekor; nilai pembelian ayam/aset **belum diimplementasikan** sebagai alokasi HPP penuh.
- **Pendapatan tambahan:** penerimaan lain dicatat terpisah, tetapi biaya khusus sumber pendapatan lain belum dialokasikan otomatis.

## Batasan akuntansi prototipe

Perhitungan berpusat pada **HPP operasional**. HPP penuh (biaya ayam dan penyusutan aset), pencatatan tray dalam kemasan sebelum pengiriman, penyusutan tray, retur telur, pemisahan ongkos penjualan, status pembayaran biaya yang belum dibayar, saldo kas pembukaan, rugi persediaan telur, serta rekonsiliasi dan stock opname **belum dibuat**. Margin penjualan bukan laba bersih final. HPP harian yang belum memiliki telur dialihkan ke hari produksi berikutnya dan ditandai pada dashboard jika masih tersisa. Saat tidak ada produksi berikutnya, beban tersebut tetap tertunda dan belum masuk ke HPP. Jika memasukkan pengeluaran berlaku mundur, biaya telur historis dan biaya telur terjual akan dihitung ulang; jadikan laporan bulan berjalan sebagai sementara.

## Struktur

- `index.html`, `style.css`: antarmuka responsif.
- `app.js`: formulir, rendering dashboard, integrasi Firebase, ekspor/impor.
- `calc.js`: mesin hitung murni FIFO, produksi, penjualan, alokasi biaya, persediaan.
- `firebase-config.js`: isi pengaturan dari proyek Firebase Anda.
- `firestore.rules`: aturan **khusus demo yang tidak aman untuk data asli**.
- `test.mjs`: uji hitungan dasar menggunakan Node.js.
