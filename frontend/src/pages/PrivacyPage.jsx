import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Eye, Database, Lock, Trash2, Mail, User } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useTitrePage } from '../hooks/useTitrePage';

const Section = ({ icon: Icon, title, children }) => (
  <div className="glass-card-premium p-6">
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-xl bg-docuflow-secondary/10"><Icon size={18} className="text-docuflow-secondary" /></div>
      <h3 className="text-lg font-bold text-slate-800">{title}</h3>
    </div>
    <div className="text-sm text-slate-600 leading-relaxed space-y-3">{children}</div>
  </div>
);

const PrivacyPage = ({ type = 'privacy' }) => {
  const settings = useSettings();
  const isPrivacy = type === 'privacy';
  const title = isPrivacy ? 'Politique de Confidentialité' : 'Politique de Cookies';

  // Le composant sert deux routes distinctes (/privacy et /cookies) : sans titre
  // propre à chacune, les deux onglets sont indiscernables alors qu'ils ne
  // disent pas la même chose. Version courte pour l'onglet — « Politique de
  // Confidentialité · DocuFlow » ne laisse rien voir du mot utile.
  useTitrePage(isPrivacy ? 'Confidentialité' : 'Cookies');

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 animate-fade-in-down">
          <Link to="/about" className="p-2 rounded-xl bg-white shadow-sm border border-slate-200 hover:bg-slate-50 transition-colors">
            <ArrowLeft size={18} className="text-slate-500" />
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">{title}</h1>
            <p className="text-sm text-slate-400 font-medium">Dernière mise à jour : 4 août 2026</p>
          </div>
        </div>

        {isPrivacy ? (
          /* ===== POLITIQUE DE CONFIDENTIALITÉ ===== */
          <div className="space-y-4">
            <Section icon={Shield} title="1. Responsable du traitement">
              <p>Le responsable du traitement des données personnelles est <strong>{settings.site_name || 'DocuFlow'}</strong>, édité par ARCHICORP.</p>
              <p>Pour toute question : contactez-nous via l'application ou par email à l'adresse indiquée dans les paramètres de l'organisation.</p>
            </Section>

            <Section icon={Database} title="2. Données collectées">
              <p>Dans le cadre de l'utilisation de {settings.site_name || 'DocuFlow'}, nous collectons :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Données d'identification</strong> : nom complet, email, nom d'utilisateur, rôle</li>
                <li><strong>Données professionnelles</strong> : entreprise, section, fonction</li>
                <li><strong>Données d'activité</strong> : demandes créées, documents consultés, historique des actions</li>
                <li><strong>Données de connexion</strong> : adresse IP, date/heure de connexion, navigateur</li>
              </ul>
            </Section>

            <Section icon={Eye} title="3. Finalité du traitement">
              <p>Vos données sont traitées pour :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>L'exploitation du service de gestion documentaire</li>
                <li>La gestion des demandes et le workflow de validation</li>
                <li>La recherche et le classement des documents</li>
                <li>La messagerie interne et les notifications</li>
                <li>L'audit et la traçabilité des actions (conformité archivistique)</li>
                <li>L'envoi de notifications par email (statut des demandes, partage)</li>
              </ul>
            </Section>

            <Section icon={Lock} title="4. Base légale">
              <p>Le traitement repose sur :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>L'exécution du contrat</strong> : utilisation du service par l'utilisateur et son entreprise</li>
                <li><strong>L'intérêt légitime</strong> : sécurité, audit, amélioration du service</li>
                <li><strong>Le consentement</strong> : pour les cookies non essentiels et les communications marketing</li>
              </ul>
            </Section>

            <Section icon={User} title="5. Vos droits">
              <p>Conformément au RGPD, vous disposez des droits suivants :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Droit d'accès</strong> : obtenir une copie de vos données</li>
                <li><strong>Droit de rectification</strong> : corriger des données inexactes</li>
                <li><strong>Droit à l'effacement</strong> : demander la suppression de vos données</li>
                <li><strong>Droit à la portabilité</strong> : recevoir vos données dans un format structuré</li>
                <li><strong>Droit d'opposition</strong> : vous opposer au traitement pour motifs légitimes</li>
              </ul>
              <p>Pour exercer vos droits, contactez l'administrateur de votre entreprise via l'application.</p>
            </Section>

            <Section icon={Trash2} title="6. Durée de conservation">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Données de compte</strong> : conservées tant que le compte est actif + 30 jours après suppression</li>
                <li><strong>Documents</strong> : durée définie par l'archivage de l'entreprise (norme NF Z42-013)</li>
                <li><strong>Logs d'audit</strong> : 2 ans maximum</li>
                <li><strong>Cookies</strong> : durées variables selon le type (voir Politique de Cookies)</li>
              </ul>
            </Section>

            <Section icon={Mail} title="7. Contact">
              <p>Pour toute question relative à la protection de vos données, contactez l'administrateur de votre espace {settings.site_name || 'DocuFlow'} ou l'éditeur ARCHICORP.</p>
            </Section>
          </div>
        ) : (
          /* ===== POLITIQUE DE COOKIES ===== */
          <div className="space-y-4">
            <Section icon={Eye} title="1. Qu'est-ce qu'un cookie ?">
              <p>Un cookie est un petit fichier texte déposé sur votre appareil lorsque vous visitez un site web. Il permet de mémoriser vos préférences et d'améliorer votre expérience.</p>
            </Section>

            <Section icon={Database} title="2. Cookies que nous utilisons">
              <p className="font-bold">Cookies essentiels (obligatoires) :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>token</strong> : authentification de session (durée : 30 jours)</li>
                <li><strong>user</strong> : préférences utilisateur (stockage local)</li>
              </ul>
              <p className="font-bold mt-3">Cookies fonctionnels :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>docuflow_tour_done_*</strong> : mémorise si le tutoriel a été complété</li>
              </ul>
              <p className="font-bold mt-3">Cookies tiers :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
              </ul>
            </Section>

            <Section icon={Lock} title="3. Finalité des cookies">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Sécurité</strong> : authentification et prévention des fraudes</li>
                <li><strong>Préférences</strong> : mémoriser vos paramètres (thème, langue)</li>
                <li><strong>Fonctionnement</strong> : navigation fluide entre les pages</li>
              </ul>
            </Section>

            <Section icon={Trash2} title="4. Gestion des cookies">
              <p>Vous pouvez gérer vos cookies via les paramètres de votre navigateur :</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Chrome</strong> : Paramètres → Confidentialité → Cookies</li>
                <li><strong>Firefox</strong> : Options → Vie privée → Cookies</li>
                <li><strong>Safari</strong> → Préférences → Confidentialité</li>
                <li><strong>Edge</strong> : Paramètres → Confidentialité → Cookies</li>
              </ul>
              <p className="mt-2">⚠️ La suppression des cookies essentiels entraînera la déconnexion automatique.</p>
            </Section>

            <Section icon={Shield} title="5. Cookies tiers et services externes">
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Resend</strong> : envoi d'emails transactionnels (pas de cookies)</li>
              </ul>
            </Section>

            <Section icon={Mail} title="6. Contact">
              <p>Pour toute question sur les cookies, contactez l'administrateur de votre espace {settings.site_name || 'DocuFlow'}.</p>
            </Section>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pt-4 border-t border-slate-100">
          <Link to="/login" className="text-sm font-semibold hover:underline" style={{ color: settings.secondary_color || '#3b82f6' }}>
            ← Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPage;
