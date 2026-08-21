import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  KeyRound, ShieldCheck, ShieldAlert, ShieldX, Clock, Monitor, Copy, Check,
  RefreshCw, Loader2, CreditCard, Smartphone, ExternalLink, WifiOff, AlertCircle,
} from 'lucide-react';
import { useLicense } from '../contexts/LicenseContext';
import { toast } from '../components/Toast';
import { useTitrePage } from '../hooks/useTitrePage';

// ============================================================================
// LicensePage — écran d'activation et de suivi de l'abonnement (version bureau).
//
// C'est le seul écran joignable quand la licence manque : licenseMiddleware
// répond 402 sur toute l'API métier, mais laisse passer /api/license. Il doit
// donc être autonome — pas de données métier, pas d'appel au tableau de bord.
//
// TROIS CHOSES DOIVENT Y ÊTRE LISIBLES SANS AIDE DU SUPPORT
//   1. pourquoi l'accès est refusé, en français et sans code d'erreur ;
//   2. l'empreinte de la machine, que le client dicte au téléphone pour un
//      transfert de licence — d'où le bouton « Copier » ;
//   3. comment payer. Le lien s'ouvre dans le NAVIGATEUR (openExternal) : une
//      page de paiement dans une fenêtre Electron n'a ni barre d'adresse ni
//      cadenas, donc le client ne peut pas vérifier qu'il paie sur le bon site.
// ============================================================================

// Page publique d'achat. Surchargeable au build pour les tests de recette.
const PAGE_ACHAT = import.meta.env.VITE_LANDING_URL || 'https://docuflow-afgc.com';

// Présentation par état. Le message, lui, vient TOUJOURS du backend : il porte
// des éléments variables (jours restants, date d'échéance) que dupliquer ici
// ferait diverger dès la première correction côté serveur.
const APPARENCE = {
  active: {
    Icone: ShieldCheck,
    titre: 'Abonnement actif',
    teinte: 'emerald',
    parDefaut: 'Votre abonnement DocuFlow est actif.',
  },
  grace: {
    Icone: WifiOff,
    titre: 'Vérification en attente',
    teinte: 'amber',
    parDefaut: 'Connectez cet ordinateur à Internet pour confirmer votre abonnement.',
  },
  expired: {
    Icone: Clock,
    titre: 'Abonnement expiré',
    teinte: 'orange',
    parDefaut: 'Votre abonnement a expiré. Renouvelez-le pour retrouver l’accès.',
  },
  revoked: {
    Icone: ShieldX,
    titre: 'Licence révoquée',
    teinte: 'red',
    parDefaut: 'Cette licence a été révoquée. Contactez le support DocuFlow.',
  },
  machine_mismatch: {
    Icone: Monitor,
    titre: 'Licence liée à un autre ordinateur',
    teinte: 'orange',
    parDefaut: 'Cette licence est enregistrée pour un autre poste. Le support peut la transférer.',
  },
  invalid: {
    Icone: ShieldAlert,
    titre: 'Licence illisible',
    teinte: 'red',
    parDefaut: 'Le fichier de licence est altéré. Saisissez à nouveau votre clé.',
  },
  unlicensed: {
    Icone: KeyRound,
    titre: 'Activation requise',
    teinte: 'blue',
    parDefaut: 'Saisissez la clé reçue par e-mail pour activer ce poste.',
  },
};

const APPARENCE_INCONNUE = {
  Icone: ShieldAlert,
  titre: 'État de licence indéterminé',
  teinte: 'slate',
  parDefaut: 'Impossible de déterminer l’état de votre abonnement. Réessayez ou contactez le support.',
};

