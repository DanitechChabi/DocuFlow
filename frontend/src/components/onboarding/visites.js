/**
 * Visites guidées, une par module — construites d'après ce que l'utilisateur
 * PEUT faire (permissions effectives de son rôle), pas d'après son nom de rôle.
 *
 * Une étape sans `selector` s'affiche au centre de l'écran (accueil, conclusion).
 * Une étape dont la cible est absente de l'écran (menu replié sur téléphone,
 * fonction masquée par l'organisation) est sautée sans bruit par OnboardingTour.
 *
 * Contenu court, à l'impératif, ancré dans les vrais gestes de l'application :
 * une visite qui décrit des écrans qui n'existent plus (« remplissez entreprise,
 * dossier, acte… ») fait plus de mal que pas de visite.
 */

/** Module de la page courante, ou null hors des trois espaces guidés. */
export function moduleDeLaPage(pathname) {
  if (pathname === '/') return 'accueil';
  if (pathname.startsWith('/demandes') || pathname.startsWith('/dashboard')) return 'demandes';
  if (pathname.startsWith('/documents')) return 'documents';
  return null;
}

const REVOIR = {
  id: 'revoir',
  selector: '[data-tour="profile"]',
  title: 'Revoir cette visite',
  content: 'Elle est disponible à tout moment depuis votre menu, rubrique « Revoir le tour guidé ». Chaque espace a la sienne.',
  position: 'top',
};

function visiteAccueil({ can, prenom, organisation }) {
  const etapes = [{
    id: 'bienvenue',
    title: `Bienvenue${prenom ? `, ${prenom}` : ''} 👋`,
    content: `DocuFlow${organisation ? ` de ${organisation}` : ''} réunit vos demandes de documents et le fonds documentaire. Une minute pour faire le tour.`,
  }];
  if (can('requests.view')) {
    etapes.push({
      id: 'module-demandes', selector: '[data-tour="module-demandes"]', position: 'bottom',
      title: 'Demandes',
      content: can('requests.process')
        ? 'Les demandes de toute l\'organisation arrivent ici : vous les traitez, remettez les dossiers et suivez leur retour.'
        : 'Besoin d\'un document ou d\'un dossier ? Demandez-le ici en une phrase, puis suivez son avancement.',
    });
  }
  if (can('documents.view')) {
    etapes.push({
      id: 'module-documents', selector: '[data-tour="module-documents"]', position: 'bottom',
      title: 'Documents',
      content: 'Le fonds documentaire numérique : dossiers, versions, métadonnées, recherche dans le contenu.',
    });
  }
  if (can('search.documents')) {
    etapes.push({
      id: 'recherche', selector: '[data-tour="topbar-search"]', position: 'bottom',
      title: 'Rechercher partout',
      content: 'Ctrl+K depuis n\'importe quel écran : un document, une demande, en quelques lettres.',
    });
  }
  etapes.push({
    id: 'notifications', selector: '[data-tour="notifications"]', position: 'bottom',
    title: 'Vous êtes prévenu',
    content: 'Une demande avance, un dossier vous est remis, un retour est attendu : la cloche vous le dit, et un e-mail aussi.',
  });
  etapes.push(REVOIR);
  return etapes;
}

function visiteDemandes({ can }) {
  const traite = can('requests.process');
  const etapes = [];
  if (can('requests.create')) {
    etapes.push({
      id: 'nouvelle-demande', selector: '[data-tour="new-request"]', position: 'bottom',
      title: 'Demander un document',
      content: 'Décrivez simplement ce qu\'il vous faut — « le dossier du personnel de M. X » suffit. Les références exactes sont facultatives.',
    });
  }
  etapes.push({
    id: 'mes-demandes', selector: '[data-tour="mes-demandes"]', position: 'right',
    title: 'Suivre mes demandes',
    content: 'Chaque demande y montre son étape. « Redemander » relance la même en un clic.',
  });
  if (traite) {
    etapes.push({
      id: 'a-traiter', selector: '[data-tour="a-traiter"]', position: 'right',
      title: 'À traiter',
      content: 'Les demandes qui vous sont assignées. Ouvrez-en une pour la faire avancer, chercher le document ou remettre le dossier.',
    });
    etapes.push({
      id: 'toutes-demandes', selector: '[data-tour="toutes-demandes"]', position: 'right',
      title: 'Toutes les demandes',
      content: 'Vue d\'ensemble de l\'organisation, filtrable par statut. C\'est d\'ici qu\'on assigne.',
    });
    etapes.push({
      id: 'registre-prets', selector: '[data-tour="registre-prets"]', position: 'right',
      title: 'Registre des prêts',
      content: 'Remplace le registre papier : qui a quel dossier, jusqu\'à quand, ce qui est en retard. Imprimable. La remise se fait depuis la fiche d\'une demande.',
    });
  } else {
    etapes.push({
      id: 'dossier-papier',
      title: 'Un dossier papier vous est remis ?',
      content: 'Vous êtes prévenu, avec la date de retour. Rien à signer : si vous ne l\'avez pas reçu, signalez-le depuis la demande. Au retour, vous recevez votre décharge.',
    });
  }
  etapes.push(REVOIR);
  return etapes;
}

