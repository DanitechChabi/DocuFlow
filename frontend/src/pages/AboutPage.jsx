import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import {
  LayoutDashboard, Info, HelpCircle, Scale, Mail,
  Globe, Code, ChevronDown,
  FileText, MessageCircle, Building2, ShieldCheck, HardDrive,
  FolderOpen, Sparkles, Users, Zap, Heart
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
    a: "L'accès à l'application est protégé par authentification sécurisée (JWT). Chaque entreprise dispose de son propre espace isolé : les utilisateurs d'une entreprise ne voient pas les données d'une autre. Les fichiers uploadés sont stockés de manière sécurisée et ne sont accessibles qu'aux personnes autorisées."
  },
  {
    q: "Qu'est-ce que le référentiel documentaire (GED) ?",
    a: "Le module GED (Gestion Électronique des Documents) permet de classer, versionner et historiser tous les documents de l'entreprise. Vous pouvez créer des dossiers, uploader des fichiers (PDF, images, bureautique), changer les statuts (Disponible / Prêt / Archivé), et indexer automatiquement les demandes livrées."
  },
  {
    q: "Comment fonctionne l'onboarding à la première connexion ?",
    a: "Un guide interactif (spotlight + flèches) vous accompagne pas à pas : navigation dans la barre latérale, création de demande, notifications, documents, profil. Pour les superadmins, un assistant dédié aide à créer les utilisateurs, sections et configurer l'entreprise."
  },
  {
    q: "Qui contacter en cas de problème ?",
    a: "Contactez CHABI BOUKO Daniel, PDG de ARCHICORP, via l'adresse chabidaniel093@gmail.com ou le site danielchabi.netlify.app."
  }
];

const licensePoints = [
  "Cette application est fournie aux utilisateurs de l'organisation sous licence ARCHICORP.",
  "L'utilisation des données doit respecter la confidentialité des documents et des entreprises.",
  "La redistribution ou la revente de l'application sans autorisation écrite d'ARCHICORP est interdite.",
  "ARCHICORP ne saurait être tenu responsable des dommages indirects liés à l'utilisation de l'application.",
  "Toute reproduction du code source, en tout ou partie, nécessite l'accord écrit du créateur."
];