// Classes écrites en clair et non composées à la volée (`bg-${teinte}-50`) :
// Tailwind analyse les sources statiquement et purgerait des noms construits.
const TEINTES = {
  emerald: { fond: 'bg-emerald-50', bord: 'border-emerald-200', texte: 'text-emerald-700', pastille: 'bg-emerald-100 text-emerald-600' },
  amber: { fond: 'bg-amber-50', bord: 'border-amber-200', texte: 'text-amber-700', pastille: 'bg-amber-100 text-amber-600' },
  orange: { fond: 'bg-orange-50', bord: 'border-orange-200', texte: 'text-orange-700', pastille: 'bg-orange-100 text-orange-600' },
  red: { fond: 'bg-red-50', bord: 'border-red-200', texte: 'text-red-700', pastille: 'bg-red-100 text-red-600' },
  blue: { fond: 'bg-blue-50', bord: 'border-blue-200', texte: 'text-blue-700', pastille: 'bg-blue-100 text-blue-600' },
  slate: { fond: 'bg-slate-50', bord: 'border-slate-200', texte: 'text-slate-700', pastille: 'bg-slate-100 text-slate-500' },
};

/**
 * Met une saisie au format DF-XXXX-XXXX-XXXX-XXXX pendant la frappe.
 *
 * Le collage est le cas courant (la clé arrive par e-mail) et il apporte souvent
 * des espaces, des minuscules, ou un préfixe déjà présent : tout est absorbé
 * ici. La validation qui fait autorité reste celle du backend (normalizeKey) —
 * ce formatage n'est qu'un confort de saisie.
 */
function formaterCle(saisie) {
  let net = String(saisie).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (net.startsWith('DF')) net = net.slice(2);
  net = net.slice(0, 16);
  const groupes = net.match(/.{1,4}/g) || [];
  return groupes.length ? `DF-${groupes.join('-')}` : '';
}

/** La clé est-elle complète ? Évite d'envoyer une requête vouée au 400. */
const cleComplete = (valeur) => /^DF(-[A-Z0-9]{4}){4}$/.test(valeur);

/** Date lisible par un francophone, sans dépendance de mise en forme. */
function formaterDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

