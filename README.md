# DialIt

A Next.js + TypeScript foundation with an Express custom Node.js server, Socket.IO, and SQLite via better-sqlite3. The landing page contains a small persistent realtime message demo for checking the architecture. Product features have not yet been specified.

## Local development

Use Node.js 24 (see `.nvmrc`) and npm.

```sh
npm ci
npm run setup
npm run dev
```

`setup` copies `.env.example` to `.env` only when absent, applies committed SQL migrations. Open port 3000 in your local development environment. The Next.js UI, Express endpoints, and Socket.IO share one HTTP server and port. The development command watches server files; Next.js handles UI hot reload.

## Checks and production

```sh
npm test
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

- `DATABASE_URL`: defaults in `.env.example` to `file:./data/dev.db`, resolved relative to the project root. Data is stored in `data/dev.db` and ignored by Git. Back up that file with the process stopped, or use SQLite's backup facilities.
- `HOST`: default `0.0.0.0`.
- `PORT`: default `3000`.

Direct better-sqlite3 access uses prepared statements, WAL mode, and transactional SQL migrations. No Prisma client generation or engine downloads are needed. No external service credentials are needed. Do not commit `.env` or database files.

For schema changes, add a new numbered SQL file in `db/migrations/` and run `npm run db:migrate`. Migrations run in filename order within a transaction and record checksums; never edit applied files. Repeated setup preserves existing data. The server also applies pending migrations on startup.

## Structure

- `server.ts`: Express HTTP endpoints, Socket.IO, Next.js integration, shutdown handling.
- `src/app/`: App Router layout, UI, and styles.
- `src/lib/database.ts`: SQLite connection, migration runner, and message queries.
- `db/migrations/`: versioned SQL migrations.
- `scripts/`: non-destructive local setup and integration smoke check.

`GET /api/health` verifies database connectivity; `GET /api/messages` returns the latest 50 demo messages. Socket.IO `message:create` takes a string of 1–500 trimmed characters and an acknowledgement callback. Successful writes broadcast `message:created` to connected clients. History is fetched again on reconnect.

## Cloud environment setup

Dependency downloads use the npm registry. better-sqlite3 builds its native addon using a C++ compiler, make, Python 3, and Node.js headers (downloaded by node-gyp when missing). In this cloud environment, set `npm_config_cache=/workspace/.npm-cache` and `XDG_CACHE_HOME=/workspace/.cache` before `npm ci` so npm and node-gyp use writable caches. Keep TLS and package integrity verification enabled. Use the existing isolated checkout; no additional Git worktree is needed.
