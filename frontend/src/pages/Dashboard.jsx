import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import RequestForm from '../components/RequestForm';
import RequestTable from '../components/RequestTable';
import HistoryTable from '../components/HistoryTable';
import NotificationBell from '../components/NotificationBell';
import RequestDetailsModal from '../components/RequestDetailsModal';
import { requestService } from '../services/requestService';
import { requestDetailsService } from '../services/requestDetailsService';
import { authService } from '../services/authService';
import { useSettings } from '../contexts/SettingsContext';
import {
  Plus, LayoutDashboard, FileText, Package, Clock, TrendingUp,
  ShieldCheck, AlertCircle, CheckCircle, ArrowUpRight, RefreshCw, Menu
} from 'lucide-react';

const SkeletonCard = ({ delay = 0 }) => (
  <div className="bg-white rounded-2xl p-6 border border-slate-100" style={{ animationDelay: `${delay}ms` }}>
    <div className="flex justify-between items-start">
      <div className="space-y-3 flex-1">
        <div className="skeleton h-3 w-24 rounded"></div>
        <div className="skeleton h-9 w-20 rounded-lg"></div>
      </div>
      <div className="skeleton h-12 w-12 rounded-2xl"></div>
    </div>
  </div>
);

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const user = authService.getCurrentUser();
  const settings = useSettings();
  const logoSrc = settings.site_logo_url || 'https://th.bing.com/th/id/R.d7f2f165ad7ca819fe72a5f20a08a7c7?rik=cmptSS4F09F1Hw&riu=http%3a%2f%2fapiga.africa%2fimg%2fafgc.jpg&ehk=BW9PLt5Ge5oLmVWHbZvaEzZCStjt7IWIJj4n%2bEJym5M%3d&risl=&pid=ImgRaw&r=0';
  const isAdmin = user?.role === 'archiviste' || user?.role === 'admin' || user?.role === 'superadmin';

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = isAdmin
        ? await requestService.getAllRequests()
        : await requestService.getMyRequests();
      setRequests(data);
    } catch (err) {
      console.error('Erreur lors du chargement des demandes', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!isAdmin) return;
    try {
      const data = await requestService.getStats();
      setStats(data);
    } catch (err) {
      console.error('Erreur lors du chargement des stats', err);
    }
  };

  const fetchLogs = async () => {
    if (!isAdmin) return;
    try {
      const data = await requestService.getAuditLogs();
      setLogs(data);
    } catch (err) {
      console.error('Erreur lors du chargement de l\'historique', err);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchStats();
    fetchLogs();
  }, []);

  const handleOpenDetails = async (id) => {
    setSelectedRequest(id);
    setDetailsLoading(true);
    try {
      const data = await requestDetailsService.getDetails(id);
      setDetails(data);
    } catch (err) {
      alert('Erreur lors du chargement des détails');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleCloseDetails = () => {
    setSelectedRequest(null);
    setDetails(null);
    fetchRequests();
  };

  const statCards = [
    { key: 'en attente', label: 'En attente', icon: Clock, color: 'orange' },
    { key: 'a traiter', label: 'À traiter', icon: AlertCircle, color: 'purple' },
    { key: 'transmis', label: 'Transmis', icon: ArrowUpRight, color: 'green' },
    { key: 'rejete', label: 'Rejeté', icon: AlertCircle, color: 'red' },
  ];

  const totalRequests = requests.length;
  const pageTitle = {
    dashboard: 'Tableau de bord',
    requests: 'Mes demandes',
    all_requests: 'Gestion des archives',
    history: 'Historique des flux'
  }[activeTab];

  return (
    <div className="h-dvh bg-slate-50 flex flex-col lg:flex-row overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMobileOpen={sidebarOpen}
        onToggleMobile={() => setSidebarOpen(false)}
      />

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <Menu size={22} className="text-slate-700" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-afgc-secondary to-blue-600 flex items-center justify-center overflow-hidden">
              <img
                src={logoSrc}
                className="w-full h-full object-cover"
                alt="Logo"
              />
            </div>
            <span className="font-extrabold text-slate-800 text-sm">{settings.site_name || 'DocuFlow'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button onClick={fetchRequests} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <RefreshCw size={18} className="text-slate-500" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="fixed top-0 right-0 w-1/3 h-1/3 bg-blue-500/[0.03] rounded-full blur-3xl pointer-events-none"></div>
        <div className="fixed bottom-0 left-1/2 w-1/4 h-1/4 bg-slate-200/30 rounded-full blur-3xl pointer-events-none"></div>

        <div className="p-4 md:p-8 max-w-7xl mx-auto relative z-10">
          {/* Header */}
          <header className="hidden md:flex justify-between items-center mb-10 animate-fade-in-down">
            <div className="space-y-1">
              <h1 className="text-4xl font-black text-slate-900 tracking-tight">{pageTitle}</h1>
              <p className="text-slate-500 font-medium flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse-soft"></span>
                Session active : <span className="text-slate-800 font-bold">{user?.full_name}</span>
              </p>
            </div>
            <div className="flex items-center gap-4">
              <NotificationBell />
              <button onClick={fetchRequests} className="btn-secondary flex items-center gap-2 p-3" title="Rafraîchir">
                <RefreshCw size={18} className="text-slate-500" />
              </button>
              {user?.role === 'demandeur' && (
                <button onClick={() => setIsFormOpen(true)} className="btn-primary flex items-center gap-2 shadow-glow-blue animate-glow-pulse">
                  <Plus size={20} />
                  <span>Nouvelle demande</span>
                </button>
              )}
            </div>
          </header>

          {/* Mobile header summary */}
          <div className="md:hidden mb-6 animate-fade-in-down">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">{pageTitle}</h1>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              {user?.full_name} · <span className="uppercase text-slate-400">{user?.role}</span>
            </p>
            {user?.role === 'demandeur' && (
              <button onClick={() => setIsFormOpen(true)}
                className="mt-4 w-full btn-primary flex items-center justify-center gap-2 shadow-glow-blue">
                <Plus size={18} /> Nouvelle demande
              </button>
            )}
          </div>

          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <div className="animate-fade-in-up">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 mb-8 md:mb-10">
                {loading ? (
                  <>
                    <SkeletonCard delay={0} />
                    <SkeletonCard delay={100} />
                    <SkeletonCard delay={200} />
                    <SkeletonCard delay={300} />
                  </>
                ) : (
                  <>
                    <div className="bg-white rounded-2xl p-5 md:p-6 border border-slate-100 hover:shadow-lg hover:border-blue-200/50 transition-all duration-300 group cursor-default animate-fade-in-up delay-100">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total des demandes</p>
                          <h3 className="text-3xl md:text-4xl font-black text-slate-900">{totalRequests}</h3>
                        </div>
                        <div className="p-2.5 md:p-3 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-110 group-hover:bg-blue-100 transition-all duration-300">
                          <FileText size={22} />
                        </div>
                      </div>
                    </div>
                    {statCards.map(({ key, label, icon: Icon, color }, idx) => {
                      // Pour les demandeurs : stats calculées depuis leurs propres demandes
                      const count = isAdmin
                        ? (stats[key] || 0)
                        : requests.filter(r => r.statut === key).length;
                      return (
                        <div key={key} className="bg-white rounded-2xl p-5 md:p-6 border border-slate-100 hover:shadow-lg transition-all duration-300 group cursor-default animate-fade-in-up"
                          style={{ animationDelay: `${(idx + 1) * 100}ms` }}>
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">{label}</p>
                              <h3 className="text-3xl md:text-4xl font-black text-slate-900">{count}</h3>
                            </div>
                            <div className={`p-2.5 md:p-3 bg-${color}-50 text-${color}-600 rounded-2xl group-hover:scale-110 transition-all duration-300`}>
                              <Icon size={22} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Main content */}
          <div className="space-y-6 animate-fade-in-up delay-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2 md:gap-3">
                {isAdmin
                  ? <><Package size={20} className="text-afgc-secondary" /> <span>File d'attente</span></>
                  : <><FileText size={20} className="text-afgc-primary" /> <span>Mes requêtes</span></>
                }
              </h2>
              {loading && (
                <div className="flex items-center gap-2 text-xs md:text-sm text-slate-400">
                  <div className="w-4 h-4 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin"></div>
                  Chargement...
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              {activeTab === 'history' ? (
                <HistoryTable logs={logs} onRequestClick={handleOpenDetails} />
              ) : (
                <RequestTable requests={requests} role={user?.role} onRefresh={fetchRequests} onOpenDetails={handleOpenDetails} />
              )}
            </div>
          </div>
        </div>

        {/* Modals */}
        <RequestForm isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSuccess={fetchRequests} />
        {selectedRequest && (
          <RequestDetailsModal request={details?.request} history={details?.history || []} role={user?.role} onClose={handleCloseDetails} />
        )}
      </main>
    </div>
  );
};

export default Dashboard;
