require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const { DATABASE_URL, JWT_SECRET } = process.env;
if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set DATABASE_URL and a JWT_SECRET of at least 32 characters in .env');
  process.exit(1);
}
const isProd = process.env.NODE_ENV === 'production';
const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ["https://fonts.gstatic.com"],
    imgSrc: ["'self'", 'data:'],
    scriptSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  } },
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use('/api', apiLimiter);

// ---------- helpers ----------
const COLORS = ['sand', 'rose', 'sky', 'mint', 'lilac', 'amber'];
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
  const csrf = crypto.randomBytes(24).toString('hex');
  const base = { sameSite: 'strict', secure: isProd, maxAge: 7 * 864e5 };
  res.cookie('sn_token', token, { ...base, httpOnly: true });
  res.cookie('sn_csrf', csrf, { ...base, httpOnly: false });
}
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, bio: u.bio, created_at: u.created_at, last_login: u.last_login });

// CSRF: double-submit token required on every state-changing request
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies.sn_csrf, header = req.get('x-csrf-token');
  if (req.path === '/auth/login' || req.path === '/auth/register') return next();
  if (!cookie || !header || cookie.length !== header.length ||
      !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header)))
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  next();
}
app.use('/api', csrfGuard);

function requireAuth(req, res, next) {
  try { req.userId = jwt.verify(req.cookies.sn_token || '', JWT_SECRET).sub; next(); }
  catch { res.status(401).json({ error: 'Please sign in.' }); }
}

// ---------- auth ----------
app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 160).toLowerCase(), password = req.body.password;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter your name and a valid email.' });
  if (typeof password !== 'string' || password.length < 10 || password.length > 128)
    return res.status(400).json({ error: 'Password must be 10 to 128 characters.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, last_login) VALUES ($1,$2,$3,NOW()) RETURNING *', [name, email, hash]);
    setSession(res, rows[0]);
    res.status(201).json(publicUser(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    throw e;
  }
}));

const DUMMY_HASH = bcrypt.hashSync('dummy-password', 12);
app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = str(req.body.email, 160).toLowerCase(), password = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const ok = await bcrypt.compare(password, rows[0] ? rows[0].password_hash : DUMMY_HASH);
  if (!rows[0] || !ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [rows[0].id]);
  setSession(res, rows[0]);
  res.json(publicUser(rows[0]));
}));

app.post('/api/auth/logout', (req, res) => { res.clearCookie('sn_token'); res.clearCookie('sn_csrf'); res.json({ ok: true }); });

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) return res.status(401).json({ error: 'Please sign in.' });
  res.json(publicUser(rows[0]));
}));

app.patch('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const name = str(req.body.name, 80), bio = str(req.body.bio, 240);
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const { rows } = await pool.query('UPDATE users SET name=$1, bio=$2 WHERE id=$3 RETURNING *', [name, bio, req.userId]);
  res.json(publicUser(rows[0]));
}));

// ---------- notes ----------
function cleanNote(b, partial = false) {
  const out = {};
  if (!partial || 'title' in b) { out.title = str(b.title, 160); if (!out.title) throw Object.assign(new Error('Title is required.'), { status: 400 }); }
  if (!partial || 'content' in b) out.content = typeof b.content === 'string' ? b.content.slice(0, 20000) : '';
  if (!partial || 'category' in b) out.category = str(b.category, 40) || 'General';
  if (!partial || 'tags' in b) out.tags = (Array.isArray(b.tags) ? b.tags : []).map(t => str(t, 24).toLowerCase()).filter(Boolean).slice(0, 8);
  if (!partial || 'color' in b) out.color = COLORS.includes(b.color) ? b.color : 'sand';
  if (!partial || 'priority' in b) out.priority = [0, 1, 2].includes(Number(b.priority)) ? Number(b.priority) : 1;
  for (const k of ['pinned', 'favorite', 'archived', 'trashed']) if (!partial || k in b) out[k] = b[k] === true;
  if (!partial || 'reminder_at' in b) {
    const d = b.reminder_at ? new Date(b.reminder_at) : null;
    out.reminder_at = d && !isNaN(d) ? d.toISOString() : null;
  }
  return out;
}

