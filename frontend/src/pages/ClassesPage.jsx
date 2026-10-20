import React from 'react';
import ClassesPanel from '../components/admin/ClassesPanel';
import { useTitrePage } from '../hooks/useTitrePage';

/**
 * Classes et plan de classement, dans le module Documents : l'archiviste
 * configure là où il travaille (la console d'administration, réservée aux
 * administrateurs, montre le même écran).
 */
const ClassesPage = () => {
  useTitrePage('Classes et propriétés');
  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <ClassesPanel />
    </div>
  );
};

export default ClassesPage;
