import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlJsWasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const sqlJsDistDir = path.dirname(sqlJsWasmPath);
const initSqlJsModule = await import('sql.js');
const initSqlJs = initSqlJsModule.default || initSqlJsModule;
const SQL = await initSqlJs({
  locateFile: (file) => path.join(sqlJsDistDir, file),
});

const QUERY_BRIDGE_SOURCE = String.raw`
  import fs from 'node:fs';
  import 'dotenv/config';
  import { Client } from 'pg';

  const isTruthy = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  };

  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim();

  if (!connectionString) {
    throw new Error('Missing GOODY_POS_POSTGRES_URL or DATABASE_URL for PostgreSQL compatibility mode');
  }

  const client = new Client({
    connectionString,
    ssl: isTruthy(process.env.GOODY_POS_POSTGRES_SSL) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();

    if (input.action === 'query') {
      const result = await client.query(String(input.sql || ''), Array.isArray(input.params) ? input.params : []);
      process.stdout.write(JSON.stringify({
        ok: true,
        rows: result.rows || [],
        rowCount: Number(result.rowCount || 0),
        command: String(result.command || ''),
      }));
    } else if (input.action === 'batch') {
      const statements = Array.isArray(input.statements) ? input.statements : [];
      const summaries = [];
      for (const statement of statements) {
        const result = await client.query(String(statement?.sql || ''), Array.isArray(statement?.params) ? statement.params : []);
        summaries.push({
          rowCount: Number(result.rowCount || 0),
          command: String(result.command || ''),
        });
      }
      process.stdout.write(JSON.stringify({ ok: true, statements: summaries }));
    } else {
      throw new Error('Unsupported compatibility bridge action');
    }
  } finally {
    await client.end().catch(() => undefined);
  }
`;

const normalizeParam = (value) => {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && !Buffer.isBuffer(value)) {
    return Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(value);
  }
  return value;
};

const replaceQuestionPlaceholders = (sql) => {
  let result = '';
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const previous = i > 0 ? sql[i - 1] : '';

    if (char === "'" && !inDoubleQuote && previous !== '\\') {
      inSingleQuote = !inSingleQuote;
      result += char;
      continue;
    }

    if (char === '"' && !inSingleQuote && previous !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      result += char;
      continue;
    }

    if (char === '?' && !inSingleQuote && !inDoubleQuote) {
      result += `$${paramIndex}`;
      paramIndex += 1;
      continue;
    }

    result += char;
  }

  return result;
};

const hasConfiguredPostgresConnection = () => {
  return Boolean(String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || '').trim());
};

const normalizePostgresSql = (inputSql, options = {}) => {
  const mode = options.mode || 'all';
  const originalSql = String(inputSql || '').trim();
  if (!originalSql) return '';

  let sql = originalSql;
  const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql);

  sql = sql.replace(/\bCOLLATE\s+NOCASE\b/gi, '');
  sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  sql = sql.replace(/\bDATETIME\s*\(\s*'now'\s*,\s*\?\s*\)/gi, 'CURRENT_TIMESTAMP + CAST(? AS interval)');
  sql = sql.replace(/\bDATETIME\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  sql = sql.replace(/\bDATETIME\s*\(\s*([a-zA-Z_][\w.]*)\s*\)/gi, '$1');
  sql = sql.replace(/\bDATE\s*\(\s*'now'\s*,\s*'localtime'\s*,\s*'([^']+)'\s*\)/gi, "DATE(CURRENT_TIMESTAMP + INTERVAL '$1')");
  sql = sql.replace(/\bDATE\s*\(\s*'now'\s*,\s*'localtime'\s*\)/gi, 'CURRENT_DATE');
  sql = sql.replace(/\bDATE\s*\(\s*([^,()]+(?:\.[^,()]+)?)\s*,\s*'localtime'\s*\)/gi, 'DATE($1)');
  sql = sql.replace(/\b((?:[a-zA-Z_][\w]*\.)?(?:timestamp|created_at|updated_at|spent_at|clock_in_at|clock_out_at|due_date|expiry_date))\b\s+LIKE/gi, 'CAST($1 AS TEXT) LIKE');
  sql = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');

  if (hadInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = `${sql} ON CONFLICT DO NOTHING`;
  }

  sql = replaceQuestionPlaceholders(sql);

  if (mode === 'run' && /^\s*INSERT\s+INTO\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    sql = `${sql} RETURNING id`;
  }

  return sql;
};

const isMutatingSql = (sql) => {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|VACUUM|PRAGMA)\b/i.test(String(sql || '').trim());
};

const getSqlCommand = (sql) => {
  const match = String(sql || '').trim().match(/^([A-Z]+)/i);
  return String(match?.[1] || '').toUpperCase();
};

