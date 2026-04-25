/**
 * Local SQLite database adapter that provides a pg.Pool-compatible interface.
 * Used when no PostgreSQL URL is configured (portable/offline desktop mode).
 *
 * Translates PostgreSQL-style SQL to SQLite on the fly so every server query
 * works transparently against the embedded sql.js WASM engine.
 */
import Database from 'goody-db-driver';
import { initializeDatabaseSchema } from './serverSchemaBootstrap';

// ─── SQL Translation Helpers ──────────────────────────────────────────────────

const getSqlCommand = (sql: string) => {
  const match = String(sql || '').trim().match(/^([A-Z]+)/i);
  return String(match?.[1] || '').toUpperCase();
};

const isMutating = (sql: string) =>
  /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(sql);

/**
 * Expand `= ANY($N::type[])` or `= ANY($N)` into `IN ($N_a, $N_b, ...)`.
 * Must run BEFORE $N→? translation.
 */
const expandAnyArrays = (sql: string, params: any[]): { sql: string; params: any[] } => {
  const anyPattern = /=\s*ANY\s*\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/gi;
  if (!anyPattern.test(sql)) return { sql, params };

  // Reset lastIndex after test
  anyPattern.lastIndex = 0;

  const newParams = [...params];
  let result = sql;

  // Collect all matches first
  const matches: { fullMatch: string; paramNum: number; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = anyPattern.exec(sql)) !== null) {
    matches.push({ fullMatch: m[0], paramNum: parseInt(m[1], 10), index: m.index });
  }

  // Process from last to first to preserve string positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, paramNum, index } = matches[i];
    const paramIdx = paramNum - 1;
    const arr = Array.isArray(newParams[paramIdx]) ? (newParams[paramIdx] as any[]) : [];

    if (arr.length === 0) {
      // Replace with always-false condition
      result = result.substring(0, index) + 'IN (NULL)' + result.substring(index + fullMatch.length);
      newParams.splice(paramIdx, 1);
    } else {
      // Expand: replace single array param slot with individual values
      const placeholders = arr.map((_, j) => `$${paramNum + j}`).join(', ');
      result = result.substring(0, index) + `IN (${placeholders})` + result.substring(index + fullMatch.length);
      newParams.splice(paramIdx, 1, ...arr);
    }
  }

  // Renumber all $N references to be contiguous 1..N
  let idx = 0;
  result = result.replace(/\$(\d+)/g, () => {
    idx += 1;
    return `$${idx}`;
  });

  return { sql: result, params: newParams };
};

/** Strip PostgreSQL type casts like `::int`, `::text`, `::jsonb`, `::text[]`. */
const stripTypeCasts = (sql: string) =>
  sql.replace(/::(int|integer|text|double precision|jsonb|numeric|real|bigint|varchar|boolean|date|timestamptz|timestamp|text\[\]|int\[\]|integer\[\])\b/gi, '');

/** Replace `RETURNING *` / `RETURNING id` and return metadata. */
const extractReturning = (sql: string): { sql: string; mode: 'none' | 'id' | 'all'; tableName: string | null; isUpdate: boolean } => {
  const rAll = sql.match(/\s+RETURNING\s+\*\s*$/i);
  const rId = sql.match(/\s+RETURNING\s+id\s*$/i);
  if (!rAll && !rId) return { sql, mode: 'none', tableName: null, isUpdate: false };

  const tblMatch = sql.match(/^\s*(?:INSERT\s+INTO|UPDATE)\s+(\w+)/i);
  const isUpdate = /^\s*UPDATE\b/i.test(sql);
  return {
    sql: sql.replace(/\s+RETURNING\s+(?:id|\*)\s*$/i, ''),
    mode: rAll ? 'all' : 'id',
    tableName: tblMatch?.[1] ?? null,
    isUpdate,
  };
};

