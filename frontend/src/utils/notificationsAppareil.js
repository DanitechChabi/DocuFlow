import api from '../services/api';

// ============================================================================
// Notifications sur cet appareil (058) : l'abonnement Web Push du navigateur
// ou de l'application installée. Les actions importantes (demande reçue,
// dossier transmis, retard…) s'affichent alors comme des notifications de
// l'ordinateur ou du téléphone, même application fermée.
// ============================================================================

export const pushPossible = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
  && 'Notification' in window && window.location.protocol === 'https:';

const enOctets = (base64) => {
  const b = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};

const enregistrement = async () => (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('/sw.js');

/** 'actif' | 'inactif' | 'refuse' | 'impossible' */
export async function etatNotifications() {
  if (!pushPossible()) return 'impossible';
  if (Notification.permission === 'denied') return 'refuse';
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = reg && await reg.pushManager.getSubscription();
  return abo && Notification.permission === 'granted' ? 'actif' : 'inactif';
}

const appareil = () => {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : 'Linux';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  return `${nav} · ${os}`;
};

/** Demande la permission (à appeler sur un clic) et abonne l'appareil. */
export async function activerNotifications() {
  if (!pushPossible()) throw new Error('Ce navigateur ne permet pas les notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées dans le navigateur.');
  const reg = await enregistrement();
  await navigator.serviceWorker.ready;
  const { data } = await api.get('/push/cle');
  let abo = await reg.pushManager.getSubscription();
  if (abo && abo.options?.applicationServerKey) {
    const actuelle = btoa(String.fromCharCode(...new Uint8Array(abo.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (actuelle !== data.cle) { await abo.unsubscribe(); abo = null; }
  }
  if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: enOctets(data.cle) });
  await api.post('/push/abonnement', { abonnement: abo.toJSON(), appareil: appareil() });
  return 'actif';
}

export async function desactiverNotifications() {
  const reg = await navigator.serviceWorker.getRegistration();
  const abo = reg && await reg.pushManager.getSubscription();
  if (abo) {
    await api.delete('/push/abonnement', { data: { endpoint: abo.endpoint } }).catch(() => {});
    await abo.unsubscribe();
  }
  return 'inactif';
}

/** À la connexion : un appareil déjà autorisé renouvelle son abonnement (nouvel utilisateur, nouvelle clé). */
export async function rafraichirAbonnement() {
  if (!pushPossible() || Notification.permission !== 'granted') return;
  try { await activerNotifications(); } catch { /* sans gravité */ }
}
