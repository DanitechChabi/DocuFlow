import React from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';

/** Page réservée à d'autres profils : on le dit, et on propose où aller. */
const AccesReserve = () => (
  <div className="min-h-[60vh] flex items-center justify-center p-6">
    <div className="max-w-md text-center animate-fade-in-up">
      <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-4"><Lock size={24} className="text-slate-600" /></div>
      <h1 className="text-xl font-bold text-slate-900">Cette page est réservée</h1>
      <p className="mt-2 text-sm text-slate-600">
        Votre compte n'y a pas accès. Si vous en avez besoin pour votre travail, demandez à l'administrateur des archives d'ajuster votre rôle.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/" className="px-4 py-2.5 rounded-md bg-slate-900 text-white text-sm font-semibold">Retour à l'accueil</Link>
        <Link to="/demandes/mes-demandes" className="px-4 py-2.5 rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-800">Mes dossiers</Link>
      </div>
    </div>
  </div>
);

export default AccesReserve;
