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
    // IMPORTANT : les ports 4122-4221 + 4222-4321... sont dans la plage EXCLUE par Windows
    // (netsh interface ipv4 show excludedportrange protocol=tcp).
    // Utiliser 5174 (libre) pour éviter l'erreur EACCES.
    port: 5174,
    // Si le port 5174 est occupé, utiliser le port suivant disponible
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
