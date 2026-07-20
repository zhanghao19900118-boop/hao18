import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { db, migrate, audit } from './db.js';
import { config, ROOT } from './config.js';
import { SESSION_COOKIE, auth, requireUser, requireAdmin, requireCsrf, cookieOptions, createSession, hashPassword, hashToken, publicUser, validPassword, verifyPassword } from './security.js';

migrate();
const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, strictTransportSecurity: config.cookieSecure ? undefined : false }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/api', auth);

const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '登录尝试过多，请稍后再试' } });
const commentLimit = rateLimit({ windowMs: 30_000, limit: 3, keyGenerator: req => req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip), standardHeaders: true, legacyHeaders: false, message: { error: '评论过于频繁，请稍后再试' } });

const nowIso = () => new Date().toISOString();
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const userCode = id => `USR-${String(id).padStart(6,'0')}`;
const decimalPercent = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 100) / 100 : null;
};
const matchLocked = row => Date.now() >= new Date(row.kickoff_at).getTime() + 3 * 60 * 60_000;
const getMatch = id => db.prepare('SELECT * FROM matches WHERE id=?').get(id);
const predictionSelect = `SELECT p.*,u.display_name,u.username,m.home_team,m.away_team,m.match_date,m.match_time,m.kickoff_at,m.score match_score
 FROM predictions p JOIN users u ON u.id=p.user_id LEFT JOIN matches m ON m.id=p.match_id`;
const predictionJson = row => ({
  id: row.id, userId: row.user_id, username: row.username, displayName: row.display_name, matchId: row.match_id,
  game: row.match_id ? `${row.home_team} vs ${row.away_team}` : '未关联具体场次', matchDate: row.match_date, matchTime: row.match_time, matchScore: row.match_score,
  predictionText: row.prediction_text, supportedTeam: row.supported_team, weight: row.weight,
  confidencePercent: row.confidence_percent, result: row.result, pointsChange: Math.round(row.points_change),
  totalPoints: Math.round(row.total_points), status: row.status, locked: row.match_id ? matchLocked(row) : true, createdAt: row.created_at, updatedAt: row.updated_at
});

app.get('/api/health', (_req, res) => res.json({ ok: true, version: '3.1.0-rc.1', database: true, time: nowIso() }));

app.post('/api/auth/login', loginLimit, (req, res) => {
  const username = cleanText(req.body?.username, 60);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = db.prepare("SELECT * FROM users WHERE username=? AND status='active'").get(username);
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码不正确' });
  const session = createSession(user.id);
  res.cookie(SESSION_COOKIE, session.token, cookieOptions());
  audit(user.id, 'login', 'user', user.id);
  res.json({ user: publicUser(user), csrfToken: session.csrf });
});

app.use('/api', requireCsrf);

app.post('/api/auth/logout', requireUser, (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user), csrfToken: req.user ? req.csrfToken : null }));

