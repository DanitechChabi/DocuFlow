const path = require('path');
const { Pool } = require('pg');

// Chemin ABSOLU vers backend/.env, et non './.env' : ce dernier est résolu
// depuis le répertoire de travail du processus. Lancé d'ailleurs que `backend/`
// (script à la racine du dépôt, tâche planifiée, outil de migration), dotenv ne
// trouvait aucun fichier, `DATABASE_URL` restait indéfinie et le pool basculait
// silencieusement sur localhost sans SSL — donc sur une autre base que celle de
// l'application, sans le moindre message.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// SSL : `DB_SSL=true` l'active explicitement. Pour les hôtes cloud qui
// l'exigent (Neon, Supabase…), on le détecte automatiquement — évite un oubli
// qui ferait échouer toutes les requêtes en production. Local : pas de SSL.
const dbHost = process.env.DB_HOST || '';
const ssl =
  process.env.DB_SSL === 'true' || /neon\.tech$/i.test(dbHost) || !!process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false;

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl }
  : {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      ssl,
    };

const pool = new Pool(poolConfig);

// Aucune information de connexion : sans cet avertissement, `pg` se rabat sur
// localhost et l'erreur ne se manifeste qu'au premier échec de requête, très
// loin de sa cause. En production (NODE_ENV=production) l'absence de
// DATABASE_URL est une faute de configuration franche : on la signale fort.
if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
  const message =
    '[db] Ni DATABASE_URL ni DB_HOST ne sont définis — connexion tentée sur localhost. ' +
    'Vérifier backend/.env ou les variables d\'environnement de la plateforme.';
  if (process.env.NODE_ENV === 'production') console.error(message);
  else console.warn(message);
}

pool.on('connect', () => {
  console.log('Successfully connected to the PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err.message);
  // Don't crash on transient pool errors (e.g. Neon idle disconnects).
  // Only exit if the pool is completely broken.
  console.warn('[db] Pool idle error — will recover on next query');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  // Exporté pour les transactions (BEGIN/COMMIT/ROLLBACK via pool.connect())
  pool,
};
