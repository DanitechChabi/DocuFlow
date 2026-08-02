const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: './.env' });

// Sections créées par défaut à la création d'une entreprise
const DEFAULT_SECTIONS = ['Comptabilité', 'Commercial', 'DAI', 'DRI', 'DGI', 'DNCMP'];

// Normalise un code entreprise : minuscules, sans accents, espaces → tirets
function normalizeSlug(value) {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

exports.register = async (req, res) => {
  const { username, password, full_name, email, section, tenant_slug } = req.body;

  // Validation de la force du mot de passe
  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  try {
    // Déterminer le tenant (slug fourni ou défaut)
    let tenantId = 1; // défaut
    if (tenant_slug) {
      try {
        const tenant = await db.query('SELECT id FROM tenants WHERE slug = $1', [tenant_slug]);
        if (tenant.rows.length === 0) {
          return res.status(400).json({ message: 'Code entreprise invalide' });
        }
        tenantId = tenant.rows[0].id;
      } catch (err) {
        if (err.code === '42P01' || err.code === '42703') {
          // Table tenants absente (mode mono-tenant) → on ignore le slug
          console.warn('[register] Table tenants absente, slug ignoré');
        } else {
          throw err;
        }
      }
    }

    // Vérifier si l'utilisateur existe déjà (avec fallback si tenant_id absent)
    let userCheck;
    try {
      userCheck = await db.query(
        'SELECT * FROM users WHERE (username = $1 OR email = $2) AND tenant_id = $3',
        [username, email, tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        userCheck = await db.query(
          'SELECT * FROM users WHERE username = $1 OR email = $2',
          [username, email]
        );
      } else {
        throw err;
      }
    }
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ message: "L'utilisateur ou l'email existe déjà" });
    }

    // Hacher le mot de passe
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insérer l'utilisateur avec le rôle 'demandeur' FORCÉ (fallback si tenant_id absent)
    let newUser;
    try {
      newUser = await db.query(
        `INSERT INTO users (tenant_id, username, password_hash, full_name, email, section, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email, role, tenant_id`,
        [tenantId, username, hashedPassword, full_name, email, section, 'demandeur']
      );
    } catch (err) {
      if (err.code === '42703') {
        newUser = await db.query(
          `INSERT INTO users (username, password_hash, full_name, email, section, role)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role`,
          [username, hashedPassword, full_name, email, section, 'demandeur']
        );
      } else {
        throw err;
      }
    }

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      user: newUser.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur lors de l'inscription" });
  }
};

exports.login = async (req, res) => {
  const { username, password, tenant_slug } = req.body;

  try {
    let userResult;
    try {
      if (tenant_slug) {
        // Connexion scoped à une entreprise (page /<code>/login)
        const tenantResult = await db.query(
          'SELECT id, status FROM tenants WHERE slug = $1',
          [tenant_slug]
        );
        const tenant = tenantResult.rows[0];
        if (!tenant) {
          return res.status(404).json({ message: 'Entreprise non trouvée' });
        }
        if (tenant.status === 'suspended') {
          return res.status(403).json({ message: 'Cette entreprise est suspendue. Contactez le support.' });
        }
        userResult = await db.query(
          'SELECT * FROM users WHERE username = $1 AND tenant_id = $2',
          [username, tenant.id]
        );
      } else {
        userResult = await db.query(
          'SELECT * FROM users WHERE username = $1',
          [username]
        );
      }
    } catch (err) {
      // Colonne tenant_id absente (base non migrée) → login sans scoping
      if (err.code === '42703') {
        userResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
      } else {
        throw err;
      }
    }
    const user = userResult.rows[0];

    if (!user) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe incorrect' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Identifiant ou mot de passe incorrect' });
    }

    // Génération du Token JWT incluant tenant_id
    // Fallback à 1 (AFGC) si la colonne n'existe pas encore (pré-migration)
    const tenantId = user.tenant_id || 1;
    const token = jwt.sign(
      { id: user.id, role: user.role, tenant_id: tenantId },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        section: user.section,
        tenant_id: tenantId
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion' });
  }
};

