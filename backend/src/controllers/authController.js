const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: './.env' });

exports.register = async (req, res) => {
  const { username, password, full_name, email, section, tenant_slug } = req.body;

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
  const { username, password } = req.body;

  try {
    const userResult = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
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
