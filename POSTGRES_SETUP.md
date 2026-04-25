## GoodyPOS PostgreSQL primary cutover / init

### 1) Recommended `.env` for the current cutover stage
Copy `.env.postgres.example` into `.env` or merge these values into your active `.env`:

```env
GOODY_POS_DB_PROVIDER=postgres
GOODY_POS_POSTGRES_URL=postgresql://postgres:YOUR_PASSWORD@your-host:5432/goodypos
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@your-host:5432/goodypos
GOODY_POS_POSTGRES_SSL=true
GOODY_POS_ENABLE_PG_READS=true
GOODY_POS_ENABLE_PG_MIRROR_WRITES=false
```

> This is now the **required verified mode** for GoodyPOS. The legacy embedded local-store runtime has been retired; the old compatibility call surface now resolves to a PostgreSQL-backed shim while reads and writes target PostgreSQL in normal operation.

---

### 2) Bootstrap and initialize PostgreSQL
Run from the repo root:

```bash
npm run db:postgres:test
npm run db:postgres:init
npm run db:postgres:sync-core
```

Or use the one-shot bootstrap command:

```bash
npm run db:postgres:bootstrap
```

---

### 3) Verification command
After any cutover change, restart the app and run:

```bash
npm run lint && npm run build && npm run smoke
```

Latest verified result in PostgreSQL-primary mode:

```text
91 passed, 0 warning(s), 0 failed
```

---

### 4) Notes
- `database/postgres/core-schema.sql` is the main GoodyPOS core schema.
- `licensing-service/supabase/schema.sql` is for the separate licensing service database.
- If `npm run db:postgres:test` says the URL is missing, your `.env` still has a blank `GOODY_POS_POSTGRES_URL` / `DATABASE_URL`.
- `serverWriteRepository.ts` now has postgres-primary paths for sales create/layaway/return/void, market collections, purchase-order receive, stock recount review, and product/customer/sales imports when `GOODY_POS_DB_PROVIDER=postgres`.
- The legacy native embedded-store dependency has been replaced by a local PostgreSQL-backed compatibility shim so the remaining historical `db.prepare(...)` call sites no longer require the old local engine at runtime.

---

### 5) Production deployment
Build and start the PostgreSQL-only production server from the repo root:

```bash
npm run db:postgres:test
npm run build
npm run build:server
npm start
```

For distributable desktop-style update packages:

```bash
npm run release:mac
npm run release:windows
# or
npm run release:all
```

For Railway/Nixpacks-style hosting, use:
- **Build command:** `npm run build && npm run build:server`
- **Start command:** `npm start`
- **Healthcheck path:** `/api/health`

> Keep the PostgreSQL compatibility shim in place for now. Remove the leftover historical compatibility layer only after production has been stable for a while.
