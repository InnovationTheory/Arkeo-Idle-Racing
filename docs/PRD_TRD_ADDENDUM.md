# Arkeo Racing PRD/TRD Addendum (MVP Defaults + Missing Specs)

This addendum supplements the PRD/TRD provided in the project brief. It captures the MVP defaults you approved and closes the remaining spec gaps needed to build a consistent MVP.

## 1) MVP Defaults (Authoritative)

### 1.1 Payouts and budgets
- Ticket cost: `ENTRY_FEE` for both single and pick-3.
- intake = sum of all ticket costs.
- payout_budget = floor(intake * 0.90).
- placement_budget = floor(payout_budget * 0.60).
- jackpot_budget = payout_budget - placement_budget.
- House sink = intake - payout_budget (>= 10%).

### 1.2 Single ticket payouts (from placement_budget)
- 1st place: 50% of placement_budget.
- 2nd place: 30% of placement_budget.
- 3rd place: 20% of placement_budget.
- If multiple winners for a placement, split the placement share evenly.
- Non-podium single tickets pay 0 in MVP.

### 1.3 Pick-3 jackpot payouts (from jackpot_budget)
- Jackpot win: pick-3 ticket with all 3 picks finishing top-3 (unordered).
- If at least one jackpot winner exists:
  - Split jackpot_budget evenly among jackpot winners.
- If zero jackpot winners:
  - jackpot_budget pays 0; it becomes additional house sink (no rollover in MVP).

### 1.4 Hard cap rule
- If computed total payouts exceed payout_budget, scale all payouts down proportionally to fit payout_budget.

### 1.5 Identity and session
- MVP identity is guest handles + a server session cookie.
- Cookie name: `racing_session`.
- Cookie is HTTP-only, same-site lax.
- No wallet identity or authentication in MVP.

### 1.6 Handicap model
- History window N = 10 races.
- Form score: (win_count * 3) + (podium_count * 1) - (dnf_count * 2).
- Handicap thresholds:
  - Heavy: form >= 12
  - Medium: form 6-11
  - Light: form <= 5
- If horse has < 3 races, default to Light.
- Handicap effects (performance only):
  - Light: ramp_multiplier = 0.90, error_tolerance_mult = 1.10
  - Medium: ramp_multiplier = 1.00, error_tolerance_mult = 1.00
  - Heavy: ramp_multiplier = 1.15, error_tolerance_mult = 0.90

### 1.7 Failure/void policy
- Default: no refunds.
- Void only if:
  - Race fails to start (backend crash before start_at), OR
  - Subscriber unreachable for all horses during first K ticks (K = 10), OR
  - Global polling disabled due to safety trip (systemic 5xx).
- If voided:
  - status = voided
  - refund 100% of ticket cost to players
  - do not update horse history

## 2) Identity, Sessions, and Abuse Controls

### 2.1 Session creation
- On first ticket purchase, create user row with handle + session token.
- Set `racing_session` cookie on response.
- All subsequent purchases and picks must present a valid session cookie.

### 2.2 Handle rules
- Handle must be unique.
- Minimum length 3, maximum length 20.
- Allowed: letters, numbers, dash, underscore.

### 2.3 Rate limiting (MVP)
- Ticket purchase rate limit: max 10 per minute per session.
- Pick submission rate limit: max 10 per minute per session.
- Global IP limit: max 60 requests per minute per IP.
- On limit hit: return HTTP 429 with error `rate_limited`.

### 2.4 Idempotency
- Ticket purchase endpoint MUST accept `Idempotency-Key` header.
- Server stores a ticket idempotency record (raceId + session + idempotencyKey).
- Replays with same key return the original ticket result.

## 3) Economic Integrity and Concurrency

### 3.1 Race-level locking
- Use a race row lock or advisory lock when:
  - Creating tickets
  - Closing picks
  - Calculating payouts
- No more than one payout calculation per race.

### 3.2 Rounding rules
- Budget values are floored to whole credits.
- When splitting budgets among winners, each share is floored.
- Any remainder stays with the house.

### 3.3 Transaction boundaries
- Ticket purchase: balance check + ticket create + balance decrement are in a single transaction.
- Payout calculation and balance updates are in a single transaction.

## 4) Subscriber Integration Contract

### 4.1 Discovery endpoint
- GET `{SUBSCRIBER_BASE_URL}/api/services`

Response:
```
{
  "services": [
    {
      "service_id": 25,
      "name": "ethereum-mainnet",
      "service_type": "Blockchain",
      "listener_port": 62002,
      "protocol": "jsonrpc",
      "is_active": true,
      "metadata": {}
    }
  ]
}
```

Normalization rules:
- Only include `is_active=true`.
- Only include `service_type == "Blockchain"` (case-insensitive).
- Map probe type:
  - protocol jsonrpc -> ethereum_jsonrpc
  - protocol rpc -> cosmos_rpc
  - protocol rest -> cosmos_rest
- If discovery fails, fallback list = ethereum-mainnet, osmosis-1, arkeo-mainnet.
- Cache results for `SUBSCRIBER_DISCOVERY_TTL_SECS`.

