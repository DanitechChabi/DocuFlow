const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

// SSL : `DB_SSL=true` l'active explicitement. Pour les hôtes cloud qui
// l'exigent (Neon, Supabase…), on le détecte automatiquement — évite un oubli
// qui ferait échouer toutes les requêtes en production. Local : pas de SSL.
const dbHost = process.env.DB_HOST || '';
const ssl =
  process.env.DB_SSL === 'true' || /neon\.tech$/i.test(dbHost)
    ? { rejectUnauthorized: false }
    : false;

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
