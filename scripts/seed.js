import fs from 'node:fs';
import path from 'node:path';
import { migrate, db, audit } from '../server/db.js';
import { ROOT } from '../server/config.js';
import { hashPassword } from '../server/security.js';

migrate();
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
const matches = read('matches.json');
const interactions = read('interactions.json');
const kickoff = m => new Date(`${m.date}T${m.time}:00-04:00`).toISOString();

const putMatch = db.prepare(`INSERT INTO matches(id,stage,match_date,match_time,kickoff_at,home_team,away_team,score,status,venue,source,updated_at)
 VALUES(@id,@group,@date,@time,@kickoff,@home,@away,@score,@status,@venue,@source,CURRENT_TIMESTAMP)
 ON CONFLICT(id) DO UPDATE SET stage=excluded.stage,match_date=excluded.match_date,match_time=excluded.match_time,kickoff_at=excluded.kickoff_at,
 home_team=excluded.home_team,away_team=excluded.away_team,score=excluded.score,status=excluded.status,venue=excluded.venue,source=excluded.source,updated_at=CURRENT_TIMESTAMP`);
db.transaction(() => matches.forEach(m => putMatch.run({ ...m, kickoff: kickoff(m), source: m.source || null })))();

const seedPassword = process.env.SEED_USER_PASSWORD || 'ChangeMe2026';
const putUser = db.prepare(`INSERT INTO users(username,display_name,password_hash,role,must_change_password)
 VALUES(?,?,?,?,1) ON CONFLICT(username) DO UPDATE SET display_name=excluded.display_name`);
['User-01','User-02'].forEach(name => putUser.run(name.toLowerCase(), name, hashPassword(seedPassword), 'user'));
if (process.env.ADMIN_USERNAME && process.env.ADMIN_INITIAL_PASSWORD) {
  if (process.env.ADMIN_INITIAL_PASSWORD.length < 10 || !/[A-Za-z]/.test(process.env.ADMIN_INITIAL_PASSWORD) || !/\d/.test(process.env.ADMIN_INITIAL_PASSWORD)) {
    throw new Error('管理员初始密码至少10位，并同时包含字母和数字');
  }
  putUser.run(process.env.ADMIN_USERNAME, process.env.ADMIN_DISPLAY_NAME || '管理员', hashPassword(process.env.ADMIN_INITIAL_PASSWORD), 'admin');
}

const users = new Map(db.prepare('SELECT id,display_name FROM users').all().map(u => [u.display_name, u.id]));
const putPrediction = db.prepare(`INSERT INTO predictions(migration_key,user_id,match_id,prediction_text,supported_team,weight,confidence_percent,result,points_change,total_points,status,created_at,updated_at)
 VALUES(@key,@user,@match,@text,@team,@weight,@confidence,@result,@change,@total,@status,@created,@created)
 ON CONFLICT(migration_key) DO NOTHING`);
let inserted = 0, skipped = 0;
db.transaction(() => interactions.forEach(r => {
  const user = users.get(r.profile_id), candidate = r.match_ids?.[0], match = candidate && db.prepare('SELECT 1 FROM matches WHERE id=?').get(candidate) ? candidate : null;
  if (!user) { skipped++; return; }
  const result = putPrediction.run({ key: r.record_id, user, match, text: String(r.prediction || '历史积分预测').slice(0,50), team: r.supported_team || null,
    weight: Math.max(1, Math.min(100, Math.round(r.weight || 1))), confidence: Math.max(0, Math.min(100, Math.round(r.confidence_percent || 0))),
    result: ['correct','incorrect','pending'].includes(r.result) ? r.result : 'pending', change: Math.round(r.points_change || 0), total: Math.round(r.total_points || 1000),
    status: r.result === 'pending' ? 'locked' : 'settled', created: r.created_at ? `${r.created_at}T12:00:00.000Z` : new Date().toISOString() });
  inserted += Number(result.changes || 0);
}))();

const counts = db.prepare(`SELECT u.display_name profile,COUNT(p.id) count,COALESCE(SUM(p.points_change),0) point_change
 FROM users u LEFT JOIN predictions p ON p.user_id=u.id WHERE u.display_name IN ('User-01','User-02') GROUP BY u.id ORDER BY u.display_name`).all();
console.log(JSON.stringify({ matches: matches.length, interactions: interactions.length, inserted, skipped, users: counts }, null, 2));
audit(null, 'seed_completed', 'database', 'initial', null, { matches: matches.length, interactions: interactions.length, inserted, skipped });
db.close();
