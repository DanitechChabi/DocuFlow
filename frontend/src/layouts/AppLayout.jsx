import React from 'react';
import { Outlet } from 'react-router-dom';
import Topbar from '../components/Topbar';
import DocumentChatbot from '../components/DocumentChatbot';

/**
 * Layout partagé de l'application :
 * topbar horizontale (barre des tâches) en haut + zone de contenu défilante.
 * Toutes les pages connectées s'affichent dans le <Outlet />.
 */
const AppLayout = () => {
  return (
    <div className="h-dvh bg-slate-50 flex flex-col overflow-hidden">
      <Topbar />
      <main className="flex-1 overflow-y-auto relative">
        <Outlet />
      </main>
      <DocumentChatbot />
    </div>
  );
};

export default AppLayout;
