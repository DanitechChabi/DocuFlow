# Marque DocuFlow

## Master

`docuflow-logo.png` — logo officiel, **seule source de vérité**. Wordmark cursif,
512×512, encre noire opaque sur fond blanc opaque (aucun canal alpha).

Ne pas modifier les déclinaisons à la main : elles sont régénérées et toute
retouche serait écrasée. Pour changer la marque, remplacer ce fichier puis
relancer la génération.

## Génération

```bash
cd desktop && npm run brand
```

Le script (`desktop/scripts/make-brand.js`) vit dans `desktop/` parce que ses
deux dépendances — `sharp` et `png-to-ico` — y sont déjà déclarées ; il écrit
néanmoins dans `frontend/public/brand/` et `desktop/build/`. Il est idempotent.

Il est aussi appelé au début de `desktop/scripts/build-desktop.bat` : Vite
recopie `frontend/public/` au moment du build, donc des déclinaisons régénérées
après coup n'atteindraient `dist/` qu'au build suivant.

## Déclinaisons produites

`frontend/public/brand/` — versionné, servi en statique :

| Fichier | Usage |
| --- | --- |
| `docuflow-wordmark.png` | Wordmark, encre noire — emplacements larges sur fond clair |
| `docuflow-wordmark-light.png` | Wordmark, encre blanche — splash, fonds sombres |
| `docuflow-mark.png` | Monogramme « D », encre noire — topbar en thème clair |
| `docuflow-mark-light.png` | Monogramme « D », encre blanche — topbar en thème sombre, connexion |
| `favicon-{16,32,48,192,512}.png` | Onglet navigateur et icônes d'écran d'accueil |
| `apple-touch-icon.png` | iOS, 180×180, pré-composé sur fond opaque |

`desktop/build/` — non versionné (`.gitignore`), reconstruit à chaque build :
`icon.png` (512×512, electron-builder) et `icon.ico` (16→256, Inno Setup).

## Deux décisions de conception

**Détourage par luminance.** L'alpha est dérivé de la luminance et non par
seuillage binaire, ce qui préserve l'anticrénelage des courbes. Sans détourage,
le fond blanc du master s'afficherait en rectangle sur les fonds sombres.

**Monogramme pour les cadres carrés.** Le wordmark fait 3,3:1 ; dans un favicon
ou une icône d'application il devient illisible. Le « D » initial est donc
extrait pour ces usages. Le tracé cursif étant d'un seul trait, la coupe tombe
au point le plus fin du délié vers le « o » et emporte une écaille de celui-ci :
`keepLargestComponent()` la retire en ne gardant que la plus grande composante
connexe.

## Personnalisation par tenant

Ces déclinaisons ne sont que les valeurs par défaut. Un tenant qui téléverse un
`site_logo` (ou `site_favicon`) via la console de configuration les remplace :
voir `SettingsContext` côté frontend et le réglage `site_logo` du catalogue
côté backend.
