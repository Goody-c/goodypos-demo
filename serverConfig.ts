export const createServerConfig = ({
  dataRootDir,
  isDesktopRuntime,
  nodeEnv,
  resolveJwtSecret,
}: {
  dataRootDir: string;
  isDesktopRuntime: boolean;
  nodeEnv: string;
  resolveJwtSecret: (options: { isDesktopRuntime: boolean; dataRootDir: string; nodeEnv: string }) => string | undefined;
}) => {
  const JWT_SECRET = resolveJwtSecret({
    isDesktopRuntime,
    dataRootDir,
    nodeEnv,
  });

  if (!JWT_SECRET) {
    throw new Error('Missing required environment variable: JWT_SECRET');
  }

  return {
    PORT: parseInt(process.env.PORT || '3000', 10),
    HOST: process.env.HOST || '0.0.0.0',
    APP_VERSION: process.env.npm_package_version || '1.6.0',
    JWT_SECRET,
    JWT_EXPIRY: '24h',
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000,
  };
};