/** Translate PostgreSQL-specific function calls into SQLite equivalents. */
const translateFunctions = (sql: string): string => {
  let s = sql;

  // NOW() → datetime('now')
  s = s.replace(/\bNOW\(\)/gi, "datetime('now')");

  // INTERVAL arithmetic (both + and -)
  s = s.replace(
    /CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `datetime('now', '-${n} ${u}s')`,
  );
  s = s.replace(
    /CURRENT_TIMESTAMP\s*\+\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `datetime('now', '+${n} ${u}s')`,
  );
  s = s.replace(
    /CURRENT_DATE\s*-\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `date('now', '-${n} ${u}s')`,
  );
  s = s.replace(
    /CURRENT_DATE\s*\+\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi,
    (_, n, u) => `date('now', '+${n} ${u}s')`,
  );

  // NOW() - CAST($N AS INTERVAL) → goodypos_datetime_sub_interval(datetime('now'), ?)
  s = s.replace(
    /datetime\('now'\)\s*-\s*CAST\s*\(\s*(\$\d+)\s+AS\s+INTERVAL\s*\)/gi,
    (_, param) => `goodypos_datetime_sub_interval(datetime('now'), ${param})`,
  );

  // LPAD(CAST(expr AS TEXT), width, pad) → substr(repeat || CAST, -width)
  s = s.replace(
    /LPAD\s*\(\s*CAST\s*\(\s*([\w.]+)\s+AS\s+TEXT\s*\)\s*,\s*(\d+)\s*,\s*'(\d)'\s*\)/gi,
    (_, expr, width, pad) => `substr('${pad.repeat(parseInt(width, 10))}' || CAST(${expr} AS TEXT), -${width})`,
  );

  // GREATEST(a, b) → MAX(a, b) / LEAST(a, b) → MIN(a, b)
  // SQLite has no GREATEST/LEAST functions but scalar MAX/MIN with two args work identically.
  s = s.replace(/\bGREATEST\s*\(/gi, 'MAX(');
  s = s.replace(/\bLEAST\s*\(/gi, 'MIN(');

  // JSON ->> extraction (after ::jsonb is stripped): expr->>'key' → json_extract(expr, '$.key')
  // json_extract preserves types (boolean→1/0, number→number) whereas ->> always returns text
  s = s.replace(
    /([\w.]+)\s*->>\s*'(\w+)'/gi,
    (_, expr, key) => `json_extract(${expr}, '$.${key}')`,
  );

  // REGEXP_REPLACE(col, pattern, replacement, flags) → goodypos_digits_only(col)
  // Used exclusively for phone-number normalisation: strip non-digits
  s = s.replace(
    /REGEXP_REPLACE\s*\(\s*COALESCE\s*\(\s*(\w+)\s*,\s*''\s*\)\s*,\s*'\[\^0-9\]'\s*,\s*''\s*,\s*'g'\s*\)/gi,
    (_, col) => `goodypos_digits_only(COALESCE(${col}, ''))`,
  );

  return s;
};

/** Convert `$1, $2, …` to positional `?` and return the mapping. */
const dollarToPositional = (sql: string): { sql: string; map: number[] } => {
  const map: number[] = [];
  const out = sql.replace(/\$(\d+)/g, (_, n) => {
    map.push(parseInt(n, 10) - 1);
    return '?';
  });
  return { sql: out, map };
};

const reorder = (params: any[], map: number[]): any[] =>
  map.length ? map.map((i) => params[i] ?? null) : params;

const normalizeParam = (v: any) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && !Buffer.isBuffer(v)) {
    const json = JSON.stringify(v);
    // JSON.stringify(null) → "null" — convert to SQL NULL to match PG JSONB behaviour
    return json === 'null' ? null : json;
  }
  // Callers sometimes pre-stringify: JSON.stringify(null) → the string "null"
  // In PG JSONB columns, 'null' is stored as JSON null → retrieved as JS null.
  // Mirror that behaviour for SQLite TEXT columns.
  if (v === 'null') return null;
  return v;
};