// Crée une entreprise + son compte super admin + réglages/sections par défaut
exports.registerCompany = async (req, res) => {
  const { company_name, slug, admin_username, admin_password, admin_full_name, admin_email, contact_email } = req.body;

  if (!company_name || !slug || !admin_username || !admin_password || !admin_full_name || !admin_email) {
    return res.status(400).json({ message: 'Tous les champs sont requis' });
  }
  if (String(admin_password).length < 6) {
    return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères' });
  }

  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return res.status(400).json({ message: 'Code entreprise invalide' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. S'assurer que les tables et contraintes nécessaires existent (migration auto)
    // Crée la table tenants si elle n'existe pas encore
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        email_domain VARCHAR(255),
        contact_email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Assurer que tenant_id existe dans users (pour les bases pré-migration)
    try {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id) DEFAULT 1`);
      await client.query(`ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL`);
    } catch (e) { /* colonne déjà présente */ }
    // Index uniques nécessaires pour ON CONFLICT
    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_tenant_name ON sections(tenant_id, name)`);
    } catch (e) { /* index déjà présent ou table absente */ }
    try {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_tenant_key ON settings(tenant_id, key)`);
    } catch (e) { /* index déjà présent ou table absente */ }

    // 2. Tenant actif
    let tenant;
    try {
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, slug, email_domain, contact_email, status)
         VALUES ($1, $2, NULL, $3, 'active')
         RETURNING id, name, slug`,
        [company_name, normalizedSlug, contact_email || null]
      );
      tenant = tenantResult.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Ce code entreprise est déjà utilisé' });
      }
      throw err;
    }

    // 3. Super admin
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(admin_password, salt);
    await client.query(
      `INSERT INTO users (tenant_id, username, password_hash, full_name, email, role)
       VALUES ($1, $2, $3, $4, $5, 'superadmin')`,
      [tenant.id, admin_username, hashedPassword, admin_full_name, admin_email]
    );

    // 4. Réglages par défaut (ON CONFLICT requiert une contrainte unique sur (tenant_id, key))
    try {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value) VALUES
          ($1, 'site_name', $2),
          ($1, 'site_description', $3)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        [tenant.id, company_name, 'Plateforme de gestion documentaire']
      );
    } catch (settingsErr) {
      if (settingsErr.code === '42710' || settingsErr.code === '23505') {
        // Contrainte unique manquante → INSERT simple
        await client.query(
          `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'site_name', $2)`,
          [tenant.id, company_name]
        );
        await client.query(
          `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'site_description', $2)`,
          [tenant.id, 'Plateforme de gestion documentaire']
        );
      } else {
        throw settingsErr;
      }
    }

    // 5. Sections par défaut (ON CONFLICT requiert une contrainte unique sur (tenant_id, name))
    for (const sectionName of DEFAULT_SECTIONS) {
      try {
        await client.query(
          'INSERT INTO sections (tenant_id, name) VALUES ($1, $2) ON CONFLICT (tenant_id, name) DO NOTHING',
          [tenant.id, sectionName]
        );
      } catch (sectionErr) {
        if (sectionErr.code === '42710' || sectionErr.code === '23505') {
          // Contrainte unique manquante → INSERT simple (ignorer les doublons)
          await client.query(
            'INSERT INTO sections (tenant_id, name) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM sections WHERE tenant_id = $1 AND name = $2)',
            [tenant.id, sectionName]
          );
        } else {
          throw sectionErr;
        }
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Entreprise créée avec succès. Votre compte administrateur est prêt.',
      slug: tenant.slug,
      name: tenant.name,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[registerCompany] Erreur détaillée:', {
      code: err.code,
      message: err.message,
      detail: err.detail,
      constraint: err.constraint,
    });
    res.status(500).json({ message: "Erreur lors de la création de l'entreprise" });
  } finally {
    client.release();
  }
};

// Infos publiques d'une entreprise + ses réglages (pour la page de connexion dédiée)
exports.getCompanyPublic = async (req, res) => {
  const { slug } = req.params;
  try {
    const tenantResult = await db.query(
      'SELECT id, name, slug, status FROM tenants WHERE slug = $1',
      [slug]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      return res.status(404).json({ message: 'Entreprise non trouvée' });
    }

    const settingsResult = await db.query(
      "SELECT key, value FROM settings WHERE tenant_id = $1 AND key IN ('site_name', 'site_description', 'site_logo')",
      [tenant.id]
    );
    const settings = {};
    settingsResult.rows.forEach((row) => { settings[row.key] = row.value; });

    if (settings.site_logo && !settings.site_logo.startsWith('http')) {
      const host = req.headers.host || '127.0.0.1:30001';
      const protocol = req.protocol || 'http';
      settings.site_logo_url = `${protocol}://${host}/uploads/${settings.site_logo}`;
    } else {
      settings.site_logo_url = settings.site_logo || null;
    }
    delete settings.site_logo;

    res.json({
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      settings,
    });
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(404).json({ message: 'Entreprise non trouvée' });
    }
    console.error(err);
    res.status(500).json({ message: "Erreur lors du chargement de l'entreprise" });
  }
};