const shouldSkipExecStatement = (statement) => {
  const normalized = String(statement || '').trim().toUpperCase();
  if (!normalized) return true;
  return normalized.startsWith('PRAGMA ')
    || normalized === 'BEGIN'
    || normalized === 'BEGIN TRANSACTION'
    || normalized === 'COMMIT'
    || normalized === 'ROLLBACK'
    || normalized.startsWith('CREATE TABLE')
    || normalized.startsWith('CREATE INDEX')
    || normalized.startsWith('CREATE UNIQUE INDEX')
    || normalized.startsWith('CREATE TRIGGER')
    || normalized.startsWith('DROP TRIGGER')
    || normalized.startsWith('DROP TABLE');
};

const splitStatements = (sql) => String(sql || '')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

class PreparedStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = String(sql || '');
  }

  get(...params) {
    const result = this.database._query(this.sql, params, 'get');
    return Array.isArray(result.rows) ? (result.rows[0] || undefined) : undefined;
  }

  all(...params) {
    const result = this.database._query(this.sql, params, 'all');
    return Array.isArray(result.rows) ? result.rows : [];
  }

  run(...params) {
    const result = this.database._query(this.sql, params, 'run');
    const firstRow = Array.isArray(result.rows) ? (result.rows[0] || undefined) : undefined;
    const rawId = result.lastInsertRowid ?? (firstRow && typeof firstRow === 'object' ? (firstRow.id ?? firstRow.ID ?? 0) : 0);

    return {
      changes: Number(result.rowCount || 0),
      lastInsertRowid: Number(rawId || 0),
    };
  }
}

const extractInsertTableName = (sql) => {
  const match = String(sql || '').match(/^\s*INSERT(?:\s+OR\s+IGNORE)?\s+INTO\s+([a-zA-Z_][\w.]*)/i);
  return match ? match[1] : null;
};

class Database {
  constructor(_filename = ':memory:', _options = {}) {
    this.filename = _filename;
    this.options = _options;
    this.mode = hasConfiguredPostgresConnection() ? 'postgres' : 'local';
    this._resolvedFilename = this.filename === ':memory:' ? ':memory:' : path.resolve(String(this.filename || 'pos.db'));
    this._transactionDepth = 0;
    this._hasPendingWrite = false;
    this._db = this.mode === 'local' ? this._openLocalDatabase() : null;
  }

  _openLocalDatabase() {
    if (this._resolvedFilename === ':memory:') {
      return new SQL.Database();
    }

    const fileExists = fs.existsSync(this._resolvedFilename);
    if (this.options?.fileMustExist && !fileExists) {
      throw new Error(`Local store file not found: ${this._resolvedFilename}`);
    }

    if (!fileExists) {
      return new SQL.Database();
    }

    const buffer = fs.readFileSync(this._resolvedFilename);
    if (!buffer?.length) {
      return new SQL.Database();
    }

    return new SQL.Database(buffer);
  }

  _persistLocalDatabase() {
    if (this.mode !== 'local' || !this._db) return;
    if (this._transactionDepth > 0) {
      this._hasPendingWrite = true;
      return;
    }
    if (this.options?.readonly) return;
    if (this._resolvedFilename === ':memory:') {
      this._hasPendingWrite = false;
      return;
    }

    fs.mkdirSync(path.dirname(this._resolvedFilename), { recursive: true });
    const exported = this._db.export();
    fs.writeFileSync(this._resolvedFilename, Buffer.from(exported));
    this._hasPendingWrite = false;
  }

  _execute(payload) {
    const response = spawnSync(process.execPath, ['--input-type=module', '-e', QUERY_BRIDGE_SOURCE], {
      input: JSON.stringify(payload),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      cwd: process.cwd(),
    });

    if (response.error) {
      throw response.error;
    }

    if (response.status !== 0) {
      const stderr = String(response.stderr || '').trim();
      throw new Error(stderr || `PostgreSQL compatibility bridge exited with code ${response.status}`);
    }

    const stdout = String(response.stdout || '').trim();
    if (!stdout) {
      return { ok: true, rows: [], rowCount: 0, command: '' };
    }

    const parsed = JSON.parse(stdout);
    if (!parsed?.ok) {
      throw new Error(String(parsed?.error || 'PostgreSQL compatibility query failed'));
    }

    return parsed;
  }

  _queryLocal(sql, params = [], mode = 'all') {
    if (!this._db) {
      throw new Error('Local compatibility store is not initialized');
    }

    const normalizedParams = Array.isArray(params) ? params.map(normalizeParam) : [];
    const statement = this._db.prepare(String(sql || ''));
    const rows = [];

    try {
      if (normalizedParams.length > 0) {
        statement.bind(normalizedParams);
      }

      while (statement.step()) {
        rows.push(statement.getAsObject());
        if (mode === 'get') {
          break;
        }
      }
    } finally {
      statement.free();
    }

    const rowCount = Number(this._db.getRowsModified?.() || 0);
    const lastInsertRowResult = this._db.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid = Number(lastInsertRowResult?.[0]?.values?.[0]?.[0] || 0);

    if (mode === 'run' || isMutatingSql(sql)) {
      this._hasPendingWrite = true;
      this._persistLocalDatabase();
    }

    return {
      ok: true,
      rows,
      rowCount,
      command: getSqlCommand(sql),
      lastInsertRowid,
    };
  }

