// Génère build/icon.png (512×512) et build/icon.ico depuis le logo officiel.
//   - icon.png  : icône pour electron-builder (installateur bureau).
//   - icon.ico  : icône pour l'installateur Inno Setup (installer/docuflow-setup.iss).
//
// La génération elle-même vit dans make-brand.js, qui produit d'un seul tenant
// les icônes bureau et les déclinaisons web : les deux jeux doivent sortir du
// même master, sans quoi le bureau et le navigateur divergent. Ce fichier reste
// comme point d'entrée du script npm `icon` déjà référencé par la chaîne de
// build. Non bloquant : en cas d'échec, l'icône par défaut est utilisée.
require('./make-brand.js');
