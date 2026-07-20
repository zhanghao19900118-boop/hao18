import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_code TEXT UNIQUE,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      muted_until TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL DEFAULT 'wc2026' REFERENCES tournaments(id),
      stage TEXT NOT NULL,
      match_date TEXT NOT NULL,
      match_time TEXT NOT NULL,
      kickoff_at TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      score TEXT NOT NULL DEFAULT '—',
      status TEXT NOT NULL,
      venue TEXT NOT NULL,
      source TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_key TEXT UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      match_id TEXT REFERENCES matches(id),
      prediction_text TEXT NOT NULL CHECK(length(prediction_text) BETWEEN 1 AND 50),
      supported_team TEXT,
      weight INTEGER NOT NULL CHECK(weight BETWEEN 1 AND 100),
      confidence_percent REAL CHECK(confidence_percent BETWEEN 0 AND 100),
      result TEXT NOT NULL DEFAULT 'pending' CHECK(result IN ('correct','incorrect','pending')),
      points_change INTEGER NOT NULL DEFAULT 0,
      total_points INTEGER NOT NULL DEFAULT 1000,
      source_game TEXT,
      source_score TEXT,
      watched INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','locked','settled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id, created_at);
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL REFERENCES matches(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 140),
      status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden','deleted')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_comments_match ON comments(match_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      before_json TEXT,
      after_json TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Incremental migration for databases created by V3.0.
  const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  const addColumn = (table, name, definition) => {
    if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn('users', 'user_code', 'TEXT');
  addColumn('matches', 'tournament_id', "TEXT NOT NULL DEFAULT 'wc2026'");
  addColumn('predictions', 'source_game', 'TEXT');
  addColumn('predictions', 'source_score', 'TEXT');
  addColumn('predictions', 'watched', 'INTEGER NOT NULL DEFAULT 0');
  db.prepare(`INSERT OR IGNORE INTO tournaments(id,name,year,status) VALUES('wc2026','2026 FIFA World Cup',2026,'active')`).run();
  db.prepare("UPDATE matches SET tournament_id='wc2026' WHERE tournament_id IS NULL OR tournament_id='' ").run();
  db.prepare("UPDATE users SET user_code=printf('USR-%06d',id) WHERE user_code IS NULL OR user_code='' ").run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_code ON users(user_code)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id,kickoff_at)');
}

export function audit(actorId, action, targetType, targetId, before = null, after = null, reason = null) {
  db.prepare(`INSERT INTO audit_logs(actor_id,action,target_type,target_id,before_json,after_json,reason)
    VALUES(?,?,?,?,?,?,?)`).run(actorId || null, action, targetType, String(targetId ?? ''), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason);
}
