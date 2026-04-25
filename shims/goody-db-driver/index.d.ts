declare namespace Database {
  export interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
  }

  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): RunResult;
  }

  export interface Database {
    prepare(sql: string): Statement;
    pragma(name: string, options?: { simple?: boolean }): any;
    exec(sql: string): this;
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    backup(destination: string): Promise<string>;
    close(): void;
  }
}

declare class Database implements Database.Database {
  constructor(filename?: string, options?: Database.DatabaseOptions);
  prepare(sql: string): Database.Statement;
  pragma(name: string, options?: { simple?: boolean }): any;
  exec(sql: string): this;
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  backup(destination: string): Promise<string>;
  close(): void;
}

export default Database;
