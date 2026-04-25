## Railway deployment for PostgreSQL-only GoodyPOS

### Required environment variables
Set these in Railway before the first deploy:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
JWT_SECRET=replace-with-a-long-random-secret
INITIAL_ADMIN_PASSWORD=replace-with-a-strong-admin-password
GOODY_POS_DB_PROVIDER=postgres
GOODY_POS_POSTGRES_URL=<your Railway / Neon / Supabase PostgreSQL URL>
DATABASE_URL=<same PostgreSQL URL>
GOODY_POS_POSTGRES_SSL=true
GOODY_POS_ENABLE_PG_READS=true
GOODY_POS_ENABLE_PG_MIRROR_WRITES=false
```

### Build and start
- **Build command:** `npm run build && npm run build:server`
- **Start command:** `npm start`
- **Healthcheck path:** `/api/health`

### Deploy steps
1. Create a new Railway service from this repo.
2. Add the environment variables above.
3. Confirm the generated PostgreSQL URL is reachable.
4. Deploy.
5. After the first successful boot, run:

```bash
npm run db:postgres:bootstrap
```

### Verification
After deployment, check:

```bash
curl https://<your-domain>/api/health
```

Then run the local verification suite when needed:

```bash
npm run lint && npm run build && npm run smoke
E2E_BASE_URL=http://127.0.0.1:3100 npx playwright test --reporter=line
```

> Leave the compatibility shim in place for now and remove remaining historical legacy code only after production has stayed stable.
