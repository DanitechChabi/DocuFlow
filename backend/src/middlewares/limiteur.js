// ============================================================================
// limiteur — limitation de débit en mémoire, par adresse IP, pour les routes
// publiques (portail citoyen, vérification des copies). Un seul processus :
// suffisant pour freiner un robot ; derrière plusieurs instances, chacune
// compte pour elle.
// ============================================================================
function limiteur({ max, fenetreMs, message = 'Trop de requêtes : réessayez dans quelques minutes.' }) {
  const passages = new Map();
  setInterval(() => {
    const limite = Date.now() - fenetreMs;
    for (const [ip, t] of passages) {
      const restants = t.filter((x) => x > limite);
      if (restants.length) passages.set(ip, restants); else passages.delete(ip);
    }
  }, fenetreMs).unref();
  return (req, res, next) => {
    const ip = req.ip || 'inconnue';
    const limite = Date.now() - fenetreMs;
    const t = (passages.get(ip) || []).filter((x) => x > limite);
    if (t.length >= max) return res.status(429).json({ message });
    t.push(Date.now());
    passages.set(ip, t);
    return next();
  };
}

module.exports = { limiteur };
