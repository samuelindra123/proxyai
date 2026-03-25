# Setup Claude Code ke Gateway GLM-5 (DigitalOcean)

Dokumen ini menjelaskan cara menghubungkan Claude Code ke gateway lokal Express yang sudah kamu jalankan, sehingga request akan diteruskan ke model glm-5 di DigitalOcean.

## Prasyarat

- Node.js sudah terpasang
- Project gateway ini sudah ada di folder kerja
- File .env sudah berisi DO_MODEL_ACCESS_KEY yang valid

## 1. Jalankan gateway

Dari folder project:

```bash
npm start
```

Pastikan muncul log:

- Gateway listening on http://localhost:3000

## 2. Verifikasi endpoint gateway

Cek health:

```bash
curl http://localhost:3000/health
```

Cek endpoint Anthropic-compatible (yang dipakai Claude style):

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
   -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "Halo, tes koneksi"}],
    "max_tokens": 256
  }'
```

Jika berhasil, kamu akan dapat JSON dengan field content berisi jawaban.

## 3. Arahkan Claude Code ke gateway lokal

Set environment variable berikut di shell yang sama saat menjalankan Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=<isi_sama_dengan_GATEWAY_API_TOKEN>
```

Catatan:

- ANTHROPIC_API_KEY harus sama dengan GATEWAY_API_TOKEN di file .env gateway.
- Kunci asli DigitalOcean tetap disimpan di file .env gateway, bukan di Claude Code.

## 4. Jalankan Claude Code

Contoh alur:

1. Terminal A: jalankan gateway dengan npm start
2. Terminal B: export ANTHROPIC_BASE_URL dan ANTHROPIC_API_KEY
3. Terminal B: jalankan Claude Code seperti biasa

Setelah itu, request dari Claude Code akan lewat endpoint lokal ini:

- POST /v1/messages

## 5. Troubleshooting cepat

1. Error connection refused
   - Pastikan gateway aktif di port 3000
   - Jalankan lagi: npm start

2. Jawaban kosong atau aneh
   - Coba naikkan max_tokens jadi 512
   - Gunakan prompt yang lebih eksplisit

3. Unauthorized dari upstream
   - Cek nilai DO_MODEL_ACCESS_KEY di .env
   - Jika perlu, rotate key DigitalOcean lalu update .env

4. Port 3000 bentrok
   - Ubah PORT di .env, contoh PORT=3001
   - Update ANTHROPIC_BASE_URL sesuai port baru

## 6. Rekomendasi keamanan

- Jangan commit file .env
- Jangan bagikan API key DigitalOcean ke publik
- Untuk production, letakkan gateway di private network atau belakang auth tambahan

Dokumen khusus (local + deployed) ada di file berikut:

- Lihat CLAUDE-CODE-LOCAL-DEPLOY-ID.md
