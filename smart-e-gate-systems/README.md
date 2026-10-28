<div align="center">

# 🚦 Smart E-Gate Systems

### Gerbang Otonom IoT + AI untuk Kawasan Ekonomi Khusus (KEK)

**Keputusan gerbang otomatis dalam hitungan milidetik - fisik ODOL + dokumen pabean, satu alur.**

Full-stack: sensor IoT → pemrosesan AI → sinkronisasi API pemerintah → keputusan Jalur Hijau / Jalur Merah.

![Stack](https://img.shields.io/badge/stack-full--stack-2de2c6?style=for-the-badge)
![Backend](https://img.shields.io/badge/backend-Node.js%20(zero--dep)-16b8a0?style=flat-square)
![DB](https://img.shields.io/badge/database-SQLite-16b8a0?style=flat-square)
![Realtime](https://img.shields.io/badge/realtime-SSE%20%2B%20Leaflet-16b8a0?style=flat-square)
![Tests](https://img.shields.io/badge/engine%20tests-7%2F7%20passing-19e37d?style=flat-square)

*Dibangun oleh **Christina Apriani***

</div>

---

## Ringkasan

Smart E-Gate Systems adalah sistem gerbang pintar untuk truk peti kemas di KEK. Saat truk mendekat, sistem
menangkap data sensor, memprosesnya dengan AI, memverifikasi dokumen ke instansi pemerintah, lalu memutuskan
membuka atau mengunci palang — semuanya otomatis, tanpa truk berhenti total, dalam hitungan milidetik.

Repo ini adalah aplikasi yang berfungsi penuh: **backend** (HTTP server + database + REST/SSE API),
**decision engine** deterministik, dan **frontend** operator console yang interaktif. Satu engine yang sama
dipakai server dan browser, sehingga logika keputusan tidak pernah berbeda di antara keduanya.

## Logika 4 tahap

```
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
  │ 1 · IoT      │ ──▶ │ 2 · AI      │ ──▶ │ 3 · API Gov  │ ──▶ │ 4 · Keputusan│
  │ WIM · LiDAR  │     │ Vision ODOL  │     │ Kemenhub KIR │      │ Hijau/Merah  │
  │ Kamera/OCR   │     │ Prediktif    │     │ CEISA SPPB   │      │ palang/sirine│
  └──────────────┘     └──────────────┘     └──────────────┘      └──────────────┘
```

1. **Tangkap sensor IoT** - Weight-In-Motion (berat), LiDAR (dimensi 3D), kamera HD (pelat + kode kontainer),
   tanpa truk berhenti total.
2. **Pemrosesan AI** - *AI Vision* mendeteksi modifikasi ilegal / ODOL dan membaca pelat (OCR). *AI Prediktif*
   membandingkan berat riil WIM dengan berat manifes untuk mendeteksi anomali (indikasi manipulasi).
3. **Sinkronisasi API** - cek masa aktif **Uji KIR** ke database Kemenhub, dan status **SPPB** ke sistem
   **CEISA Bea Cukai**.
4. **Keputusan otomatis** - jika **lolos uji fisik ODOL DAN dokumen pabean valid** → **Jalur Hijau**, palang
   terbuka, lalu log manifes dikirim ke Bea Cukai. Jika salah satu melanggar atau ada anomali berat →
   **Jalur Merah**, palang terkunci, sirine berbunyi, truk diarahkan ke pemeriksaan fisik / putar balik.

## Fitur aplikasi

| Modul | Deskripsi |
|---|---|
| **🚦 Gate Control** | Visual gerbang animatif (palang, truk, beacon, sirine) dengan pipeline 4 tahap yang menyala real-time dan verdict Hijau/Merah. Tombol simulasi truk masuk + preset skenario. |
| **🎛️ Sensor Input** | Input manual pembacaan sensor (WIM, dimensi, OCR) atau pilih kendaraan terdaftar, lalu proses dengan rincian lengkap per tahap. |
| **🔎 Cek Data** | Cari pelat / kode kontainer, lihat data gabungan kendaraan + manifes + status pabean. |
| **🗄️ Data Registry** | CRUD penuh untuk kendaraan, manifes, dan dokumen SPPB - tambah, ubah, hapus. |
| **🗺️ Live Map** | Peta OpenStreetMap real-time: lokasi gerbang KEK Batang + truk dianimasikan mendekati gerbang, berwarna sesuai keputusan. |
| **📜 Event Log** | Riwayat seluruh lintasan dengan filter jalur, alasan penolakan, dan metrik. |

## Arsitektur

```
smart-e-gate-systems/
├── server.js              # HTTP server (zero-dep): static + REST + SSE
├── src/
│   ├── engine.js          # ⭐ Decision engine 4 tahap (UMD, dipakai server + browser)
│   ├── db.js              # Skema + seed + query (node:sqlite)
│   └── govApi.js          # Integrasi Kemenhub KIR & CEISA SPPB (simulasi async)
├── public/
│   ├── index.html         # Operator console
│   ├── css/styles.css     # Desain sistem (control-room)
│   └── js/
│       ├── engine.js      # salinan canonical src/engine.js (mode demo statis)
│       ├── seed.js        # dataset demo + preset skenario
│       ├── api.js         # data layer (auto live-backend / demo-offline)
│       ├── map.js         # Leaflet live map
│       └── app.js         # controller UI + animasi pipeline
├── test/engine.test.js    # 7 unit test keputusan
└── package.json
```

**Satu engine, dua runtime.** `src/engine.js` adalah otoritas tunggal keputusan gerbang. Server memanggilnya
lewat `require`; browser memakai salinan identik. Keputusan di backend dan di layar operator dijamin sama.

**Mode adaptif.** Frontend otomatis mendeteksi backend. Jika server aktif → **mode LIVE** (database SQLite,
SSE real-time). Jika dibuka sebagai halaman statis tanpa server (mis. GitHub Pages) → **mode DEMO** memakai
engine lokal + `localStorage`. Semua fitur tetap berfungsi di kedua mode.

## Menjalankan

Butuh **Node.js ≥ 20**. Tanpa `npm install` — tidak ada dependency eksternal.

```bash
# jalankan server
npm start
# buka http://localhost:3000

# mode pengembangan (auto-reload)
npm run dev

# jalankan ulang seed database
npm run seed

# unit test decision engine
npm test
```

Mau cepat lihat UI tanpa Node? Buka `public/index.html` langsung di browser — berjalan di **mode DEMO**.

## REST API

| Method | Endpoint | Fungsi |
|---|---|---|
| `POST` | `/api/gate/evaluate` | Proses satu lintasan: input pembacaan sensor → keputusan lengkap |
| `GET` | `/api/stream` | Server-Sent Events: aliran kejadian gerbang real-time |
| `GET` | `/api/lookup/:q` | Data gabungan kendaraan + manifes + pabean |
| `GET/POST/DELETE` | `/api/vehicles` | CRUD kendaraan |
| `GET/POST/DELETE` | `/api/manifests` | CRUD manifes |
| `GET/POST` | `/api/customs` | CRUD dokumen SPPB |
| `GET` | `/api/events` · `/api/stats` | Log & metrik |

Contoh evaluasi gerbang:

```bash
curl -X POST http://localhost:3000/api/gate/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"plate_ocr":"B 9114 KDT","container_code":"TGHU 2048115",
       "wim_kg":32800,"len_mm":12100,"wid_mm":2490,"hei_mm":4150,"ocr_conf":0.98}'
# => { "lane":"GREEN", "action":{"gate":"OPEN",...}, "stages":{...}, "reasons":[] }
```

## Parameter keputusan (dapat dikonfigurasi)

Ambang kebijakan ada di `src/engine.js` (`POLICY`):

- **Overload**: WIM melebihi JBI terdaftar (+ toleransi 5%) → ditolak.
- **Over-dimension**: dimensi LiDAR melebihi batas legal terdaftar → ditolak.
- **Anomali berat**: |berat riil - (tare + kargo manifes)| melebihi 8% → ditolak.
- **KIR**: masa uji berkala harus masih aktif.
- **SPPB**: status pabean harus `APPROVED`.

Jalur Hijau hanya jika **semua** terpenuhi. Pelanggaran apa pun → Jalur Merah + sirine.

## Catatan teknis

- Backend murni modul inti Node (`http`, `node:sqlite`) - nol dependency, mudah di-deploy, mudah diaudit.
- Integrasi Kemenhub & CEISA ditulis sebagai fungsi async bershape produksi (`src/govApi.js`); endpoint resmi
  tinggal menggantikan stub tanpa mengubah orchestrator.
- Peta memakai Leaflet + OpenStreetMap (tanpa API key). Jika tile tidak dapat dimuat, modul peta gagal dengan
  anggun dan fungsi gerbang tetap berjalan.

## Lisensi

MIT © 2026 Christina Apriani.

---

<div align="center">
<sub>Smart E-Gate Systems · IoT + AI · ODOL · Kemenhub KIR · CEISA Bea Cukai · dibangun oleh Christina Apriani</sub>
</div>
