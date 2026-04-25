const requireEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const env = {
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  adminApiKey: requireEnv('ADMIN_API_KEY'),
  licenseSigningSecret: requireEnv('LICENSE_SIGNING_SECRET'),
  dashboardAccessPassword: process.env.DASHBOARD_ACCESS_PASSWORD?.trim() || '@Goody3660',
  defaultLicenseDurationDays: toPositiveInt(process.env.DEFAULT_LICENSE_DURATION_DAYS, 365),
  allowedOrigin: process.env.ALLOWED_ORIGIN?.trim() || '*',
} as const;
