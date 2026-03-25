# Panduan Lengkap: Setup Claude Code Dari Nol (Gateway Sudah Online di Vercel)

Panduan ini fokus khusus ke sisi pengguna Claude Code.

Asumsi:

- Gateway GLM-5 sudah online di Vercel.
- Kamu sudah punya 2 data dari admin/deployer gateway:
  - URL gateway (contoh: https://my-glm-gateway.vercel.app)
  - GATEWAY_API_TOKEN (token akses client)

## 1. Install Claude Code

Gunakan installer resmi dari dokumentasi Claude Code (metode install bisa berubah tergantung OS/versi).

Setelah selesai install, cek CLI:

```bash
claude --version
```

Jika command belum dikenali:

- Tutup lalu buka terminal baru.
- Jalankan `source ~/.bashrc` (atau file shell profile kamu).
- Pastikan PATH dari installer Claude Code sudah aktif.

## 2. Simpan konfigurasi koneksi ke gateway Vercel

Di terminal tempat kamu akan menjalankan Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://my-glm-gateway.vercel.app
export ANTHROPIC_API_KEY=ISI_DENGAN_GATEWAY_API_TOKEN
```

Keterangan:

- `ANTHROPIC_BASE_URL` harus URL gateway Vercel kamu.
- `ANTHROPIC_API_KEY` harus sama persis dengan token yang dipasang pada `GATEWAY_API_TOKEN` di server.

## 3. Buat permanen env di Linux (opsional, disarankan)

Supaya tidak perlu export ulang setiap buka terminal:

```bash
echo 'export ANTHROPIC_BASE_URL=https://my-glm-gateway.vercel.app' >> ~/.bashrc
echo 'export ANTHROPIC_API_KEY=ISI_DENGAN_GATEWAY_API_TOKEN' >> ~/.bashrc
source ~/.bashrc
```

## 4. Verifikasi koneksi ke gateway sebelum buka Claude Code

Tes endpoint Claude-style:

```bash
curl -i -X POST "$ANTHROPIC_BASE_URL/v1/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "Halo, tes koneksi via Vercel"}],
    "max_tokens": 256
  }'
```

Expected:

- Status `200`
- JSON berisi `content` dari assistant

Jika status `401`, token salah atau tidak terkirim.

## 5. Jalankan Claude Code

Jalankan Claude Code seperti biasa, lalu coba prompt sederhana:

- "Jawab singkat: ibukota Prancis apa?"
- "Buat fungsi JavaScript untuk palindrome checker."

Jika setup benar, respons Claude Code akan datang dari model GLM-5 lewat gateway Vercel.

## 6. Cara cek bahwa request memang lewat gateway kamu

1. Ubah token sementara ke nilai salah:

```bash
export ANTHROPIC_API_KEY=salah
```

2. Kirim ulang tes curl/Claude request.

Expected: `401 Unauthorized`.

3. Balikkan ke token benar:

```bash
export ANTHROPIC_API_KEY=ISI_DENGAN_GATEWAY_API_TOKEN
```

## 7. Troubleshooting khusus Claude Code + Vercel

1. `401 Unauthorized`
- Token tidak cocok.
- Header Authorization tidak terbaca.
- Env di terminal Claude Code belum ter-load.

2. `404 Not Found`
- URL base salah.
- Deployment belum aktif atau route Vercel salah.

3. `500` atau error upstream
- `DO_MODEL_ACCESS_KEY` di Vercel invalid/expired.
- Upstream DigitalOcean sedang gangguan.

4. Timeout
- Latency upstream tinggi.
- Coba prompt lebih pendek dan turunkan `max_tokens`.

5. Claude Code tetap ke provider default
- Pastikan env diset pada terminal/sesi yang benar.
- Cek ulang dengan `echo $ANTHROPIC_BASE_URL` dan `echo $ANTHROPIC_API_KEY`.

## 8. Keamanan operasional

- Jangan share `ANTHROPIC_API_KEY` ke publik.
- Gunakan token berbeda untuk tiap environment (dev/staging/prod).
- Rotate token berkala.
- Jika token pernah bocor, rotate segera lalu update env di semua client.

## 9. Checklist final (siap pakai)

- `claude --version` sukses.
- `ANTHROPIC_BASE_URL` mengarah ke URL Vercel.
- `ANTHROPIC_API_KEY` sesuai token gateway.
- Tes curl ke `/v1/messages` status 200.
- Prompt pertama di Claude Code sukses.
