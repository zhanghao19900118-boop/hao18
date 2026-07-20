import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-worldcup-v3-'));
process.env.DB_PATH = path.join(temp, 'test.db');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';

const { default: app } = await import('../server/app.js');
const { db } = await import('../server/db.js');
const { hashPassword } = await import('../server/security.js');
let userId, otherId, csrf;
const user = request.agent(app);
const other = request.agent(app);
const admin = request.agent(app);

before(() => {
  const add = db.prepare('INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES(?,?,?,?,?)');
  userId = Number(add.run('user1','用户一',hashPassword('Password123'), 'user', 1).lastInsertRowid);
  otherId = Number(add.run('user2','用户二',hashPassword('Password456'), 'user', 0).lastInsertRowid);
  add.run('admin','管理员',hashPassword('AdminPass123'), 'admin', 0);
  db.prepare(`INSERT INTO matches(id,stage,match_date,match_time,kickoff_at,home_team,away_team,score,status,venue)
    VALUES('future','A','2099-01-01','12:00','2099-01-01T16:00:00.000Z','Alpha','Beta','—','未开始','Test Stadium')`).run();
});

after(() => { db.close(); fs.rmSync(temp, { recursive:true, force:true }); });

test('health endpoint', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.ok, true);
});

test('private predictions reject anonymous visitor', async () => {
  await request(app).get('/api/predictions').expect(401);
});

test('first login requires password change', async () => {
  const login = await user.post('/api/auth/login').send({username:'user1',password:'Password123'}).expect(200);
  csrf = login.body.csrfToken;
  assert.equal(login.body.user.mustChangePassword, true);
  await user.get('/api/predictions').expect(428);
  await user.post('/api/auth/change-password').set('X-CSRF-Token',csrf).send({currentPassword:'Password123',newPassword:'NewPassword123'}).expect(200);
});

test('user can create multiple predictions and edit only own data', async () => {
  const first = await user.post('/api/matches/future/predictions').set('X-CSRF-Token',csrf).send({predictionText:'Alpha 表现更稳定',weight:20}).expect(201);
  const second = await user.post('/api/matches/future/predictions').set('X-CSRF-Token',csrf).send({predictionText:'可能出现平局',weight:10}).expect(201);
  assert.notEqual(first.body.id, second.body.id);
  const otherLogin = await other.post('/api/auth/login').send({username:'user2',password:'Password456'}).expect(200);
  await other.patch(`/api/predictions/${first.body.id}`).set('X-CSRF-Token',otherLogin.body.csrfToken).send({predictionText:'越权修改',weight:5}).expect(403);
  const changed = await user.patch(`/api/predictions/${first.body.id}`).set('X-CSRF-Token',csrf).send({predictionText:'Alpha 防守更稳定',weight:25}).expect(200);
  assert.equal(changed.body.weight,25);
});

test('comments require login, preserve plain text, and are publicly readable', async () => {
  await request(app).post('/api/matches/future/comments').send({content:'游客评论'}).expect(401);
  await user.post('/api/matches/future/comments').set('X-CSRF-Token',csrf).send({content:'<script>alert(1)</script> 只作为文本'}).expect(201);
  const res = await request(app).get('/api/matches/future/comments').expect(200);
  assert.equal(res.body.comments.length,1);
  assert.equal(res.body.comments[0].content,'<script>alert(1)</script> 只作为文本');
});

test('only admin can delete comments and static interaction source is not public', async () => {
  const comment = db.prepare('SELECT id FROM comments LIMIT 1').get();
  await user.delete(`/api/comments/${comment.id}`).set('X-CSRF-Token',csrf).send({reason:'越权'}).expect(403);
  const login = await admin.post('/api/auth/login').send({username:'admin',password:'AdminPass123'}).expect(200);
  await admin.delete(`/api/comments/${comment.id}`).set('X-CSRF-Token',login.body.csrfToken).send({reason:'测试管理删除'}).expect(200);
  await request(app).get('/data/interactions.json').expect(404);
});

test('admin can create user, keep immutable code, rename username, and protect last admin', async () => {
  const login = await admin.post('/api/auth/login').send({username:'admin',password:'AdminPass123'}).expect(200);
  const made = await admin.post('/api/admin/users').set('X-CSRF-Token',login.body.csrfToken).send({username:'new_user',displayName:'新用户',password:'TempPassword123',role:'user'}).expect(201);
  assert.equal(made.body.mustChangePassword,true);
  assert.match(made.body.userCode,/^USR-\d{6}$/);
  const renamed=await admin.patch(`/api/admin/users/${made.body.id}`).set('X-CSRF-Token',login.body.csrfToken).send({username:'renamed_user',reason:'测试改名'}).expect(200);
  assert.equal(renamed.body.username,'renamed_user');
  assert.equal(renamed.body.userCode,made.body.userCode);
  const adminRow = db.prepare("SELECT id FROM users WHERE username='admin'").get();
  await admin.patch(`/api/admin/users/${adminRow.id}`).set('X-CSRF-Token',login.body.csrfToken).send({status:'disabled',reason:'测试'}).expect(409);
});

test('admin CSV-style import preserves fields and two-decimal confidence', async () => {
  const login = await admin.post('/api/auth/login').send({username:'admin',password:'AdminPass123'}).expect(200);
  const target=db.prepare("SELECT user_code FROM users WHERE username='renamed_user'").get();
  const result=await admin.post('/api/admin/predictions/import').set('X-CSRF-Token',login.body.csrfToken).send({records:[{
    record_id:'IMPORT-0001',profile_id:target.user_code,created_at:'2026-06-11',match_ids:'future',game:'Alpha vs Beta',score:'—',
    prediction:'测试积分预测',supported_team:'Alpha',weight:'20',confidence_percent:'67.25',result:'pending',points_change:'0',total_points:'1000',watched:'true'
  }]}).expect(200);
  assert.equal(result.body.inserted,1);
  const row=db.prepare("SELECT confidence_percent,source_game,watched FROM predictions WHERE migration_key='IMPORT-0001'").get();
  assert.equal(row.confidence_percent,67.25);
  assert.equal(row.source_game,'Alpha vs Beta');
  assert.equal(row.watched,1);
});

test('migration totals remain exactly 149 and 54', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../data/interactions.json', import.meta.url)));
  const counts = source.reduce((m,r)=>(m[r.profile_id]=(m[r.profile_id]||0)+1,m),{});
  assert.deepEqual(counts,{'User-01':149,'User-02':54});
});
