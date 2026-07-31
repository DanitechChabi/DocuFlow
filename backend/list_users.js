const db = require('./src/config/db');

async function listUsers() {
  try {
    const result = await db.query('SELECT id, username, full_name, role FROM users;');
    console.log(JSON.stringify(result.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listUsers();