app.post('/api/auth/change-password', requireUser, (req, res) => {
  const current = String(req.body?.currentPassword || ''), next = String(req.body?.newPassword || '');
  if (!verifyPassword(current, req.user.password_hash)) return res.status(400).json({ error: '当前密码不正确' });
  if (!validPassword(next)) return res.status(400).json({ error: '新密码至少10位，并同时包含字母和数字' });
  db.prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(req.user.id, hashToken(req.cookies[SESSION_COOKIE]));
  audit(req.user.id, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (req.user?.must_change_password && !['/me','/auth/logout','/auth/change-password'].includes(req.path)) return res.status(428).json({ error: '首次登录必须先修改密码', code: 'PASSWORD_CHANGE_REQUIRED' });
  next();
});

app.get('/api/matches', (_req, res) => {
  const rows = db.prepare('SELECT * FROM matches ORDER BY tournament_id,kickoff_at').all();
  res.json(rows.map(m => ({ id:m.id, tournamentId:m.tournament_id, group:m.stage, date:m.match_date, time:m.match_time, home:m.home_team, away:m.away_team, score:m.score, status:m.status, venue:m.venue, kickoffAt:m.kickoff_at, locked:matchLocked(m) })));
});

app.get('/api/tournaments', (_req,res) => res.json(db.prepare('SELECT id,name,year,status FROM tournaments ORDER BY year DESC').all()));

app.get('/api/predictions', requireUser, (req, res) => {
  const clauses = [], params = [];
  if (req.query.mine === '1') { clauses.push('p.user_id=?'); params.push(req.user.id); }
  if (req.query.matchId) { clauses.push('p.match_id=?'); params.push(String(req.query.matchId)); }
  if (req.query.status) { clauses.push('p.status=?'); params.push(String(req.query.status)); }
  if (req.query.team) { clauses.push('(m.home_team LIKE ? OR m.away_team LIKE ?)'); params.push(`%${req.query.team}%`, `%${req.query.team}%`); }
  if (req.query.date) { clauses.push('m.match_date=?'); params.push(String(req.query.date)); }
  const rows = db.prepare(`${predictionSelect}${clauses.length ? ' WHERE '+clauses.join(' AND ') : ''} ORDER BY p.created_at DESC,p.id DESC LIMIT 1000`).all(...params);
  res.json(rows.map(predictionJson));
});

app.get('/api/leaderboard', requireUser, (_req, res) => {
  const rows = db.prepare(`SELECT u.id,u.display_name,COALESCE((SELECT p.total_points FROM predictions p WHERE p.user_id=u.id ORDER BY p.created_at DESC,p.id DESC LIMIT 1),1000) total_points,
    (SELECT COUNT(*) FROM predictions p WHERE p.user_id=u.id) predictions FROM users u WHERE u.status='active' ORDER BY total_points DESC,u.display_name`).all();
  res.json(rows.map((r,i) => ({ rank:i+1, userId:r.id, displayName:r.display_name, totalPoints:Math.round(r.total_points), predictions:r.predictions })));
});

app.post('/api/matches/:id/predictions', requireUser, (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) return res.status(404).json({ error: '比赛不存在' });
  if (matchLocked(match)) return res.status(409).json({ error: '比赛已锁定，不能新增预测' });
  const text = cleanText(req.body?.predictionText, 50), weight = Math.round(Number(req.body?.weight));
  if (!text || text.length > 50) return res.status(400).json({ error: '预测内容必须为1–50字' });
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) return res.status(400).json({ error: '权重必须是1–100的整数' });
  const info = db.prepare(`INSERT INTO predictions(user_id,match_id,prediction_text,weight,status,total_points)
    VALUES(?,?,?,?, 'open', COALESCE((SELECT total_points FROM predictions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1),1000))`).run(req.user.id, match.id, text, weight, req.user.id);
  const row = db.prepare(`${predictionSelect} WHERE p.id=?`).get(info.lastInsertRowid);
  audit(req.user.id, 'prediction_created', 'prediction', info.lastInsertRowid, null, predictionJson(row));
  res.status(201).json(predictionJson(row));
});

