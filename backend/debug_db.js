const db = require('./src/config/db');

async function debug() {
  try {
    console.log('--- Listing Tables ---');
    const tables = await db.query(`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname != 'pg_catalog'
      AND schemaname != 'information_schema';
    `);
    console.log(tables.rows);
    process.exit(0);
  } catch (err) {
    console.error('Debug failed:', err);
    process.exit(1);
  }
}

debug();