const AboutPage = () => {
  const navigate = useNavigate();
  const settings = useSettings();
  const [openFaq, setOpenFaq] = useState(0);

  const features = [
    { icon: <FileText size={20} />, title: 'Demandes documentaires', desc: 'Créez, suivez et gérez vos demandes de documents avec une machine à états complète' },
    { icon: <MessageCircle size={20} />, title: 'Messagerie interne', desc: 'Échangez en temps réel avec pièces jointes, conversations et notifications' },
    { icon: <HardDrive size={20} />, title: 'Pièces jointes', desc: 'Transmettez des fichiers par demande ou message (jusqu\'à 5 fichiers, 10 Mo)' },
    { icon: <ShieldCheck size={20} />, title: 'Gestion des accès', desc: 'Rôles granulaires : demandeur, archiviste, admin, superadmin par entreprise' },
    { icon: <Building2 size={20} />, title: 'Multi-entreprises', desc: 'Chaque entreprise dispose de son espace isolé avec son branding et ses sections' },
    { icon: <Info size={20} />, title: 'Suivi & historique', desc: 'Toutes les actions sont tracées : audit logs, historique d\'états, journal documentaire' },
    { icon: <FolderOpen size={20} />, title: 'Référentiel documentaire (GED)', desc: 'Dossiers, versions multiples, statuts (Disponible/Prêt/Archivé), indexation auto des livraisons' },
    { icon: <Sparkles size={20} />, title: 'Onboarding guidé', desc: 'Tour interactif spotlight + assistant superadmin pour une prise en main immédiate' },
  ];

  const stats = [
    { label: 'Entreprises', value: '∞', icon: <Building2 size={18} /> },
    { label: 'Utilisateurs', value: 'Illimité', icon: <Users size={18} /> },
    { label: 'Documents', value: 'Versionnés', icon: <FolderOpen size={18} /> },
    { label: 'Disponibilité', value: '24/7', icon: <Zap size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8 md:space-y-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3 md:gap-5">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-3 bg-white text-slate-700 rounded-2xl shadow-sm border border-slate-200 hover:bg-slate-50 transition-all hover:shadow-md"
              aria-label="Retour au tableau de bord"
            >
              <LayoutDashboard size={22} />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2.5 md:p-3 bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-2xl shadow-lg">
                  <Info size={22} md={24} />
                </div>
                <h1 className="text-xl md:text-3xl font-black text-slate-900 tracking-tight">À propos</h1>
              </div>
              <p className="text-xs md:text-sm text-slate-500 font-medium md:ml-1">
                {settings.site_name || 'DocuFlow'} — Plateforme de gestion documentaire
              </p>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 animate-fade-in-up">
          {stats.map((s, i) => (
            <div key={s.label} className="glass-card-premium p-4 md:p-5 text-center" style={{ animationDelay: `${100 + i * 80}ms` }}>
              <div className="flex items-center justify-center gap-2 text-afgc-secondary mb-2">
                {s.icon}
              </div>
              <div className="text-2xl md:text-3xl font-black text-slate-900">{s.value}</div>
              <div className="text-xs md:text-sm text-slate-500 font-medium mt-0.5">{s.label}</div>
            </div>
          ))}
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
            <strong>{settings.site_name || 'DocuFlow'}</strong> est une plateforme complète de gestion documentaire
            conçue pour faciliter le suivi des demandes de documents au sein d'une organisation.
            Elle permet aux demandeurs de créer et suivre leurs demandes, aux archivistes de
            traiter, vérifier et livrer les documents, et aux administrateurs de piloter l'ensemble.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            Le <strong>référentiel documentaire (GED)</strong> intégré offre un classement par dossiers,
            une gestion de versions, un cycle de vie (Disponible / Prêt / Archivé) et un historique
            complet. Les demandes livrées peuvent être indexées automatiquement dans le référentiel,
            créant ainsi une base de connaissances pérenne.
          </p>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            L'expérience utilisateur est enrichie par un <strong>onboarding interactif</strong> à la première
            connexion (spotlight + flèches) et un <strong>assistant dédié pour les superadministrateurs</strong>
            qui guide la création des utilisateurs, sections, branding et configuration de l'entreprise.
          </p>
        </div>

        {/* Fonctionnalités clés */}
        <div className="animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-xl">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Fonctionnalités clés</h2>
              <p className="text-xs text-slate-400">Tout ce dont vous avez besoin</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="glass-card p-4 md:p-5 group hover:shadow-elevated transition-all duration-300 border border-slate-100"
                style={{ animationDelay: `${i * 60}ms` }}
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

        {/* FAQ */}
        <div className="animate-fade-in-up">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-amber-100 text-amber-600 rounded-xl">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Questions fréquentes</h2>
              <p className="text-xs text-slate-400">Tout ce que vous devez savoir</p>
            </div>
          </div>
          <div className="space-y-2">
            {faqItems.map((item, i) => (
              <details
                key={i}
                className="group glass-card border border-slate-100 overflow-hidden"
                open={openFaq === i}
              >
                <summary
                  className="p-4 md:p-5 flex items-center gap-3 cursor-pointer list-none select-none"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
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
              <h2 className="text-lg font-bold text-slate-800">Licence & Conditions</h2>
              <p className="text-xs text-slate-400">Cadre juridique d'utilisation</p>
            </div>
          </div>
          <ul className="space-y-2 text-sm text-slate-600">
            {licensePoints.map((point, i) => (
              <li key={i} className="flex items-start gap-2 pl-1">
                <span className="text-emerald-500 flex-shrink-0 mt-1">✓</span>
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Signature créateur */}
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
                <p className="text-xs text-slate-400 mt-0.5">Créateur & Développeur de DocuFlow</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Mail size={12} /> chabidaniel093@gmail.com</span>
                  <span className="flex items-center gap-1"><Globe size={12} /> danielchabi.netlify.app</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end text-right md:items-center md:text-center">
              <div className="p-2 bg-white/50 rounded-xl backdrop-blur-sm">
                <Code size={20} className="text-blue-600" />
              </div>
              <p className="text-xs text-slate-500 mt-2 font-medium">Version 1.0</p>
              <p className="text-xs text-slate-400">Conçu avec passion pour ARCHICORP</p>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm text-slate-500">
            <span>© 2024-2025 ARCHICORP. Tous droits réservés.</span>
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