const db = require('./src/config/db');

async function promoteAdmin() {
  try {
    await db.query("UPDATE users SET role = 'superadmin' WHERE username = 'admin';");
    console.log('User "admin" has been promoted to superadmin successfully.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

promoteAdmin();