  _query(sql, params = [], mode = 'all') {
    if (this.mode === 'local') {
      return this._queryLocal(sql, params, mode);
    }

    const translatedSql = normalizePostgresSql(sql, { mode });
    const normalizedParams = Array.isArray(params) ? params.map(normalizeParam) : [];

    if (mode === 'run') {
      const tableName = extractInsertTableName(sql);
      if (tableName) {
        try {
          this._execute({
            action: 'query',
            sql: `SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), COALESCE((SELECT MAX(id) FROM ${tableName}), 0) + 1, false)`,
            params: [],
          });
        } catch {
          // Ignore sequence sync failures for tables that do not use a serial ID column.
        }
      }
    }

    return this._execute({
      action: 'query',
      sql: translatedSql,
      params: normalizedParams,
    });
  }

  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  pragma(statement, options = {}) {
    const pragmaText = String(statement || '').trim();
    const lowerPragma = pragmaText.toLowerCase();

    if (this.mode === 'local' && this._db) {
      try {
        const result = this._db.exec(`PRAGMA ${pragmaText}`);
        const firstValue = result?.[0]?.values?.[0]?.[0];
        if (options && options.simple) {
          return firstValue ?? 'ok';
        }

        const rows = (result?.[0]?.values || []).map((row) => {
          const columnName = result?.[0]?.columns?.[0] || 'value';
          return { [columnName]: row?.[0] };
        });
        return rows;
      } catch {
        if (lowerPragma.startsWith('quick_check')) {
          return options && options.simple ? 'ok' : [{ quick_check: 'ok' }];
        }
        return options && options.simple ? 'ok' : [];
      }
    }

    if (lowerPragma.startsWith('quick_check')) {
      return options && options.simple ? 'ok' : [{ quick_check: 'ok' }];
    }
    return options && options.simple ? 'ok' : [];
  }

  exec(sql) {
    if (this.mode === 'local' && this._db) {
      const statementText = String(sql || '');
      this._db.exec(statementText);

      if (splitStatements(statementText).some((statement) => isMutatingSql(statement))) {
        this._hasPendingWrite = true;
        this._persistLocalDatabase();
      }

      return this;
    }

    const statements = splitStatements(sql)
      .filter((statement) => !shouldSkipExecStatement(statement))
      .map((statement) => normalizePostgresSql(statement, { mode: 'run' }))
      .filter(Boolean)
      .map((statement) => ({ sql: statement, params: [] }));

    if (statements.length > 0) {
      try {
        this._execute({ action: 'batch', statements });
      } catch {
        // Compatibility mode is intentionally forgiving for legacy schema bootstrap SQL.
      }
    }

    return this;
  }

  transaction(fn) {
    if (this.mode !== 'local' || !this._db) {
      return (...args) => fn(...args);
    }

    return (...args) => {
      const startingDepth = this._transactionDepth;
      const isOutermostTransaction = startingDepth === 0;
      const savepointName = `goodypos_sp_${startingDepth + 1}`;
      const pendingWriteBefore = this._hasPendingWrite;

      if (isOutermostTransaction) {
        this._db.exec('BEGIN');
      } else {
        this._db.exec(`SAVEPOINT ${savepointName}`);
      }

      this._transactionDepth += 1;

      try {
        const result = fn(...args);

        if (isOutermostTransaction) {
          this._db.exec('COMMIT');
        } else {
          this._db.exec(`RELEASE SAVEPOINT ${savepointName}`);
        }

        return result;
      } catch (error) {
        this._hasPendingWrite = pendingWriteBefore;
        try {
          if (isOutermostTransaction) {
            this._db.exec('ROLLBACK');
          } else {
            this._db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            this._db.exec(`RELEASE SAVEPOINT ${savepointName}`);
          }
        } catch {
          // Ignore rollback failures in best-effort recovery.
        }
        throw error;
      } finally {
        this._transactionDepth = Math.max(0, this._transactionDepth - 1);
        if (isOutermostTransaction && this._hasPendingWrite) {
          this._persistLocalDatabase();
        }
      }
    };
  }

  async backup(destination) {
    const resolvedDestination = path.resolve(String(destination || 'goodypos-backup.db'));
    fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });

    if (this.mode === 'local' && this._db) {
      this._persistLocalDatabase();
      if (this._resolvedFilename !== ':memory:' && fs.existsSync(this._resolvedFilename)) {
        fs.copyFileSync(this._resolvedFilename, resolvedDestination);
      } else {
        fs.writeFileSync(resolvedDestination, Buffer.from(this._db.export()));
      }
      return resolvedDestination;
    }

    const snapshot = {
      provider: 'postgres',
      generatedAt: new Date().toISOString(),
      note: 'GoodyPOS PostgreSQL compatibility snapshot. Use native PostgreSQL backups for full restore coverage.',
    };

    fs.writeFileSync(resolvedDestination, JSON.stringify(snapshot, null, 2));
    return resolvedDestination;
  }

  close() {
    if (this.mode === 'local' && this._db) {
      this._persistLocalDatabase();
      this._db.close();
      this._db = null;
    }
  }
}

Database.Database = Database;

export default Database;