### 4.2 Probe via listener port (preferred)
- If listener_port is provided:
  - Ethereum JSON-RPC: POST `http://subscriber-host:{listener_port}/`
    - body: `{ "jsonrpc":"2.0", "id":1, "method":"eth_blockNumber", "params":[] }`
  - Cosmos RPC: GET `http://subscriber-host:{listener_port}/status`
  - Cosmos REST: GET `http://subscriber-host:{listener_port}/cosmos/base/tendermint/v1beta1/blocks/latest`

### 4.3 Probe via subscriber API (fallback)
- POST `{SUBSCRIBER_BASE_URL}/api/probe`
```
{
  "service_name": "ethereum-mainnet",
  "probe_type": "eth_blockNumber"
}
```

### 4.4 Timeouts and retries
- Timeout: `POLL_TIMEOUT_MS` (default 1500 ms).
- Retry: 2 attempts on timeout or network errors.
- Backoff: 200 ms between attempts.

### 4.5 Error semantics
- Non-2xx responses are errors.
- Any error marks the tick as failed for that horse.
- If all horses fail for the first K ticks, race is voided.

## 5) Track and Weather Numerical Configs

### 5.1 Track definitions (MVP)
- Sprint:
  - durationSecs = 90, tickMs = 1000
  - ramp = linear, start = 0.2, end = 1.0
  - thresholds: p95Ms=900, errorRate=0.20, maxStaleTicks=5, latencyConsecutiveTicks=3, errorConsecutiveTicks=3
- Endurance:
  - durationSecs = 180, tickMs = 1000
  - ramp = linear, start = 0.1, end = 1.0
  - thresholds: p95Ms=1100, errorRate=0.18, maxStaleTicks=6, latencyConsecutiveTicks=4, errorConsecutiveTicks=4
- Chaos:
  - durationSecs = 120, tickMs = 800
  - ramp = pulse, start = 0.3, end = 1.2
  - thresholds: p95Ms=800, errorRate=0.15, maxStaleTicks=4, latencyConsecutiveTicks=2, errorConsecutiveTicks=2

### 5.2 Weather definitions (MVP)
- Clear:
  - latencyMult=1.0, errorMult=1.0, jitterMult=0.8, spikes=[]
- Jitter Wave:
  - latencyMult=1.1, errorMult=1.05, jitterMult=1.4, spikes=[15,30,45]
- Error Storm:
  - latencyMult=1.2, errorMult=1.3, jitterMult=1.1, spikes=[20,40,60]

Notes:
- Spikes are expressed in seconds from race start (aligned to tick boundaries).
- Ramp affects load factor, which affects error and latency in sim/live modes.
- Spike ticks multiply weather modifiers by: latency * 1.25, error * 1.25, jitter * 1.10.

## 6) Provider Assignment

- Providers are assigned after picks close.
- If multiple providers exist for a service type:
  - Weighted random selection by reliabilityScore (weight = score^2).
- If no providers exist:
  - Create a simulated provider entry for the service type.
- Provider assignments are revealed only after picks close.

## 7) Multi-instance Orchestration

- Scheduler uses a leader lock.
- Preferred: Postgres advisory lock `pg_try_advisory_lock(hashtext('arkeo-racing-scheduler'))`.
- Only the leader schedules races and transitions race state.
- Race creation uses a transaction to prevent duplicate races in the same time window.

## 8) API Surface Additions (MVP)

- `GET /api/me` -> { userId, handle, balance }
- `GET /api/me/tickets?raceId=` -> list of tickets for the session user
- `GET /api/me/payouts?raceId=` -> list of payouts for the session user
- `GET /api/races?limit=` -> race history list

## 9) Analytics Taxonomy (PostHog)

- `race_created` { raceId, trackId, weatherId }
- `race_started` { raceId }
- `race_voided` { raceId, reason }
- `race_finished` { raceId, payoutBudget, intake }
- `ticket_purchased` { raceId, ticketId, ticketType, costCredits }
- `picks_submitted` { raceId, ticketId, pickCount }
- `provider_assigned` { raceId }

Sampling:
- 100% for race lifecycle events.
- 10% for UI click events.

## 10) Data Retention and Indexing

- RaceEvent retention: 90 days.
- Race and Payout retention: 1 year.
- Indexes:
  - race(status, startAt)
  - payout(raceId)
  - ticket(raceId)
  - raceEvent(raceId)

## 11) Timezone and Timestamp Policy

- API stores timestamps in UTC.
- UI renders timestamps in America/Denver.

## 12) Accessibility and Mobile

- Touch targets >= 44px.
- Text contrast meets WCAG AA for core UI.
- Layout must be usable at 360px width.

## 13) Observability

- Structured logs with raceId, ticketId, userId (if present).
- Errors include error code + stack trace (server only).
- Basic metrics: request count, error rate, race duration, tick latency.

## 14) Secrets and Config

- All secrets via env vars (no secrets in repo).
- Support .env files for local dev.
- Production secrets via container runtime secrets.
