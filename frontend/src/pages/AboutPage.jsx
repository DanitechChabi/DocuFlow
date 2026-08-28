import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import {
  Info, HelpCircle, Scale, Mail, ArrowLeft,
  Globe, Code, ChevronDown, Search, Tags, Lock, Layers,
  FileText, MessageCircle, Building2, ShieldCheck, HardDrive,
  FolderOpen, Sparkles, SlidersHorizontal, Share2, Archive, ScrollText,
  Server, Heart, Compass,
} from 'lucide-react';
import { RESTART_TOUR_EVENT } from '../components/OnboardingTour';
import { authService } from '../services/authService';
import { useTitrePage } from '../hooks/useTitrePage';

// Date de dernière révision de cette page. Écrite en clair : une date calculée
// à l'affichage prétendrait que le contenu est à jour du jour même.
const LAST_UPDATED = '19 août 2026';
const APP_VERSION = '2.0';

const faqItems = [
  {
    q: 'Comment créer une demande de document ?',
    a: "Depuis le tableau de bord, cliquez sur « Nouvelle demande ». Renseignez l'entreprise concernée, le numéro de dossier, le numéro d'acte, l'année, le type de document, le motif et la priorité. Vous pouvez joindre jusqu'à 5 fichiers. Un accusé de réception vous est envoyé par e-mail dès l'enregistrement.",
  },
  {
    q: "Comment suivre l'avancement de ma demande ?",
    a: "Une demande progresse « en attente » → « à traiter » → « transmis » → « livré ». Trois états sont terminaux : « livré », « rejeté » et « annulé ». Les transitions sont contrôlées par le serveur — un état ne peut pas être sauté, et une demande terminée ne repart pas en arrière. L'onglet « Mes demandes » affiche l'état courant, et l'historique conserve chaque transition avec son auteur, son horodatage et son commentaire.",
  },
  {
    q: 'Puis-je annuler une demande que je viens de créer ?',
    a: "Oui, tant qu'elle n'est pas terminée : un demandeur peut annuler ses propres demandes, et uniquement les siennes. C'est la seule transition qui lui est ouverte — faire avancer une demande relève de l'archiviste ou de l'administrateur.",
  },
  {
    q: "Qu'est-ce que le référentiel documentaire (GED) ?",
    a: "C'est la bibliothèque de l'organisation : dossiers de classement, versions successives d'un même document, cycle de vie (Disponible / Prêt / Archivé) et référence canonique immuable. Une demande livrée peut y être indexée en un clic, ce qui évite de ressaisir ce qui a déjà été traité.",
  },
  {
    q: 'Comment retrouver un document dont je ne connais pas le nom ?',
    a: "Trois moyens se complètent. La recherche plein texte lit le contenu extrait des fichiers, pas seulement leur titre. Les vues dynamiques regroupent la bibliothèque à la volée par type, année, statut, entreprise ou auteur. Les étiquettes, proposées automatiquement à partir du contenu, servent de facettes cliquables.",
  },
  {
    q: 'Que sont les métadonnées typées ?',
    a: "Au-delà des champs standards, chaque organisation définit ses propres champs — texte, nombre, date, liste de choix, booléen — regroupés en schémas applicables aux documents. Le type est vérifié à l'enregistrement, et un champ déclaré obligatoire bloque la validation s'il est vide.",
  },
  {
    q: 'Deux personnes peuvent-elles modifier le même document ?',
    a: "Non, et c'est voulu. Le verrouillage (check-in / check-out) réserve un document à une personne le temps de sa modification. Les autres voient qui l'a réservé et depuis quand. Sans ce mécanisme, la dernière écriture effacerait silencieusement la précédente.",
  },
  {
    q: 'Comment partager un document avec une personne externe ?',
    a: "Depuis la fiche du document, la fonction de partage envoie un e-mail à un maximum de 20 destinataires, avec un message d'accompagnement facultatif. Les adresses sont validées avant l'envoi, et le compte rendu indique le nombre exact d'envois aboutis — pas une promesse de succès.",
  },
  {
    q: 'Que puis-je configurer pour mon organisation ?',
    a: "La console de configuration couvre huit domaines : identité visuelle, thème, documents, sécurité, notifications, régionalisation, stockage et rétention. Chaque réglage est propre à l'organisation — nom de l'expéditeur des e-mails, taille maximale des fichiers, durée de session, rôle autorisé à consulter la GED, durée de conservation, entre autres.",
  },
  {
    q: 'Combien de temps mes documents sont-ils conservés ?',
    a: "Des politiques de rétention définissent une durée par organisation — cinq ans par défaut — et le traitement appliqué à l'expiration : archivage ou signalement pour revue. Une politique peut viser un schéma de métadonnées précis, et prévenir un nombre de jours à l'avance. Aucune suppression n'a lieu sans qu'une politique l'ait explicitement prévue.",
  },
  {
    q: 'Comment mes données sont-elles isolées de celles des autres entreprises ?',
    a: "Chaque enregistrement porte l'identifiant de son organisation, et toute lecture comme toute écriture est filtrée sur cet identifiant côté serveur — jamais côté navigateur. Une organisation ne peut donc pas atteindre les données d'une autre, même en forgeant une requête à la main.",
  },
  {
    q: "Qu'enregistre le journal d'audit ?",
    a: "Les actions métier : création et affectation de demande, changement de statut, dépôt et partage de document, gestion des utilisateurs. Les refus et les échecs y figurent aussi, explicitement marqués. La simple consultation d'un écran n'y figure pas — elle noyait les vraies actions sous du trafic technique.",
  },
  {
    q: 'Comment revoir le tour guidé ?',
    // Réservée aux personnes connectées : un visiteur non authentifié n'a ni
    // menu d'avatar ni tour à rejouer, la réponse le renverrait dans le vide.
    authOnly: true,
    a: "Le tour se déclenche à la première connexion. Pour le revoir ensuite, ouvrez le menu de votre avatar en haut à droite et choisissez « Revoir le tour guidé » — ou utilisez le bouton situé en haut de cette page.",
  },
  {
    q: 'Qui contacter en cas de problème ?',
    a: 'Contactez CHABI BOUKO Daniel, PDG de ARCHICORP, à chabidaniel093@gmail.com ou via danielchabi.netlify.app.',
  },
];

