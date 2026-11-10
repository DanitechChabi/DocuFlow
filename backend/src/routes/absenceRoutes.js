// ============================================================================
// Absence et suppléance (migration 042), sous /api/absence.
//   GET / PUT / DELETE /            la mienne
//   GET /collegues                  suppléants possibles
//   PUT / DELETE /utilisateurs/:id  celle d'un autre (users.edit : un agent
//                                   parti sans la déclarer)
// ============================================================================
const express = require('express');
const router = express.Router();
const absence = require('../services/absenceService');
const auth = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/requirePermission');

router.use(auth);
const repondre = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (err) {
    if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message });
    console.error('[absence]', err);
    return res.status(500).json({ message: 'Absence non enregistrée' });
  }
};
const cible = async (req) => {
  const id = Number(req.params.id);
  const db = require('../config/db');
  if (!(await db.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2', [id, req.user.tenant_id])).rows[0]) {
    throw Object.assign(new Error('Utilisateur introuvable.'), { status: 404 });
  }
  return id;
};

router.get('/', repondre(async (req) => ({ absence: await absence.etat(req.user.tenant_id, req.user.id) })));
router.get('/collegues', repondre((req) => absence.collegues(req.user.tenant_id, req.user.id)));
router.put('/', repondre(async (req) => ({ absence: await absence.definir(req.user.tenant_id, req.user.id, req.body || {}, req.user.id) })));
router.delete('/', repondre(async (req) => ({ absence: await absence.lever(req.user.tenant_id, req.user.id) })));
router.put('/utilisateurs/:id', requirePermission('users.edit'), repondre(async (req) => ({ absence: await absence.definir(req.user.tenant_id, await cible(req), req.body || {}, req.user.id) })));
router.delete('/utilisateurs/:id', requirePermission('users.edit'), repondre(async (req) => ({ absence: await absence.lever(req.user.tenant_id, await cible(req)) })));

module.exports = router;
