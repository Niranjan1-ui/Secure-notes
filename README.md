# Secure Notes

Full-stack notes vault: Node.js + Express + PostgreSQL, plain HTML/CSS/JS frontend.

## Run it
1. `createdb secure_notes` (or create the database in pgAdmin)
2. `cp .env.example .env` and set `DATABASE_URL` and a random `JWT_SECRET` (32+ chars)
3. `npm install`
4. `npm run db:init` (creates the tables from `schema.sql`)
5. `npm start` then open http://localhost:3000

## Note fields
title, content, category, tags, color, priority (low/normal/high), pinned, favorite, archived, trashed (soft delete), reminder date/time, created and updated timestamps.
User fields: name, email, password hash, bio, created and last login.

## Security built in
- bcrypt (cost 12) password hashing, constant-time login path, generic error messages
- JWT in an HttpOnly, SameSite=Strict cookie (Secure in production) plus double-submit CSRF token on every write
- Every note query includes `user_id`, so one user cannot read or change another's notes (no IDOR)
- All SQL is parameterized (no SQL injection), search wildcards are escaped
- Rate limits on login/register and the API, 100 KB body limit, input validation and length caps
- Helmet security headers with a strict CSP; the frontend builds the DOM with textContent only (no XSS)

## API
POST /api/auth/register | login | logout, GET/PATCH /api/auth/me
GET /api/notes?view=&category=&tag=&q=&sort=, POST /api/notes, PATCH/DELETE /api/notes/:id, DELETE /api/notes (empty trash)
GET /api/stats
