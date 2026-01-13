# Arkeo Racing (Play Token)

Arkeo Racing is a real-time multiplayer browser game that visualizes Arkeo infrastructure performance as a racing simulation. This repo is an MVP bootstrap with a Node.js + TypeScript API, a React + Vite web UI, and Postgres persistence.

Important rules:
- Play token only (no real money, no withdrawals)
- House must never lose: total payouts per race <= 90% of total intake

## Repo layout
```
apps/
  api/         Express + ws + Prisma race orchestrator
  web/         Vite + React + Tailwind UI
infra/
  docker-compose.yml
  .env
  env.example
  config/postgres-data/  (persistent Postgres data)
  config/subscriber-data/ (subscriber snapshot data)
docs/
  PRD_TRD_ADDENDUM.md
```

## Run
From repo root:
```
cd infra
# Edit .env (copy from env.example if needed)
mkdir -p config/postgres-data
mkdir -p config/subscriber-data
docker compose up --build
```

Stop:
```
cd infra
docker compose down
```

Reset data (destructive):
```
cd infra
docker compose down
rm -rf config/postgres-data/*
```

- API: http://localhost:8081
- Web: http://localhost:8081
- WS: ws://localhost:8081/ws?raceId=<raceId>

## API (MVP)
- `GET /api/health`
- `GET /api/me`
- `GET /api/me/wallet`
- `POST /api/me/wallet`
- `POST /api/me/wallet/disconnect`
- `POST /api/me/nickname`
- `GET /api/me/wallet/balance`
- `GET /api/bank`
- `GET /api/me/tickets?raceId=`
- `GET /api/me/payouts?raceId=`
- `GET /api/races/current`
- `GET /api/races?limit=`
- `GET /api/races/:raceId`
- `GET /api/races/:raceId/providers`
- `GET /api/races/:raceId/results`
- `POST /api/races/:raceId/tickets`
- `POST /api/races/:raceId/picks`
- `POST /api/admin/races/create-now`
- `POST /api/admin/races/start-now`
- `POST /api/admin/races/end-now`
- `GET /api/subscriber/services`

## Web UI (MVP)
- Lobby: picks and ticket purchase
- Race: live SVG track + WS updates
- Results: placements + payouts

## Notes
- Live mode is the default (`RACING_MODE=live`) and uses subscriber discovery + allowlisted probes.
- Subscriber probe endpoint default: `SUBSCRIBER_PROBE_PATH=/api/probe`.
- Subscriber snapshots are refreshed per race and written to `SUBSCRIBER_SNAPSHOT_DIR` (default `/app/data/subscriber`), including `listeners.json`.
- Postgres data persists under `infra/config/postgres-data`.
- Keplr wallet linking stores the address + nickname and reads the ARKEO balance from LCD.
- Ticket entry requires an on-chain payment to the bank address; paste the tx hash in the UI.
- Stake amounts are configured with `ENTRY_FEE_UARKEO` and `PICK3_FEE_UARKEO` in `infra/.env`.
- Keplr stake sends use `VITE_ARKEO_GAS_PRICE` and `VITE_ARKEO_GAS_LIMIT` from `infra/.env`.
- Hot wallet files are stored inside the container; the mnemonic is written to `infra/.env` on first creation when `ARKEOD_MNEMONIC` is empty.
- Source builds are enabled by default (`ARKEOD_BUILD_FROM_SOURCE=1`) to support arm64; `ARKEOD_SOURCE_REF=master` by default (pin to a tag for reproducibility).

## MVP payout defaults
- Ticket cost: `ENTRY_FEE` for both single and pick-3.
- `payout_budget = floor(intake * 0.90)`.
- `placement_budget = payout_budget * 0.60`, `jackpot_budget = payout_budget * 0.40`.
- Single payouts split by placement budget: 1st 50%, 2nd 30%, 3rd 20%.
- Pick-3 jackpot splits `jackpot_budget` equally among winners; if no winners, jackpot pays out 0.
