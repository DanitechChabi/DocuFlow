import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import api from '../services/api';
import { useSettings } from '../contexts/SettingsContext';
import { useTitrePage } from '../hooks/useTitrePage';

/** Affiche A4 du guichet : le QR code du portail citoyen et les trois étapes. */
const Affiche = ({ org, lien, qr }) => (
  <article className="certificat" style={{ textAlign: 'center' }}>
    <p className="certificat-surtitre">{org}</p>
    <h1 style={{ fontSize: '30px', margin: '12px 0' }}>Demandez vos actes d'état civil en ligne</h1>
    <p className="certificat-texte" style={{ fontSize: '16px' }}>Acte de naissance, de mariage, de décès : plus besoin de venir déposer votre demande.</p>
    <img src={qr} alt="QR code du portail" style={{ width: '260px', height: '260px', margin: '18px auto' }} />
    <p className="mono" style={{ fontSize: '14px', wordBreak: 'break-all' }}>{lien}</p>
    <ol style={{ textAlign: 'left', maxWidth: '460px', margin: '24px auto', fontSize: '16px', lineHeight: 1.7, listStyle: 'decimal', paddingLeft: '22px' }}>
      <li><b>Scannez</b> le code avec votre téléphone et remplissez la demande.</li>
      <li><b>Notez</b> votre code de suivi (DF-…) et suivez l'avancement en ligne.</li>
      <li><b>Venez une seule fois</b>, quand l'acte est prêt, avec votre code et une pièce d'identité.</li>
    </ol>
  </article>
);

const AffichePortailPage = () => {
  useTitrePage('Affiche du portail citoyen');
  const settings = useSettings();
  const [lien, setLien] = useState(null);
  const [qr, setQr] = useState(null);
  useEffect(() => {
    api.get('/portail-indicateurs').then(async (r) => {
      const l = r.data.lien || (r.data.chemin ? `${window.location.origin}${r.data.chemin}` : null);
      setLien(l);
      if (l) setQr(await QRCode.toDataURL(l, { width: 600, margin: 1, errorCorrectionLevel: 'M' }));
    }).catch(() => {});
  }, []);
  const org = settings.legal_entity || settings.site_name || '';
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[920px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link to="/demandes" className="text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"><ArrowLeft size={15} /> Demandes</Link>
        <button type="button" onClick={() => window.print()} disabled={!qr} className="btn btn-primary"><Printer size={16} /> Imprimer</button>
      </div>
      {!qr ? <div className="glass-card-premium p-16 text-center text-slate-400"><Loader2 size={28} className="animate-spin mx-auto" /></div>
        : <div className="certificat-ecran"><Affiche org={org} lien={lien} qr={qr} /></div>}
      {qr && createPortal(<div className="portail-impression portail-portrait"><style>{'@media print { @page { size: A4 portrait; margin: 14mm; } }'}</style><Affiche org={org} lien={lien} qr={qr} /></div>, document.body)}
    </div>
  );
};

export default AffichePortailPage;
