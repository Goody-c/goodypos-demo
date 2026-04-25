import CompatStoreDriver from 'goody-db-driver';

export const CURRENT_LOCAL_STORE_EXTENSION = '.db';

export const isKnownLocalStoreFile = (fileName) => {
  return String(fileName || '').endsWith(CURRENT_LOCAL_STORE_EXTENSION);
};

export const openLocalDataStore = (filePath, options) => {
  return new CompatStoreDriver(filePath, options);
};

export default CompatStoreDriver;
