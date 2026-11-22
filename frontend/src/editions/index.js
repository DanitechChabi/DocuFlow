import {
  GraduationCap, ArchiveX, UserPlus, BookMarked, DatabaseZap,
  LayoutDashboard, PlusCircle, FileSearch, ClipboardList, BookOpenCheck, Mail, Warehouse, FolderOpen, Table2, PackageOpen, ScanBarcode, BarChart3, Users, Settings2,
} from 'lucide-react';

/**
 * Éditions dédiées de DocuFlow : un même code, des sites distincts.
 *
 * L'édition se choisit AU BUILD par VITE_EDITION (ex. VITE_EDITION=afgc sur le
 * projet Vercel de l'AFGC). Sans cette variable, rien ne change : c'est la
 * plateforme DocuFlow générale, web comme bureau.
 *
 * Une édition fixe trois choses, et seulement celles-là :
 *  - l'organisation : la connexion ouvre directement son espace, sans code
 *    d'entreprise à saisir ;
 *  - la marque (nom, logo, couleurs), qui prime sur les réglages chargés ;
 *  - le menu et l'accueil, réduits à ce que cette organisation utilise.
 * Routes, API, permissions et isolation des données restent celles de DocuFlow :
 * une page absente du menu reste protégée par ses permissions, rien de plus.
 */