app.get('/api/notes', requireAuth, wrap(async (req, res) => {
  const where = ['user_id = $1'], params = [req.userId];
  const view = req.query.view || 'all';
  if (view === 'trash') where.push('trashed = TRUE');
  else {
    where.push('trashed = FALSE');
    if (view === 'archived') where.push('archived = TRUE');
    else where.push('archived = FALSE');
    if (view === 'pinned') where.push('pinned = TRUE');
    if (view === 'favorites') where.push('favorite = TRUE');
    if (view === 'reminders') where.push('reminder_at IS NOT NULL');
  }
  if (req.query.category) { params.push(String(req.query.category).slice(0, 40)); where.push(`category = $${params.length}`); }
  if (req.query.tag) { params.push(String(req.query.tag).slice(0, 24)); where.push(`$${params.length} = ANY(tags)`); }
  if (req.query.q) {
    const like = '%' + String(req.query.q).slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';
    params.push(like);
    where.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
  }
  const sorts = { updated: 'updated_at DESC', created: 'created_at DESC', title: 'LOWER(title) ASC', priority: 'priority DESC, updated_at DESC' };
  const order = sorts[req.query.sort] || sorts.updated;
  const { rows } = await pool.query(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY pinned DESC, ${order} LIMIT 500`, params);
  res.json(rows);
}));

app.get('/api/stats', requireAuth, wrap(async (req, res) => {
  const [t, c, g] = await Promise.all([
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE NOT trashed AND NOT archived) AS total,
      COUNT(*) FILTER (WHERE NOT trashed AND pinned) AS pinned,
      COUNT(*) FILTER (WHERE NOT trashed AND favorite) AS favorites,
      COUNT(*) FILTER (WHERE NOT trashed AND archived) AS archived,
      COUNT(*) FILTER (WHERE trashed) AS trash,
      COUNT(*) FILTER (WHERE NOT trashed AND reminder_at > NOW()) AS reminders
      FROM notes WHERE user_id = $1`, [req.userId]),
    pool.query(`SELECT category, COUNT(*)::int AS n FROM notes WHERE user_id=$1 AND NOT trashed AND NOT archived GROUP BY category ORDER BY n DESC`, [req.userId]),
    pool.query(`SELECT t AS tag, COUNT(*)::int AS n FROM notes, UNNEST(tags) t WHERE user_id=$1 AND NOT trashed GROUP BY t ORDER BY n DESC LIMIT 12`, [req.userId]),
  ]);
  res.json({ counts: t.rows[0], categories: c.rows, tags: g.rows });
}));

app.post('/api/notes', requireAuth, wrap(async (req, res) => {
  const n = cleanNote(req.body);
  const { rows } = await pool.query(
    `INSERT INTO notes (user_id,title,content,category,tags,color,priority,pinned,favorite,archived,trashed,reminder_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.userId, n.title, n.content, n.category, n.tags, n.color, n.priority, n.pinned, n.favorite, n.archived, n.trashed, n.reminder_at]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/notes/:id(\\d+)', requireAuth, wrap(async (req, res) => {
  const n = cleanNote(req.body, true);
  const keys = Object.keys(n);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update.' });
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  // ownership enforced in the query itself (prevents IDOR)
  const { rows } = await pool.query(
    `UPDATE notes SET ${sets}, updated_at = NOW() WHERE id = $${keys.length + 1} AND user_id = $${keys.length + 2} RETURNING *`,
    [...keys.map(k => n[k]), req.params.id, req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Note not found.' });
  res.json(rows[0]);
}));

app.delete('/api/notes/:id(\\d+)', requireAuth, wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM notes WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  if (!rowCount) return res.status(404).json({ error: 'Note not found.' });
  res.json({ ok: true });
}));

app.delete('/api/notes', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM notes WHERE user_id=$1 AND trashed = TRUE', [req.userId]);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(process.env.PORT || 3000, () => console.log('Secure Notes running on http://localhost:' + (process.env.PORT || 3000)));