function visiteDocuments({ can }) {
  const etapes = [{
    id: 'liste-documents', selector: '[data-tour="documents"]', position: 'right',
    title: 'Le fonds documentaire',
    content: 'Tous les documents auxquels votre rôle donne accès, avec leurs versions et leur historique.',
  }];
  if (can('documents.upload')) {
    etapes.push({
      id: 'nouveau-document', selector: '[data-tour="nouveau-document"]', position: 'bottom',
      title: 'Verser un document',
      content: 'Ajoutez un ou plusieurs fichiers ; le texte est extrait pour la recherche. Un scan joint à une demande livrée arrive aussi ici.',
    });
  }
  if (can('folders.view')) {
    etapes.push({
      id: 'dossiers', selector: '[data-tour="dossiers"]', position: 'bottom',
      title: 'Les dossiers',
      content: 'L\'arborescence de classement. Un dossier peut être restreint à certains rôles ou personnes (bouclier).',
    });
  }
  if (can('documents.index')) {
    etapes.push({
      id: 'a-indexer', selector: '[data-tour="a-indexer"]', position: 'right',
      title: 'À indexer',
      content: 'Les documents versés en masse ou issus d\'une demande, qui attendent leurs métadonnées.',
    });
  }
  if (can('compliance.view')) {
    etapes.push({
      id: 'conformite', selector: '[data-tour="conformite"]', position: 'right',
      title: 'Conformité',
      content: 'Chaque document versé est lu (émetteur, montants, dates) puis contrôlé avec les autres : facture hors devis, attestation expirée, numéro d\'entreprise incohérent.',
    });
  }
  etapes.push({
    id: 'favoris', selector: '[data-tour="favoris"]', position: 'right',
    title: 'Vos favoris et vos suivis',
    content: 'L\'étoile d\'une fiche garde un document à portée de main ; la cloche vous prévient de ses nouvelles versions, de ses changements de statut et des commentaires où l\'on vous mentionne.',
  });
  etapes.push({
    id: 'taches', selector: '[data-tour="taches"]', position: 'right',
    title: 'Mes tâches',
    content: 'Les documents qui attendent votre visa dans un circuit de validation. Votre approbation enregistre l\'empreinte exacte de la version visée.',
  });
  if (can('search.advanced')) {
    etapes.push({
      id: 'recherche', selector: '[data-tour="recherche"]', position: 'right',
      title: 'Recherche avancée',
      content: 'Combinez le texte des fichiers, la classe et ses propriétés, le dossier, les dates. Enregistrez une recherche et activez son alerte : vous serez prévenu des nouveaux documents.',
    });
  }
  etapes.push({
    id: 'echeances', selector: '[data-tour="echeances"]', position: 'right',
    title: 'Échéancier',
    content: 'Fins de contrat, validités d\'attestation, factures à payer : les dates à ne pas manquer, avec un rappel avant l\'échéance.',
  });
  if (can('archives.view')) {
    etapes.push({
      id: 'archivage', selector: '[data-tour="archivage"]', position: 'right',
      title: 'Archivage & preuve',
      content: 'Chaque fichier porte son empreinte SHA-256 et il est relu régulièrement. Le journal est chaîné et scellé, et un gel juridique interdit toute destruction le temps d\'un contentieux. Un certificat d\'archivage s\'émet depuis la fiche ; les durées de conservation mènent aux bordereaux d\'élimination, validés par une autre personne.',
    });
  }
  etapes.push({
    id: 'corbeille', selector: '[data-tour="corbeille"]', position: 'right',
    title: 'Rien ne disparaît d\'un clic',
    content: 'Un document supprimé passe d\'abord par la corbeille, d\'où il se restaure. Tout est tracé dans le journal.',
  });
  etapes.push(REVOIR);
  return etapes;
}

/** Étapes de la visite d'un module pour cet utilisateur. */
export function construireVisite(module, contexte) {
  if (module === 'accueil') return visiteAccueil(contexte);
  if (module === 'demandes') return visiteDemandes(contexte);
  if (module === 'documents') return contexte.can('documents.view') ? visiteDocuments(contexte) : [];
  return [];
}
