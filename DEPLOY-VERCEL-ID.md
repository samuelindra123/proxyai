# Deploy Gateway GLM-5 ke Vercel

Panduan ini khusus untuk deploy project gateway ini ke Vercel agar bisa dipakai Claude Code dari internet.

## 1. Prasyarat

- Akun Vercel
- Vercel CLI terpasang
- Project ini sudah berjalan lokal

Install CLI jika belum:

```bash
npm i -g vercel
```

## 2. Struktur penting untuk Vercel

Project ini sudah disiapkan dengan:

- api/index.js sebagai serverless entrypoint
- vercel.json untuk route semua endpoint ke Express app
- server.js yang tetap support local run dan mode serverless

## 3. Deploy pertama

Dari folder project:

```bash
vercel
```

Ikuti prompt sampai selesai.

## 4. Set environment variable di Vercel

Set semua env ini di dashboard Vercel (Project Settings > Environment Variables):

- DO_MODEL_ACCESS_KEY = token model DigitalOcean
- GATEWAY_API_TOKEN = token akses client (untuk Claude Code)
- DEFAULT_MODEL = glm-5
- DO_BASE_URL = https://inference.do-ai.run

Opsional:

- HOST tidak wajib di Vercel
- PORT tidak wajib di Vercel

## 5. Redeploy production

Setelah env lengkap:

```bash
vercel --prod
```

## 6. Test endpoint deploy

Misal URL deploy kamu:

- https://my-glm-gateway.vercel.app

Test health:

```bash
curl https://my-glm-gateway.vercel.app/health
```

Test endpoint Claude-style:

```bash
export ANTHROPIC_API_KEY=<isi_dengan_GATEWAY_API_TOKEN>

curl -X POST https://my-glm-gateway.vercel.app/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "Halo dari vercel"}],
    "max_tokens": 256
  }'
```

Jika sukses, status 200 dan content terisi jawaban.

## 7. Pakai di Claude Code

Di mesin yang menjalankan Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://my-glm-gateway.vercel.app
export ANTHROPIC_API_KEY=<isi_dengan_GATEWAY_API_TOKEN>
```

Lalu jalankan Claude Code seperti biasa.

## 8. Keamanan wajib

- Rotate DO_MODEL_ACCESS_KEY lama jika pernah terekspos.
- Gunakan token berbeda untuk local dan production.
- Jangan commit file .env.
