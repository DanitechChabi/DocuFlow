import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  KeyRound, Plus, RefreshCw, Loader2, Copy, Check, Monitor, MonitorOff,
  ShieldCheck, ShieldX, ShieldAlert, Clock, CalendarPlus, Search, X,
  Building2, Mail, Ban, RotateCcw,
} from 'lucide-react';
import { superadminService } from '../../services/superadminService';
import { tenantService } from '../../services/tenantService';
import { toast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';

/**
 * LicensePanel — administration des licences de bureau (propriétaire de la plateforme).
 *
 * Les quatre routes /api/superadmin/licenses existaient sans aucun écran :
 * émettre, prolonger, révoquer ou transférer une licence exigeait un appel HTTP
 * à la main. C'est l'outil de vente et de support du produit sous abonnement.
 *
 * NE PAS CONFONDRE avec LicensePage (services/licenseService.js, /license au
 * singulier) : celle-là est l'écran du CLIENT sur son poste, et ses routes ne
 * sont même pas montées en mode SaaS. Ici on regarde le parc depuis l'éditeur.
 *
 * DEUX ÉCARTS DU BACKEND QUE CET ÉCRAN DOIT ABSORBER
 *
 *   1. L'émission ne signe rien et ne vérifie pas la clé de signature. Elle
 *      renvoie 201 même si DESKTOP_LICENSE_PRIVATE_KEY manque : la panne se
 *      révèle chez le client, à l'activation (503 SIGNING_UNAVAILABLE), après
 *      qu'on lui a facturé et envoyé sa clé. D'où le bandeau permanent et le
 *      bouton d'émission désactivé quand `signing_configured` est faux.
 *
 *   2. POST /licenses renvoie la ligne BRUTE (13 colonnes), sans tenant_name ni
 *      days_remaining, contrairement à GET/PATCH/reset-machine qui passent par
 *      LICENSE_SELECT. Fusionner cette réponse dans la liste afficherait une
 *      ligne sans échéance ni entreprise : on relit donc toujours l'inventaire
 *      après une mutation, jamais de mise à jour optimiste.
 */

// Vocabulaire aligné sur LicensePage (APPARENCE) : le support et le client
// doivent nommer le même état de la même façon. `pending` n'existe pas côté
// poste — son équivalent y est « unlicensed / Activation requise », d'où le
// libellé retenu ici. Les classes sont écrites en clair : `bg-${x}-50` serait
// purgé par Tailwind.
const ETATS = {
  active: {
    libelle: 'Abonnement actif',
    court: 'Actif',
    Icone: ShieldCheck,
    pastille: 'bg-emerald-100 text-emerald-600',
  },
  pending: {
    libelle: 'Activation requise',
    court: 'À activer',
    Icone: KeyRound,
    pastille: 'bg-blue-100 text-blue-600',
  },
  expired: {
    libelle: 'Abonnement expiré',
    court: 'Expiré',
    Icone: Clock,
    pastille: 'bg-orange-100 text-orange-600',
  },
  revoked: {
    libelle: 'Licence révoquée',
    court: 'Révoqué',
    Icone: ShieldX,
    pastille: 'bg-red-100 text-red-600',
  },
};

const ETAT_INCONNU = {
  libelle: 'État indéterminé',
  court: 'Inconnu',
  Icone: ShieldAlert,
  pastille: 'bg-slate-100 text-slate-500',
};

const etatDe = (statut) => ETATS[statut] || ETAT_INCONNU;

// Même format que LicensePage : « 24 septembre 2026 ».
const formaterDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const formaterDateCourte = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

// Durées proposées à l'émission et à la prolongation. Le backend borne à 36 mois
// (Math.min(36, …)) : au-delà il tronque en silence, autant ne pas le proposer.
const DUREES = [1, 3, 6, 12, 24, 36];

const FORMULAIRE_VIDE = {
  months: 12,
  customer_email: '',
  customer_company: '',
  tenant_id: '',
  notes: '',
};

const LicensePanel = () => {
  const [licences, setLicences] = useState([]);
  // null = pas encore su. Distingué de `false` pour ne pas alarmer pendant le
  // premier chargement.
  const [signatureOk, setSignatureOk] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recharge, setRecharge] = useState(false);

  const [recherche, setRecherche] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('all');

  // Émission
  const [emissionOuverte, setEmissionOuverte] = useState(false);
  const [formulaire, setFormulaire] = useState(FORMULAIRE_VIDE);
  const [emissionEnCours, setEmissionEnCours] = useState(false);
  // Clé fraîchement émise, à recopier avant de fermer : c'est le livrable à
  // envoyer au client, et rien d'autre dans l'écran ne la met en avant.
  const [cleEmise, setCleEmise] = useState(null);

  // Prolongation
  const [prolongationCible, setProlongationCible] = useState(null);
  const [prolongationMois, setProlongationMois] = useState(12);
  const [prolongationEnCours, setProlongationEnCours] = useState(false);

  // Copie : porte l'identifiant de la ligne copiée, sinon toutes les lignes du
  // tableau afficheraient « Copié » en même temps.
  const [copieId, setCopieId] = useState(null);

  const [confirm, setConfirm] = useState({
    open: false, title: '', message: '', type: 'danger', confirmLabel: 'Confirmer', onConfirm: null,
  });
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fermerConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  const chargerLicences = useCallback(async ({ silencieux = false } = {}) => {
    if (silencieux) setRecharge(true); else setLoading(true);
    try {
      const data = await superadminService.getLicenses();
      setLicences(Array.isArray(data?.licenses) ? data.licenses : []);
      setSignatureOk(Boolean(data?.signing_configured));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du chargement des licences');
    } finally {
      setLoading(false);
      setRecharge(false);
    }
  }, []);

  // Entreprises : pour rattacher une licence à un tenant existant. Chargé à part
  // et sans toast — l'inventaire doit s'afficher même si cet appel échoue, le
  // rattachement étant facultatif (tenant_id est nullable en base).
  const chargerTenants = useCallback(async () => {
    try {
      const data = await tenantService.getAllTenants();
      setTenants(Array.isArray(data) ? data : []);
    } catch {
      setTenants([]);
    }
  }, []);

  useEffect(() => {
    chargerLicences();
    chargerTenants();
  }, [chargerLicences, chargerTenants]);

  const copier = async (valeur, id) => {
    if (!valeur) return;
    try {
      await navigator.clipboard.writeText(valeur);
      setCopieId(id);
      setTimeout(() => setCopieId((actuel) => (actuel === id ? null : actuel)), 2000);
    } catch {
      toast.error('Copie impossible. Sélectionnez la valeur pour la copier.');
    }
  };

  // --- ÉMISSION ---------------------------------------------------------------

  const ouvrirEmission = () => {
    setFormulaire(FORMULAIRE_VIDE);
    setCleEmise(null);
    setEmissionOuverte(true);
  };

  const emettre = async (e) => {
    e.preventDefault();
    setEmissionEnCours(true);
    try {
      const data = await superadminService.createLicense({
        months: Number(formulaire.months) || 0,
        customer_email: formulaire.customer_email.trim() || undefined,
        customer_company: formulaire.customer_company.trim() || undefined,
        // Chaîne vide → undefined : le backend ferait `Number('')` → 0 → null,
        // ce qui marche par accident. Autant ne pas envoyer le champ.
        tenant_id: formulaire.tenant_id || undefined,
        notes: formulaire.notes.trim() || undefined,
      });
      const cle = data?.license?.license_key;
      if (cle) {
        setCleEmise(cle);
        toast.success('Licence émise');
      } else {
        // 201 sans clé : anormal, mais la licence peut exister. Ne pas inviter à
        // réémettre — ce serait une seconde licence facturée pour un seul client.
        toast.info('Licence émise, mais la clé n\'a pas été renvoyée. Vérifiez l\'inventaire.');
        setEmissionOuverte(false);
      }
      // On relit : la réponse du POST n'a ni entreprise ni jours restants.
      chargerLicences({ silencieux: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'émission de la licence');
    } finally {
      setEmissionEnCours(false);
    }
  };

  // --- PROLONGATION -----------------------------------------------------------

  const prolonger = async () => {
    if (!prolongationCible) return;
    setProlongationEnCours(true);
    try {
      const data = await superadminService.updateLicense(prolongationCible.id, {
        months: Number(prolongationMois) || 1,
      });
      const echeance = formaterDate(data?.license?.valid_until);
      toast.success(echeance ? `Licence prolongée jusqu'au ${echeance}` : 'Licence prolongée');
      setProlongationCible(null);
      chargerLicences({ silencieux: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la prolongation');
    } finally {
      setProlongationEnCours(false);
    }
  };

  // --- RÉVOCATION / RÉHABILITATION -------------------------------------------

  const demanderRevocation = (licence) => {
    setConfirm({
      open: true,
      type: 'danger',
      title: 'Révoquer cette licence ?',
      confirmLabel: 'Révoquer',
      message: `${licence.license_key} — ${licence.customer_company || licence.customer_email || 'client non renseigné'}. `
        + 'Le poste perdra l\'accès à la fermeture de sa fenêtre hors ligne, sous '
        + '7 jours au plus. La révocation est réversible : vous pourrez réhabiliter '
        + 'la licence, son échéance et son historique de paiement sont conservés.',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await superadminService.updateLicense(licence.id, { status: 'revoked' });
          toast.success('Licence révoquée');
          chargerLicences({ silencieux: true });
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur lors de la révocation');
        } finally {
          setConfirmLoading(false);
          fermerConfirm();
        }
      },
    });
  };

  // Réhabilitation. On repose 'active' même si l'échéance est passée : le statut
  // 'expired' est CALCULÉ, la péremption automatique du prochain inventaire le
  // remettra à 'expired' si la date ne suit pas. Le message le dit, sinon
  // l'administrateur croit avoir rendu l'accès alors qu'il faut prolonger.
  const demanderRehabilitation = (licence) => {
    const echeance = formaterDate(licence.valid_until);
    const perimee = licence.valid_until && new Date(licence.valid_until) < new Date();
    setConfirm({
      open: true,
      type: 'info',
      title: 'Réhabiliter cette licence ?',
      confirmLabel: 'Réhabiliter',
      message: perimee
        ? `L'échéance de cette licence est dépassée (${echeance}). Elle repassera immédiatement `
          + 'en « expiré » et le poste restera bloqué : prolongez-la pour rendre l\'accès.'
        : echeance
          ? `La licence redevient active jusqu'au ${echeance}.`
          : 'La licence redevient active. Aucune échéance n\'est posée : pensez à la prolonger.',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await superadminService.updateLicense(licence.id, { status: 'active' });
          toast.success('Licence réhabilitée');
          chargerLicences({ silencieux: true });
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur lors de la réhabilitation');
        } finally {
          setConfirmLoading(false);
          fermerConfirm();
        }
      },
    });
  };

  // --- TRANSFERT DE POSTE -----------------------------------------------------

  const demanderTransfert = (licence) => {
    setConfirm({
      open: true,
      type: 'warning',
      title: 'Délier le poste actuel ?',
      confirmLabel: 'Délier le poste',
      message: `${licence.machine_label || 'Poste enregistré'} sera détaché de ${licence.license_key}. `
        + 'Le client pourra activer la même clé sur un autre ordinateur. À faire '
        + 'lors d\'un changement de machine ou d\'un remplacement de carte mère.',
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          const data = await superadminService.resetLicenseMachine(licence.id);
          toast.success('Poste délié — la clé peut être activée ailleurs');
          // L'avertissement du backend porte la durée réelle de l'artefact : on
          // l'affiche tel quel plutôt que de recopier « 7 jours » ici, valeur qui
          // divergerait au premier ajustement côté serveur.
          if (data?.warning) toast.info(data.warning, 8000);
          chargerLicences({ silencieux: true });
        } catch (err) {
          toast.error(err.response?.data?.message || 'Erreur lors du transfert');
        } finally {
          setConfirmLoading(false);
          fermerConfirm();
        }
      },
    });
  };

  // --- DÉRIVÉS ----------------------------------------------------------------

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return licences.filter((l) => {
      if (filtreStatut !== 'all' && l.status !== filtreStatut) return false;
      if (!q) return true;
      return [l.license_key, l.customer_email, l.customer_company, l.tenant_name, l.machine_label, l.notes]
        .some((champ) => String(champ || '').toLowerCase().includes(q));
    });
  }, [licences, recherche, filtreStatut]);

  const compteurs = useMemo(() => {
    const base = { all: licences.length, active: 0, pending: 0, expired: 0, revoked: 0 };
    licences.forEach((l) => {
      if (base[l.status] !== undefined) base[l.status] += 1;
    });
    return base;
  }, [licences]);

  const FILTRES = [
    { key: 'all', label: 'Toutes' },
    { key: 'active', label: 'Actives' },
    { key: 'pending', label: 'À activer' },
    { key: 'expired', label: 'Expirées' },
    { key: 'revoked', label: 'Révoquées' },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="animate-spin text-docuflow-primary" size={32} />
        <p className="text-slate-500 font-medium">Chargement des licences…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Signature indisponible. L'émission reste techniquement acceptée par le
          backend (201, sans signer) : le blocage est ici, et le message couvre
          les DEUX causes possibles — car `signing_configured` vaut aussi false
          quand la migration 015 manque, cas où la clé est pourtant en place. */}
      {signatureOk === false && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <ShieldAlert size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-700 leading-relaxed">
            <p className="font-bold mb-1">Émission impossible : le dispositif de signature ne répond pas.</p>
            <p>
              Une clé émise maintenant serait refusée par le poste du client, à l'activation et
              après paiement. Deux causes possibles, à vérifier dans cet ordre : la variable
              <strong> DESKTOP_LICENSE_PRIVATE_KEY</strong> n'est pas renseignée sur le serveur, ou la
              migration <strong>015_licensing.sql</strong> n'a pas été appliquée à la base.
            </p>
          </div>
        </div>
      )}

      {/* Barre d'outils */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        <div className="flex gap-1.5 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 overflow-x-auto scrollbar-none">
          {FILTRES.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltreStatut(f.key)}
              className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all whitespace-nowrap ${
                filtreStatut === f.key ? 'bg-docuflow-primary text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {f.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                filtreStatut === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {compteurs[f.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative flex-1 lg:max-w-xs">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="input-premium pl-10"
            placeholder="Rechercher (clé, client, entreprise, poste…)"
          />
        </div>

        <button
          onClick={() => chargerLicences({ silencieux: true })}
          disabled={recharge}
          className="btn-secondary flex items-center justify-center gap-2"
          title="Recharger l'inventaire"
        >
          <RefreshCw size={16} className={recharge ? 'animate-spin' : ''} />
          Actualiser
        </button>

        <button
          onClick={ouvrirEmission}
          disabled={signatureOk === false}
          className="btn-primary flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          title={signatureOk === false
            ? 'Signature indisponible : la clé émise serait refusée par le poste du client'
            : 'Émettre une nouvelle licence'}
        >
          <Plus size={16} /> Émettre une licence
        </button>
      </div>

      {/* Inventaire */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3 font-bold">Clé de licence</th>
                <th className="px-4 py-3 font-bold">Client</th>
                <th className="px-4 py-3 font-bold">Statut</th>
                <th className="px-4 py-3 font-bold">Valable jusqu'au</th>
                <th className="px-4 py-3 font-bold">Poste</th>
                <th className="px-4 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtrees.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  <KeyRound size={32} className="mx-auto mb-2 opacity-40" />
                  {licences.length === 0
                    ? 'Aucune licence émise. Le bouton « Émettre une licence » crée la première.'
                    : 'Aucune licence ne correspond à ce filtre'}
                </td></tr>
              )}
              {filtrees.map((l) => {
                const etat = etatDe(l.status);
                const jours = l.days_remaining;
                const paiements = Number(l.payments_count) || 0;
                return (
                  <tr key={l.id} className="border-t border-slate-50 hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs font-bold text-slate-800 select-all" title={l.license_key}>
                          {l.license_key}
                        </p>
                        <button
                          onClick={() => copier(l.license_key, `cle-${l.id}`)}
                          className="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                          title="Copier la clé"
                        >
                          {copieId === `cle-${l.id}`
                            ? <Check size={13} className="text-emerald-600" />
                            : <Copy size={13} />}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Émise le {formaterDateCourte(l.created_at)}
                        {paiements > 0 && ` · ${paiements} paiement${paiements > 1 ? 's' : ''}`}
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">
                        {l.customer_company || l.customer_email || '—'}
                      </p>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1">
                        {l.tenant_name
                          ? <><Building2 size={9} /> {l.tenant_name}</>
                          : l.customer_email && l.customer_company
                            ? <><Mail size={9} /> {l.customer_email}</>
                            : 'Aucune entreprise rattachée'}
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${etat.pastille}`}>
                        <etat.Icone size={10} /> {etat.court}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      {l.valid_until ? (
                        <>
                          <p className="text-xs text-slate-600">{formaterDateCourte(l.valid_until)}</p>
                          {/* days_remaining est plafonné à 0 côté SQL : « 0 jour »
                              signifie échu, pas « dernier jour ». */}
                          <p className={`text-[10px] font-bold ${
                            jours === 0 ? 'text-red-500' : jours != null && jours <= 15 ? 'text-orange-500' : 'text-slate-400'
                          }`}>
                            {jours === 0 ? 'Échu' : jours != null ? `${jours} jour${jours > 1 ? 's' : ''} restant${jours > 1 ? 's' : ''}` : '—'}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400">Aucune échéance</p>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {l.machine_id ? (
                        <>
                          <p className="text-xs text-slate-600 flex items-center gap-1">
                            <Monitor size={11} className="text-slate-300" />
                            {l.machine_label || 'Poste sans nom'}
                          </p>
                          <div className="flex items-center gap-1">
                            <p className="font-mono text-[10px] text-slate-400 truncate max-w-[110px]" title={l.machine_id}>
                              {l.machine_id}
                            </p>
                            <button
                              onClick={() => copier(l.machine_id, `poste-${l.id}`)}
                              className="p-0.5 rounded text-slate-300 hover:text-slate-600 transition-colors"
                              title="Copier l'empreinte du poste"
                            >
                              {copieId === `poste-${l.id}`
                                ? <Check size={11} className="text-emerald-600" />
                                : <Copy size={11} />}
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-slate-400 flex items-center gap-1">
                          <MonitorOff size={11} className="text-slate-300" />
                          {/* activated_at survit au transfert : distinguer « jamais
                              activée » d'« activée puis déliée » évite de croire
                              qu'un client n'a jamais installé le produit. */}
                          {l.activated_at ? 'Poste délié' : 'Jamais activée'}
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setProlongationCible(l); setProlongationMois(12); }}
                          className="p-2 rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          title="Prolonger l'abonnement"
                        >
                          <CalendarPlus size={15} />
                        </button>
                        {l.machine_id && (
                          <button
                            onClick={() => demanderTransfert(l)}
                            className="p-2 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                            title="Délier le poste (changement d'ordinateur)"
                          >
                            <RefreshCw size={15} />
                          </button>
                        )}
                        {l.status === 'revoked' ? (
                          <button
                            onClick={() => demanderRehabilitation(l)}
                            className="p-2 rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                            title="Réhabiliter la licence"
                          >
                            <RotateCcw size={15} />
                          </button>
                        ) : (
                          <button
                            onClick={() => demanderRevocation(l)}
                            className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="Révoquer la licence"
                          >
                            <Ban size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span><strong className="text-slate-600">{filtrees.length}</strong> licence(s) affichée(s)</span>
          <span className="flex items-center gap-1">
            <Monitor size={12} /> Une licence vaut pour un seul poste — le transfert se fait ici
          </span>
        </div>
      </div>

      {/* ============ ÉMISSION ============ */}
      {emissionOuverte && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => !emissionEnCours && setEmissionOuverte(false)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-scale-in overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <KeyRound size={20} className="text-emerald-500" />
                {cleEmise ? 'Licence émise' : 'Émettre une licence'}
              </h2>
              <button
                onClick={() => setEmissionOuverte(false)}
                disabled={emissionEnCours}
                className="p-2 hover:bg-slate-100 rounded-full"
              >
                <X size={20} className="text-slate-400" />
              </button>
            </div>

            {cleEmise ? (
              /* La clé n'est plus jamais mise en avant après cette fermeture :
                 c'est le seul moment où on peut la copier sans la chercher dans
                 le tableau. */
              <div className="p-8 space-y-5">
                <p className="text-sm text-slate-500 leading-relaxed">
                  Transmettez cette clé au client. Il la saisira sur l'écran d'activation de
                  DocuFlow, sur le poste à équiper.
                </p>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                  <p className="font-mono text-sm font-bold text-emerald-800 select-all break-all">{cleEmise}</p>
                  <button
                    onClick={() => copier(cleEmise, 'emise')}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-all"
                  >
                    {copieId === 'emise' ? <Check size={14} /> : <Copy size={14} />}
                    {copieId === 'emise' ? 'Copié' : 'Copier'}
                  </button>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setEmissionOuverte(false)} className="btn-secondary flex-1">
                    Fermer
                  </button>
                  <button onClick={ouvrirEmission} className="btn-primary flex-1 flex items-center justify-center gap-2">
                    <Plus size={16} /> Émettre une autre
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={emettre} className="p-8 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Durée</label>
                  <select
                    className="input-premium"
                    value={formulaire.months}
                    onChange={(e) => setFormulaire({ ...formulaire, months: e.target.value })}
                  >
                    {DUREES.map((m) => (
                      <option key={m} value={m}>{m} mois</option>
                    ))}
                    {/* 0 mois : clé sans échéance, à prolonger ensuite. Le poste
                        la refusera tant qu'aucune durée n'est posée. */}
                    <option value={0}>Sans échéance (à prolonger ensuite)</option>
                  </select>
                  <p className="text-[10px] text-slate-400">
                    Une durée enregistre aussi la vente au journal des paiements. Maximum 36 mois.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Client</label>
                  <input
                    className="input-premium"
                    type="email"
                    value={formulaire.customer_email}
                    onChange={(e) => setFormulaire({ ...formulaire, customer_email: e.target.value })}
                    placeholder="Adresse e-mail (recommandé)"
                  />
                  <input
                    className="input-premium"
                    value={formulaire.customer_company}
                    onChange={(e) => setFormulaire({ ...formulaire, customer_company: e.target.value })}
                    placeholder="Société du client (optionnel)"
                  />
                </div>

                {/* Rattachement facultatif : une licence est vendue AVANT que
                    l'entreprise n'existe en base — le client crée son
                    organisation au premier lancement. */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Entreprise déjà enregistrée
                  </label>
                  <select
                    className="input-premium"
                    value={formulaire.tenant_id}
                    onChange={(e) => setFormulaire({ ...formulaire, tenant_id: e.target.value })}
                  >
                    <option value="">Aucune — le client créera la sienne</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Notes internes</label>
                  <textarea
                    className="input-premium"
                    rows={2}
                    value={formulaire.notes}
                    onChange={(e) => setFormulaire({ ...formulaire, notes: e.target.value })}
                    placeholder="Référence de règlement, contact, conditions particulières…"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={emissionEnCours}
                    className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {emissionEnCours ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                    {emissionEnCours ? 'Émission…' : 'Émettre la clé'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmissionOuverte(false)}
                    disabled={emissionEnCours}
                    className="btn-secondary flex-1"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ============ PROLONGATION ============ */}
      {prolongationCible && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => !prolongationEnCours && setProlongationCible(null)}
        >
          <div
            className="bg-white w-full max-w-md rounded-3xl shadow-2xl animate-scale-in overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <CalendarPlus size={18} className="text-emerald-500" /> Prolonger l'abonnement
              </h2>
              <button
                onClick={() => setProlongationCible(null)}
                disabled={prolongationEnCours}
                className="p-2 hover:bg-slate-100 rounded-full"
              >
                <X size={18} className="text-slate-400" />
              </button>
            </div>
            <div className="p-8 space-y-4">
              <div>
                <p className="font-mono text-xs font-bold text-slate-700">{prolongationCible.license_key}</p>
                <p className="text-xs text-slate-400">
                  {prolongationCible.customer_company || prolongationCible.customer_email || 'Client non renseigné'}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Durée ajoutée</label>
                <select
                  className="input-premium"
                  value={prolongationMois}
                  onChange={(e) => setProlongationMois(e.target.value)}
                >
                  {DUREES.map((m) => <option key={m} value={m}>{m} mois</option>)}
                </select>
              </div>

              {/* Le cumul est la propriété qui compte : un renouvellement
                  anticipé ne doit pas faire perdre le reliquat au client. */}
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3 leading-relaxed">
                {prolongationCible.valid_until && (prolongationCible.days_remaining ?? 0) > 0
                  ? `La durée s'ajoute au reliquat : l'échéance du ${formaterDateCourte(prolongationCible.valid_until)} est repoussée d'autant, rien n'est perdu.`
                  : 'La nouvelle échéance part d\'aujourd\'hui.'}
                {prolongationCible.status === 'revoked' && ' Cette licence est révoquée : la prolongation ne la réhabilite pas, il faut la réhabiliter séparément.'}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setProlongationCible(null)}
                  disabled={prolongationEnCours}
                  className="btn-secondary flex-1"
                >
                  Annuler
                </button>
                <button
                  onClick={prolonger}
                  disabled={prolongationEnCours}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {prolongationEnCours ? <Loader2 size={16} className="animate-spin" /> : <CalendarPlus size={16} />}
                  {prolongationEnCours ? 'Prolongation…' : 'Prolonger'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirm.open}
        title={confirm.title}
        message={confirm.message}
        type={confirm.type}
        confirmLabel={confirm.confirmLabel}
        loading={confirmLoading}
        onConfirm={confirm.onConfirm}
        onClose={fermerConfirm}
      />
    </div>
  );
};

export default LicensePanel;
