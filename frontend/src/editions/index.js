import {
  LayoutDashboard, PlusCircle, FileSearch, ClipboardList, BookOpenCheck, Mail, Warehouse, FolderOpen, Table2,
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
    // Menu à plat : des chemins existants de DocuFlow, nommés avec les mots de
    // l'AFGC. Chaque entrée garde la permission de sa route.
    menu: [
      { to: '/', label: 'Accueil', icone: LayoutDashboard, end: true },
      { to: '/demandes/nouvelle', label: 'Demander un dossier', icone: PlusCircle, permission: 'requests.create' },
      { to: '/demandes/mes-demandes', label: 'Mes dossiers', icone: FileSearch, permission: 'requests.view' },
      { to: '/demandes/a-traiter', label: 'À traiter', icone: ClipboardList, permission: 'requests.process' },
      { to: '/demandes/prets', label: 'Dossiers sortis', icone: BookOpenCheck, permission: 'requests.process' },
      { to: '/courrier', label: 'Courrier', icone: Mail, permission: 'mail.view' },
      { to: '/documents/magasins', label: 'Boîtes et rayonnages', icone: Warehouse, permission: 'documents.view' },
      { to: '/documents/liste', label: 'Dossiers numérisés', icone: FolderOpen, permission: 'documents.view' },
      { to: '/documents/saisie', label: 'Saisie et import Excel', icone: Table2, permission: 'documents.index' },
    ],
    // Espaces sans visite guidée automatique : l'édition en remplace les écrans,
    // dont les phrases d'aide suffisent.
    visitesMasquees: ['accueil', 'demandes'],
    // Page d'accueil propre à l'édition, chargée à la demande.
    accueil: () => import('../pages/editions/AccueilAfgc'),
    // Écrans propres à l'édition, à la place de ceux de DocuFlow aux mêmes
    // adresses : mêmes routes, mêmes permissions, vocabulaire de l'AFGC
    // (Demandé → Transmis → Retourné) et listes de dossiers.
    pages: {
      '/demandes/nouvelle': () => import('../pages/editions/afgc/DemanderAfgc'),
      '/demandes/mes-demandes': () => import('../pages/editions/afgc/MesDossiersAfgc'),
      '/demandes/a-traiter': () => import('../pages/editions/afgc/TraitementAfgc'),
      '/demandes/prets': () => import('../pages/editions/afgc/SortiesAfgc'),
    },
  },
};

/** Édition active, ou null pour la plateforme DocuFlow générale. */
export const edition = EDITIONS[import.meta.env.VITE_EDITION] || null;
