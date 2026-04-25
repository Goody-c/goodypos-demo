import CompatStoreDriver from 'goody-db-driver';

export type ServerDatabase = CompatStoreDriver.Database;

export const CURRENT_LOCAL_STORE_EXTENSION = '.db';

export const isKnownLocalStoreFile = (fileName: string) => {
  return String(fileName || '').endsWith(CURRENT_LOCAL_STORE_EXTENSION);
};

export const openLocalDataStore = (
  filePath: string,
  options?: ConstructorParameters<typeof CompatStoreDriver>[1],
): ServerDatabase => {
  return new CompatStoreDriver(filePath, options);
};

export default CompatStoreDriver;
