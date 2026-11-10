-- Retour arrière de 041_courrier.sql (à appliquer à la main).
UPDATE roles SET permissions = array_remove(array_remove(array_remove(permissions, 'mail.view'), 'mail.register'), 'mail.manage');
ALTER TABLE notifications DROP COLUMN IF EXISTS lien;
DROP TABLE IF EXISTS courrier_evenements;
DROP TABLE IF EXISTS courrier_compteurs;
DROP TABLE IF EXISTS courriers;
