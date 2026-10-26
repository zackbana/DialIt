# DialIt

A Next.js + TypeScript foundation with an Express custom Node.js server, Socket.IO, and Prisma backed by SQLite. The landing page contains a small persistent realtime message demo for checking the architecture. Product features have not yet been specified.

## Local development

Use Node.js 24 (see `.nvmrc`) and npm.

```sh
npm ci
npm run setup
npm run dev
```

`setup` copies `.env.example` to `.env` only when absent, generates Prisma Client, and applies committed migrations. Open port 3000 in your local development environment. The Next.js UI, Express endpoints, and Socket.IO share one HTTP server and port. The development command watches server files; Next.js handles UI hot reload.

## Checks and production

```sh
npm run lint
npm run typecheck
npm run build
npm start
# In another terminal, with the server running:
npm run test:smoke
```

The smoke check exercises the rendered page, database health, WebSocket-only connections, invalid-input rejection, a broadcast between two clients, and persisted history. It removes its own test record. Set `SMOKE_URL` to test another local port. Stop `npm run dev` before starting production on the same port.

`npm start` runs the compiled custom server; do not use `next start`. Build with development dependencies installed. Use a long-running Node.js host with WebSocket upgrades and a persistent writable disk, rather than a serverless Next.js deployment. A reverse proxy must forward `/socket.io/` HTTP polling and WebSocket upgrades. This single-instance SQLite scaffold has no authentication or rate limiting; add those before public use. Multi-instance deployment needs a shared database and Socket.IO adapter/session routing strategy.

## Configuration and persistence

- `DATABASE_URL`: defaults in `.env.example` to `file:./prisma/dev.db`, resolved relative to the project root. Data is stored in `prisma/dev.db` and ignored by Git. Back up that file with the process stopped, or use SQLite's backup facilities.
- `HOST`: default `0.0.0.0`.
- `PORT`: default `3000`.

Prisma 7 uses the better-sqlite3 driver adapter and `prisma.config.ts` for the CLI datasource. No external service credentials are needed. Do not commit `.env` or database files.

For schema changes, edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>`, and commit both the schema and migration. Existing databases use `npm run db:migrate` without resets. Re-run `npm run db:generate` after schema changes.

## Structure

- `server.ts`: Express HTTP endpoints, Socket.IO, Next.js integration, shutdown handling.
- `src/app/`: App Router layout, UI, and styles.
- `src/lib/prisma.ts`: shared Prisma client.
- `prisma/`: schema and versioned migrations.
- `scripts/`: non-destructive local setup and integration smoke check.

`GET /api/health` verifies database connectivity; `GET /api/messages` returns the latest 50 demo messages. Socket.IO `message:create` takes a string of 1–500 trimmed characters and an acknowledgement callback. Successful writes broadcast `message:created` to connected clients. History is fetched again on reconnect.

## Cloud environment setup

Dependency downloads require the npm registry and `binaries.prisma.sh` for verified Prisma CLI engine downloads. If setup reports a 403 for that host, allow it in environment network settings and rerun `npm run setup`. Keep TLS and checksum verification enabled. Use the existing isolated checkout; no additional Git worktree is needed.