const licensePoints = [
  "Cette application est fournie aux utilisateurs de l'organisation sous licence ARCHICORP.",
  "L'utilisation des données doit respecter la confidentialité des documents et des entreprises.",
  "La redistribution ou la revente de l'application sans autorisation écrite d'ARCHICORP est interdite.",
  "ARCHICORP ne saurait être tenu responsable des dommages indirects liés à l'utilisation de l'application.",
  'Toute reproduction du code source, en tout ou partie, nécessite l\'accord écrit du créateur.',
];

// Socle technique — annoncé parce qu'un utilisateur averti veut savoir sur quoi
// repose l'outil auquel il confie ses archives.
const stack = [
  { label: 'Interface', value: 'React 19 · Vite' },
  { label: 'Serveur', value: 'Node.js · Express' },
  { label: 'Base de données', value: 'PostgreSQL' },
  { label: 'Authentification', value: 'JWT' },
];

const AboutPage = () => {
  const navigate = useNavigate();
  const settings = useSettings();
  // L'entrée ouverte est repérée par sa question, non par son indice : la liste
  // est filtrée selon la session, et un indice ne désignerait pas la même
  // question dans les deux cas.
  const [openFaq, setOpenFaq] = useState(faqItems[0].q);

  const siteName = settings.site_name || 'DocuFlow';

  // « À propos et aide » et non « À propos » seul : c'est la page où l'on
  // retrouve la FAQ, et c'est sous ce mot qu'on la cherche dans une liste
  // d'onglets.
  useTitrePage('À propos et aide');

  // Cette page est publique : elle s'ouvre aussi bien depuis le menu d'un
  // utilisateur connecté que depuis le pied de la page de connexion. Les
  // raccourcis vers l'intérieur de l'application ne valent donc que si une
  // session existe — sinon ils renverraient le visiteur vers /login.
  const isAuthenticated = Boolean(authService.getCurrentUser());

  const visibleFaq = faqItems.filter((item) => !item.authOnly || isAuthenticated);

  // Retour à la page précédente, ou à un point d'entrée sûr si entrée directe
  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(isAuthenticated ? '/dashboard' : '/login');
  };

  // Le tour est monté par le tableau de bord : il faut y revenir avant de le
  // déclencher, sinon l'événement n'a aucun destinataire.
  const restartTour = () => {
    navigate('/dashboard');
    setTimeout(() => window.dispatchEvent(new CustomEvent(RESTART_TOUR_EVENT)), 400);
  };

  const features = [
    {
      icon: <FileText size={20} />,
      title: 'Demandes documentaires',
      desc: "Progression en quatre étapes contrôlée par le serveur, trois états terminaux, affectation nominative, priorités, historique horodaté de chaque transition.",
    },
    {
      icon: <FolderOpen size={20} />,
      title: 'Référentiel documentaire',
      desc: 'Dossiers de classement, versions successives, cycle de vie Disponible / Prêt / Archivé, référence canonique immuable.',
    },
    {
      icon: <Layers size={20} />,
      title: 'Métadonnées typées',
      desc: 'Schémas propres à chaque organisation : texte, nombre, date, liste de choix, booléen. Type vérifié et champs obligatoires imposés.',
    },
    {
      icon: <Search size={20} />,
      title: 'Recherche plein texte',
      desc: 'Le texte des fichiers est extrait au dépôt : la recherche porte sur le contenu réel, pas seulement sur les titres.',
    },
    {
      icon: <Tags size={20} />,
      title: 'Vues dynamiques et étiquettes',
      desc: 'Regroupement à la volée par type, année, statut, entreprise ou auteur. Étiquettes proposées à partir du contenu extrait.',
    },
    {
      icon: <Lock size={20} />,
      title: 'Verrouillage anticollision',
      desc: "Check-in / check-out : un document réservé n'est modifiable que par la personne qui l'a pris, jamais écrasé en silence.",
    },
    {
      icon: <Share2 size={20} />,
      title: 'Partage par e-mail',
      desc: 'Jusqu\'à 20 destinataires validés par envoi, message d\'accompagnement, compte rendu du nombre exact d\'envois aboutis.',
    },
    {
      icon: <MessageCircle size={20} />,
      title: 'Messagerie interne',
      desc: 'Conversations directes avec pièces jointes, compteur de messages non lus et notifications en temps réel.',
    },
    {
      icon: <Building2 size={20} />,
      title: 'Cloisonnement par organisation',
      desc: "Filtrage sur l'identifiant d'organisation appliqué côté serveur à chaque lecture et chaque écriture, jamais côté navigateur.",
    },
    {
      icon: <ShieldCheck size={20} />,
      title: 'Rôles et permissions',
      desc: 'Demandeur, archiviste, administrateur, superadministrateur. Le périmètre de la GED est lui-même paramétrable par organisation.',
    },
    {
      icon: <SlidersHorizontal size={20} />,
      title: 'Console de configuration',
      desc: 'Huit domaines réglables sans intervention technique : identité, thème, documents, sécurité, notifications, régions, stockage, rétention.',
    },
    {
      icon: <Archive size={20} />,
      title: 'Politiques de rétention',
      desc: "Durée de conservation par organisation ou par schéma, action définie à l'expiration — archivage ou revue — et préavis paramétrable.",
    },
    {
      icon: <ScrollText size={20} />,
      title: "Journal d'audit",
      desc: 'Les actions métier sont tracées en ajout seul, refus et échecs compris. La simple consultation d\'un écran n\'y figure pas.',
    },
    {
      icon: <HardDrive size={20} />,
      title: 'Stockage adaptable',
      desc: "Disque du serveur ou stockage infonuagique selon la configuration, sans changement dans l'usage quotidien.",
    },
  ];

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8 md:space-y-10">
        {/* En-tête */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3 md:gap-5">
            <button
              onClick={handleBack}
              className="p-2 rounded-xl bg-white shadow-sm border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors flex-shrink-0"
              aria-label="Retour"
              title="Retour"
            >
              <ArrowLeft size={18} className="text-slate-500" />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2.5 md:p-3 bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl shadow-lg">
                  <Info size={22} />
                </div>
                <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight">À propos</h1>
              </div>
              <p className="text-xs md:text-sm text-slate-500 font-medium md:ml-1">
                {siteName} — {settings.site_description || 'Plateforme de gestion documentaire'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium sm:flex-col sm:items-end">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-bold">Version {APP_VERSION}</span>
            <span>Mise à jour : {LAST_UPDATED}</span>
          </div>
        </div>

        {/* Présentation */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
              <Info size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Ce que fait cette plateforme</h2>
              <p className="text-xs text-slate-400">Présentation générale</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            <strong>{siteName}</strong> traite deux besoins qui se répondent : la <strong>demande</strong> de
            document, avec son cycle de traitement et sa traçabilité, et la <strong>conservation</strong> de
            ce document, avec son classement, ses versions et sa durée de vie. Un demandeur formule sa
            requête, un archiviste la traite et la livre, un administrateur pilote l'ensemble — et ce qui a
            été livré alimente le référentiel plutôt que de se perdre dans une boîte aux lettres.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            Chaque organisation dispose d'un espace entièrement cloisonné. Le filtrage par organisation est
            appliqué côté serveur à chaque lecture et chaque écriture : ce n'est pas une présentation
            différente des mêmes données, c'est une séparation effective. Une organisation configure son
            identité visuelle, ses champs de métadonnées, ses règles de sécurité et ses durées de
            conservation sans que cela n'affecte les autres.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed">
            La recherche ne s'arrête pas aux titres : le texte des fichiers déposés est extrait pour être
            interrogeable, des étiquettes sont proposées à partir de ce contenu, et les vues dynamiques
            réorganisent la bibliothèque à la volée selon le critère qui vous intéresse sur le moment.
          </p>

          {isAuthenticated && (
            <button
              onClick={restartTour}
              className="btn-secondary mt-6 inline-flex items-center gap-2 text-sm"
            >
              <Compass size={16} /> Revoir le tour guidé
            </button>
          )}
        </div>

        {/* Fonctionnalités */}
        <div className="animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-xl">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Fonctionnalités</h2>
              <p className="text-xs text-slate-400">{features.length} capacités livrées</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="glass-card p-4 md:p-5 group hover:shadow-elevated transition-all duration-300 border border-slate-100"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-start gap-3 md:gap-4">
                  <div className="p-2.5 md:p-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl shadow-lg flex-shrink-0 group-hover:scale-105 transition-transform">
                    {f.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 text-sm md:text-base">{f.title}</h3>
                    <p className="text-xs md:text-sm text-slate-500 mt-1 leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Socle technique */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-slate-100 text-slate-600 rounded-xl">
              <Server size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Socle technique</h2>
              <p className="text-xs text-slate-400">Sur quoi repose la plateforme</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {stack.map((s) => (
              <div key={s.label} className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{s.label}</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{s.value}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mt-5">
            Les mots de passe sont hachés (bcrypt), les sessions reposent sur un jeton signé dont la durée
            de validité est réglable par organisation, et les fichiers sont conservés soit sur le disque du
            serveur, soit sur un stockage infonuagique selon la configuration retenue.
          </p>
        </div>

        {/* Questions fréquentes */}
        <div className="animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Questions fréquentes</h2>
              <p className="text-xs text-slate-400">{visibleFaq.length} réponses</p>
            </div>
          </div>
          <div className="space-y-2">
            {visibleFaq.map((item) => (
              <details
                key={item.q}
                className="group glass-card border border-slate-100 overflow-hidden"
                open={openFaq === item.q}
              >
                <summary
                  className="p-4 md:p-5 flex items-center gap-3 cursor-pointer list-none select-none"
                  onClick={(e) => { e.preventDefault(); setOpenFaq(openFaq === item.q ? null : item.q); }}
                >
                  <span className="flex-1 font-medium text-slate-700 text-sm md:text-base pr-4">{item.q}</span>
                  <ChevronDown
                    size={20}
                    className="text-slate-400 transition-transform duration-200 group-open:rotate-180 flex-shrink-0"
                    aria-hidden="true"
                  />
                </summary>
                <div className="px-4 md:px-5 pb-4 md:pb-5 pt-0 border-t border-slate-100 animate-scale-in">
                  <p className="text-sm text-slate-600 leading-relaxed">{item.a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Licence */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up border border-slate-200">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-purple-100 text-purple-600 rounded-xl">
              <Scale size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Licence et conditions</h2>
              <p className="text-xs text-slate-400">Cadre juridique d'utilisation</p>
            </div>
          </div>
          <ul className="space-y-2 text-sm text-slate-600">
            {licensePoints.map((point) => (
              <li key={point} className="flex items-start gap-2 pl-1">
                <span className="text-emerald-500 flex-shrink-0 mt-1">✓</span>
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-5">
            Le traitement des données personnelles est détaillé dans la{' '}
            <button
              onClick={() => navigate('/privacy')}
              className="text-docuflow-secondary font-semibold hover:underline"
            >
              politique de confidentialité
            </button>.
          </p>
        </div>

        {/* Auteur */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up bg-gradient-to-r from-slate-50 to-blue-50 border border-slate-200 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4 md:gap-6">
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg flex items-center justify-center text-white font-bold text-2xl md:text-3xl border-2 border-white/20">
                CB
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-black text-slate-900">CHABI BOUKO Daniel</h3>
                <p className="text-sm text-slate-600 font-medium">PDG de <strong className="text-slate-900">ARCHICORP</strong></p>
                <p className="text-xs text-slate-400 mt-0.5">Créateur et développeur de DocuFlow</p>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
                  <a href="mailto:chabidaniel093@gmail.com" className="flex items-center gap-1 hover:text-docuflow-secondary transition-colors">
                    <Mail size={12} /> chabidaniel093@gmail.com
                  </a>
                  <a href="https://danielchabi.netlify.app" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-docuflow-secondary transition-colors">
                    <Globe size={12} /> danielchabi.netlify.app
                  </a>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-start md:items-center text-left md:text-center">
              <div className="p-2 bg-white/50 rounded-xl backdrop-blur-sm">
                <Code size={20} className="text-blue-600" />
              </div>
              <p className="text-xs text-slate-500 mt-2 font-medium">Version {APP_VERSION}</p>
              <p className="text-xs text-slate-400">Conçu pour ARCHICORP</p>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm text-slate-500">
            <span>© 2024–2026 ARCHICORP. Tous droits réservés.</span>
            <span className="flex items-center gap-1">
              <Heart size={14} className="text-red-500" />
              Développé pour l'excellence documentaire
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AboutPage;
