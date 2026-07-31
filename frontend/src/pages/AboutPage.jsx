import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import {
  LayoutDashboard, Info, HelpCircle, Scale, User, Mail, Phone,
  MapPin, Globe, GraduationCap, Code, ChevronDown, ExternalLink,
  FileText, MessageCircle, Building2, ShieldCheck, HardDrive
} from 'lucide-react';

const faqItems = [
  {
    q: "Comment créer une demande de document ?",
    a: "Connectez-vous, puis cliquez sur le bouton « Nouvelle demande » dans le tableau de bord. Remplissez les informations du document (entreprise, numéro de dossier, type, motif, priorité) et enregistrez. Vous pouvez aussi joindre des fichiers en pièces jointes."
  },
  {
    q: "Comment suivre l'état de ma demande ?",
    a: "Votre demande passe par plusieurs statuts : « en attente », « à traiter », « transmis », « livré » ou « rejeté ». Consultez la section « Mes demandes » pour voir l'évolution en temps réel."
  },
  {
    q: "Puis-je joindre des fichiers à ma demande ?",
    a: "Oui. Lors de la création d'une demande, vous pouvez joindre jusqu'à 5 fichiers (PDF, Word, Excel, images…). L'archiviste peut également ajouter des documents traités dans le dossier de la demande."
  },
  {
    q: "Comment envoyer un fichier par la messagerie ?",
    a: "Ouvrez la messagerie en bas à droite de l'écran, sélectionnez ou démarrez une conversation, puis cliquez sur l'icône 📎 pour joindre un fichier à votre message avant de l'envoyer."
  },
  {
    q: "Comment sont protégées mes données ?",
    a: "L'accès à l'application est protégé par authentification sécurisée (JWT). Chaque entreprise dispose de son propre espace isolé : les utilisateurs d'une entreprise ne voient pas les données d'une autre. Les fichiers uploadés sont stockés sur le serveur et ne sont accessibles qu'aux personnes autorisées."
  },
  {
    q: "Qui contacter en cas de problème ?",
    a: "Contactez le développeur de l'application, Daniel CHABI BOUKO, via l'adresse chabidaniel093@gmail.com ou le site danielchabi.netlify.app."
  }
];

const licensePoints = [
  "Cette application est fournie gratuitement aux utilisateurs de l'organisation.",
  "L'utilisation des données doit respecter la confidentialité des documents et des entreprises.",
  "La redistribution ou la revente de l'application sans autorisation du créateur est interdite.",
  "Le créateur ne saurait être tenu responsable des dommages indirects liés à l'utilisation de l'application.",
  "Toute reproduction du code source, en tout ou partie, nécessite l'accord écrit du créateur."
];

