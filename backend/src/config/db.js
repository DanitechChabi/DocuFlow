const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

// SSL requis par Neon/Cloud-hosted (production). `DB_SSL=true` active une
// connexion chiffrée. En local (PostgreSQL classique sans SSL), on laisse false.
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  ssl,
});

pool.on('connect', () => {
  console.log('Successfully connected to the PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
