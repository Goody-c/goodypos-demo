import { createCoreReadRepository } from './serverReadRepository';
import { createCoreWriteRepository } from './serverWriteRepository';
import { createSecurityHelpers } from './serverSecurity';
import { createBusinessHelpers } from './serverBusinessHelpers';
import { createMaintenanceHelpers } from './serverMaintenanceHelpers';
import { createInventoryHelpers } from './serverInventoryHelpers';
import { createBackupLifecycle } from './serverLifecycle';

export const createServerComposition = ({
  postgresPool,
  dailyBackupDir,
  safetySnapshotDir,
  makeSafeTimestamp,
  jwtSecret,
  maxLoginAttempts,
  lockoutDurationMs,
  uploadsRootDir,
}: {
  postgresPool: any;
  dailyBackupDir: string;
  safetySnapshotDir: string;
  makeSafeTimestamp: (date?: Date) => string;
  jwtSecret: string;
  maxLoginAttempts: number;
  lockoutDurationMs: number;
  uploadsRootDir: string;
}) => {
  const coreReadRepository = createCoreReadRepository({
    postgresPool,
  });

  const coreWriteRepository = createCoreWriteRepository({
    postgresPool,
  });

  const backupLifecycle = createBackupLifecycle({
    dailyBackupDir,
    safetySnapshotDir,
    makeSafeTimestamp,
  });

  const securityHelpers = createSecurityHelpers({
    postgresPool,
    jwtSecret,
    maxLoginAttempts,
    lockoutDurationMs,
  });

  const businessHelpers = createBusinessHelpers({
    postgresPool,
  });

  const maintenanceHelpers = createMaintenanceHelpers({
    postgresPool,
    uploadsRootDir,
  });

  const inventoryHelpers = createInventoryHelpers({
    postgresPool,
  });

  return {
    coreReadRepository,
    coreWriteRepository,
    ...backupLifecycle,
    ...securityHelpers,
    ...businessHelpers,
    ...maintenanceHelpers,
    ...inventoryHelpers,
  };
};
