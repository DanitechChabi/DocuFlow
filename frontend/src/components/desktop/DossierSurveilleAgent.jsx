import { useEffect, useRef } from 'react';
import { documentService } from '../../services/documentService';
import { toast } from '../Toast';

/** Événement émis après chaque lot versé : les listes « À indexer » se rechargent. */
export const SCANS_IMPORTES_EVENT = 'docuflow:scans-importes';

/**
 * Agent du dossier surveillé (application de bureau uniquement).
 *
 * Le processus principal guette le dossier de dépôt et signale chaque fichier
 * COMPLET ; cet agent le verse dans DocuFlow AU NOM de l'utilisateur connecté
 * (même chemin qu'un téléversement en masse : statut « À indexer », texte et
 * OCR extraits par le serveur), puis dit au guetteur de le ranger.
 *
 * Monté par AppLayout tant qu'une session autorisée à verser est ouverte : la
 * surveillance est « armée » au montage et désarmée au démontage (déconnexion),
 * de sorte qu'aucun scan n'est versé sans responsable.
 *
 * Échecs : un refus qui tient au FICHIER (type, taille) compte un essai — au
 * troisième, le guetteur le range dans « _Non importés » avec la raison. Une
 * panne réseau, une erreur serveur ou un droit manquant ne disent rien du
 * fichier : nouvel essai sans le compter, le scan n'est jamais perdu.
 */
const DossierSurveilleAgent = () => {
  const file = useRef([]);
  const enCours = useRef(false);
  const lot = useRef({ ok: 0, ko: 0, minuterie: null });

  useEffect(() => {
    const api = window.desktopApp?.dossierSurveille;
    if (!api) return undefined;
    let vivant = true;

    // Un message par lot, pas un par page : un scanner à chargeur en dépose
    // vingt d'affilée.
    const annoncer = () => {
      clearTimeout(lot.current.minuterie);
      lot.current.minuterie = setTimeout(() => {
        const { ok, ko } = lot.current;
        lot.current.ok = 0;
        lot.current.ko = 0;
        if (ok) {
          toast.success(`${ok} scan${ok > 1 ? 's' : ''} importé${ok > 1 ? 's' : ''} depuis le dossier surveillé — à indexer`);
          window.dispatchEvent(new CustomEvent(SCANS_IMPORTES_EVENT, { detail: { nombre: ok } }));
        }
        if (ko) toast.error(`${ko} fichier${ko > 1 ? 's' : ''} du dossier surveillé n'${ko > 1 ? 'ont' : 'a'} pas pu être importé${ko > 1 ? 's' : ''}. Détail dans « À indexer ».`);
      }, 1500);
    };

    const verser = async ({ chemin, nom }) => {
      try {
        const { type, donnees } = await api.lire(chemin);
        const config = await api.config();
        const fd = new FormData();
        fd.append('bulkUpload', 'true');
        if (config?.dossierGedId) fd.append('dossier_id', String(config.dossierGedId));
        fd.append('files', new File([donnees], nom, { type }));
        const res = await documentService.createDocument(fd);
        if (res?.created?.length) {
          await api.confirmer(chemin, { ok: true });
          lot.current.ok += 1;
        } else {
          const raison = res?.rejected?.[0]?.reason || res?.rejected?.[0]?.error || res?.message || 'Fichier refusé par le serveur.';
          await api.confirmer(chemin, { ok: false, raison });
          lot.current.ko += 1;
        }
      } catch (err) {
        const statut = err.response?.status;
        const raison = err.response?.data?.message || err.message || 'Versement impossible.';
        // 400, 413, 415… : le fichier est en cause. 401/403 (session, droits),
        // 5xx et réseau : non — on réessaiera.
        const transitoire = !statut || statut >= 500 || statut === 401 || statut === 403 || statut === 429;
        await api.confirmer(chemin, { ok: false, raison, transitoire }).catch(() => {});
        if (!transitoire) lot.current.ko += 1;
      }
      annoncer();
    };

    const traiter = async () => {
      if (enCours.current) return;
      enCours.current = true;
      while (vivant && file.current.length) await verser(file.current.shift());
      enCours.current = false;
    };

    const desabonner = api.surFichier((f) => {
      if (file.current.some((x) => x.chemin === f.chemin)) return;
      file.current.push(f);
      traiter();
    });
    api.armer(true).catch(() => {});

    return () => {
      vivant = false;
      desabonner?.();
      file.current = [];
      api.armer(false).catch(() => {});
    };
  }, []);

  return null;
};

export default DossierSurveilleAgent;
