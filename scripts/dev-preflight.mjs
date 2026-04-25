import net from 'node:net';
import process from 'node:process';
import path from 'node:path';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const port = Math.max(1, Number(process.env.PORT || 3000) || 3000);
const postgresUrl = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim();
const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const checkPort = async (targetPort) => {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(targetPort, '0.0.0.0');
  });
};

const checkPostgresConnection = async (connectionString) => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } finally {
    await client.end().catch(() => {});
  }
};

const run = async () => {
  const warnings = [];

  const isPortFree = await checkPort(port);
  if (!isPortFree) {
    console.error(`Preflight failed: PORT ${port} is already in use.`);
    process.exit(1);
  }

  if (!postgresUrl) {
    console.error('Preflight failed: missing GOODY_POS_POSTGRES_URL or DATABASE_URL.');
    process.exit(1);
  }

  try {
    await checkPostgresConnection(postgresUrl);
  } catch (error) {
    console.error(`Preflight failed: PostgreSQL connection check failed (${error instanceof Error ? error.message : String(error)}).`);
    process.exit(1);
  }

  if (nodeEnv === 'production' && !String(process.env.JWT_SECRET || '').trim()) {
    warnings.push('JWT_SECRET is not set in production mode.');
  }

  console.log(`Preflight OK: port ${port} is available, PostgreSQL is reachable.`);
  warnings.forEach((warning) => console.warn(`Preflight warning: ${warning}`));
};

run().catch((error) => {
  console.error(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
