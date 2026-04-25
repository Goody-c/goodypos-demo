import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.GOODY_POS_POSTGRES_URL = '';
process.env.DATABASE_URL = '';

const { default: Database } = await import('./index.js');

test('file-backed local transactions commit successfully after writes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goody-db-driver-'));
  const dbPath = path.join(tempDir, 'pos.db');
  const db = new Database(dbPath);

  try {
    db.exec('CREATE TABLE stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);');
    const inserted = db.prepare('INSERT INTO stores (name) VALUES (?)').run('Store A');

    assert.doesNotThrow(() => {
      db.transaction(() => {
        db.prepare('DELETE FROM stores WHERE id = ?').run(inserted.lastInsertRowid);
      })();
    });

    const remaining = db.prepare('SELECT COUNT(*) AS count FROM stores').get();
    assert.equal(Number(remaining?.count || 0), 0);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
