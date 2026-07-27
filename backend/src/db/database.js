import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'graph.db');

let _db;

export function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  _db.exec(schema);
  runMigrations(_db);
  return _db;
}

export function setDb(db) {
  _db = db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

export function jparse(s, fallback = null) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

export function jstr(v) {
  return JSON.stringify(v ?? null);
}
