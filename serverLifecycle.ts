import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createHttpServer } from 'http';
import { createServer as createNetServer } from 'net';

type BackupLifecycleDependencies = {
  dailyBackupDir: string;
  safetySnapshotDir: string;
  makeSafeTimestamp: (date?: Date) => string;
};

export const createBackupLifecycle = ({
  dailyBackupDir: _dailyBackupDir,
  safetySnapshotDir: _safetySnapshotDir,
  makeSafeTimestamp: _makeSafeTimestamp,
}: BackupLifecycleDependencies) => {
  const createSafetySnapshot = async (_reason: 'startup' | 'pre-maintenance'): Promise<string | null> => {
    // SQLite local backups are not applicable in PostgreSQL mode
    return null;
  };

  const scheduleDailyLocalBackups = () => {
    // No-op: backups are managed at the PostgreSQL infrastructure level
  };

  return {
    createSafetySnapshot,
    scheduleDailyLocalBackups,
  };
};

type StartServerRuntimeDependencies = {
  app: any;
  appBaseDir: string;
  dataRootDir: string;
  uploadsRootDir: string;
  HOST: string;
  PORT: number;
  LAN_IP: string;
  JWT_EXPIRY: string;
};

const isPortAvailable = (host: string, port: number) => new Promise<boolean>((resolve, reject) => {
  const probe = createNetServer();

  probe.once('error', (error: NodeJS.ErrnoException) => {
    probe.close();
    if (error?.code === 'EADDRINUSE') {
      resolve(false);
      return;
    }
    reject(error);
  });

  probe.once('listening', () => {
    probe.close(() => resolve(true));
  });

  probe.listen(port, host);
});

export const startServerRuntime = async ({
  app,
  appBaseDir,
  dataRootDir,
  uploadsRootDir,
  HOST,
  PORT,
  LAN_IP,
  JWT_EXPIRY,
}: StartServerRuntimeDependencies) => {
  console.log(`Starting server in ${process.env.NODE_ENV || 'development'} mode...`);

  app.use('/uploads', express.static(uploadsRootDir));
  const httpServer = createHttpServer(app);
  const isProduction = process.env.NODE_ENV === 'production';
  const resolvedPort = PORT;

  if (!isProduction) {
    const portIsAvailable = await isPortAvailable(HOST, resolvedPort);
    if (!portIsAvailable) {
      throw new Error(`Port ${resolvedPort} is already in use. Stop the process using this port, then restart Goody-POS.`);
    }
  }

  process.env.PORT = String(resolvedPort);

  try {
    if (!isProduction) {
      const { createServer: createViteServer } = await import('vite');
      const configuredHmrHost = String(process.env.VITE_HMR_HOST || '').trim();
      const resolvedHmrHost = configuredHmrHost || (HOST === '0.0.0.0' ? 'localhost' : HOST);
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          host: HOST,
          strictPort: true,
          hmr: {
            server: httpServer,
            host: resolvedHmrHost,
            clientPort: resolvedPort,
            protocol: process.env.VITE_HMR_PROTOCOL === 'wss' ? 'wss' : 'ws',
          },
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);

      app.use('*', async (req: any, res: any, next: any) => {
        const url = req.originalUrl;
        try {
          let template = fs.readFileSync(path.join(appBaseDir, 'index.html'), 'utf-8');
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } catch (e) {
          vite.ssrFixStacktrace(e as Error);
          next(e);
        }
      });

      console.log(`Vite middleware integrated (HMR: ${process.env.VITE_HMR_PROTOCOL === 'wss' ? 'wss' : 'ws'}://${resolvedHmrHost}:${resolvedPort})`);
    } else {
      const distPath = path.join(appBaseDir, 'dist');
      app.use(express.static(distPath));
      app.get('*', (_req: any, res: any) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      console.log('Serving static files from dist');
    }

    app.use((err: any, req: any, res: any, next: any) => {
      console.error('Unhandled server error:', err);

      if (res.headersSent) {
        return next(err);
      }

      if (req.originalUrl?.startsWith('/api/')) {
        return res.status(err?.status || 500).json({
          error: err?.message || 'Internal server error',
        });
      }

      res.status(err?.status || 500).send('Internal server error');
    });

    httpServer.listen(resolvedPort, HOST, () => {
      console.log(`✅ Goody-POS running at http://localhost:${resolvedPort}`);
      console.log(`📱 LAN Access: http://${LAN_IP}:${resolvedPort}`);
      console.log(`📂 Data directory: ${dataRootDir}`);
      console.log(`🔐 JWT Expiry: ${JWT_EXPIRY} | Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};
