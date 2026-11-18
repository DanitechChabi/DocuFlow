// ============================================================================
// Application installable (PWA) : manifeste et service worker, selon l'édition
// (AFGC Archives ou DocuFlow). Le service worker garde l'interface en cache
// pour qu'elle s'ouvre vite et hors ligne ; les données (l'API, sur une autre
// adresse) ne sont jamais mises en cache.
// ============================================================================

const MARQUES = {
  afgc: {
    name: 'AFGC Archives', short_name: 'AFGC Archives',
    description: 'Demandes de dossiers, sorties et fonds des archives de l\'AFGC.',
    theme_color: '#091422', background_color: '#091422',
    icones: { petite: '/editions/afgc/pwa-192.png', grande: '/editions/afgc/pwa-512.png', masquable: '/editions/afgc/pwa-maskable-512.png', apple: '/editions/afgc/apple-touch-icon.png' },
  },
  defaut: {
    name: 'DocuFlow', short_name: 'DocuFlow',
    description: 'Plateforme de gestion documentaire et d\'archivage.',
    theme_color: '#0f172a', background_color: '#0f172a',
    icones: { petite: '/brand/favicon-192.png', grande: '/brand/favicon-512.png', masquable: null, apple: '/brand/apple-touch-icon.png' },
  },
};

function manifeste(m) {
  return {
    name: m.name, short_name: m.short_name, description: m.description, lang: 'fr',
    start_url: '/', scope: '/', id: '/', display: 'standalone', orientation: 'any',
    theme_color: m.theme_color, background_color: m.background_color,
    icons: [
      { src: m.icones.petite, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: m.icones.grande, sizes: '512x512', type: 'image/png', purpose: 'any' },
      ...(m.icones.masquable ? [{ src: m.icones.masquable, sizes: '512x512', type: 'image/png', purpose: 'maskable' }] : []),
    ],
  };
}

function serviceWorker(m, version) {
  const prechargees = ['/', '/manifest.webmanifest', m.icones.petite, m.icones.grande];
  return `// Service worker généré à la compilation (pwa.config.js).
const CACHE = 'interface-${version}';
const PRECHARGEES = ${JSON.stringify(prechargees)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECHARGEES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const url = new URL(r.url);
  // Seulement l'interface : ni l'API (autre adresse), ni les envois.
  if (r.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') {
    // Les pages : le réseau d'abord, l'interface en cache hors ligne.
    e.respondWith(fetch(r).then((rep) => { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put('/', copie)); return rep; })
      .catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Fichiers compilés (nom unique) : le cache d'abord.
    e.respondWith(caches.match(r).then((x) => x || fetch(r).then((rep) => { if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(r, copie)); } return rep; })));
    return;
  }
  // Le reste (icônes, images) : le cache, mis à jour en arrière-plan.
  e.respondWith(caches.match(r).then((x) => {
    const reseau = fetch(r).then((rep) => { if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then((c) => c.put(r, copie)); } return rep; }).catch(() => x);
    return x || reseau;
  }));
});
`;
}

export function pwa(edition) {
  const m = MARQUES[edition] || MARQUES.defaut;
  return {
    name: 'docuflow-pwa',
    transformIndexHtml(html) {
      let h = html
        .replace(/<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="${m.theme_color}" />`)
        .replace(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" sizes="180x180" href="${m.icones.apple}" />`)
        .replace(/<meta name="application-name"[^>]*>/, `<meta name="application-name" content="${m.name}" />`);
      const ajout = `<link rel="manifest" href="/manifest.webmanifest" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${m.short_name}" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`;
      if (edition === 'afgc') h = h.replace(/<title>[^<]*<\/title>/, '<title>AFGC Archives</title>')
        .replace(/href="\/brand\/favicon-(32|16|192)\.png"/g, (x, t) => (t === '192' ? `href="${m.icones.petite}"` : 'href="/editions/afgc/embleme.png"'));
      return h.replace('</head>', `    ${ajout}\n  </head>`);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifeste(m), null, 2) });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(m, Date.now().toString(36)) });
    },
  };
}
