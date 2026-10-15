require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(fs.readFileSync(__dirname + '/schema.sql', 'utf8'))
  .then(() => { console.log('Database ready.'); return pool.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
