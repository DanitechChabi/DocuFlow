import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // Forcer l'écoute sur IPv4 (127.0.0.1) au lieu d'IPv6 (::1)
    // évite l'erreur "EACCES: permission denied ::1:5173" sur Windows
    host: '127.0.0.1',
    // IMPORTANT : le port 5173 est dans la plage de ports EXCLUE par Windows
    // (netsh interface ipv4 show excludedportrange protocol=tcp → 5139-5338).
    // Utiliser 4173 (libre) pour éviter l'erreur EACCES.
    port: 4173,
    // Si le port 4173 est occupé, utiliser le port suivant disponible
    strictPort: false,
    // Préfixer pour que l'API locale fonctionne en dev
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:30001',
        changeOrigin: true,
      },
    },
  },
})