/** Translate DDL-specific PostgreSQL syntax to SQLite equivalents. */
const translateDdl = (sql: string): string => {
  let s = sql;
  s = s.replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  s = s.replace(/\bJSONB\b/gi, 'TEXT');
  s = s.replace(/\bDOUBLE\s+PRECISION\b/gi, 'REAL');
  s = s.replace(/\bNUMERIC\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL');
  s = s.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
  s = s.replace(/\bTIMESTAMP\b/gi, 'DATETIME');
  s = s.replace(/'{}'\s*$/gm, "'{}'");
  // SQLite does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN
  s = s.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, 'ADD COLUMN');
  return s;
};

/** Handle `ALTER TABLE t ADD COLUMN IF NOT EXISTS …` (SQLite < 3.35 does not support IF NOT EXISTS for ADD COLUMN). */
const isAlterAddColumn = (sql: string) =>
  /^\s*ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i.test(sql);

/**
 * Rewrite `WITH cteName AS (SELECT generate_series(...) AS col)` into a RECURSIVE CTE.
 * Must run BEFORE translateFunctions because the INTERVAL args don't have nested parens yet.
 */
const translateGenerateSeries = (sql: string): string => {
  // Match WITH cteName AS ( SELECT generate_series( ... ) AS colName )
  // Use a more robust approach: find the generate_series call by scanning for balanced parens.
  const gsStart = sql.search(/WITH\s+\w+\s+AS\s*\(\s*SELECT\s+generate_series\s*\(/i);
  if (gsStart === -1) return sql;

  // Extract cteName and colName from the header
  const headerMatch = sql.slice(gsStart).match(/WITH\s+(\w+)\s+AS\s*\(\s*SELECT\s+generate_series\s*\(/);
  if (!headerMatch) return sql;
  const cteName = headerMatch[1];

  // Find balanced parens for generate_series(...)
  const parenStart = gsStart + headerMatch[0].length - 1; // position of opening '('
  let depth = 1;
  let pos = parenStart + 1;
  while (pos < sql.length && depth > 0) {
    if (sql[pos] === '(') depth++;
    else if (sql[pos] === ')') depth--;
    pos++;
  }
  const rawArgs = sql.slice(parenStart + 1, pos - 1);

  // Find the AS colName after generate_series(...)
  const afterParen = sql.slice(pos);
  const colNameMatch = afterParen.match(/^\s+AS\s+(\w+)\s*\)/i);
  if (!colNameMatch) return sql;
  const colName = colNameMatch[1];

  // The full match ends after the closing ) of the outer CTE paren
  const fullMatchEnd = pos + colNameMatch[0].length;
  const fullMatch = sql.slice(gsStart, fullMatchEnd);

  // Split args (first two are start, end; third is step which we ignore — always 1 day)
  const args = rawArgs.split(',').map((a: string) => a.trim());
  if (args.length < 2) return sql;

  let startExpr = args[0];
  let endExpr = args[1];

  // Translate CURRENT_DATE ± INTERVAL in args
  const intrvl = (s: string) =>
    s
      .replace(/CURRENT_DATE\s*-\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi, (_, n, u) => `date('now', '-${n} ${u}s')`)
      .replace(/CURRENT_DATE\s*\+\s*INTERVAL\s*'(\d+)\s*(day|month|year)s?'/gi, (_, n, u) => `date('now', '+${n} ${u}s')`)
      .replace(/\bCURRENT_DATE\b/gi, "date('now')");
  startExpr = intrvl(startExpr);
  endExpr = intrvl(endExpr);

  const recursive = `WITH RECURSIVE ${cteName}(${colName}) AS (SELECT ${startExpr} UNION ALL SELECT date(${colName}, '+1 day') FROM ${cteName} WHERE ${colName} < ${endExpr})`;
  return sql.replace(fullMatch, recursive);
};

// ─── Full Translation Pipeline ────────────────────────────────────────────────

interface TranslatedQuery {
  sql: string;
  params: any[];
  returningMode: 'none' | 'id' | 'all';
  tableName: string | null;
  isUpdate: boolean;
}

const translate = (sql: string, params: any[] = []): TranslatedQuery => {
  let s = String(sql || '').trim();
  let p = (params || []).map(normalizeParam);

  // Skip transaction control statements
  const upper = s.toUpperCase();
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
    return { sql: s, params: [], returningMode: 'none', tableName: null, isUpdate: false };
  }

  // Skip PG-specific system queries
  if (/\bpg_get_serial_sequence\b/i.test(s) || /\bsetval\b/i.test(s) ||
      /\bcurrent_database\(\)/i.test(s) || /\bversion\(\)/i.test(s)) {
    return { sql: '', params: [], returningMode: 'none', tableName: null, isUpdate: false };
  }

  // DDL path
  if (/^\s*(CREATE|ALTER|DROP)\b/i.test(s)) {
    s = translateDdl(s);
    s = stripTypeCasts(s);
    return { sql: s, params: [], returningMode: 'none', tableName: null, isUpdate: false };
  }

  // DML path
  const expanded = expandAnyArrays(s, p);
  s = expanded.sql;
  p = expanded.params;

  s = stripTypeCasts(s);
  s = translateGenerateSeries(s); // Before translateFunctions to avoid nested paren issues
  s = translateFunctions(s);

  const ret = extractReturning(s);
  s = ret.sql;

  // ON CONFLICT DO NOTHING is supported by SQLite ≥ 3.24 (sql.js ships ≥ 3.40)

  const pos = dollarToPositional(s);
  s = pos.sql;
  p = reorder(p, pos.map);

  return { sql: s, params: p, returningMode: ret.mode, tableName: ret.tableName, isUpdate: ret.isUpdate };
};

// ─── Pool-Compatible Adapter ──────────────────────────────────────────────────

interface QueryResult {
  rows: any[];
  rowCount: number;
  command: string;
}

class LocalDatabaseClient {
  constructor(private db: any) {}

  async query(sql: string, params?: any[]): Promise<QueryResult> {
    return executeLocalQuery(this.db, sql, params);
  }

  release(): void {
    // No-op for local single-connection SQLite.
  }
}

const executeLocalQuery = (db: any, sql: string, params: any[] = []): QueryResult => {
  const { sql: tSql, params: tParams, returningMode, tableName, isUpdate } = translate(sql, params);

  // Skip no-op queries (PG system introspection etc.)
  if (!tSql) {
    return { rows: [], rowCount: 0, command: '' };
  }

  const command = getSqlCommand(tSql);

  // Transaction control
  if (command === 'BEGIN' || command === 'COMMIT' || command === 'ROLLBACK') {
    try { db.exec(tSql); } catch { /* ignore duplicate begin/commit */ }
    return { rows: [], rowCount: 0, command };
  }

  // DDL
  if (command === 'CREATE' || command === 'DROP') {
    try { db.exec(tSql); } catch { /* ignore already-exists errors */ }
    return { rows: [], rowCount: 0, command };
  }

  if (command === 'ALTER') {
    if (isAlterAddColumn(tSql)) {
      try { db.exec(tSql); } catch { /* column already exists */ }
    } else {
      try { db.exec(tSql); } catch { /* ignore */ }
    }
    return { rows: [], rowCount: 0, command };
  }

  // CREATE INDEX
  if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(tSql)) {
    try { db.exec(tSql); } catch { /* index already exists */ }
    return { rows: [], rowCount: 0, command: 'CREATE' };
  }

  // DML queries
  if (isMutating(tSql)) {
    // For UPDATE RETURNING *, we need to capture the WHERE clause ID to re-fetch
    let updateWhereId: number | null = null;
    if (isUpdate && returningMode !== 'none' && tableName) {
      // Extract WHERE id = ? value from params — it's typically the last param
      const whereIdMatch = tSql.match(/WHERE\s+id\s*=\s*\?/i);
      if (whereIdMatch) {
        // Find the param index for the WHERE id = ? placeholder
        const beforeWhere = tSql.substring(0, whereIdMatch.index);
        const qCount = (beforeWhere.match(/\?/g) || []).length;
        updateWhereId = Number(tParams[qCount]) || null;
      }
    }

    const stmt = db.prepare(tSql);
    const result = stmt.run(...tParams);
    const lastId = Number(result.lastInsertRowid || 0);
    const changes = Number(result.changes || 0);

    if (returningMode === 'id') {
      if (isUpdate && updateWhereId) {
        return { rows: [{ id: updateWhereId }], rowCount: changes, command };
      }
      return { rows: [{ id: lastId }], rowCount: changes, command };
    }
    if (returningMode === 'all' && tableName) {
      const lookupId = isUpdate ? (updateWhereId || lastId) : lastId;
      if (lookupId) {
        const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(lookupId);
        return { rows: row ? [row] : [], rowCount: changes, command };
      }
      // Multi-column RETURNING without a simple id lookup — re-fetch by last inserted id
      if (lastId) {
        const row = db.prepare(`SELECT * FROM ${tableName} WHERE rowid = ?`).get(lastId);
        return { rows: row ? [row] : [], rowCount: changes, command };
      }
      return { rows: [], rowCount: changes, command };
    }

    return { rows: [], rowCount: changes, command };
  }

  // SELECT
  const stmt = db.prepare(tSql);
  const rows = stmt.all(...tParams);
  return { rows, rowCount: rows.length, command };
};

// ─── Public Factory ───────────────────────────────────────────────────────────

export interface LocalDatabasePool {
  query(sql: string, params?: any[]): Promise<QueryResult>;
  connect(): Promise<LocalDatabaseClient>;
  end(): Promise<void>;
  /** Marker so the rest of the server can detect local mode. */
  __isLocalAdapter: true;
}

export const createLocalDatabasePool = (databasePath: string): LocalDatabasePool => {
  const db = new Database(databasePath);

  // Register custom SQL scalar functions on the underlying sql.js instance.
  // IMPORTANT: sql.js `export()` (used by the goody-db-driver to persist to disk)
  // wipes all custom functions, so we must re-register after every persist.
  const registerCustomFunctions = () => {
    const rawDb = (db as any)._db;
    if (!rawDb?.create_function) return;
    rawDb.create_function('goodypos_digits_only', (input: string) =>
      String(input || '').replace(/[^0-9]/g, ''),
    );
    rawDb.create_function('REGEXP_REPLACE', (input: string, pattern: string, replacement: string, _flags: string) => {
      try {
        const flags = String(_flags || '').replace(/[^gimsuy]/g, '');
        return String(input || '').replace(new RegExp(pattern, flags), replacement);
      } catch { return String(input || ''); }
    });
    rawDb.create_function('goodypos_datetime_sub_interval', (dt: string, interval: string) => {
      const match = String(interval || '').match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?/i);
      if (!match) return dt;
      const n = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      const d = new Date(dt || new Date().toISOString());
      switch (unit) {
        case 'second': d.setSeconds(d.getSeconds() - n); break;
        case 'minute': d.setMinutes(d.getMinutes() - n); break;
        case 'hour': d.setHours(d.getHours() - n); break;
        case 'day': d.setDate(d.getDate() - n); break;
        case 'week': d.setDate(d.getDate() - n * 7); break;
        case 'month': d.setMonth(d.getMonth() - n); break;
        case 'year': d.setFullYear(d.getFullYear() - n); break;
      }
      return d.toISOString().replace('T', ' ').substring(0, 19);
    });
  };
  registerCustomFunctions();

  // Monkey-patch _persistLocalDatabase to re-register custom functions after each export()
  const origPersist = (db as any)._persistLocalDatabase?.bind(db);
  if (origPersist) {
    (db as any)._persistLocalDatabase = function () {
      origPersist();
      registerCustomFunctions();
    };
  }

  // Bootstrap the SQLite schema (safe to call repeatedly — all CREATE IF NOT EXISTS)
  initializeDatabaseSchema(db);

  return {
    __isLocalAdapter: true,

    async query(sql: string, params?: any[]): Promise<QueryResult> {
      return executeLocalQuery(db, sql, params);
    },

    async connect(): Promise<LocalDatabaseClient> {
      return new LocalDatabaseClient(db);
    },

    async end(): Promise<void> {
      try { db.close(); } catch { /* ignore */ }
    },
  };
};
