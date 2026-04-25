# GoodyPOS Licensing Service

A custom lightweight licensing backend for `GoodyPOS` built for **Vercel + Supabase**.

## Policy this service enforces

- **Internet is required for first activation**
- **1 license = 1 device**
- **one-time activation key**
- after activation, the app can continue working offline
- Super System Owner can **create**, **revoke**, and **reset** licenses

---

## API routes

### Public app routes
- `GET /api/health`
- `POST /api/activate`
- `POST /api/validate` *(optional manual refresh / status check)*

### Super owner admin routes
- `POST /api/admin/create-license`
- `GET /api/admin/list-licenses`
- `POST /api/admin/revoke-license`
- `POST /api/admin/reset-device`

All admin routes require:

```http
x-admin-key: YOUR_ADMIN_API_KEY
```

---

## Quick setup

### 1. Create a Supabase project
Run the SQL inside:

```text
supabase/schema.sql
```

### 2. Add env vars in Vercel
Copy values from:

```text
.env.example
```

### 3. Deploy
```bash
cd licensing-service
npm install
npm run typecheck
vercel
```

### 4. Open the Super System Owner dashboard
After deployment, open the root URL in a browser:

```text
https://your-license-service.vercel.app/
```

Enter your `ADMIN_API_KEY` there to generate, revoke, and reset one-time license keys.

---

## Example: create a license

```bash
curl -X POST https://your-license-service.vercel.app/api/admin/create-license \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_API_KEY" \
  -d '{
    "issuedToName": "Demo Store",
    "plan": "STANDARD",
    "storeModeAllowed": "SUPERMARKET",
    "validityDays": 365,
    "notes": "Initial customer rollout"
  }'
```

## Example: activate from GoodyPOS

```bash
curl -X POST https://your-license-service.vercel.app/api/activate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "GDP-ABCDE-FGHIJ-KLMNO",
    "deviceFingerprint": "macos:serial-or-app-generated-id",
    "deviceName": "Front Desk iMac",
    "storeName": "Goody Ikeja",
    "storeMode": "SUPERMARKET",
    "appVersion": "1.0.0"
  }'
```

## Example: optional online status check

```bash
curl -X POST https://your-license-service.vercel.app/api/validate \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "GDP-ABCDE-FGHIJ-KLMNO",
    "deviceFingerprint": "macos:serial-or-app-generated-id",
    "appVersion": "1.0.0"
  }'
```

---

## GoodyPOS integration notes

From the main POS app, store these locally after successful activation:

- `license_key`
- `device_fingerprint`
- `activated_at`
- `last_validated_at`
- `cache_token`

Recommended behavior:
- block setup if activation fails
- after successful activation, allow normal offline use
- require internet again only for a new device, reinstall, or manual status refresh