const LicensePage = () => {
  const navigate = useNavigate();
  const {
    state, allowed, message, licenseKey, validUntil, daysRemaining, graceDaysRemaining,
    machineId, desktop, loading, check, activate,
  } = useLicense();

  const [saisie, setSaisie] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [verification, setVerification] = useState(false);
  const [erreur, setErreur] = useState('');
  const [copie, setCopie] = useState(false);

  // Sur le web, cette page n'a aucun sens : il n'y a pas de licence de poste.
  // Renvoi immédiat vers le tableau de bord plutôt qu'un écran vide, au cas où
  // l'URL /license serait atteinte par un signet ou un lien partagé.
  useEffect(() => {
    if (!desktop) navigate('/dashboard', { replace: true });
  }, [desktop, navigate]);

  const apparence = APPARENCE[state] || APPARENCE_INCONNUE;
  const teinte = TEINTES[apparence.teinte] || TEINTES.slate;
  const { Icone } = apparence;

  // L'onglet porte l'état de la licence, pas le nom de l'écran : c'est
  // l'information que le client lit au téléphone avec le support, et « Licence »
  // seul ne dit pas si l'abonnement est expiré ou lié à un autre poste.
  //
  // Déclaré avant le `return null` du cas web : un hook s'appelle à chaque
  // rendu, même dans la branche où la page ne s'affiche pas.
  useTitrePage(apparence.titre);

  const handleActivation = async (event) => {
    event.preventDefault();
    setErreur('');
    if (!cleComplete(saisie)) {
      setErreur('Clé incomplète. Format attendu : DF-XXXX-XXXX-XXXX-XXXX');
      return;
    }

    setEnCours(true);
    try {
      const resultat = await activate(saisie);
      if (resultat?.allowed) {
        toast.success('Poste activé. Bienvenue dans DocuFlow.');
        navigate('/dashboard', { replace: true });
      } else {
        // Activation acceptée par le serveur mais état non autorisé : cas réel
        // d'un abonnement dont l'échéance est déjà passée au moment où la clé
        // est saisie. Le message du backend explique lequel.
        setErreur(resultat?.message || 'Cette clé n’ouvre pas d’abonnement actif.');
      }
    } catch (err) {
      const donnees = err.response?.data;
      // 402 = paiement en attente : le client n'a rien fait de mal, sa clé
      // existe mais le règlement n'est pas encore parvenu. Le distinguer évite
      // de lui faire vérifier une clé pourtant correcte.
      setErreur(
        donnees?.message
        || (err.response?.status === 402
          ? 'Le paiement de cette licence n’est pas encore confirmé.'
          : 'Activation impossible. Vérifiez votre connexion Internet, puis réessayez.')
      );
    } finally {
      setEnCours(false);
    }
  };

  const handleVerification = async () => {
    setErreur('');
    setVerification(true);
    try {
      // force: true — c'est tout l'intérêt du bouton. Le client vient de payer
      // et ne doit pas attendre l'échéance de renouvellement de l'artefact.
      const resultat = await check(true);
      if (resultat?.allowed) {
        toast.success('Abonnement confirmé.');
        navigate('/dashboard', { replace: true });
      } else {
        toast.info(resultat?.message || 'Aucun changement : abonnement toujours inactif.');
      }
    } catch {
      setErreur('Vérification impossible. Cet ordinateur est-il connecté à Internet ?');
    } finally {
      setVerification(false);
    }
  };

  const copierEmpreinte = useCallback(async () => {
    if (!machineId) return;
    try {
      await navigator.clipboard.writeText(machineId);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      // clipboard indisponible (contexte non sécurisé) : l'empreinte reste
      // affichée en clair et sélectionnable, le client peut la recopier.
      toast.error('Copie impossible. Sélectionnez l’empreinte pour la copier.');
    }
  }, [machineId]);

  const ouvrirAchat = (chemin) => {
    const url = `${PAGE_ACHAT}${chemin}`;
    // openExternal n'existe qu'en bureau ; le repli couvre le cas d'un preload
    // non chargé, qui rendrait sinon le bouton inerte sans explication.
    if (window.desktopApp?.openExternal) window.desktopApp.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!desktop) return null;

  const echeance = formaterDate(validUntil);
  // Le formulaire n'a d'intérêt que si aucun abonnement n'est actif sur ce
  // poste, ou si la licence enregistrée appartient à une autre machine.
  const afficherFormulaire = !allowed;

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden p-4"
      style={{ background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 50%, #eff6ff 100%)' }}
    >
      <div
        className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full blur-3xl pointer-events-none"
        style={{ backgroundColor: '#3b82f615' }}
      />

      <div className="max-w-2xl w-full animate-fade-in-up relative z-10">
        {/* En-tête : état de la licence */}
        <div className="text-center mb-8">
          <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-5 ${teinte.pastille}`}>
            <Icone size={36} />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">{apparence.titre}</h1>
          {/* whitespace-pre-line : les messages du backend contiennent des sauts
              de ligne délibérés (licenseGuard), qui portent le sens du message. */}
          <p className="text-slate-500 mt-3 font-medium whitespace-pre-line">
            {message || apparence.parDefaut}
          </p>
        </div>

        <div className="glass-card-premium p-8 shadow-elevated">
          {/* Récapitulatif de l'abonnement en cours, s'il y en a un */}
          {(licenseKey || echeance) && (
            <div className={`mb-6 p-4 rounded-xl border ${teinte.fond} ${teinte.bord}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                {licenseKey && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Clé de licence</div>
                    <div className="font-mono text-sm font-bold text-slate-800">{licenseKey}</div>
                  </div>
                )}
                {echeance && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Valable jusqu’au</div>
                    <div className={`text-sm font-bold ${teinte.texte}`}>
                      {echeance}
                      {daysRemaining != null && ` — ${daysRemaining} jour${daysRemaining > 1 ? 's' : ''}`}
                    </div>
                  </div>
                )}
              </div>
              {graceDaysRemaining != null && (
                <div className="mt-3 pt-3 border-t border-white/60 text-sm font-semibold text-amber-700 flex items-center gap-2">
                  <Clock size={15} className="flex-shrink-0" />
                  Vérification requise dans {graceDaysRemaining} jour{graceDaysRemaining > 1 ? 's' : ''}.
                </div>
              )}
            </div>
          )}

          {erreur && (
            <div className="mb-6 p-4 bg-orange-50/80 text-orange-600 rounded-xl border border-orange-200 text-sm font-bold flex items-start gap-3 animate-fade-in-down">
              <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-line">{erreur}</span>
            </div>
          )}

          {afficherFormulaire && (
            <form onSubmit={handleActivation} className="mb-6">
              <label htmlFor="license-key" className="block text-sm font-bold text-slate-700 mb-2">
                Clé de licence
              </label>
              <div className="relative">
                <KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                <input
                  id="license-key"
                  type="text"
                  className="input-premium pl-12 font-mono tracking-wider uppercase"
                  placeholder="DF-XXXX-XXXX-XXXX-XXXX"
                  value={saisie}
                  onChange={(e) => setSaisie(formaterCle(e.target.value))}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={enCours}
                  autoFocus
                />
              </div>
              <p className="text-xs text-slate-400 mt-2 font-medium">
                Reçue par e-mail après votre paiement. Une licence active un seul ordinateur.
              </p>

              <button
                type="submit"
                className="btn-primary w-full mt-5 flex items-center justify-center gap-2 py-3"
                disabled={enCours || !cleComplete(saisie)}
              >
                {enCours ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Activation en cours…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} />
                    Activer cet ordinateur
                  </>
                )}
              </button>
            </form>
          )}

          {/* « Vérifier maintenant » : indispensable juste après un paiement, et
              pour sortir de la fenêtre de grâce dès le retour du réseau. */}
          <button
            type="button"
            onClick={handleVerification}
            className="btn-secondary w-full flex items-center justify-center gap-2 py-3"
            disabled={verification || loading}
          >
            {verification ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Vérification…
              </>
            ) : (
              <>
                <RefreshCw size={18} />
                Vérifier maintenant
              </>
            )}
          </button>

          {allowed && (
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="w-full mt-3 text-sm font-bold text-docuflow-secondary hover:underline py-2"
            >
              Retour à DocuFlow
            </button>
          )}

          {/* Offre et moyens de paiement */}
          <div className="mt-8 pt-6 border-t border-slate-200">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-bold text-slate-700">Abonnement DocuFlow</span>
              <span className="text-2xl font-black text-slate-900">
                75 000 <span className="text-sm font-bold text-slate-400">FCFA / mois</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium mb-4">
              Un poste de travail. Vos documents restent sur cet ordinateur.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => ouvrirAchat('/tarifs?moyen=momo')}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary transition-all"
              >
                <Smartphone size={17} />
                Mobile Money
                <ExternalLink size={13} className="text-slate-300" />
              </button>
              <button
                type="button"
                onClick={() => ouvrirAchat('/tarifs?moyen=paypal')}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-docuflow-secondary hover:text-docuflow-secondary transition-all"
              >
                <CreditCard size={17} />
                PayPal / Carte
                <ExternalLink size={13} className="text-slate-300" />
              </button>
            </div>
          </div>

          {/* Empreinte machine — ce que le support demande en premier. */}
          {machineId && (
            <div className="mt-6 pt-6 border-t border-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Identifiant de cet ordinateur
                  </div>
                  {/* select-all : un clic suffit à tout sélectionner si le
                      presse-papiers est indisponible. */}
                  <div className="font-mono text-xs text-slate-500 truncate select-all" title={machineId}>
                    {machineId}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copierEmpreinte}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-xs font-bold text-slate-600 hover:bg-slate-200 transition-all"
                >
                  {copie ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  {copie ? 'Copié' : 'Copier'}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2 font-medium">
                À communiquer au support pour transférer votre licence sur un autre poste.
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6 font-medium">
          Besoin d’aide ? Écrivez à support@docuflow-afgc.com
        </p>
      </div>
    </div>
  );
};

export default LicensePage;