app.patch('/api/predictions/:id', requireUser, (req, res) => {
  const row = db.prepare(`${predictionSelect} WHERE p.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '预测记录不存在' });
  const admin = req.user.role === 'admin';
  if (!admin && row.user_id !== req.user.id) return res.status(403).json({ error: '不能修改其他用户的预测' });
  if (!admin && matchLocked(row)) return res.status(409).json({ error: '比赛已锁定，不能修改预测' });
  const text = req.body.predictionText === undefined ? row.prediction_text : cleanText(req.body.predictionText, 50);
  const weight = req.body.weight === undefined ? row.weight : Math.round(Number(req.body.weight));
  if (!text || text.length > 50 || !Number.isInteger(weight) || weight < 1 || weight > 100) return res.status(400).json({ error: '请检查预测内容和权重' });
  let confidence = row.confidence_percent, result = row.result, points = row.points_change, status = row.status;
  if (admin) {
    if (req.body.confidencePercent !== undefined) {
      confidence = decimalPercent(req.body.confidencePercent);
      if (confidence === null) return res.status(400).json({ error:'置信区间必须为0–100，可保留两位小数' });
    }
    if (['correct','incorrect','pending'].includes(req.body.result)) result = req.body.result;
    if (req.body.pointsChange !== undefined) points = Math.round(Number(req.body.pointsChange));
    if (['open','locked','settled'].includes(req.body.status)) status = req.body.status;
  }
  db.prepare(`UPDATE predictions SET prediction_text=?,weight=?,confidence_percent=?,result=?,points_change=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(text,weight,confidence,result,points,status,row.id);
  const after = db.prepare(`${predictionSelect} WHERE p.id=?`).get(row.id);
  audit(req.user.id, 'prediction_updated', 'prediction', row.id, predictionJson(row), predictionJson(after), admin ? cleanText(req.body.reason,200) : null);
  res.json(predictionJson(after));
});

app.delete('/api/predictions/:id', requireUser, (req, res) => {
  const row = db.prepare(`${predictionSelect} WHERE p.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '预测记录不存在' });
  if (row.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '不能删除其他用户的预测' });
  if (req.user.role !== 'admin' && matchLocked(row)) return res.status(409).json({ error: '比赛已锁定，不能删除预测' });
  db.prepare('DELETE FROM predictions WHERE id=?').run(row.id);
  audit(req.user.id, 'prediction_deleted', 'prediction', row.id, predictionJson(row), null);
  res.json({ ok: true });
});

app.get('/api/matches/:id/comments', (req, res) => {
  if (!getMatch(req.params.id)) return res.status(404).json({ error: '比赛不存在' });
  const page = Math.max(1, Number(req.query.page || 1)), limit = 20, offset = (page-1)*limit;
  const admin = req.user?.role === 'admin';
  const rows = db.prepare(`SELECT c.*,u.display_name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.match_id=? ${admin?'':"AND c.status='visible'"} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`).all(req.params.id,limit+1,offset);
  res.json({ comments: rows.slice(0,limit).map(c=>({ id:c.id,matchId:c.match_id,userId:c.user_id,displayName:c.display_name,content:c.content,status:c.status,createdAt:c.created_at,canModerate:admin })), hasMore:rows.length>limit, page });
});

app.post('/api/matches/:id/comments', requireUser, commentLimit, (req, res) => {
  if (!getMatch(req.params.id)) return res.status(404).json({ error: '比赛不存在' });
  if (req.user.muted_until && new Date(req.user.muted_until) > new Date()) return res.status(403).json({ error: '当前账号暂时不能发表评论' });
  const content = cleanText(req.body?.content, 140);
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });
  const info = db.prepare('INSERT INTO comments(match_id,user_id,content) VALUES(?,?,?)').run(req.params.id,req.user.id,content);
  audit(req.user.id,'comment_created','comment',info.lastInsertRowid,null,{matchId:req.params.id,content});
  res.status(201).json({ id:info.lastInsertRowid,matchId:req.params.id,userId:req.user.id,displayName:req.user.display_name,content,status:'visible',createdAt:nowIso() });
});

app.delete('/api/comments/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '评论不存在' });
  db.prepare("UPDATE comments SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
  audit(req.user.id,'comment_deleted','comment',row.id,row,null,cleanText(req.body?.reason,200));
  res.json({ ok:true });
});

app.patch('/api/admin/comments/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
  const status = req.body?.status;
  if (!row || !['visible','hidden'].includes(status)) return res.status(400).json({ error:'评论或状态无效' });
  db.prepare('UPDATE comments SET status=? WHERE id=?').run(status,row.id);
  audit(req.user.id,'comment_status_changed','comment',row.id,row,{...row,status},cleanText(req.body?.reason,200));
  res.json({ ok:true });
});

app.get('/api/admin/users', requireAdmin, (_req,res) => res.json(db.prepare('SELECT id,user_code,username,display_name,role,status,muted_until,must_change_password,created_at FROM users ORDER BY created_at DESC').all()));

app.get('/api/admin/comments', requireAdmin, (req,res) => {
  const clauses=[],params=[];
  if(req.query.matchId){clauses.push('c.match_id=?');params.push(String(req.query.matchId))}
  if(req.query.userId){clauses.push('c.user_id=?');params.push(Number(req.query.userId))}
  if(req.query.q){clauses.push('c.content LIKE ?');params.push(`%${String(req.query.q).slice(0,100)}%`)}
  const rows=db.prepare(`SELECT c.*,u.display_name,m.home_team,m.away_team FROM comments c JOIN users u ON u.id=c.user_id JOIN matches m ON m.id=c.match_id ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY c.created_at DESC,c.id DESC LIMIT 500`).all(...params);
  res.json(rows.map(c=>({id:c.id,matchId:c.match_id,game:`${c.home_team} vs ${c.away_team}`,userId:c.user_id,displayName:c.display_name,content:c.content,status:c.status,createdAt:c.created_at})));
});

app.post('/api/admin/users', requireAdmin, (req,res) => {
  const username=cleanText(req.body?.username,60), display=cleanText(req.body?.displayName,60), password=String(req.body?.password||''), role=req.body?.role==='admin'?'admin':'user';
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(username) || !display || !validPassword(password)) return res.status(400).json({ error:'用户名、显示名或密码格式不正确' });
  try {
    const info=db.prepare('INSERT INTO users(username,display_name,password_hash,role,must_change_password) VALUES(?,?,?,?,1)').run(username,display,hashPassword(password),role);
    const code=userCode(info.lastInsertRowid);
    db.prepare('UPDATE users SET user_code=? WHERE id=?').run(code,info.lastInsertRowid);
    audit(req.user.id,'user_created','user',info.lastInsertRowid,null,{userCode:code,username,displayName:display,role});
    res.status(201).json({ id:info.lastInsertRowid,userCode:code,username,displayName:display,role,status:'active',mustChangePassword:true });
  } catch (error) { res.status(409).json({ error:error.code==='SQLITE_CONSTRAINT_UNIQUE'?'用户名已存在':'创建用户失败' }); }
});

app.patch('/api/admin/users/:id', requireAdmin, (req,res) => {
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error:'用户不存在' });
  const role=req.body.role==='admin'?'admin':req.body.role==='user'?'user':user.role;
  const status=req.body.status==='disabled'?'disabled':req.body.status==='active'?'active':user.status;
  if ((role!=='admin'||status!=='active') && user.role==='admin' && user.status==='active') {
    const count=db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active'").get().n;
    if (count<=1) return res.status(409).json({ error:'不能停用或降级最后一个有效管理员' });
  }
  const mutedUntil=req.body.mutedUntil===null?null:req.body.mutedUntil?new Date(req.body.mutedUntil).toISOString():user.muted_until;
  const display=cleanText(req.body.displayName,60)||user.display_name;
  const username=req.body.username===undefined?user.username:cleanText(req.body.username,60);
  if(!/^[A-Za-z0-9._-]{3,60}$/.test(username)) return res.status(400).json({error:'用户名须为3–60位字母、数字、点、下划线或连字符'});
  try {
    db.prepare('UPDATE users SET username=?,display_name=?,role=?,status=?,muted_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(username,display,role,status,mutedUntil,user.id);
  } catch(error) {
    return res.status(409).json({error:error.code==='SQLITE_CONSTRAINT_UNIQUE'?'用户名已存在':'用户更新失败'});
  }
  if(status==='disabled') db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  const after=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  audit(req.user.id,'user_updated','user',user.id,publicUser(user),publicUser(after),cleanText(req.body.reason,200));
  res.json(publicUser(after));
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, (req,res) => {
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id), password=String(req.body?.password||'');
  if (!user || !validPassword(password)) return res.status(400).json({ error:'用户不存在或密码格式不正确' });
  db.prepare('UPDATE users SET password_hash=?,must_change_password=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(password),user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  audit(req.user.id,'password_reset','user',user.id,null,null);
  res.json({ ok:true });
});

app.post('/api/admin/predictions/import', requireAdmin, (req,res) => {
  const records=Array.isArray(req.body?.records)?req.body.records:[];
  if(!records.length||records.length>2000) return res.status(400).json({error:'请上传1–2000条记录'});
  const findUser=db.prepare(`SELECT * FROM users WHERE user_code=? COLLATE NOCASE OR username=? COLLATE NOCASE OR display_name=? COLLATE NOCASE LIMIT 1`);
  const hasMatch=db.prepare('SELECT 1 FROM matches WHERE id=?');
  const insert=db.prepare(`INSERT INTO predictions(migration_key,user_id,match_id,prediction_text,supported_team,weight,confidence_percent,result,points_change,total_points,source_game,source_score,watched,status,created_at,updated_at)
    VALUES(@key,@user,@match,@text,@team,@weight,@confidence,@result,@change,@total,@game,@score,@watched,@status,@created,@created)
    ON CONFLICT(migration_key) DO NOTHING`);
  let inserted=0,skipped=0;const errors=[];
  db.transaction(()=>records.forEach((raw,index)=>{
    try{
      const key=cleanText(raw.record_id,80),profile=cleanText(raw.profile_id,80);
      const user=findUser.get(profile,profile,profile);
      const text=cleanText(raw.prediction,50),weight=Number(raw.weight),confidence=decimalPercent(raw.confidence_percent);
      const result=['correct','incorrect','pending'].includes(raw.result)?raw.result:'pending';
      const ids=Array.isArray(raw.match_ids)?raw.match_ids:String(raw.match_ids||'').split(/[;|,]/).map(x=>x.trim()).filter(Boolean);
      const match=ids.find(id=>hasMatch.get(id))||null;
      if(!key||!user||!text||!Number.isInteger(weight)||weight<1||weight>100||confidence===null) throw new Error('主键、用户、内容、权重或置信度无效');
      const created=raw.created_at&&Number.isFinite(Date.parse(raw.created_at))?new Date(raw.created_at).toISOString():nowIso();
      const change=Number.isFinite(Number(raw.points_change))?Math.round(Number(raw.points_change)):0;
      const total=Number.isFinite(Number(raw.total_points))?Math.round(Number(raw.total_points)):1000;
      const outcome=insert.run({key,user:user.id,match,text,team:cleanText(raw.supported_team,80)||null,weight,confidence,result,change,total,
        game:cleanText(raw.game,160)||null,score:cleanText(raw.score,40)||null,watched:['true','1','yes','是'].includes(String(raw.watched).toLowerCase())?1:0,
        status:result==='pending'?'locked':'settled',created});
      if(outcome.changes) inserted++;else skipped++;
    }catch(error){errors.push({row:index+2,error:error.message});}
  }))();
  audit(req.user.id,'predictions_imported','prediction_import','csv',null,{inserted,skipped,errorCount:errors.length});
  res.json({inserted,skipped,errors:errors.slice(0,50)});
});

app.post('/api/admin/predictions/:id/settle', requireAdmin, (req,res) => {
  const row=db.prepare(`${predictionSelect} WHERE p.id=?`).get(req.params.id);
  if(!row) return res.status(404).json({error:'预测记录不存在'});
  const confidence=decimalPercent(req.body?.confidencePercent);
  if(confidence===null) return res.status(400).json({error:'置信区间必须为0–100，可保留两位小数'});
  const change=Math.round(row.weight*confidence/100-row.weight);
  db.transaction(()=>{
    db.prepare("UPDATE predictions SET confidence_percent=?,points_change=?,result=?,status='settled',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(confidence,change,change>=0?'correct':'incorrect',row.id);
    const all=db.prepare('SELECT id,points_change FROM predictions WHERE user_id=? ORDER BY created_at,id').all(row.user_id);
    let total=1000; const put=db.prepare('UPDATE predictions SET total_points=? WHERE id=?');
    all.forEach(p=>{total+=Math.round(p.points_change);put.run(total,p.id)});
  })();
  const after=db.prepare(`${predictionSelect} WHERE p.id=?`).get(row.id);
  audit(req.user.id,'prediction_settled','prediction',row.id,predictionJson(row),predictionJson(after),cleanText(req.body?.reason,200));
  res.json(predictionJson(after));
});

app.get('/api/admin/audit', requireAdmin, (_req,res) => res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC,id DESC LIMIT 500').all()));

app.get('/data/interactions.json', (_req,res) => res.status(404).end());
app.use(express.static(ROOT, { index:'index.html', dotfiles:'deny', maxAge:0, setHeaders:res=>res.setHeader('Cache-Control','no-store') }));
app.get('*path', (_req,res) => res.sendFile(`${ROOT}/index.html`));

app.use((error,_req,res,_next)=>{ console.error(error); res.status(500).json({error:'服务器内部错误'}); });

if (!config.isTest) app.listen(config.port,config.host,()=>console.log(`DG World Cup V3 listening on http://${config.host}:${config.port}`));
export default app;
