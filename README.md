# Hotel Management System

Single-property hotel management app with guest booking requests, staff room/catalog tools, reservation lifecycle actions, dashboard counts, session authentication, and MongoDB-backed inventory transactions. The current checkout includes local development setup and automated checks; production deployment and launch controls are not configured.

## Prerequisites and setup

- Node.js 22 or newer
- pnpm 10.20.0
- Docker Compose only if you want to run MongoDB locally or run replica-set integration tests

Copy `.env.example` to the workspace root as `.env`. Use a random `CSRF_SECRET` at least 32 characters long and replace the local demo guest/staff credentials. Keep `.env` untracked.

```sh
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm db:up` starts a local single-node replica set and waits up to 90 seconds for it to become writable primary. It is a development convenience, not a high-availability database. `pnpm db:seed` only accepts development/demo database names, requires explicit `DEMO_GUEST_EMAIL`, `DEMO_GUEST_PASSWORD`, `DEMO_STAFF_EMAIL`, and `DEMO_STAFF_PASSWORD`, hashes passwords with Argon2id, and never prints the passwords. Do not use demo identities as production accounts.

The backend listens on port 3002; Vite serves the frontend on port 5173 and proxies `/api` to the backend. Backend commands load the workspace-root `.env`. `pnpm db:down` stops local containers while preserving the named MongoDB volume.

For the Atlas demo setup on a Mac, start the backend and frontend separately in two Terminal windows from the workspace root. The scripts use API port 3002 to avoid a local port 3001 conflict:

```sh
pnpm dev:backend
pnpm dev:frontend
```

Keep both terminals open and visit `http://localhost:5173`. The backend connects to the database configured in the workspace-root `.env`; Docker is not needed when using Atlas. To start both applications in one terminal, use `pnpm dev`.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the backend and frontend together |
| `pnpm dev:backend` | Start only the backend |
| `pnpm dev:frontend` | Start only the frontend |
| `pnpm db:up` / `pnpm db:down` | Start and stop the local replica set |
| `pnpm db:migrate` | Apply repeatable collection validators and indexes |
| `pnpm db:seed` | Seed local demo identities, room types, and representative reservations |
| `pnpm test` | Run unit and in-process HTTP tests; replica-set tests stay gated |
| `pnpm test:integration` | Start Docker MongoDB, verify the dedicated test DB guard/index, and run replica-set tests in isolated `_test` databases |
| `pnpm lint` | Current strict TypeScript check (ESLint/style lint is not configured) |
| `pnpm typecheck` | Strict TypeScript checks for contracts, API, scripts, and web |
| `pnpm build` | Production builds for contracts, API, and web |
| `pnpm check` | Run lint, typecheck, unit tests, and builds |

GitHub Actions runs frozen-lockfile install, `pnpm check`, and `pnpm test:integration`. It does not deploy or seed production data.

## Operational status and limits

The API requires MongoDB replica-set transaction support. Local Compose uses one member; production should use a managed multi-node replica set, private network access, least-privilege credentials, backups/PITR, centralized monitoring, and a rehearsed restore. No production environment, provider, alerting, backup, restore, or deploy pipeline is configured.

Reservation lists cap page size at 100 and offset at 10,000. Availability scans at most 500 room types and is advisory. Inventory-affecting writes serialize through the shared room-type guard; transaction retries have a bounded five-second budget. No production-scale query plan, load, failover, or performance measurement has been run. The architecture plan’s RPO/RTO values are conditional planning targets, not measured commitments.

Before real guest operations, resolve physical room assignment/continuity, housekeeping and out-of-service inventory, no-show and late/early stay policies, staff MFA and account recovery, abuse controls, guest verification, price/tax/cancellation terms, privacy/retention, backups and restore, security/accessibility reviews, load/failover tests, and operator training. Payments/refunds need a separate design.

See [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), [docs/operations.md](docs/operations.md), [docs/contracts.md](docs/contracts.md), and [docs/api.md](docs/api.md) for implementation details and route contracts.