const AboutPage = () => {
  const navigate = useNavigate();
  const settings = useSettings();
  const [openFaq, setOpenFaq] = useState(0);

  const features = [
    { icon: <FileText size={20} />, title: 'Demandes documentaires', desc: 'Créez et suivez vos demandes de documents' },
    { icon: <MessageCircle size={20} />, title: 'Messagerie interne', desc: 'Échangez avec les utilisateurs en temps réel' },
    { icon: <HardDrive size={20} />, title: 'Pièces jointes', desc: 'Transmettez des fichiers par demande ou message' },
    { icon: <ShieldCheck size={20} />, title: 'Gestion des accès', desc: 'Rôles et droits par profil utilisateur' },
    { icon: <Building2 size={20} />, title: 'Multi-entreprises', desc: 'Chaque entreprise dispose de son espace isolé' },
    { icon: <Info size={20} />, title: 'Suivi & historique', desc: 'Toutes les actions sont tracées et consultables' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6 md:space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3 md:gap-5">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-3 bg-white text-slate-700 rounded-2xl shadow-sm border border-slate-200 hover:bg-slate-50 transition-all hover:shadow-md"
            >
              <LayoutDashboard size={22} />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 md:p-2.5 bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl shadow-lg">
                  <Info size={22} />
                </div>
                <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight">À propos</h1>
              </div>
              <p className="text-xs md:text-sm text-slate-500 font-medium md:ml-1">
                {settings.site_name || 'DocuFlow'} — Plateforme de gestion documentaire
              </p>
            </div>
          </div>
        </div>

        {/* À propos de l'application */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
              <Info size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">À propos de l'application</h2>
              <p className="text-xs text-slate-400">Présentation de la plateforme</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            <strong>{settings.site_name || 'DocuFlow'}</strong> est une plateforme de gestion documentaire
            conçue pour faciliter le suivi des demandes de documents au sein d'une organisation.
            Elle permet aux demandeurs de créer et suivre leurs demandes, et aux archivistes de
            traiter, vérifier et livrer les documents demandés, le tout dans un environnement sécurisé.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            L'application intègre une messagerie interne, la transmission de fichiers en pièces jointes,
            un système de notifications, ainsi qu'une gestion multi-entreprises avec des espaces isolés.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <div key={i} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-blue-200 hover:shadow-sm transition-all">
                <div className="p-2 w-fit bg-white rounded-xl shadow-sm text-blue-600 mb-3">{f.icon}</div>
                <h3 className="text-sm font-bold text-slate-800 mb-1">{f.title}</h3>
                <p className="text-xs text-slate-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Questions fréquentes (FAQ)</h2>
              <p className="text-xs text-slate-400">Les réponses aux questions les plus courantes</p>
            </div>
          </div>

          <div className="space-y-3">
            {faqItems.map((item, i) => (
              <div key={i} className="border border-slate-200 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="text-sm font-bold text-slate-700">{item.q}</span>
                  <ChevronDown size={18}
                    className={`text-slate-400 transition-transform flex-shrink-0 ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 animate-fade-in-up">
                    <p className="text-sm text-slate-600 leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Licence d'utilisation */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-xl">
              <Scale size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Licence d'utilisation</h2>
              <p className="text-xs text-slate-400">Conditions d'utilisation de la plateforme</p>
            </div>
          </div>
          <ul className="space-y-3">
            {licensePoints.map((point, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400 mt-5 pt-4 border-t border-slate-100">
            © {new Date().getFullYear()} CHABI BOUKO Daniel — Tous droits réservés. Version 1.0.
          </p>
        </div>

        {/* Créateur */}
        <div className="glass-card-premium p-6 md:p-8 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-violet-100 text-violet-600 rounded-xl">
              <User size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Créateur de l'application</h2>
              <p className="text-xs text-slate-400">Le développeur derrière la plateforme</p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Avatar */}
            <div className="flex flex-col items-center md:items-start gap-4 md:w-1/3 flex-shrink-0">
              <div className="w-32 h-32 rounded-3xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white text-5xl font-black shadow-xl shadow-violet-500/20">
                DC
              </div>
              <div className="text-center md:text-left">
                <h3 className="text-xl font-black text-slate-900">CHABI BOUKO Daniel</h3>
                <p className="text-sm text-violet-600 font-bold mt-0.5">Archiviste & Développeur Web</p>
                <span className="inline-block mt-2 px-3 py-1 bg-emerald-100 text-emerald-600 rounded-lg text-xs font-bold">
                  Disponible pour missions freelance
                </span>
              </div>
            </div>

            {/* Bio + infos */}
            <div className="flex-1 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Passionné du numérique depuis 2021, Daniel CHABI BOUKO est étudiant en Licence
                d'Archivistique à l'École Nationale d'Administration (ENA) et développeur web/backend
                indépendant. Il combine expertise en gestion documentaire (GED) et développement
                logiciel pour créer des solutions métier, à l'image de la présente plateforme.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <Mail size={16} className="text-slate-400 flex-shrink-0" />
                  <a href="mailto:chabidaniel093@gmail.com" className="text-sm text-slate-700 hover:text-violet-600 transition-colors truncate">
                    chabidaniel093@gmail.com
                  </a>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <Phone size={16} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-700">+229 01 53 73 62 65</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <MapPin size={16} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-700">Abomey-Calavi, Bénin</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <GraduationCap size={16} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-700">Licence Archivistique — ENA</span>
                </div>
              </div>

              {/* Compétences */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Code size={14} /> Compétences
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['HTML', 'CSS', 'JavaScript', 'PHP', 'Python', 'Django', 'WordPress', 'SQL', 'GED', 'Koha', 'ABCD'].map((skill, i) => (
                    <span key={i} className="px-3 py-1.5 bg-violet-50 text-violet-600 rounded-lg text-xs font-bold">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Liens */}
              <div className="flex flex-wrap gap-3 pt-2">
                <a href="https://danielchabi.netlify.app" target="_blank" rel="noopener noreferrer"
                  className="btn-primary flex items-center gap-2">
                  <ExternalLink size={16} /> Portfolio
                </a>
                <a href="https://archicorp.org" target="_blank" rel="noopener noreferrer"
                  className="btn-secondary flex items-center gap-2">
                  <Globe size={16} /> ArchiCorp
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
