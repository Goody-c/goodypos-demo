import type { Pool } from 'pg';
import { createSettingsWriteRepository } from './serverWriteRepository.settings';
import { createCustomersWriteRepository } from './serverWriteRepository.customers';
import { createCatalogWriteRepository } from './serverWriteRepository.catalog';
import { createStaffWriteRepository } from './serverWriteRepository.staff';
import { createExpensesWriteRepository } from './serverWriteRepository.expenses';
import { createOperationsWriteRepository } from './serverWriteRepository.operations';
import { createInventoryWriteRepository } from './serverWriteRepository.inventory';
import { createSalesWriteRepository } from './serverWriteRepository.sales';
import { createImportsWriteRepository } from './serverWriteRepository.imports';

type CoreWriteRepositoryOptions = {
  postgresPool: Pool;
};

export const createCoreWriteRepository = ({ postgresPool }: CoreWriteRepositoryOptions) => ({
  ...createSettingsWriteRepository({ postgresPool }),
  ...createCustomersWriteRepository({ postgresPool }),
  ...createCatalogWriteRepository({ postgresPool }),
  ...createStaffWriteRepository({ postgresPool }),
  ...createExpensesWriteRepository({ postgresPool }),
  ...createOperationsWriteRepository({ postgresPool }),
  ...createInventoryWriteRepository({ postgresPool }),
  ...createSalesWriteRepository({ postgresPool }),
  ...createImportsWriteRepository({ postgresPool }),
});
