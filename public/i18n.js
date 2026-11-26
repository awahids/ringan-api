/*
 * Ringan API — UI language (Indonesian source strings, English translation).
 * The app is written in Indonesian; when English is selected, a MutationObserver
 * translates text nodes and placeholder/title/aria-label attributes as they appear.
 * User content (request names, bodies, responses, code, AI answers) is never touched.
 */
(function () {
  'use strict';

  // Exact strings (trimmed) -> English.
  const EN = {
    // generic
    'Batal': 'Cancel', 'Hapus': 'Delete', 'Tutup': 'Close', 'Simpan': 'Save', 'Kirim': 'Send', 'Buat': 'Create', 'Buka': 'Open', 'Nama': 'Name',
    'Pengaturan': 'Settings', 'Kosong': 'Empty', 'Lewati': 'Skip', 'Kembali': 'Back', 'Selesai': 'Done', 'Lanjut': 'Next', 'Naik': 'Move up', 'Turun': 'Move down',
    'Duplikat': 'Duplicate', 'Berdampingan': 'Side by side', 'Jenis': 'Kind', 'Kosongkan': 'Clear', 'Ekspresi': 'Expression', 'Dilewati': 'Skipped', 'Nilai': 'Value',
    'Tabel': 'Table', 'Skenario': 'Scenarios', 'Lulus': 'Passed', 'Gagal': 'Failed', 'Ambil': 'Extract', 'Aktif': 'Active', 'Pakai': 'Use', 'Bersihkan': 'Clear',
    'Dijeda': 'Paused', 'Terhubung': 'Connected', 'Lanjutkan': 'Resume', 'Jeda': 'Pause', 'Putuskan': 'Disconnect', 'Hubungkan': 'Connect', 'Variabel': 'Variables',
    'Sumber': 'Source', 'Catatan': 'Notes', 'Aktifkan': 'Enable', 'Mulai': 'Start', 'Tujuan': 'Target', 'Perbarui': 'Update', 'Terang': 'Light', 'Gelap': 'Dark',
    'Tema': 'Theme', 'Tipe': 'Type', 'Koleksi': 'Collections', 'Tersimpan': 'Saved', 'Lokal': 'Local', 'Bahasa': 'Language', 'Ikuti sistem': 'Follow system',
    'Memuat…': 'Loading…', 'Mengirim…': 'Sending…', 'Berjalan…': 'Running…', 'menunggu…': 'waiting…', 'mengambil…': 'fetching…', 'Menghubungkan…': 'Connecting…', 'Mengimport…': 'Importing…',
    'Belum tersimpan…': 'Unsaved…', 'Gagal simpan': 'Save failed', 'Hari ini': 'Today', 'Catatan:': 'Notes:', 'atau': 'or', 'dan': 'and',
    // session / errors
    'Sesi tidak valid (server mungkin di-restart). Muat ulang halaman (F5).': 'Invalid session (the server may have restarted). Reload the page (F5).',
    'URL masih kosong': 'URL is empty', 'Request dibatalkan.': 'Request cancelled.', 'Tidak bisa memuat data': 'Could not load data', 'Gagal menyalin': 'Copy failed',
    // kv tables / auth
    'Hapus baris': 'Delete row', 'File maksimal 20 MB': 'Max file size 20 MB', 'Pilih file': 'Choose file', 'Sembunyikan nilai': 'Hide value',
    'Mengikuti auth dari parent.': 'Inherits auth from parent.', 'Dikirim sebagai header Authorization: Bearer <token>': 'Sent as header Authorization: Bearer <token>',
    'Dikirim di': 'Sent in', 'Tip: gunakan variabel seperti': 'Tip: use a variable like', 'supaya nilai rahasia disimpan di environment.': 'so secret values stay in the environment.',
    // sidebar / tabs
    'Cari di history…': 'Search history…', 'Cari request…': 'Search requests…', 'Belum ada koleksi.': 'No collections yet.', 'Terakhir: lulus': 'Last run: passed', 'Terakhir: gagal': 'Last run: failed',
    'Buka berdampingan': 'Open side by side', 'Tutup tampilan berdampingan': 'Close side-by-side view', 'Tutup tab lain': 'Close other tabs', 'Tutup semua': 'Close all', 'Tutup (Ctrl+W)': 'Close (Ctrl+W)',
    'Koleksi baru': 'New collection', 'Nama koleksi': 'Collection name', 'Request baru': 'New request', 'Folder baru': 'New folder', 'Nama folder': 'Folder name', 'Ganti nama': 'Rename',
    'Buat request dengan AI…': 'Create request with AI…', 'Jalankan semua (Runner)': 'Run all (Runner)', 'Environment…': 'Environments…', 'Skenario…': 'Scenarios…',
    'Pengaturan koleksi': 'Collection settings', 'Import ke koleksi ini…': 'Import into this collection…', 'Perbarui dari link': 'Update from link', 'Hapus koleksi': 'Delete collection',
    'Jalankan folder (Runner)': 'Run folder (Runner)', 'Pengaturan folder': 'Folder settings', 'Hapus folder': 'Delete folder', 'Hapus request': 'Delete request',
    'cURL disalin ke clipboard': 'cURL copied to clipboard', 'Riwayat perubahan': 'Changelog', 'Ganti environment': 'Switch environment', 'Tanpa environment': 'No environment',
    'Kelola environment…': 'Manage environments…', 'Koleksi baru / template…': 'New collection / template…', 'Hubungkan ke project API (live)…': 'Connect to API project (live)…',
    'Buka folder koleksi (Bruno / Git)…': 'Open collection folder (Bruno / Git)…',
    // templates
    'Template': 'Template', 'Mulai dari nol.': 'Start from scratch.', 'Login → token → endpoint terproteksi': 'Login → token → protected endpoint',
    'List, detail, buat, ubah, hapus + skenario CRUD (contoh: dummyjson.com).': 'List, detail, create, update, delete + CRUD scenario (example: dummyjson.com).',
    'Login, simpan token otomatis, lalu akses endpoint dengan Bearer token (contoh: dummyjson.com).': 'Log in, save the token automatically, then call endpoints with a Bearer token (example: dummyjson.com).',
    'Smoke test project sendiri': 'Smoke test your own project', 'Cek cepat API lokal: health, status, dan waktu respons. Isi baseUrl dengan server Anda.': 'Quick check of a local API: health, status and response time. Set baseUrl to your server.',
    // tour
    'Import koleksi': 'Import a collection', 'Tempel link GitHub (Bruno), file Postman / OpenAPI, atau perintah cURL.': 'Paste a GitHub link (Bruno), a Postman / OpenAPI file, or a cURL command.',
    'Koleksi baru & template': 'New collection & templates', 'Buat koleksi kosong atau dari template: CRUD, Login → token, dan smoke test.': 'Create an empty collection or start from a template: CRUD, Login → token, and smoke test.',
    'Koleksi & request': 'Collections & requests', 'Klik request untuk membukanya. Klik kanan / tombol ⋯ untuk menu: Runner, Skenario, Export, dokumentasi.': 'Click a request to open it. Use the ⋯ button for the menu: Runner, Scenarios, Export, documentation.',
    'URL & variabel': 'URL & variables', 'Tulis {{variabel}}. Hijau = ada nilainya, merah = belum ada. Arahkan kursor untuk melihat nilainya.': 'Write {{variable}}. Green = has a value, red = missing. Hover to see the value.',
    'Klik atau tekan Ctrl+Enter. Response tampil di kanan: Pretty, Tree, Tabel, atau Raw.': 'Click or press Ctrl+Enter. The response shows as Pretty, Tree, Table or Raw.',
    'Environment aktif, status request terakhir, test, dan AI. Klik untuk mengganti.': 'Active environment, last request status, tests and AI. Click to change.',
    'Bahasa, tema, AI, notifikasi. Tur ini bisa diulang dari sini.': 'Language, theme, AI, notifications. You can replay this tour from here.',
    'Tur singkat': 'Quick tour', 'Mulai tur': 'Start tour', 'Kenalan lagi dengan bagian-bagian utama aplikasi.': 'Get to know the main parts of the app again.',
    // split / compare
    'Bandingkan response kedua request': 'Compare the responses of both requests', 'Bandingkan response': 'Compare responses', 'Tukar posisi': 'Swap sides',
    'Tampilan berdampingan butuh layar yang lebih lebar.': 'Side-by-side view needs a wider window.', 'Hanya request yang bisa dibuka berdampingan.': 'Only requests can be opened side by side.',
    'Buka request lain dulu untuk ditampilkan berdampingan.': 'Open another request first to show it side by side.', 'Kirim kedua request dulu supaya ada response untuk dibandingkan.': 'Send both requests first so there are responses to compare.',
    'hanya di B': 'only in B', 'hanya di A': 'only in A', 'Struktur sama': 'Same structure', 'Body identik': 'Identical body', 'Klik untuk menyalin path': 'Click to copy the path',
    'Bandingkan struktur saja (abaikan nilai, cek field & tipe)': 'Compare structure only (ignore values, check fields & types)', 'Bukan JSON: dibandingkan per baris.': 'Not JSON: compared line by line.',
    // empty view
    'Pilih request di sidebar, atau mulai dari:': 'Pick a request in the sidebar, or start with:', 'Hubungkan ke project API': 'Connect to an API project',
    'Import dari link GitHub (koleksi Bruno), Postman v2.1, OpenAPI JSON, atau perintah cURL.': 'Import from a GitHub link (Bruno collection), Postman v2.1, OpenAPI JSON, or a cURL command.',
    'kirim request  ·': 'send request  ·', 'simpan': 'save',
    // request editor
    'https://api.example.com/users  atau  {{baseUrl}}/users/:id': 'https://api.example.com/users  or  {{baseUrl}}/users/:id', 'Perintah cURL diubah menjadi request': 'cURL command converted into a request',
    'Body JSON': 'JSON body', 'Field ada': 'Field exists', 'Waktu < 1 detik': 'Time < 1 second', 'Simpan token ke env': 'Save token to env', 'Simpan ke runtime var': 'Save to runtime var',
    'Path param ditulis di URL dengan': 'Path params are written in the URL as', '. Variabel:': '. Variables:', ', dinamis:': ', dynamic:', 'JSON tidak valid:': 'Invalid JSON:', 'Rapikan JSON': 'Format JSON',
    'Content-Type multipart beserta boundary diatur otomatis.': 'The multipart Content-Type and boundary are set automatically.', 'Request ini tidak mengirim body.': 'This request sends no body.',
    'Diwarisi (bisa ditimpa header di atas)': 'Inherited (can be overridden by the headers above)',
    'Content-Type ditambahkan otomatis sesuai mode body jika belum di-set. Header Authorization dari tab Auth.': 'Content-Type is added automatically from the body mode if not set. The Authorization header comes from the Auth tab.',
    'Variabel khusus request ini. Urutan prioritas: runtime (bru.setVar) > request > environment > koleksi.': 'Variables for this request only. Priority: runtime (bru.setVar) > request > environment > collection.',
    'Runtime vars koleksi ini': 'Runtime vars of this collection', 'API tersedia:': 'Available API:', '(kompatibel Postman dasar). Script berjalan terisolasi tanpa akses jaringan.': '(basic Postman compatible). Scripts run isolated without network access.',
    'Operator & nilai': 'Operator & value', 'Contoh:': 'Example:', 'Belum disimpan, JSON tidak valid:': 'Not saved, invalid JSON:',
    'Validasi response terhadap schema setiap kali request dikirim': 'Validate the response against the schema on every send', 'Format: kunci = status code (': 'Format: key = status code (',
    'Hasil validasi muncul di tab Tests pada response, juga di Runner dan CLI.': 'Validation results show in the response Tests tab, the Runner and the CLI.',
    'Catatan / dokumentasi request ini': 'Notes / documentation for this request', 'Mengirim request…': 'Sending request…', 'Tekan': 'Press', 'atau klik Send.': 'or click Send.',
    'Gagal di pre-request script:': 'Failed in pre-request script:', 'Belum ada assertion atau test. Tambahkan di tab Assert atau Tests pada request.': 'No assertions or tests yet. Add them in the request Assert or Tests tab.',
    // response
    'Klik untuk buka/tutup': 'Click to expand/collapse', 'Klik untuk menyalin nilai': 'Click to copy the value', 'Cari di tabel…': 'Search table…', 'Klik untuk mengurutkan': 'Click to sort',
    'Filter path, mis. data.items[0]': 'Filter path, e.g. data.items[0]', '(tidak ada nilai di path ini)': '(no value at this path)', 'Buka semua': 'Expand all',
    'klik key = salin path, klik nilai = salin nilai': 'click key = copy path, click value = copy value', '… (dipotong)': '… (truncated)', 'Body disalin': 'Body copied',
    'Tidak ada output console.log dari script.': 'No console.log output from scripts.', 'Tidak ada yang cocok.': 'No matches.',
    // history
    'Belum ada history. Setiap request yang Anda kirim akan tercatat di sini (maks. 300 terakhir).': 'No history yet. Every request you send is recorded here (last 300).',
    'Hapus semua history': 'Clear all history', 'Hapus semua history?': 'Clear all history?', 'Request tidak sempat dikirim (gagal di pre-request script).': 'The request was not sent (failed in pre-request script).',
    'Tidak ada header.': 'No headers.', 'Buka request asal': 'Open original request', 'Simpan sebagai request baru': 'Save as new request', 'Request yang dikirim': 'Sent request',
    'Buat koleksi dulu untuk menyimpan request': 'Create a collection first to save the request', '(dari history)': '(from history)',
    // scenarios
    'Skenario baru': 'New scenario', 'Nama skenario, mis. "Login lalu buat order"': 'Scenario name, e.g. "Log in then create order"', '+ Skenario': '+ Scenario',
    'menjalankan beberapa request berurutan sebagai satu test, tanpa menulis script. Contoh:': 'run several requests in order as one test, without writing scripts. Example:',
    'Login → ambil token → buat produk → ambil ID → lihat produk → hapus': 'Log in → get token → create product → take ID → view product → delete',
    'Di setiap langkah Anda bisa menentukan status yang diharapkan dan mengambil nilai dari response (mis.': 'At every step you can set the expected status and extract values from the response (e.g.',
    ') menjadi variabel': ') into a variable', 'yang langsung dipakai langkah berikutnya.': 'that the next steps use right away.', '▶ Jalankan skenario': '▶ Run scenario',
    'Berhenti saat langkah gagal': 'Stop when a step fails', 'Hapus skenario?': 'Delete scenario?', '(request tidak ditemukan)': '(request not found)',
    'nama header, mis. Location': 'header name, e.g. Location', 'path, mis. token atau data.id': 'path, e.g. token or data.id',
    'Runtime: hanya selama aplikasi terbuka. Environment: disimpan ke environment aktif.': 'Runtime: only while the app is open. Environment: saved to the active environment.',
    'Buka request': 'Open request', 'Seret untuk mengubah urutan': 'Drag to reorder', 'Status yang diharapkan: 200, 2xx, atau 200,201': 'Expected status: 200, 2xx, or 200,201',
    'Jeda sebelum langkah ini (ms)': 'Delay before this step (ms)', 'Hapus langkah': 'Delete step', '+ Ambil nilai dari response': '+ Extract value from response',
    'Belum ada langkah. Tambahkan request pertama di bawah.': 'No steps yet. Add the first request below.', 'Pilih request untuk ditambahkan…': 'Choose a request to add…', '+ Tambah langkah': '+ Add step',
    'Nilai yang diambil langsung bisa dipakai langkah berikutnya sebagai': 'Extracted values can be used by the next steps as',
    '(di URL, header, body, atau auth). Skenario juga bisa dijalankan dari CLI:': '(in the URL, headers, body or auth). Scenarios can also run from the CLI:',
    'status': 'status', 'jeda': 'delay', 'langkah': 'steps',
    // status bar / updates
    'Pengaturan AI': 'AI settings', 'Buka halaman rilis': 'Open release page', 'Versi Node: perbarui dengan git pull lalu npm install, atau unduh installer desktop.': 'Node version: update with git pull then npm install, or download the desktop installer.',
    'Lihat perubahan': 'View changes', 'Lewati versi ini': 'Skip this version', 'Cek update sekarang': 'Check for updates now', 'Versi terpasang:': 'Installed version:', 'Sudah versi terbaru': 'Up to date',
    'Cek update otomatis dimatikan': 'Automatic update check is off', 'Semua rilis di GitHub': 'All releases on GitHub', 'Belum dirilis': 'Unreleased', 'Tidak ada catatan.': 'No notes.',
    'Versi baru yang tersedia': 'New versions available', 'Riwayat versi': 'Version history',
    // AI
    'Koneksi ke AI terputus sebelum jawaban selesai.': 'The connection to the AI dropped before the answer finished.', 'Atur provider AI dulu (API key & model).': 'Set up an AI provider first (API key & model).',
    'AI masih menjawab. Tunggu atau klik Stop.': 'The AI is still answering. Wait or click Stop.', 'Menghubungi AI…': 'Contacting the AI…', 'Dihentikan oleh Anda': 'Stopped by you',
    'Buat test & assertion': 'Generate tests & assertions', 'Jelaskan response / error': 'Explain response / error', 'Buat data uji': 'Generate test data', 'Review keamanan & kualitas': 'Security & quality review',
    'Ditambahkan ke Tests': 'Added to Tests', 'Tambahkan ke Tests': 'Add to Tests',
    'Pertanyaan di luar konteks request/koleksi ini, jadi tidak diproses. Tanyakan hal seputar request, response, atau test yang sedang dibuka.': 'This question is outside the context of this request/collection, so it was not processed. Ask about the open request, its response or tests.',
    '(tidak ada jawaban)': '(no answer)', 'Data yang dikirim ke AI': 'Data sent to the AI', 'Tanya apa saja tentang request ini… (Enter kirim, Shift+Enter baris baru)': 'Ask anything about this request… (Enter to send, Shift+Enter for a new line)',
    'AI belum diatur': 'AI is not set up', 'Atur AI': 'Set up AI', 'Kirim request dulu supaya AI bisa melihat response-nya.': 'Send the request first so the AI can see its response.',
    'Pilih provider AI (Claude, OpenAI, Gemini, Ollama lokal, OpenRouter, Groq, DeepSeek, atau server OpenAI-compatible) lalu isi API key di "Atur AI".': 'Choose an AI provider (Claude, OpenAI, Gemini, local Ollama, OpenRouter, Groq, DeepSeek, or an OpenAI-compatible server) and enter its API key under "Set up AI".',
    'AI melihat request ini, response terakhir, schema, dan test yang ada. Header Authorization, cookie, token, password, dan variabel secret selalu disamarkan sebelum dikirim.': 'The AI sees this request, the last response, the schema and existing tests. Authorization headers, cookies, tokens, passwords and secret variables are always masked before sending.',
    'Hentikan jawaban': 'Stop answer', 'Atur provider AI dulu.': 'Set up an AI provider first.', 'Buat request dengan AI': 'Create request with AI',
    'Contoh: login dengan email dan password lalu simpan token ke environment; atau: ambil daftar order milik user 5 halaman 2': 'Example: log in with email and password then save the token to the environment; or: get the orders of user 5, page 2',
    'AI sedang menyusun request…': 'The AI is building the request…', 'Request dari AI': 'Request from AI', 'Request dibuat oleh AI. Periksa dulu sebelum dikirim.': 'Request created by AI. Check it before sending.',
    'Deskripsi di luar konteks pembuatan request API, jadi tidak diproses. Jelaskan request yang Anda butuhkan, mis. "ambil daftar produk halaman 2".': 'The description is not about creating an API request, so it was not processed. Describe the request you need, e.g. "get products page 2".',
    'Jawaban AI tidak berisi request yang valid:': 'The AI answer did not contain a valid request:', 'Jelaskan request yang Anda butuhkan': 'Describe the request you need', 'Gagal memuat pengaturan AI': 'Could not load AI settings',
    'klik "Ambil daftar model"': 'click "Fetch model list"', 'Ambil daftar model': 'Fetch model list', 'Simpan & tes koneksi': 'Save & test connection', 'Pengaturan AI disimpan': 'AI settings saved',
    'Hapus API key?': 'Delete API key?', 'Hapus key provider ini': "Delete this provider's key", 'Asisten AI': 'AI assistant', 'Pengaturan AI…': 'AI settings…',
    'Claude, OpenAI, Gemini, Ollama, OpenRouter, Groq, DeepSeek, atau server OpenAI-compatible.': 'Claude, OpenAI, Gemini, Ollama, OpenRouter, Groq, DeepSeek, or an OpenAI-compatible server.',
    // live sync
    'Live: dijeda': 'Live: paused', 'Live: ada perubahan di spec, belum diterapkan': 'Live: spec changed, not applied yet', 'Tidak terhubung': 'Not connected', 'Ada perubahan (auto-update mati)': 'Changes available (auto-update off)',
    'Spec berubah, tapi tidak ada perubahan endpoint (mis. hanya deskripsi/versi).': 'The spec changed, but no endpoints changed (e.g. only description/version).',
    '2 detik': '2 seconds', '5 detik': '5 seconds', '10 detik': '10 seconds', '30 detik': '30 seconds', '1 menit': '1 minute',
    'Terhubung ke project API (live)': 'Connected to API project (live)', 'Update otomatis': 'Auto update', 'Terapkan perubahan': 'Apply changes', 'Sinkron sekarang': 'Sync now',
    'Putuskan koneksi live?': 'Disconnect live sync?', 'Koleksi tetap ada, tapi tidak lagi mengikuti perubahan spec project.': 'The collection stays, but no longer follows changes to the project spec.',
    'Hubungkan ke project API (live)': 'Connect to API project (live)', 'Terdeteksi di project': 'Detected in project', 'Pilih spec yang mau diikuti:': 'Choose the spec to follow:',
    'Pilih folder project API': 'Choose API project folder', 'URL dev server atau URL spec': 'Dev server URL or spec URL', 'Cari spec': 'Find spec', 'Pilih folder project…': 'Choose project folder…',
    'Update otomatis saat API berubah': 'Update automatically when the API changes',
    'Tidak ada file openapi/swagger (.json/.yaml) di folder ini. Lihat saran di bawah, atau hubungkan lewat URL dev server.': 'No openapi/swagger (.json/.yaml) file in this folder. See the tips below, or connect via the dev server URL.',
    'File spec ditemukan. Ringan akan memantau file ini; setiap kali generator memperbarui file, koleksi ikut ter-update.': 'Spec file found. Ringan will watch it; whenever your generator updates the file, the collection updates too.',
    // folder sync
    'Buka folder koleksi Bruno': 'Open Bruno collection folder', 'Folder ini sudah terbuka sebagai koleksi.': 'This folder is already open as a collection.', 'Buka folder': 'Open folder',
    'Muat ulang dari folder': 'Reload from folder', 'Lepas tautan folder?': 'Unlink folder?', 'Lepas tautan': 'Unlink', 'Simpan ke folder…': 'Save to folder…',
    'Koleksi tetap ada di aplikasi, tapi perubahan berikutnya tidak lagi ditulis ke folder. File di folder tidak dihapus.': 'The collection stays in the app, but further changes are no longer written to the folder. Files in the folder are not deleted.',
    'Simpan koleksi sebagai file .bru agar bisa di-commit ke Git, dibuka di Bruno, dan dijalankan dengan CLI.': 'Save the collection as .bru files so it can be committed to Git, opened in Bruno, and run with the CLI.',
    // collection view
    'Koleksi /': 'Collection /', 'Jalankan semua request': 'Run all requests', 'Import ke sini': 'Import here', 'Dokumentasi koleksi (opsional)': 'Collection documentation (optional)',
    'Variabel koleksi berlaku di semua environment. Nilai environment menimpa variabel koleksi dengan nama sama.': 'Collection variables apply to every environment. Environment values override collection variables with the same name.',
    'Pre-request (sebelum setiap request)': 'Pre-request (before every request)', 'Post-response (setelah setiap response)': 'Post-response (after every response)', 'Tests (untuk setiap request)': 'Tests (for every request)',
    'Environment baru': 'New environment', 'Nama (mis. local, staging)': 'Name (e.g. local, staging)', 'Hapus environment?': 'Delete environment?', 'Pakai di request dengan': 'Use in requests as',
    'Belum ada environment. Buat satu untuk menyimpan baseUrl, token, dll per server (local, staging, production).': 'No environments yet. Create one to store baseUrl, tokens, etc. per server (local, staging, production).',
    'Request dengan auth "Inherit" memakai pengaturan ini.': 'Requests with "Inherit" auth use this setting.',
    // runner
    'Tidak ada request untuk dijalankan.': 'No requests to run.', 'Variabel tidak ditemukan:': 'Variable not found:', 'Jalankan lagi': 'Run again', '(dihentikan)': '(stopped)', 'Jeda (ms)': 'Delay (ms)', 'Berhenti saat gagal': 'Stop on failure',
    // import
    'Tempel JSON (Postman / Bruno / OpenAPI), isi file .bru, atau perintah cURL…': 'Paste JSON (Postman / Bruno / OpenAPI), .bru file content, or a cURL command…',
    'Belum ada file dipilih.': 'No file selected.', 'Tidak ada file .bru / .json.': 'No .bru / .json files.', 'Ada file > 30 MB, dilewati.': 'A file is larger than 30 MB and was skipped.',
    'Tarik file ke sini, atau': 'Drop files here, or', 'Pilih file (.json / .yaml / .bru)': 'Choose file (.json / .yaml / .bru)', 'Pilih folder koleksi Bruno': 'Choose Bruno collection folder',
    'Link collection': 'Collection link', 'Dari link': 'From link', 'Dari file': 'From file', 'Tempel teks': 'Paste text', 'Project API (live)': 'API project (live)',
    'Isi link terlebih dahulu': 'Enter a link first', 'Pilih file terlebih dahulu': 'Choose a file first', 'Tempel teks terlebih dahulu': 'Paste some text first', 'Tidak ada koleksi ditemukan': 'No collection found', 'Perbarui dari link?': 'Update from link?',
    // export
    'Pilih format:': 'Choose a format:',
    'Bisa di-import di Postman, Insomnia, Bruno, dan aplikasi lain. Assertion diubah menjadi pm.test; script bru.* diberi shim agar tetap jalan.': 'Can be imported in Postman, Insomnia, Bruno and other apps. Assertions become pm.test; bru.* scripts get a shim so they keep working.',
    'Spesifikasi API: path, parameter, body, auth, dan schema response. Script/test tidak ikut.': 'API specification: paths, parameters, body, auth and response schemas. Scripts/tests are not included.',
    'Sama dengan OpenAPI 3 JSON, dalam format YAML.': 'Same as OpenAPI 3 JSON, in YAML format.', 'Format lengkap (termasuk script, test, environment). Bisa di-import di Bruno atau Ringan.': 'Full format (including scripts, tests, environments). Can be imported in Bruno or Ringan.',
    'Dokumentasi HTML': 'HTML documentation', 'Satu file HTML siap dibagikan: daftar endpoint, parameter, body, contoh cURL, contoh response, dan skenario. Nilai rahasia disamarkan.': 'A single shareable HTML file: endpoints, parameters, body, cURL examples, example responses and scenarios. Secret values are masked.',
    // settings
    'Timeout request (ms)': 'Request timeout (ms)', 'Timeout script (ms)': 'Script timeout (ms)', 'Verifikasi TLS': 'Verify TLS', 'Matikan untuk server testing dengan sertifikat self-signed.': 'Turn off for test servers with self-signed certificates.',
    'Ikuti redirect': 'Follow redirects', 'Notifikasi desktop': 'Desktop notifications', 'Beri tahu saat Runner atau request lama selesai (saat jendela tidak aktif)': 'Notify when the Runner or a slow request finishes (while the window is inactive)',
    'Cek versi baru otomatis': 'Check for new versions automatically', 'Cek sekarang': 'Check now', 'Bahasa tampilan': 'Display language',
    'Geser untuk mengubah lebar': 'Drag to resize', 'Buka sidebar': 'Open sidebar', 'Import collection (link, file, cURL)': 'Import collection (link, file, cURL)', 'Menu': 'Menu',
    '• Repo / folder GitHub berisi koleksi Bruno (.bru) — publik, atau set env': '• GitHub repo / folder with a Bruno collection (.bru) — public, or set env',
    '• Link raw JSON: Postman v2.x, Bruno export, OpenAPI/Swagger (mis.': '• Raw JSON link: Postman v2.x, Bruno export, OpenAPI/Swagger (e.g.',
    '• GitHub Gist, atau link langsung ke file .bru': '• GitHub Gist, or a direct link to a .bru file',
    'http://localhost:3000  atau  http://localhost:8000/openapi.json': 'http://localhost:3000  or  http://localhost:8000/openapi.json',
    'Koleksi dibuat dari spec OpenAPI project Anda dan otomatis ikut berubah saat API diubah (endpoint baru, parameter, schema). Didukung: FastAPI, NestJS, Spring Boot, ASP.NET, Laravel (l5-swagger), Go (swag), Django (drf-spectacular), Express (swagger-jsdoc), Fastify, Quarkus, atau file openapi.yaml/json di repo.': 'The collection is built from your project\'s OpenAPI spec and follows API changes automatically (new endpoints, parameters, schemas). Supported: FastAPI, NestJS, Spring Boot, ASP.NET, Laravel (l5-swagger), Go (swag), Django (drf-spectacular), Express (swagger-jsdoc), Fastify, Quarkus, or an openapi.yaml/json file in the repo.',
    'nama': 'name', 'nilai': 'value',
    '// dijalankan sebelum request dikirim\n// req.setHeader("X-Time", Date.now());': '// runs before the request is sent\n// req.setHeader("X-Time", Date.now());',
    '// dijalankan setelah response diterima\n// bru.setEnvVar("token", res.body.token);': '// runs after the response arrives\n// bru.setEnvVar("token", res.body.token);',
    '), nilai = JSON Schema / OpenAPI schema. Diisi otomatis saat import OpenAPI (JSON/YAML).': '), value = JSON Schema / OpenAPI schema. Filled automatically when importing OpenAPI (JSON/YAML).',
    'Mendukung type, required, properties, items, enum, nullable, oneOf/anyOf/allOf, format, min/max, pattern, additionalProperties.': 'Supports type, required, properties, items, enum, nullable, oneOf/anyOf/allOf, format, min/max, pattern, additionalProperties.',
    '. Centang "Secret" untuk menyembunyikan nilai di layar; nilai secret tidak ikut di-export. Semua data tetap tersimpan lokal di komputer ini.': '. Tick "Secret" to hide the value on screen; secret values are never exported. All data stays local on this computer.',
    'Indonesian / English. AI juga menjawab dalam bahasa ini.': 'Indonesian / English. The AI also answers in this language.',
  };

  // Dynamic strings: [regex, replacement]. Checked in order when no exact match exists.
  const PATTERNS = [
    [/^Request selesai: (.+)$/, 'Request finished: $1'],
    [/^Mengikuti auth dari (.+?): (.+)\.$/, 'Inherits auth from $1: $2.'],
    [/^Koleksi "(.+)" dibuat dari template (.+)\.$/, 'Collection "$1" created from template $2.'],
    [/^"(.+)"( beserta (\d+) request di dalamnya)? akan dihapus\. Tindakan ini tidak bisa dibatalkan\.$/, (m, a, b, n) => `"${a}"${b ? ` and its ${n} requests` : ''} will be deleted. This cannot be undone.`],
    [/^Status berbeda: (.+) vs (.+)$/, 'Different status: $1 vs $2'],
    [/^(.+) = \(nilai acak saat dikirim\)$/, '$1 = (random value when sent)'],
    [/^(.+): TIDAK DITEMUKAN di environment\/variabel$/, '$1: NOT FOUND in environment/variables'],
    [/^✕ tidak ditemukan: (.+)$/, '✕ not found: $1'],
    [/^Variabel tidak ditemukan: (.+)\. Cek environment yang aktif\.$/, 'Variable not found: $1. Check the active environment.'],
    [/^Klik untuk menyalin path: (.+)$/, 'Click to copy the path: $1'],
    [/^… (\d+) item lagi \(pakai filter path untuk melihatnya\)$/, '… $1 more items (use the path filter to see them)'],
    [/^Response biner \((.+)\)\.$/, 'Binary response ($1).'],
    [/^(.+) → redirect dari (.+)$/, '$1 → redirect from $2'],
    [/^URL akhir: (.+)$/, 'Final URL: $1'],
    [/^(\d+) entri history akan dihapus permanen\.$/, '$1 history entries will be deleted permanently.'],
    [/^Skenario "(.+)" akan dihapus\. Request-nya tidak ikut terhapus\.$/, 'Scenario "$1" will be deleted. Its requests are kept.'],
    [/^Butuh (.+) yang belum ada di environment\/variabel dan belum diambil langkah sebelumnya\.$/, 'Needs $1, which is not in the environment/variables and is not extracted by an earlier step.'],
    [/^Skenario "(.+)": (lulus|gagal) \((\d+)\/(\d+) langkah\)$/, (m, n, r, a, b) => `Scenario "${n}": ${r === 'lulus' ? 'passed' : 'failed'} (${a}/${b} steps)`],
    [/^(Lulus|Gagal) · (\d+)\/(\d+) langkah · (.+)$/, (m, r, a, b, t) => `${r === 'Lulus' ? 'Passed' : 'Failed'} · ${a}/${b} steps · ${t}`],
    [/^(\d+) request berjalan$/, '$1 requests running'],
    [/^(\d+) lulus$/, '$1 passed'], [/^(\d+) gagal$/, '$1 failed'],
    [/^(\d+) perbedaan( struktur)?$/, (m, n, s) => `${n} difference${n === '1' ? '' : 's'}${s ? ' in structure' : ''}`],
    [/^Versi (.+) tersedia — klik untuk melihat perubahan$/, 'Version $1 available — click to see what changed'],
    [/^Versi (.+) tersedia$/, 'Version $1 available'],
    [/^Unduh untuk (.+)$/, 'Download for $1'],
    [/^· Anda memakai v(.+)$/, '· you are on v$1'],
    [/^(\d+) versi baru sejak versi Anda\.$/, '$1 new versions since yours.'],
    [/^Gagal cek update: (.+)$/, 'Update check failed: $1'],
    [/^Anda sudah memakai versi terbaru \(v(.+)\)\.$/, 'You are on the latest version (v$1).'],
    [/^Tidak bisa cek update: (.+)$/, 'Could not check for updates: $1'],
    [/^Ringan API diperbarui ke v(.+)\.$/, 'Ringan API was updated to v$1.'],
    [/^(\d+) assertion ditambahkan$/, '$1 assertions added'],
    [/^(\d+) request dibuat di folder "(.+)"$/, '$1 requests created in folder "$2"'],
    [/^Buat (\d+) request \(dengan assertion status\) di folder baru$/, 'Create $1 requests (with status assertions) in a new folder'],
    [/^(\d+) model tersedia, ketik atau pilih di kolom Model$/, '$1 models available, type or pick one in the Model field'],
    [/^Live: tidak terhubung \((.+)\)$/, 'Live: not connected ($1)'],
    [/^Live: terhubung ke (.+)$/, 'Live: connected to $1'],
    [/^Runner selesai: (.+)$/, 'Runner finished: $1'],
    [/^Import berhasil: (\d+) koleksi, (\d+) request\.$/, 'Import succeeded: $1 collections, $2 requests.'],
    [/^Tambahkan ke: (.+)$/, 'Add to: $1'],
    [/^(\d+) file siap di-import\.$/, '$1 files ready to import.'],
    [/^Sertakan environment aktif \("(.+)"\) sebagai collection variables$/, 'Include the active environment ("$1") as collection variables'],
    [/^Contoh response diambil dari response terakhir di sesi ini \((\d+) dari (\d+) request sudah punya response\)\. Jalankan runner dulu agar lengkap\.$/, 'Example responses come from the last responses in this session ($1 of $2 requests have one). Run the Runner first for complete docs.'],
    [/^Export selesai: (.+)$/s, (m, rest) => `Export finished: ${rest.replace('\n\nCatatan:', '\n\nNotes:')}`],
    [/^Environment "(.+)" akan dihapus\.$/, 'Environment "$1" will be deleted.'],
    [/^Dimuat ulang dari folder: (\d+) request\.$/, 'Reloaded from folder: $1 requests.'],
    [/^Data tersimpan di: (.+)$/, 'Data is stored in: $1'],
    [/^Ringan API (.*) · Node (.*)\. Tidak ada login, tidak ada sinkronisasi cloud\.$/, 'Ringan API $1 · Node $2. No login, no cloud sync.'],
    [/^Versi terpasang: v(.+)\. Pengecekan hanya membaca daftar rilis publik di GitHub\.$/, 'Installed version: v$1. The check only reads the public release list on GitHub.'],
    [/^Header ini dikirim oleh semua request di (koleksi|folder) ini \(bisa ditimpa per request\)\.$/, (m, w) => `These headers are sent by every request in this ${w === 'koleksi' ? 'collection' : 'folder'} (can be overridden per request).`],
    [/^Gagal menulis folder koleksi "(.+)": (.+)$/, 'Could not write collection folder "$1": $2'],
    [/^Script dihentikan: melebihi batas waktu (.+) detik\.$/, 'Script stopped: exceeded the $1 second time limit.'],
    [/^Disimpan ke koleksi "(.+)"\. Nilai variabel sudah terisi \(bukan \{\{variabel\}\}\); auth disalin sebagai header\.$/, 'Saved to collection "$1". Variable values are filled in (not {{variable}}); auth is copied as a header.'],
    [/^Koleksi "(.+)" dibuka dari folder\. Perubahan disimpan langsung ke file \.bru\.$/, 'Collection "$1" opened from folder. Changes are saved straight to .bru files.'],
    [/^Terhubung ke "(.+)" \((\d+) endpoint\)\. Koleksi akan mengikuti perubahan API secara otomatis\.$/, 'Connected to "$1" ($2 endpoints). The collection will follow API changes automatically.'],
    [/^Tests (\d+)\/(\d+)$/, 'Tests $1/$2'],
    [/^Env (.+)$/, 'Env $1'],
    [/^Koleksi (.{1,80})$/, (m, n) => (/\s(dibuat|tetap|akan)\s/.test(n) ? m : `Collection ${n}`)],
  ];

  const SKIP = 'pre, code, textarea, script, style, .name, .tname, .url-hl, .url-preview, .jtree, .jtable, .code, .md, .md-text, .cl-body, .hdr-table, [data-noi18n], .diff-table';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  let lang = 'id';
  let observer = null;

  function translate(text) {
    if (lang !== 'en' || !text) return text;
    const t = text.trim();
    if (!t || !/[A-Za-z]/.test(t)) return text;
    let out = EN[t];
    if (out === undefined) {
      for (const [re, rep] of PATTERNS) {
        if (re.test(t)) { out = t.replace(re, rep); break; }
      }
    }
    if (out === undefined) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return lead + out + trail;
  }

  function skip(el) { return !el || (el.closest && el.closest(SKIP)); }

  function translateNode(node) {
    if (node.nodeType === 3) {
      if (skip(node.parentElement)) return;
      const nv = translate(node.nodeValue);
      if (nv !== node.nodeValue) node.nodeValue = nv;
      return;
    }
    if (node.nodeType !== 1) return;
    // Attributes (placeholder/title) of form fields are UI text even though their content is not.
    const attrs = (el) => { for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const nv = translate(v); if (nv !== v) el.setAttribute(a, nv); } } };
    if (skip(node.parentElement)) return;
    attrs(node);
    if (node.matches(SKIP)) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (n.nodeType === 1 && n.matches(SKIP)) { attrs(n); return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n = walker.nextNode();
    while (n) {
      if (n.nodeType === 3) { const nv = translate(n.nodeValue); if (nv !== n.nodeValue) n.nodeValue = nv; }
      else attrs(n);
      n = walker.nextNode();
    }
  }

  function setLang(l) {
    lang = l === 'en' ? 'en' : 'id';
    document.documentElement.lang = lang;
    if (observer) { observer.disconnect(); observer = null; }
    if (lang !== 'en') return;
    translateNode(document.body);
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.RinganI18n = { setLang, translate, get lang() { return lang; }, EN, PATTERNS };
})();
