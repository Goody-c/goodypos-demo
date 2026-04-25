import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from './env.js';
import { verifyDashboardAccessToken } from './security.js';

export type ApiRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

export type ApiResponse = ServerResponse;

export const applyCors = (res: ApiResponse) => {
  res.setHeader('Access-Control-Allow-Origin', env.allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, X-Dashboard-Access-Token');
};

export const sendJson = (res: ApiResponse, statusCode: number, payload: unknown) => {
  applyCors(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const ensureMethod = (req: ApiRequest, res: ApiResponse, allowedMethods: string[]) => {
  if (req.method === 'OPTIONS') {
    applyCors(res);
    res.statusCode = 204;
    res.end();
    return false;
  }

  if (!allowedMethods.includes(req.method || '')) {
    sendJson(res, 405, {
      ok: false,
      error: `Method ${req.method || 'UNKNOWN'} not allowed`,
      allowedMethods,
    });
    return false;
  }

  return true;
};

export const readJsonBody = async <T = Record<string, unknown>>(req: ApiRequest): Promise<T> => {
  if (typeof req.body === 'object' && req.body !== null) {
    return req.body as T;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body) as T;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return {} as T;
  }

  return JSON.parse(rawBody) as T;
};

export const getQueryParams = (req: ApiRequest) => {
  const url = new URL(req.url || '/', 'http://localhost');
  return url.searchParams;
};

export const requireAdmin = (req: ApiRequest, res: ApiResponse) => {
  const dashboardAccessToken = String(req.headers['x-dashboard-access-token'] || '').trim();
  if (!dashboardAccessToken || !verifyDashboardAccessToken(dashboardAccessToken)) {
    sendJson(res, 401, {
      ok: false,
      error: 'Dashboard password required',
    });
    return false;
  }

  const provided = String(req.headers['x-admin-key'] || '').trim();
  if (!provided || provided !== env.adminApiKey) {
    sendJson(res, 401, {
      ok: false,
      error: 'Invalid admin API key',
    });
    return false;
  }

  return true;
};
