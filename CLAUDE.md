# Arkeo Racing

A real-time multiplayer browser game that visualizes Arkeo infrastructure provider performance as a horse racing simulation. MVP using play tokens only (no real money).

**Key constraint:** House must never lose - total payouts per race must be <= 90% of total intake.

## Project Structure

```
apps/
├── api/          # Express + WebSocket server (TypeScript, Prisma ORM)
│   ├── src/
│   │   ├── routes/      # REST API endpoints
│   │   ├── race/        # Race engine & simulation logic
│   │   ├── scheduler/   # Race orchestration & leader election
│   │   ├── subscriber/  # Arkeo provider discovery
│   │   ├── poller/      # Provider latency polling
│   │   ├── ws/          # WebSocket server
│   │   ├── rewards/     # Payout calculation
│   │   └── arkeo/       # On-chain transaction handling
│   └── prisma/          # Database schema & migrations
└── web/          # React + Vite SPA
    ├── src/
    │   ├── pages/       # Lobby, Race, Results, RaceDay
    │   ├── components/  # Reusable UI (HorseCard, TrackView, etc.)
    │   └── hooks/       # useWalletState, useRaceCountdown
infra/            # Docker Compose & config
docs/             # PRD/TRD specs
```

## Tech Stack

- **Backend:** Node.js, Express, TypeScript, Prisma, PostgreSQL, WebSocket (ws)
- **Frontend:** React 18, React Router 6, Vite, Tailwind CSS
- **Wallet:** Keplr integration via @cosmjs/*
- **Deployment:** Docker Compose (single container)

## Common Commands

### API (apps/api)
```bash
npm run dev              # Watch mode development
npm run build            # Generate Prisma + compile TS
npm run start            # Run production server
npm run prisma:generate  # Generate Prisma client
npm run prisma:deploy    # Apply migrations
npm run db:seed          # Seed database
```

### Web (apps/web)
```bash
npm run dev              # Vite dev server (port 3000)
npm run build            # Production build
npm run preview          # Preview production build
```

### Docker (infra/)
```bash
docker compose up --build    # Start all services
docker compose down          # Stop services
```

## Architecture Notes

### Race Engine
- Tick-based simulation loop (`race/engine.ts`, `race/sim.ts`)
- Horse performance based on archetype (front_runner, stalker, stretch_runner, grinder, burst, erratic), temperament, and handicap tier
- Provider polling measures latency; errors can eliminate horses
- Load factor calculations with configurable ramp configs

### Race Lifecycle
States: `scheduled` → `picking` → `running` → `finished`/`voided`

### Leader Election
Uses PostgreSQL advisory locks (`pg_advisory_xact_lock`) for scheduler singleton

### WebSocket
- Endpoint: `ws://localhost:8081/ws?raceId=<id>`
- Broadcasts real-time race state to connected clients
- Auto-reconnection with exponential backoff on client

### Payout Rules
- 1st place: 50%, 2nd: 30%, 3rd: 20% (of payout budget)
- Pick-3 jackpot for multi-race predictions
- Payouts capped at 90% of total intake

## Key API Endpoints

- `GET/POST /api/me` - User session
- `GET /api/races` - List races
- `GET /api/races/:raceId` - Race details
- `POST /api/races/:raceId/tickets` - Place bet
- `POST /api/races/:raceId/selection` - Preview selection
- `GET /api/me/wallet/balance` - Wallet balance
- `POST /api/admin/races/create-now` - Admin: create race

Rate limits: 300 GET/min, 60 POST/min per IP

## Database Schema

Key models (see `apps/api/prisma/schema.prisma`):
- `User` - Session, handle, wallet, nickname
- `Race` - Status, track, weather, intake, payout budget
- `Horse` - Display name, handicap tier, form score
- `RaceHorse` - Horse in race with archetype, provider, placement
- `Ticket` - User wager (single or pick-3)
- `Payout` - Winnings credited

Enums: `RaceStatus`, `HandicapTier`, `TicketType`, `RaceArchetype`, `Temperament`

## Configuration

Environment variables in `infra/.env` (see `infra/env.example`):
- Database: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- Race settings: `RACE_INTERVAL_SECS`, `PICK_WINDOW_SECS`, `HORSES_PER_RACE`
- Fees: `ENTRY_FEE_UARKEO`, `PICK3_FEE_UARKEO`
- Arkeo chain: `ARKEO_RPC_URL`, `ARKEO_LCD_URL`, `ARKEO_CHAIN_ID`

## Code Conventions

- TypeScript strict mode enabled
- camelCase for functions/variables, PascalCase for types/components
- Async/await throughout backend
- React functional components with hooks
- Tailwind CSS for styling
- Prisma for type-safe database access

## Ports

- API/Web: 8081 (when SERVE_WEB_STATIC=1)
- PostgreSQL: 5432
- Vite dev: 3000
