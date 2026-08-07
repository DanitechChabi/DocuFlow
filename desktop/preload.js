// Pont minimal entre la fenêtre et le processus principal (Electron).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  isDesktop: true,
  platform: process.platform,
});
