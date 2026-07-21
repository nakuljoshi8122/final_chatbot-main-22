# ShopAssist POC

Multi-store seller/buyer shopping assistant with AI chat, inventory management, and store registry.

## Repository layout

```
adk/                          # Python backend (FastAPI + Google ADK)
├── api/                      # FastAPI app, schemas, route modules
├── agents/                   # Buyer and seller CRM agents
├── catalog/                  # Boutique KB + seller product catalogs
├── commerce/                 # Buyer replies, tiles, cart, seller AI
├── config/                   # LLM configuration
├── data/                     # JSON/Markdown runtime data (stores, products)
├── media/                    # Uploaded image handling
├── persistence/              # Postgres session + CRM models
├── scripts/                  # Seed and image maintenance scripts
├── stores/                   # Store registry and request scope
├── tools/                    # ADK tool functions
├── voice/                    # STT/TTS helpers
├── static/                   # Product images served at /product-images
├── main.py                   # Compatibility entry: uvicorn main:app
└── requirements.txt

botbotbot/                      # Expo React Native mobile app
├── app/                      # Expo Router routes (thin wrappers)
├── src/
│   ├── features/             # Role picker, buyer, seller, inventory, legacy tabs
│   ├── shared/               # UI, theme, hooks, utilities
│   ├── services/             # API clients
│   └── contexts/             # App-wide React context
└── assets/                   # Fonts and images
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- Docker (Postgres via `docker-compose.yml`)
- OpenAI API key (or Google Gemini if `LLM_PROVIDER=gemini`)

## Quick start

### 1. Database

```bash
# From repo root — use 5433 if port 5432 is already taken
POSTGRES_PORT=5433 docker compose up -d
```

### 2. Backend

```bash
cd adk
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: OPENAI_API_KEY, DATABASE_URL (match Postgres port)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Verify:

```bash
curl http://127.0.0.1:8000/health
```

### 3. Mobile app

```bash
cd botbotbot
npm install
# Set EXPO_PUBLIC_API_URL in .env to your machine IP:8000
npx expo start -c
```

## Environment variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | `adk/.env` | Chat + voice |
| `DATABASE_URL` | `adk/.env` | Postgres sessions |
| `EXPO_PUBLIC_API_URL` | `botbotbot/.env` | Backend URL for mobile |

## Smoke test checklist

- [ ] `/health` returns `healthy`
- [ ] Role picker → Seller → create/open store → chat
- [ ] Role picker → Buyer → category → shop → chat
- [ ] Product tiles open `/product/[id]`
- [ ] Legacy tabs still reachable at `/(tabs)/chat`
