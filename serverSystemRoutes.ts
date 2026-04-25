import type { Pool } from 'pg';

type SystemRouteDependencies = {
  app: any;
  postgresPool: Pool;
  APP_VERSION: string;
  authenticate: any;
  authorize: (roles: string[]) => any;
  LICENSE_API_BASE_URL?: string;
  LICENSE_REQUIRED_FOR_NEW_STORES: boolean;
  LICENSE_DEVICE_NAME: string;
  checkLicenseServiceConnection: () => Promise<{
    configured: boolean;
    connected: boolean;
    statusCode: number | null;
    error: string | null;
  }>;
};

export const registerSystemRoutes = ({
  app,
  postgresPool,
  APP_VERSION,
  authenticate,
  authorize,
  LICENSE_API_BASE_URL,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  checkLicenseServiceConnection,
}: SystemRouteDependencies) => {
  app.get('/api/health', async (_req: any, res: any) => {
    try {
      const [storesResult, usersResult] = await Promise.all([
        postgresPool.query('SELECT COUNT(*) as count FROM stores'),
        postgresPool.query('SELECT COUNT(*) as count FROM users'),
      ]);
      const storeCount = Number(storesResult.rows[0]?.count || 0);
      const userCount = Number(usersResult.rows[0]?.count || 0);
      res.json({
        ok: true,
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        stores: storeCount,
        users: userCount,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, status: 'error', error: err?.message || 'Health check failed' });
    }
  });

  app.get('/api/app/version', (_req: any, res: any) => {
    try {
      res.json({
        version: APP_VERSION,
        name: 'GoodyPOS',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Version check failed' });
    }
  });

  app.get('/api/license/status', authenticate, authorize(['SYSTEM_ADMIN']), async (_req: any, res: any) => {
    try {
      const storesResult = await postgresPool.query(`
        SELECT id, name, mode, license_key, license_status, license_plan, license_activated_at, license_last_validated_at
        FROM stores
        ORDER BY created_at DESC, id DESC
      `);
      const stores = storesResult.rows as Array<{
        id: number;
        name: string;
        mode: 'SUPERMARKET' | 'GADGET';
        license_key?: string | null;
        license_status?: string | null;
        license_plan?: string | null;
        license_activated_at?: string | null;
        license_last_validated_at?: string | null;
      }>;
      const connection = await checkLicenseServiceConnection();

      res.json({
        ok: true,
        configured: connection.configured,
        connected: connection.connected,
        serviceStatusCode: connection.statusCode,
        connectionError: connection.error,
        requiredForNewStores: LICENSE_REQUIRED_FOR_NEW_STORES,
        activationRequiresInternet: true,
        activationMode: 'ONLINE_ONLY_FIRST_ACTIVATION',
        deviceName: LICENSE_DEVICE_NAME,
        serviceUrl: LICENSE_API_BASE_URL || null,
        stores: stores.map((store) => ({
          ...store,
          license_key_masked: store.license_key
            ? `${String(store.license_key).slice(0, 7)}••••${String(store.license_key).slice(-4)}`
            : null,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'License status check failed' });
    }
  });
};
