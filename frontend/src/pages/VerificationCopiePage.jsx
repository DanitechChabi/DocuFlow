import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Loader2, FileText } from 'lucide-react';
import { urlApi } from '../services/collaborationService';
import { empreinteFichier } from '../services/serviceArchivesService';

/**
 * Vérification PUBLIQUE d'une copie certifiée conforme (040), ouverte par le
 * QR code imprimé sur la copie. Le PDF reçu peut être comparé : son empreinte
 * est calculée dans le navigateur, le fichier ne part pas.
 */
const VerificationCopiePage = () => {
  const { jeton } = useParams();
  const base = `${urlApi()}/verifier/${encodeURIComponent(jeton)}`;
  const [c, setC] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [comparaison, setComparaison] = useState(null);
  const [calcul, setCalcul] = useState(false);

  useEffect(() => {
    document.title = 'Vérification d\'une copie certifiée';
    fetch(base).then(async (r) => {
      const corps = await r.json().catch(() => ({}));
      if (r.status === 404) setErreur('Cette copie n\'est pas enregistrée : le document présenté n\'a pas été délivré par ce service.');
      else if (!r.ok) setErreur(corps.message || 'Vérification indisponible.');
      else setC(corps);
    }).catch(() => setErreur('Serveur injoignable.'));
  }, [base]);

  const comparer = async (fichier) => {
    setCalcul(true);
    try { setComparaison((await empreinteFichier(fichier)) === c.empreinte_copie); } finally { setCalcul(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="max-w-lg mx-auto space-y-4">
        <h1 className="text-xl font-bold text-slate-900">Vérification d'une copie certifiée conforme</h1>
        {erreur ? (
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 flex gap-3"><ShieldAlert size={22} className="flex-shrink-0" /><p className="font-semibold">{erreur}</p></div>
        ) : !c ? <Loader2 size={28} className="animate-spin text-slate-400 mx-auto" /> : (
          <>
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex gap-3">
              <ShieldCheck size={22} className="flex-shrink-0" />
              <div>
                <p className="font-bold">Copie enregistrée au registre de {c.organisation}</p>
                <p className="text-sm">N° {c.numero}, délivrée le {new Date(c.delivre_at).toLocaleDateString('fr-FR')}.</p>
              </div>
            </div>
            <dl className="p-4 rounded-2xl bg-white border border-slate-200 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Document</dt><dd className="font-semibold">{c.document}</dd>
              <dt className="text-slate-500">Délivrée à</dt><dd className="font-semibold">{c.destinataire}</dd>
              <dt className="text-slate-500">Signataire</dt><dd className="font-semibold">{c.signataire}, {c.qualite}</dd>
              <dt className="text-slate-500">Pages</dt><dd className="font-semibold">{c.pages}</dd>
              {c.lieu && <><dt className="text-slate-500">Lieu</dt><dd className="font-semibold">{c.lieu}</dd></>}
            </dl>
            <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
              <p className="text-sm text-slate-600">Vous avez reçu la copie en PDF ? Comparez-la à l'exemplaire du registre. Le fichier reste sur votre appareil.</p>
              <label className="btn-secondary w-full flex items-center justify-center gap-2 cursor-pointer">
                {calcul ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} Choisir le PDF reçu
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && comparer(e.target.files[0])} />
              </label>
              {comparaison === true && <p className="text-sm font-bold text-emerald-700">Identique à l'exemplaire du registre : la copie n'a pas été modifiée.</p>}
              {comparaison === false && <p className="text-sm font-bold text-red-700">Ce fichier diffère de la copie délivrée : il a été modifié ou ce n'est pas la même copie.</p>}
              <p className="text-xs text-slate-400">Pour une copie papier, vérifiez que le numéro, la date et le destinataire ci-dessus correspondent à ceux imprimés.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VerificationCopiePage;
