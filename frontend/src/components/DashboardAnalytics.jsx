import React, { useState, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { TrendingUp, BarChart3, PieChart } from 'lucide-react';
import { requestService } from '../services/requestService';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, Legend);

/**
 * Panneau d'analytics pour le dashboard administrateur.
 * Affiche des graphiques Chart.js : répartition statuts, évolution, top entreprises.
 */
const DashboardAnalytics = () => {
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [statsData, logsData] = await Promise.all([
          requestService.getStats(),
          requestService.getAuditLogs(),
        ]);
        setStats(statsData);
        setLogs(logsData || []);
      } catch (err) {
        console.error('Analytics error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="glass-card-premium p-6 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <BarChart3 size={20} className="text-docuflow-secondary" />
          <h3 className="text-lg font-bold text-slate-800">Analyses</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 skeleton rounded-2xl"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // 1. Données pour le graphique Doughnut (répartition par statut)
  //
  // Les clés sont celles de la machine à états du backend (requestStateMachine.js) :
  // elles portent leurs accents (`livré`, `annulé`) et doivent correspondre au
  // caractère près, `getStats` renvoyant un objet indexé par la valeur brute de
  // la colonne `statut`. Le graphique lisait `stats['livre']` sans accent : le
  // segment « Livré » restait donc à zéro même avec des demandes livrées, et
  // « Annulé » n'était pas représenté du tout — deux statuts sur six perdus.
  const STATUS_SLICES = [
    { key: 'en attente', label: 'En attente', color: '#f59e0b' },
    { key: 'a traiter', label: 'À traiter', color: '#8b5cf6' },
    { key: 'transmis', label: 'Transmis', color: '#10b981' },
    { key: 'livré', label: 'Livré', color: '#3b82f6' },
    { key: 'rejete', label: 'Rejeté', color: '#ef4444' },
    { key: 'annulé', label: 'Annulé', color: '#94a3b8' },
  ];

  const statusData = {
    labels: STATUS_SLICES.map((s) => s.label),
    datasets: [{
      data: STATUS_SLICES.map((s) => stats[s.key] || 0),
      backgroundColor: STATUS_SLICES.map((s) => s.color),
      borderWidth: 0,
      hoverOffset: 8,
    }],
  };

  // 2. Données pour le graphique Bar (activité par jour — 7 derniers jours)
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7Days.push(d.toISOString().slice(0, 10));
  }
  const logsByDay = {};
  logs.forEach(log => {
    const dateStr = log.created_at || log.timestamp;
    if (!dateStr) return;
    try {
      const day = new Date(dateStr).toISOString().slice(0, 10);
      logsByDay[day] = (logsByDay[day] || 0) + 1;
    } catch { /* date invalide, ignorer */ }
  });
  const activityData = {
    labels: last7Days.map(d => {
      const date = new Date(d);
      return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    }),
    datasets: [{
      label: 'Actions',
      data: last7Days.map(d => logsByDay[d] || 0),
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      borderColor: '#3b82f6',
      borderWidth: 2,
      fill: true,
      tension: 0.4,
      pointRadius: 4,
      pointBackgroundColor: '#3b82f6',
    }],
  };

  // 3. Total des demandes toutes catégories.
  // `stats` vient de getStats, qui agrège la table `requests` : ce total compte
  // donc des DEMANDES, pas des actions du journal. L'intitulé disait « actions
  // enregistrées », ce qui laissait lire le nombre d'écritures d'audit.
  const total = Object.values(stats).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);

  return (
    <div className="glass-card-premium p-6 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={20} className="text-docuflow-secondary" />
        <h3 className="text-lg font-bold text-slate-800">Analyses</h3>
        <span className="text-xs text-slate-400 font-medium">
          {total} demande{total > 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Graphique 1 : Répartition par statut */}
        <div className="space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <PieChart size={14} /> Répartition
          </p>
          <div className="h-52 flex items-center justify-center">
            {total > 0 ? (
              <Doughnut
                data={statusData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom', labels: { padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 } } },
                  },
                  cutout: '65%',
                }}
              />
            ) : (
              <p className="text-sm text-slate-400">Aucune donnée</p>
            )}
          </div>
        </div>

        {/* Graphique 2 : Activité 7 derniers jours */}
        <div className="md:col-span-2 space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp size={14} /> Activité (7 jours)
          </p>
          <div className="h-52 flex items-center justify-center">
            {/* Une organisation neuve n'a aucune écriture d'audit : la courbe
                serait alors plate à zéro, ce qui se lit comme une panne du
                graphique plutôt que comme une absence de données. Le camembert
                voisin gère déjà ce cas — on aligne les deux. */}
            {logs.length > 0 ? (
              <Line
                data={activityData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
                    x: { ticks: { font: { size: 11 } }, grid: { display: false } },
                  },
                }}
              />
            ) : (
              <p className="text-sm text-slate-400">Aucune activité sur les 7 derniers jours</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardAnalytics;
