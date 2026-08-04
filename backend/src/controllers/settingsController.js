const db = require('../config/db');
const path = require('path');
const fs = require('fs');

exports.getSettings = async (req, res) => {
  const tenantId = req.user?.tenant_id || 1;

  try {
    // Tenter avec tenant_id (mode multi-tenant); fallback si colonne absente
    let result;
    try {
      result = await db.query(
        'SELECT key, value FROM settings WHERE tenant_id = $1',
        [tenantId]
      );
    } catch (err) {
      if (err.code === '42703') {
        // Colonne tenant_id absente → mode mono-tenant
        result = await db.query('SELECT key, value FROM settings');
      } else {
        throw err;
      }
    }

    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });

    // Ajouter l'URL complète du logo
    if (settings.site_logo && !settings.site_logo.startsWith('http')) {
      const host = req.headers.host || '127.0.0.1:30001';
      const protocol = req.protocol || 'http';
      settings.site_logo_url = `${protocol}://${host}/uploads/${settings.site_logo}`;
    } else {
      settings.site_logo_url = settings.site_logo || null;
    }

    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors du chargement des paramètres' });
  }
};

exports.updateSettings = async (req, res) => {
  const tenantId = req.user.tenant_id;
  const allowed = [
    'site_name', 'site_description',
    'primary_color', 'secondary_color', 'accent_color', 'dark_color', 'gold_color',
  ];

  try {
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key)) continue;

      // D'abord essayer de mettre à jour
      let result;
      try {
        result = await db.query(
          'UPDATE settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $2 AND key = $3',
          [value, tenantId, key]
        );
      } catch (err) {
        if (err.code === '42703') {
          result = await db.query(
            'UPDATE settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2',
            [value, key]
          );
        } else {
          throw err;
        }
      }

      // Si aucune ligne mise à jour, insérer
      if (result && result.rowCount === 0) {
        try {
          await db.query(
            'INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)',
            [tenantId, key, value]
          );
        } catch (err) {
          if (err.code === '42703') {
            await db.query(
              'INSERT INTO settings (key, value) VALUES ($1, $2)',
              [key, value]
            );
          } else {
            throw err;
          }
        }
      }
    }
    res.json({ message: 'Paramètres mis à jour' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur lors de la mise à jour' });
  }
};

// Types MIME autorisés pour les logos
const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5 Mo

exports.uploadLogo = async (req, res) => {
  const tenantId = req.user.tenant_id;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }

    // Validation du type de fichier
    if (!ALLOWED_LOGO_MIMES.includes(req.file.mimetype)) {
      // Supprimer le fichier rejeté
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, '../../uploads', req.file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ message: 'Type de fichier non autorisé. Formats acceptés : PNG, JPG, GIF, WebP' });
    }

    // Validation de la taille
    if (req.file.size > MAX_LOGO_SIZE) {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, '../../uploads', req.file.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ message: 'Le fichier est trop volumineux. Taille maximum : 5 Mo' });
    }

    const filename = req.file.filename;

    // Supprimer l'ancien logo si présent
    try {
      const old = await db.query(
        "SELECT value FROM settings WHERE tenant_id = $1 AND key = 'site_logo'",
        [tenantId]
      );
      if (old.rows.length > 0 && old.rows[0].value && old.rows[0].value !== filename) {
        const oldPath = path.join(__dirname, '../../uploads', old.rows[0].value);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    } catch (err) {
      if (err.code !== '42703') throw err;
    }

    // Sauvegarder le nouveau logo
    try {
      await db.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1, 'site_logo', $2)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
        [tenantId, filename]
      );
    } catch (err) {
      if (err.code === '42703') {
        await db.query(
          `INSERT INTO settings (key, value)
           VALUES ('site_logo', $1)
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
          [filename]
        );
      } else {
        throw err;
      }
    }

    const host = req.headers.host || '127.0.0.1:30001';
    const protocol = req.protocol || 'http';
    const logoUrl = `${protocol}://${host}/uploads/${filename}`;

    res.json({ message: 'Logo mis à jour', filename, url: logoUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur lors de l'upload du logo" });
  }
};