const EDITIONS = {
  afgc: {
    id: 'afgc',
    // Slug de l'espace AFGC dans DocuFlow (tenant).
    organisation: 'afgc',
    nomCourt: 'AFGC',
    nomLong: "L'Africaine des Garanties et du Cautionnement",
    // Clés de réglages appliquées par-dessus celles du serveur. Couleurs du site
    // de l'AFGC : vert #2C9C0A, jaune #F8D500, bleu nuit #091422.
    reglages: {
      site_name: 'AFGC Archives',
      site_description: "L'Africaine des Garanties et du Cautionnement — demandes et suivi des dossiers",
      site_logo_url: '/editions/afgc/embleme-tuile.png',
      site_favicon_url: '/editions/afgc/embleme.png',
      primary_color: '#091422',
      secondary_color: '#2C9C0A',
      dark_color: '#13263d',
      gold_color: '#F8D500',
      accent_color: '#f8fafc',
    },
    // Cartouche sombre de l'écran de connexion : emblème en blanc.
    logoConnexion: '/editions/afgc/embleme-blanc.png',
    // Emblème en couleurs, pour les fonds clairs (accueil).
    embleme: '/editions/afgc/embleme.png',
    // Étiquettes à code-barres des dossiers entrés (053) : désactivées pour
    // l'instant. La douchette reste utilisable avec le n° d'acte tapé.
    // Passer à true pour rendre l'impression des étiquettes.
    etiquettes: false,
    // Menu par usage : chaque entrée garde la permission de sa route ; une
    // rubrique sans entrée accessible ne s'affiche pas (un agent ne voit que
    // « Demandes »).
    menu: [
      { to: '/', label: 'Accueil', icone: LayoutDashboard, end: true },
      { section: 'Demandes', to: '/demandes/nouvelle', label: 'Demander un dossier', icone: PlusCircle, permission: 'requests.create' },
      { section: 'Demandes', to: '/demandes/mes-demandes', label: 'Mes dossiers', icone: FileSearch, permission: 'requests.view' },
      { section: 'Au quotidien', to: '/demandes/a-traiter', label: 'À traiter', icone: ClipboardList, permission: 'requests.process' },
      { section: 'Au quotidien', to: '/archives/douchette', label: 'Douchette', icone: ScanBarcode, permission: 'requests.process' },
      { section: 'Au quotidien', to: '/demandes/prets', label: 'Dossiers sortis', icone: BookOpenCheck, permission: 'requests.process' },
      { section: 'Au quotidien', to: '/courrier', label: 'Courrier', icone: Mail, permission: 'mail.view' },
      { section: 'Les fonds', to: '/archives/entrees', label: 'Entrée des dossiers', icone: PackageOpen, permission: 'requests.process' },
      { section: 'Les fonds', to: '/archives/non-retires', label: 'Non retirés / annulés', icone: ArchiveX, permission: 'requests.process' },
      { section: 'Les fonds', to: '/archives/ouvertures-compte', label: 'Ouvertures de compte', icone: UserPlus, permission: 'requests.process' },
      { section: 'Les fonds', to: '/archives/plan', label: 'Plan de classement', icone: BookMarked, permission: 'requests.process' },
      { section: 'Les fonds', to: '/archives/mfiles', label: 'Recherche M-Files', icone: DatabaseZap, permission: 'requests.process' },
      { section: 'Les fonds', to: '/documents/liste', label: 'Dossiers numérisés', icone: FolderOpen, permission: 'documents.view' },
      { section: 'Les fonds', to: '/documents/magasins', label: 'Boîtes et rayonnages', icone: Warehouse, permission: 'documents.view' },
      { section: 'Les fonds', to: '/documents/saisie', label: 'Saisie et import Excel', icone: Table2, permission: 'documents.index' },
      { section: 'Pilotage', to: '/archives/tableau-de-bord', label: 'Tableau de bord', icone: BarChart3, permission: 'requests.process' },
      { section: 'Pilotage', to: '/archives/docubot', label: 'DocuBot apprend', icone: GraduationCap, permission: 'requests.process' },
      { section: 'Administration', to: '/admin/comptes', label: 'Comptes', icone: Users, permission: 'users.view' },
      { section: 'Administration', to: '/admin/reglages', label: 'Réglages', icone: Settings2, permission: 'settings.manage' },
    ],
    // Départements dont les demandes suivent des motifs habituels : ces motifs
    // sont proposés en premier — le premier d'entre eux par défaut — à leurs
    // agents, et à l'archive qui enregistre une demande en leur nom. Le
    // département d'un agent se lit dans sa section (« DE — Engagement »,
    // « Engagements », « DE »…).
    // Ce qu'une demande doit comporter selon la typologie (mêmes règles que le
    // serveur, backend/src/config/editions.js) : l'archive retrouve le dossier
    // sans rappeler le demandeur.
    exigences: {
      'Bonne exécution (CBE)': ['nom_entreprise', 'num_acte'],
      'Avance de démarrage (CAD)': ['nom_entreprise', 'num_acte'],
      'Caution professionnelle (CP)': ['nom_entreprise', 'num_acte'],
      'Caution douanière (CD)': ['nom_entreprise', 'num_acte'],
      'Prêt': ['nom_entreprise', 'annee'],
      'Garantie bancaire': ['nom_entreprise', 'banque', 'annee'],
    },
    departements: [
      { sigle: 'DC', nom: 'Commercial', motifs: ['Consultation', 'Prorogation', 'Actualisation', 'Renouvellement'] },
      { sigle: 'DE', nom: 'Engagement', motifs: ['Restitution de provision', 'Solde créditeur', 'Levée d\'engagement'] },
    ],
    // Espaces sans visite guidée automatique : l'édition en remplace les écrans,
    // dont les phrases d'aide suffisent.
    visitesMasquees: ['accueil', 'demandes'],
    // « Demander un dossier » derrière Ctrl+K et la barre du haut.
    demandeRapide: () => import('../pages/editions/afgc/DemandeRapideAfgc'),
    // Page d'accueil propre à l'édition, chargée à la demande.
    accueil: () => import('../pages/editions/AccueilAfgc'),
    // Écrans propres à l'édition, à la place de ceux de DocuFlow aux mêmes
    // adresses : mêmes routes, mêmes permissions, vocabulaire de l'AFGC
    // (Demandé → Transmis → Retourné) et listes de dossiers.
    // Écrans propres à l'édition, à des adresses nouvelles.
    routes: {
      '/archives/entrees': () => import('../pages/editions/afgc/EntreesAfgc'),
      '/archives/douchette': () => import('../pages/editions/afgc/DouchetteAfgc'),
      '/archives/tableau-de-bord': () => import('../pages/editions/afgc/TableauBordAfgc'),
      '/archives/docubot': () => import('../pages/editions/afgc/DocubotApprendAfgc'),
      '/archives/non-retires': () => import('../pages/editions/afgc/CartonsAfgc'),
      '/archives/ouvertures-compte': () => import('../pages/editions/afgc/CartonsAfgc'),
      '/archives/cartons': () => import('../pages/editions/afgc/CartonsAfgc'),
      '/archives/plan': () => import('../pages/editions/afgc/PlanClassementAfgc'),
      '/archives/mfiles': () => import('../pages/editions/afgc/MfilesAfgc'),
      '/admin/comptes': () => import('../pages/editions/afgc/ComptesAfgc'),
      '/admin/reglages': () => import('../pages/editions/afgc/AdministrationAfgc'),
    },
    pages: {
      // Connexion (identifiant ou adresse Outlook) et inscription en deux
      // temps (« Vous êtes… » : le département, puis l'identité).
      '/login': () => import('../pages/editions/afgc/ConnexionAfgc'),
      '/register': () => import('../pages/editions/afgc/InscriptionAfgc'),
      '/demandes/nouvelle': () => import('../pages/editions/afgc/DemanderAfgc'),
      '/demandes/mes-demandes': () => import('../pages/editions/afgc/MesDossiersAfgc'),
      '/demandes/a-traiter': () => import('../pages/editions/afgc/TraitementAfgc'),
      '/demandes/prets': () => import('../pages/editions/afgc/SortiesAfgc'),
    },
  },
};

/** Édition active, ou null pour la plateforme DocuFlow générale. */
export const edition = EDITIONS[import.meta.env.VITE_EDITION] || null;

// Marque la page pour les styles propres à l'édition (index.css).
if (edition && typeof document !== 'undefined') document.documentElement.dataset.edition = edition.id;
