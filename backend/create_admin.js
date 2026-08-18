const db = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function createAdmin() {
  try {
    const passwordHash = await bcrypt.hash('Admin123!', 10);
    await db.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, section, role)
       VALUES (1, 'admin', $1, 'Super Admin', 'admin@afgc.com', 'Informatique', 'superadmin')`,
      [passwordHash]
    );
    console.log('✅ Admin user created successfully.');
    process.exit(0);
  } catch (err) {
    if (err.code === '23505') {
      console.log('ℹ️  Admin user already exists.');
      process.exit(0);
    } else {
      console.error('❌ Failed to create admin user:', err);
      process.exit(1);
    }
  }
}

createAdmin();
