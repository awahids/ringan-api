# Ringan API

API client lokal yang ringan untuk testing API. Tanpa login, tanpa cloud, tanpa `npm install`; cukup Node.js 18+.
Semua data tersimpan di `data/store.json` di komputer Anda.

## Unduh

<!-- download:start -->
**Versi terbaru: v1.1.1** · [catatan rilis](https://github.com/awahids/ringan-api/releases/tag/v1.1.1) · [semua versi](https://github.com/awahids/ringan-api/releases)

| Sistem | Jenis | Unduh |
|---|---|---|
| Windows | Installer (disarankan) | [RinganAPI-Setup-1.1.1.exe](https://github.com/awahids/ringan-api/releases/download/v1.1.1/RinganAPI-Setup-1.1.1.exe) |
| Windows | Portable, tanpa install | [RinganAPI-Portable-1.1.1.exe](https://github.com/awahids/ringan-api/releases/download/v1.1.1/RinganAPI-Portable-1.1.1.exe) |
| macOS | Apple Silicon (M1/M2/M3/M4) | [RinganAPI-1.1.1-arm64.dmg](https://github.com/awahids/ringan-api/releases/download/v1.1.1/RinganAPI-1.1.1-arm64.dmg) |
| macOS | Intel | [RinganAPI-1.1.1-x64.dmg](https://github.com/awahids/ringan-api/releases/download/v1.1.1/RinganAPI-1.1.1-x64.dmg) |

Arsip .zip untuk macOS juga tersedia di [halaman rilis](https://github.com/awahids/ringan-api/releases/tag/v1.1.1). Installer belum ditandatangani sertifikat developer: di Windows pilih *More info → Run anyway* saat SmartScreen muncul; di macOS lihat [cara membuka pertama kali](https://github.com/awahids/ringan-api#membuka-di-macos-pertama-kali).
<!-- download:end -->

### Membuka di macOS pertama kali

Ringan API belum ditandatangani dengan sertifikat Apple Developer, jadi macOS menahannya saat pertama dibuka:

1. Buka file `.dmg`, seret **Ringan API** ke folder **Applications**.
2. Di Finder buka **Applications**, **klik kanan** (atau Control-klik) **Ringan API → Open**, lalu pilih **Open** di dialog yang muncul.
3. Di macOS 15 (Sequoia) atau lebih baru, jika tidak ada tombol Open: coba buka sekali, lalu masuk **System Settings → Privacy & Security**, gulir ke bawah, klik **Open Anyway** untuk Ringan API, dan konfirmasi dengan password Mac.

Ini cukup dilakukan sekali. Jika muncul pesan **"Ringan API is damaged and can't be opened"** (biasanya pada versi 1.1.0 ke bawah, atau file yang ditandai karantina oleh browser), jalankan di Terminal lalu buka lagi:

```bash
xattr -cr "/Applications/Ringan API.app"
```

## Aplikasi desktop (Electron)

Installer yang dibangun sendiri (lihat *Build sendiri* di bawah) ada di folder `dist/`:

| File | Keterangan |
|---|---|
| `RinganAPI-Setup-<versi>.exe` | Installer Windows (bisa pilih folder, buat shortcut Desktop & Start Menu). |
| `RinganAPI-Portable-<versi>.exe` | Satu file, langsung jalan tanpa install. |
| `RinganAPI-<versi>-x64.dmg` / `-arm64.dmg` | macOS Intel / Apple Silicon (di-build di Mac atau GitHub Actions). |

Data versi desktop tersimpan di folder data pengguna (menu **Help → Buka folder data**):
Windows `%APPDATA%\Ringan API\data\store.json`, macOS `~/Library/Application Support/Ringan API/data/store.json`.

Build sendiri:

```
npm install
node node_modules/electron/install.js   # hanya jika npm 11 melewati install script Electron
npm run desktop                          # jalankan versi desktop dari source
npm run dist:win                         # installer Windows -> dist/
npm run dist:mac                         # installer macOS (harus di Mac)
```

**macOS lewat GitHub Actions:** push folder ini ke repo GitHub, buka tab *Actions* → *Desktop build* → *Run workflow* (atau push tag `v1.0.0`). Hasil `.dmg` (Intel & Apple Silicon) dan `.exe` muncul sebagai *artifact*.
Build belum ditandatangani: di macOS buka pertama kali lewat klik kanan → *Open*; di Windows SmartScreen pilih *More info → Run anyway*.

## Update & riwayat perubahan

- Aplikasi mengecek **GitHub Releases** repo ini saat dibuka dan tiap 6 jam. Jika ada versi baru, muncul notifikasi berisi ringkasan perubahan dan tombol **Unduh** yang langsung memilih installer sesuai sistem (Windows Setup/Portable, macOS Intel/Apple Silicon). Bisa juga "Lewati versi ini" atau dimatikan di **Pengaturan → Update**.
- Klik nomor versi di pojok kiri bawah (atau **Pengaturan → Riwayat perubahan**) untuk melihat changelog setiap versi, termasuk versi baru yang belum terpasang. Setelah update, halaman "Yang baru" muncul sekali.
- Riwayat perubahan ditulis di [`CHANGELOG.md`](CHANGELOG.md).

### Merilis versi baru

1. Tulis perubahan di bagian `## [Unreleased]` pada `CHANGELOG.md` (Ditambahkan / Diubah / Diperbaiki).
2. Jalankan `npm run release -- 1.2.0` (atau `patch` / `minor` / `major`). Skrip mengganti `[Unreleased]` menjadi versi + tanggal, menaikkan versi di `package.json`, lalu membuat commit dan tag `v1.2.0`.
3. `git push && git push origin v1.2.0`. Workflow **Desktop build** membangun installer Windows & macOS lalu menerbitkan GitHub Release dengan catatan dari changelog. Aplikasi pengguna akan menampilkan notifikasi update.

## Versi tanpa install (Node.js)

| Cara | Keterangan |
|---|---|
| Klik dua kali **`Ringan API.vbs`** | Buka seperti aplikasi desktop (jendela Edge/Chrome mode app, tanpa console). Server berhenti sendiri ~3 menit setelah jendela ditutup. |
| Klik dua kali **`start.bat`** | Sama, tapi dengan jendela console (tutup console = server berhenti). Saat pertama dijalankan, otomatis memasang `@anthropic-ai/sdk` (untuk AI Claude). |
| `node server.js` | Dari terminal. Opsi: `--no-open`, `--browser` (buka di browser biasa), `--auto-exit`. Port default 4877 (`PORT=5000 node server.js`). |

## Fitur

- **Import dari link**: repo/folder GitHub berisi koleksi Bruno (`.bru`), link raw JSON Postman v2.x / Bruno export, OpenAPI-Swagger (**JSON atau YAML**), GitHub Gist, file `.bru`. Koleksi yang di-import dari link bisa **diperbarui dari link** kapan saja.
- **Import dari file/folder** (pilih folder koleksi Bruno) atau **tempel teks** (JSON, isi `.bru`, perintah cURL). Tempel cURL langsung di kolom URL juga bisa.
- **Request**: GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, query & path params (`/:id`), headers, body (JSON, Text, XML, Form URL-Encoded, Multipart + file), auth (Bearer, Basic, API Key, inherit dari folder/koleksi).
- **Variabel & environment**: `{{baseUrl}}`, environment per koleksi (local/staging/prod), variabel koleksi, variabel request, runtime var (`bru.setVar`), variabel dinamis `{{$guid}} {{$timestamp}} {{$randomInt}} {{$isoTimestamp}} {{$randomEmail}}`. Nilai bisa ditandai *secret* (tidak ikut di-export).
- **Testing**:
  - *Assert* tanpa kode: `res.status` → `eq 200`, `res.body.items.length` → `gt 0`, `res.headers.content-type` → `contains json`, dll.
  - *Tests* JavaScript: `test()` + `expect()` gaya Chai, plus `pm.test` / `pm.expect` / `pm.response` untuk koleksi Postman.
  - *Script* pre-request & post-response (`req`, `res`, `bru`), mis. simpan token: `bru.setEnvVar("token", res.body.token)`.
- **Tab request**: buka banyak request/koleksi sekaligus seperti tab browser. `Ctrl+W` tutup tab, `Ctrl+Tab` pindah tab, klik tengah untuk menutup, klik kanan untuk "Tutup tab lain".
- **History**: setiap request yang dikirim tercatat (300 terakhir, di `data/history.json`) lengkap dengan request yang terkirim, response, dan hasil test. Buka dari sidebar **History**, lalu "Buka request asal" atau "Simpan sebagai request baru".
- **Simpan ke folder `.bru` (Git)**: di Overview koleksi pilih **Simpan ke folder…**, atau **+ → Buka folder koleksi** untuk folder Bruno yang sudah ada. Setiap perubahan langsung ditulis sebagai file `.bru` (format Bruno, bisa dibuka di Bruno). Commit ke Git untuk berbagi dengan tim; hasil `git pull` terbaca saat aplikasi dibuka atau lewat **Muat ulang dari folder**. Nilai *secret* tidak pernah ditulis ke file.
- **Validasi schema response (OpenAPI)**: saat import OpenAPI, schema response per status (`200`, `4XX`, `default`) ikut tersimpan di tab **Schema** tiap request dan dicek otomatis setiap request dikirim (tipe, field wajib, enum, format, nullable, `$ref`, oneOf/anyOf/allOf, dll). Bisa diedit atau ditulis manual.
- **Terhubung ke project API yang sedang dikerjakan (live)**: **+ → Hubungkan ke project API (live)**, isi URL dev server (mis. `http://localhost:3000`) atau pilih folder project. Ringan mencari spec OpenAPI otomatis di path umum framework (FastAPI `/openapi.json`, Spring `/v3/api-docs`, NestJS `/api-json`, ASP.NET `/swagger/v1/swagger.json`, Laravel l5-swagger, Go swag, Django drf-spectacular, Fastify, Quarkus, dll.) atau file `openapi/swagger.*.json|yaml` di repo. Setelah terhubung, Ringan mengecek spec tiap beberapa detik dan **meng-update koleksi otomatis**:
  - endpoint baru ditambahkan (per tag/folder), path/parameter/schema response mengikuti spec, body contoh yang belum Anda edit ikut diperbarui;
  - tests, assertion, script, auth, nilai parameter, dan body yang sudah Anda edit **tetap dipertahankan**;
  - endpoint yang dihapus dari spec dipindah ke folder "Tidak ada lagi di spec" (tidak dihapus) dan kembali otomatis jika muncul lagi;
  - environment "Local" dibuat dengan `baseUrl` mengarah ke dev server. Status live terlihat di sidebar (titik hijau/merah).
- **Asisten AI (multi-provider)**: tab **AI ✦** di setiap request, dan **Buat request dengan AI…** di menu koleksi/folder.
  - Provider: **Anthropic Claude** (default `claude-opus-5-5`, lewat SDK resmi `@anthropic-ai/sdk`, refusal fallback server-side aktif), **OpenAI**, **Google Gemini**, **Ollama** (lokal, gratis), **OpenRouter**, **Groq**, **DeepSeek**, dan server **OpenAI-compatible** apa pun (LM Studio, vLLM, LiteLLM). Atur di **Pengaturan → Pengaturan AI** ("Ambil daftar model" mengambil model terbaru langsung dari provider).
  - Jawaban **di-stream** (muncul bertahap saat AI menulis) untuk semua provider, dengan tombol **Stop** untuk menghentikan; jawaban yang sudah keluar tetap tersimpan.
  - Aksi cepat: *Buat test & assertion* (langsung bisa ditambahkan), *Jelaskan response / error*, *Buat data uji* (variasi valid & negatif → satu klik jadi request dengan assertion status), *Review keamanan & kualitas*, dan tanya bebas.
  - Hanya menjawab sesuai konteks request/koleksi yang sedang dibuka; pertanyaan di luar konteks tidak diproses.
  - Privasi: header Authorization/Cookie, field token/password/secret, dan variabel secret **selalu disamarkan** sebelum dikirim; isi yang dikirim bisa dilihat di "Data yang dikirim ke AI". API key disimpan lokal, terenkripsi keychain OS di versi desktop, dan tidak pernah dikirim ke halaman.
- **Skenario tanpa kode**: tab **Skenario** di koleksi. Susun langkah (request) dengan seret-lepas, tentukan status yang diharapkan (`200`, `2xx`, `200,201`), dan ambil nilai dari body/header/status menjadi `{{variabel}}` untuk langkah berikutnya, mis. login → simpan token → buat data → ambil ID → hapus. Tersimpan di folder `.bru` sebagai `ringan-scenarios.json` dan bisa dijalankan dari CLI (`--scenario`).
- **Template koleksi** (**+ → Koleksi baru / template…**): CRUD REST, Login → token → endpoint terproteksi, dan smoke test project sendiri. **Tur singkat** muncul saat pertama kali dibuka.
- **Tampilan berdampingan & bandingkan**: klik kanan tab → **Buka berdampingan**, lalu **Bandingkan response** (status, header, body per path; atau struktur saja).
- **Highlight variabel**: `{{variabel}}` hijau jika ada nilainya, merah jika belum; arahkan kursor untuk melihat nilainya.
- **Status bar & notifikasi desktop**: environment, status request terakhir, test, AI; notifikasi saat Runner/skenario/request lama selesai ketika jendela tidak aktif.
- **Bahasa**: Indonesia atau Inggris (**Pengaturan → Bahasa tampilan**).
- **Runner**: jalankan semua request di koleksi/folder berurutan, ringkasan lulus/gagal, jeda antar request, berhenti saat gagal, `bru.setNextRequest()`.
- **Response viewer**: status, waktu, ukuran, JSON Pretty / **Tree** (klik untuk menyalin path atau nilai) / **Tabel** (urut & cari) / Raw + filter path, preview gambar, PDF, dan HTML, headers, hasil test, timeline (request yang benar-benar dikirim + console log script).
- **Export** koleksi (menu koleksi → **Export…**, atau CLI `ringan export`) ke:
  - **Postman Collection v2.1**: folder, request, body, auth, variabel (+ environment aktif). Assertion diubah menjadi `pm.test`, script `bru.*`/`res.*` diberi shim agar tetap jalan di Postman/Newman.
  - **OpenAPI 3 (JSON/YAML)**: server dari `{{baseUrl}}`, path params (`/:id` → `/{id}`), query/header params, request body + schema hasil inferensi, auth → `securitySchemes`, schema response dari tab Schema (atau dari response terakhir). Request dengan path+method sama digabung sebagai `examples`.
  - **Bruno JSON**: format lengkap termasuk script & environment.
  - **Dokumentasi HTML**: satu file HTML siap dibagikan berisi daftar endpoint, parameter, body, contoh cURL, contoh response (dari response terakhir), dan skenario.

  Nilai secret tidak pernah ikut di-export. Copy as cURL per request.

## CLI runner (untuk CI/CD)

```
node bin/ringan.js run <sumber> [opsi]
node bin/ringan.js list
```

`<sumber>` bisa berupa folder koleksi `.bru`, file JSON/YAML (Bruno, Postman, OpenAPI), link, atau nama koleksi yang tersimpan di aplikasi.

| Opsi | Keterangan |
|---|---|
| `-e, --env <nama>` | Environment yang dipakai |
| `--env-var key=value` | Set/override variabel (boleh berulang), mis. token dari secret CI |
| `-f, --folder <path>` | Hanya folder tertentu, mis. `"Users/Admin"` |
| `-s, --scenario <nama>` | Jalankan skenario yang dibuat di aplikasi |
| `-r, --reporter cli,junit,html,json` | Format laporan; `-o <dir>` lokasi laporan (default `./ringan-reports`) |
| `--bail`, `--delay <ms>`, `--timeout <ms>`, `--insecure` | Berhenti saat gagal, jeda, timeout, abaikan TLS |

Export dari terminal:

```
node bin/ringan.js export ./api-tests -t openapi-yaml -o openapi.yaml
node bin/ringan.js export "Nama Koleksi" -t postman -o ./exports
```

Format: `postman`, `openapi`, `openapi-yaml`, `bruno`, `html` (dokumentasi).

Exit code `0` jika semua lulus, `1` jika ada yang gagal, jadi pipeline otomatis merah. Contoh GitHub Actions:

```yaml
- run: node ringan-api/bin/ringan.js run ./api-tests --env staging --env-var token=${{ secrets.API_TOKEN }} -r cli,junit,html -o reports
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: api-test-report, path: reports }
```

Catatan: script koleksi di CLI berjalan di vm terpisah tanpa `require`/akses file/jaringan, tapi itu bukan batas keamanan penuh. Jalankan hanya koleksi yang Anda percaya.

## Keamanan

- Server hanya listen di `127.0.0.1`, dan API-nya hanya menerima panggilan dari halaman aplikasi (token per sesi, cek Host/Origin). Website lain tidak bisa memakai proxy lokal ini.
- Script dari koleksi yang di-import berjalan di Web Worker terisolasi: **tanpa akses jaringan**, tanpa akses DOM/penyimpanan, dengan batas waktu.
- Untuk repo GitHub privat atau kena rate limit, set env `GITHUB_TOKEN` sebelum menjalankan server.

## Belum didukung

live sync untuk API tanpa spec OpenAPI (perlu generator spec di project), GraphQL/gRPC/WebSocket khusus (GraphQL bisa via body JSON), OAuth2 flow, `pm.sendRequest`, `require()` di script, data-driven runner (CSV), sinkron otomatis saat file `.bru` diubah dari luar (pakai "Muat ulang dari folder"). Schema response tersimpan di aplikasi, tidak di file `.bru`.

## Tes

```
node test/smoke.js
```
