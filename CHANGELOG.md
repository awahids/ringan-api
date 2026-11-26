# Changelog

Semua perubahan penting pada Ringan API dicatat di file ini.
Formatnya mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan versi mengikuti [Semantic Versioning](https://semver.org/lang/id/).

Bagian **[Unreleased]** berisi perubahan yang sudah ada di kode tapi belum dirilis. Saat rilis, `npm run release -- <versi>` mengubahnya menjadi nomor versi beserta tanggal.

## [Unreleased]

### Ditambahkan
- **Skenario tanpa kode**: susun alur berurutan (mis. login → buat data → ambil → ubah → hapus) dengan seret-lepas, tentukan status yang diharapkan (`200`, `2xx`, `200,201`), dan ambil nilai dari body/header/status response menjadi `{{variabel}}` untuk langkah berikutnya. Skenario ikut tersimpan di folder `.bru` (`ringan-scenarios.json`) dan bisa dijalankan dari CLI: `ringan run <sumber> --scenario "<nama>"`.
- **Tampilan response**: mode Tree (klik key menyalin path, klik nilai menyalin nilai) dan Tabel (urut, cari, untuk array of object), preview gambar, PDF, dan HTML, serta XML yang dirapikan.
- **Highlight variabel** di URL dan tabel: hijau jika ada nilainya, merah jika belum ada; arahkan kursor untuk melihat nilainya (nilai secret disamarkan), plus pratinjau URL akhir.
- **Tampilan berdampingan**: buka dua request sekaligus dan bandingkan response-nya (status, header, body JSON per path atau per baris; opsi bandingkan struktur saja).
- **Status bar** (environment aktif, status/waktu/ukuran/test request terakhir, request yang sedang berjalan, provider AI) dan **notifikasi desktop** saat Runner, skenario, atau request lama selesai ketika jendela tidak aktif.
- **Dokumentasi HTML otomatis**: export koleksi menjadi satu file HTML siap dibagikan (daftar endpoint, parameter, body, contoh cURL, contoh response, skenario, pencarian). Nilai rahasia disamarkan. Juga lewat CLI: `ringan export <sumber> -t html`.
- **Template koleksi**: CRUD REST, Login → token → endpoint terproteksi, dan smoke test project sendiri, lengkap dengan assertion dan skenario.
- **Tur singkat** saat pertama kali membuka aplikasi (bisa diulang dari Pengaturan).
- **Bahasa tampilan Inggris/Indonesia** di Pengaturan; asisten AI ikut menjawab dalam bahasa yang dipilih.

### Diubah
- Asisten AI hanya menjawab sesuai konteks request/koleksi yang sedang dibuka (request, response, test, variabel) dan tidak mengarang data yang tidak ada. Pertanyaan di luar konteks tidak diproses: jawaban dihentikan seketika dan pertanyaan itu tidak ikut dikirim di percakapan berikutnya.

### Diperbaiki
- Menu klik kanan pada tab bisa error jika salah satu item menu tidak tersedia.

## [1.1.1] - 2026-11-26

### Diperbaiki
- Aplikasi macOS tidak bisa dibuka setelah diinstal (di Apple Silicon muncul pesan "rusak/damaged"). Aplikasi kini ditandatangani ad-hoc sehingga bisa dibuka lewat klik kanan → Open atau System Settings → Privacy & Security → Open Anyway.

### Ditambahkan
- Link unduhan installer di README dan di catatan GitHub Release, beserta panduan membuka aplikasi di macOS pertama kali.
- Build CI memverifikasi tanda tangan aplikasi macOS dan menjalankannya sebelum dirilis.

## [1.1.0] - 2026-11-26

### Ditambahkan
- Notifikasi saat ada versi baru di GitHub Releases, lengkap dengan catatan perubahannya dan tombol unduh installer yang sesuai sistem operasi (Windows installer/portable, macOS Intel/Apple Silicon).
- Riwayat perubahan per versi (menu **Riwayat perubahan** di sidebar dan Pengaturan), termasuk versi baru yang belum terpasang.
- Halaman "Yang baru" yang muncul sekali setelah aplikasi diperbarui.
- Opsi di Pengaturan untuk mematikan pengecekan update otomatis.
- Workflow rilis: push tag `v*` membangun installer Windows & macOS lalu membuat GitHub Release dengan catatan dari changelog ini.

### Diperbaiki
- Sidebar, response, editor request, history, dan modal tidak bisa di-scroll saat isinya panjang.

### Diubah
- Tampilan responsif: di bawah 1100px panel request/response bertumpuk; di bawah 820px sidebar menjadi drawer (tombol ☰) dan modal, menu, serta tabel menyesuaikan layar.

## [1.0.0] - 2026-11-26

Rilis pertama.

### Ditambahkan
- Editor request: method, URL, query & path params, headers, body (JSON, Text, XML, Form URL-Encoded, Multipart dengan file), auth (Bearer, Basic, API Key, inherit dari folder/koleksi).
- Environment per koleksi, variabel koleksi/request/runtime, variabel dinamis (`{{$guid}}`, `{{$timestamp}}`, dll.), nilai secret.
- Testing: assertion deklaratif, tests JavaScript gaya Chai (`test`, `expect`) plus kompatibilitas `pm.*` Postman, script pre-request & post-response di sandbox tanpa akses jaringan.
- Runner koleksi/folder dengan ringkasan, jeda, berhenti saat gagal, dan `bru.setNextRequest()`.
- Tab request, history request, response viewer (JSON pretty + filter, headers, timeline).
- Import: koleksi Bruno (.bru / JSON), Postman v2.x, OpenAPI 3 / Swagger (JSON & YAML), cURL, dari link GitHub/Gist/raw URL.
- Export: Postman Collection v2.1, OpenAPI 3 (JSON/YAML), Bruno JSON.
- Simpan koleksi sebagai folder `.bru` (Git-friendly) dengan sinkronisasi dua arah.
- Validasi response terhadap schema OpenAPI.
- Live sync dengan project API yang sedang dikembangkan: koleksi ikut ter-update saat spec OpenAPI berubah tanpa menghapus test/script Anda.
- Asisten AI multi-provider (Claude, OpenAI, Gemini, Ollama, OpenRouter, Groq, DeepSeek, OpenAI-compatible) dengan streaming jawaban, pembuatan test & data uji, dan penyamaran data sensitif.
- CLI runner (`ringan run`, `ringan export`) dengan laporan JUnit/HTML/JSON untuk CI.
- Aplikasi desktop Electron untuk Windows dan macOS; API key AI dienkripsi dengan keychain OS.

[Unreleased]: https://github.com/awahids/ringan-api/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/awahids/ringan-api/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/awahids/ringan-api/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/awahids/ringan-api/releases/tag/v1.0.0
