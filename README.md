# DigitalOcean GLM-5 Express Gateway

Express gateway untuk mengakses model `glm-5` di DigitalOcean (`https://inference.do-ai.run`) dengan dua format API:

- OpenAI compatible: `POST /v1/chat/completions`
- Anthropic compatible (basic): `POST /v1/messages`

## 1) Setup

```bash
npm install
cp .env.example .env
```

Isi `.env`:

```env
HOST=127.0.0.1
PORT=3000
DO_MODEL_ACCESS_KEY=YOUR_DIGITALOCEAN_MODEL_ACCESS_KEY
GATEWAY_API_TOKEN=YOUR_STRONG_GATEWAY_TOKEN
DEFAULT_MODEL=glm-5
DO_BASE_URL=https://inference.do-ai.run
```

Jalankan server:

```bash
npm run dev
# atau
npm start
```

## 2) Test endpoint OpenAI compatible

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5",
    "messages": [{"role": "user", "content": "What is the capital of France?"}],
    "max_tokens": 100
  }'
```

## 3) Test endpoint Anthropic compatible (untuk client yang pakai format Claude)

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GATEWAY_API_TOKEN" \
  -d '{
    "model": "glm-5",
    "max_tokens": 256,
    "messages": [
      {"role": "user", "content": "Halo, sebutkan 3 kota besar di Indonesia."}
    ]
  }'
```

## 4) Integrasi ke Claude Code (via proxy API)

Beberapa workflow Claude Code bisa diarahkan ke endpoint custom dengan environment variable.

Contoh:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=YOUR_GATEWAY_API_TOKEN
```

Catatan:
- Server ini melakukan translasi request ke DigitalOcean `chat/completions`.
- Endpoint `/v1/messages` di sini adalah adapter sederhana, bukan implementasi penuh seluruh fitur Anthropic API.

## Security

- Jangan commit API key ke git.
- Karena API key sempat dibagikan di chat, sebaiknya lakukan rotate key di DigitalOcean sebelum dipakai di production.

## Dokumentasi Indonesia

- Setup cepat Claude Code: `SETUP-CLAUDE-CODE-ID.md`
- Panduan local + deploy: `CLAUDE-CODE-LOCAL-DEPLOY-ID.md`
- Panduan lengkap dari nol: `CLAUDE-CODE-DARI-NOL-SAMPAI-PROMPT-ID.md`
- Deploy ke Vercel: `DEPLOY-VERCEL-ID.md`
