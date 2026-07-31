const db = require('./src/config/db');

async function debug() {
  try {
    console.log('--- Checking Users ---');
    const users = await db.query('SELECT id, username, role FROM users');
    console.log(users.rows);

    console.log('\n--- Checking Requests ---');
    const requests = await db.query('SELECT id, id_user, nom_entreprise, statut FROM requests');
    console.log(requests.rows);

    console.log('\n--- Checking Audit Logs ---');
    const logs = await db.query('SELECT id, request_id, action FROM audit_logs LIMIT 10');
    console.log(logs.rows);

    process.exit(0);
  } catch (err) {
    console.error('Debug failed:', err);
    process.exit(1);
  }
}

debug();
