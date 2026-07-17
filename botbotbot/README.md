# ShopAssist Mobile App

Expo React Native app for the ShopAssist multi-store POC.

## Structure

- `app/` — Expo Router route files (URLs unchanged; thin re-exports)
- `src/features/` — Screen implementations by domain
  - `role-picker/` — Entry role selection
  - `seller/` — Store management, chat, inventory, queries
  - `buyer/` — Category browse and shop chat
  - `inventory/` — Product listing forms
  - `product/` — Product detail screen
  - `legacy-store/` — Preserved single-store tab flow
  - `chat-shared/` — Product tiles and voice UI
- `src/shared/` — Theme, UI primitives, hooks, utilities
- `src/services/` — API and inventory clients
- `src/contexts/` — `AppContext` (live seller/buyer flow)

## Setup

```bash
npm install
```

Create `botbotbot/.env`:

```env
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000
```

## Run

```bash
npx expo start -c
# Press w (web), i (iOS), or a (Android)
```

## Backend

Requires the FastAPI server in `../adk` on port 8000. See root [README.md](../README.md).

## Typecheck

```bash
npx tsc --noEmit
npm run lint
```
