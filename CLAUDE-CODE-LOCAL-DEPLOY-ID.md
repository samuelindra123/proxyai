# Panduan Khusus Claude Code (Local dan Deploy)

Dokumen ini khusus untuk menghubungkan Claude Code ke gateway GLM-5 DigitalOcean.

## Konsep singkat

- Claude Code diarahkan ke gateway kamu (bukan langsung ke DigitalOcean).
- Gateway kamu yang menyimpan DO_MODEL_ACCESS_KEY.
- Claude Code mengakses gateway memakai token terpisah: GATEWAY_API_TOKEN.

## A. Konfigurasi aman .env (gateway)

Gunakan format ini di file .env:

```env
HOST=127.0.0.1
PORT=3000
DO_MODEL_ACCESS_KEY=isi_dengan_token_digitalocean
GATEWAY_API_TOKEN=isi_token_panjang_acak_min_32_byte
DEFAULT_MODEL=glm-5
DO_BASE_URL=https://inference.do-ai.run
```

Catatan keamanan:

- HOST=127.0.0.1 membatasi akses hanya dari mesin lokal.
- DO_MODEL_ACCESS_KEY tidak pernah dipasang di Claude Code.
- GATEWAY_API_TOKEN dipakai sebagai kunci akses client ke gateway.

## B. Mode Local (Claude Code di mesin yang sama)

1. Jalankan gateway:

```bash
npm start
```

2. Set environment Claude Code di terminal yang sama dengan sesi Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
export ANTHROPIC_API_KEY=isi_sama_dengan_GATEWAY_API_TOKEN
```

3. Jalankan Claude Code seperti biasa.

4. Uji cepat endpoint yang dipakai Claude format:

```bash
curl -X POST http://127.0.0.1:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "Halo, test local"}],
    "max_tokens": 256
  }'
```

Jika sukses, status 200 dan field content terisi.

## C. Mode Deployed (gateway sudah online)

Contoh URL deploy:

- https://gateway-ai.contoh.com

1. Di server deploy, set env production:

```env
HOST=0.0.0.0
PORT=3000
DO_MODEL_ACCESS_KEY=isi_dengan_token_digitalocean
GATEWAY_API_TOKEN=isi_token_panjang_acak_baru
DEFAULT_MODEL=glm-5
DO_BASE_URL=https://inference.do-ai.run
```

2. Pasang reverse proxy + TLS (Nginx/Cloudflare/Load Balancer) agar akses HTTPS.

3. (Sangat disarankan) Batasi akses:

- Allowlist IP
- Basic auth tambahan atau WAF
- Rate limit

4. Di sisi Claude Code (mesin client):

```bash
export ANTHROPIC_BASE_URL=https://gateway-ai.contoh.com
export ANTHROPIC_API_KEY=isi_sama_dengan_GATEWAY_API_TOKEN_production
```

5. Uji endpoint deployed:

```bash
curl -X POST https://gateway-ai.contoh.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "Halo, test deployed"}],
    "max_tokens": 256
  }'
```

## D. Checklist keamanan production

- Wajib rotate token lama jika pernah terbuka di chat/log.
- Simpan secret di secret manager (bukan plaintext jika memungkinkan).
- Aktifkan logging minimal tanpa menulis token ke log.
- Gunakan firewall untuk menutup akses langsung ke port app.
- Buat token berbeda untuk local, staging, production.

## E. Diagnostik cepat

1. 401 Unauthorized
- Token di header tidak cocok dengan GATEWAY_API_TOKEN.
- Pastikan header Authorization: Bearer <token> terkirim.

2. 5xx dari gateway
- Cek DO_MODEL_ACCESS_KEY dan koneksi keluar ke inference.do-ai.run.

3. Jawaban kosong/aneh
- Naikkan max_tokens.
- Tetap pakai default reasoning_effort=low dari gateway.
