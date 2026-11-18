# L'IA documentaire de l'AFGC : DocuBot avec Hugging Face et Ollama

DocuBot répond déjà avec ses règles : où est un dossier, qui l'a, l'état des demandes, les retards, les chiffres. Ce dossier ajoute un **modèle de langue** qui tourne sur un serveur de l'AFGC grâce à **Ollama**. Ce modèle est **entraîné** sur Google Colab avec les outils de **Hugging Face**.

Le modèle ne remplace pas les données. Il a deux rôles :

1. **Comprendre** une question que les règles ne reconnaissent pas, par exemple « le dossier des Ets Kpadonou est-il revenu ? ». Il en tire l'intention, l'entreprise, l'acte et la date, puis DocuFlow calcule la réponse sur la base. Le modèle n'invente donc jamais un nom, un chiffre ou une date.
2. **Rédiger** une réponse d'aide à partir des procédures de l'archive (`backend/src/config/connaissancesAfgc.js`), et seulement d'elles.

Sans Ollama, ou si le modèle ne répond pas, DocuBot fonctionne comme avant.

## Deux niveaux d'apprentissage

1. **Toujours actif, sans rien installer** : au démarrage du serveur, DocuBot apprend sur le jeu d'exemples ci-dessous (environ 4 500 questions, en 0,1 seconde, sans carte graphique). Ce petit modèle bayésien (`backend/src/services/intentionService.js`) reconnaît ce que veut une question tournée librement. Mesures sur des questions écrites à la main, hors des exemples :

   | | Règles seules | Avec le modèle appris |
   |---|---|---|
   | 70 questions libres (`config/questionsReellesDocubot.js`) | 46 % | 97 % |
   | 24 questions jamais vues pendant les réglages | 71 % | 96 % |

   Les formulations ajoutées au jeu ont été écrites après avoir vu les erreurs sur les 70 questions libres : le second jeu, jamais vu, est la mesure la plus honnête. Un test empêche le score des questions libres de descendre sous 90 %.
2. **En option, Ollama** : un vrai modèle de langue, entraîné sur Colab (ci-dessous), pour les questions que le premier niveau ne sait pas lire et pour rédiger l'aide.

## Le modèle choisi (niveau 2)

**Qwen3 4B Instruct 2507** (`Qwen/Qwen3-4B-Instruct-2507` sur Hugging Face), sous **licence Apache 2.0**, ce qui permet l'usage en entreprise. Il est bon en français, assez petit pour tourner sans carte graphique sur le serveur (environ 3 Go de mémoire, quelques secondes par question), et assez grand pour bien apprendre.

## Les quatre étapes

### 1 et 2. L'entraînement, sur Google Colab (gratuit, faisable depuis un téléphone)

1. Téléchargez le carnet : https://afgc.vercel.app/ia/entrainer-docubot.ipynb (ou depuis **Réglages → DocuBot : modèle de langue**).
2. Ouvrez https://colab.research.google.com, choisissez *Importer*, puis le carnet.
3. Menu *Exécution → Modifier le type d'exécution* → **GPU T4** → Enregistrer.
4. *Exécution → Tout exécuter*, puis **autorisez Google Drive** dans la fenêtre qui s'ouvre au début.
5. Comptez **30 à 45 minutes**. Gardez l'onglet ouvert ; sur téléphone, laissez l'écran allumé et branchez le chargeur. La cellule 5 affiche le score sur les questions de test (« Intention juste »).
6. À la fin, **`docubot-afgc.zip`** (environ 4,3 Go : le modèle GGUF et son `Modelfile`) se trouve dans **Mon Drive → DocuBot**. Les adaptateurs appris y sont aussi copiés dès la fin de l'apprentissage, pour ne rien perdre si la session coupe pendant la conversion.

Le carnet récupère tout seul le jeu d'exemples publié avec DocuFlow (`/ia/jeu-docubot-*.jsonl`). Ses noms d'entreprise sont **inventés** : rien de l'AFGC ne part sur Colab. Les noms du test diffèrent de ceux de l'entraînement : on mesure si le modèle a compris, pas s'il a appris par cœur.

Le carnet apprend avec la méthode LoRA, c'est-à-dire de petits « adaptateurs » ajoutés au modèle. Il les fusionne ensuite au modèle et le convertit pour Ollama (GGUF, 8 bits), avec les outils de llama.cpp.

**Variante avec les vrais noms**, à réserver à un entraînement sur un poste de l'AFGC :

```
cd backend
node scripts/ia-documentaire/generer-jeu.js --noms-reels --espace afgc --sortie ..\ia-documentaire\jeu
```

### 3. L'installation sur le serveur

1. Installez **Ollama** pour Windows : https://ollama.com/download/windows (`OllamaSetup.exe`).
2. Sur le serveur, téléchargez `docubot-afgc.zip` depuis Google Drive (Mon Drive → DocuBot).
3. En administrateur, depuis le dossier `scripts` de DocuFlow :

```
.\installer-docubot.ps1 -Paquet C:\chemin\docubot-afgc.zip
```

Le script fait trois choses :

- il lance Ollama au démarrage de Windows, **sur le serveur seulement** (127.0.0.1) ;
- il installe le modèle sous le nom `docubot-afgc` ;
- il fait un essai.

Pour essayer sans attendre l'entraînement, `.\installer-docubot.ps1 -Base` installe le modèle de départ, qui demande Internet pendant l'installation.

4. Dans DocuFlow, ouvrez **Réglages → DocuBot : modèle de langue** :
   - adresse `http://localhost:11434` ;
   - modèle `docubot-afgc` ;
   - cliquez sur **Enregistrer**, puis **Tester la connexion**.

Si Ollama tourne sur un autre poste, mettez son adresse, par exemple `http://10.0.0.25:11434`. Sur ce poste, réglez `OLLAMA_HOST=0.0.0.0:11434` et n'ouvrez le pare-feu qu'au serveur DocuFlow.

### 4. Mesurer

Depuis le dossier `backend`, avec Ollama lancé :

```
node scripts/ia-documentaire/evaluer.js --modele docubot-afgc --jeu jeu-docubot-test.jsonl
node scripts/ia-documentaire/evaluer.js --modele qwen3:4b-instruct --jeu jeu-docubot-test.jsonl
```

Les deux commandes donnent le pourcentage d'intentions, d'entreprises, d'actes et de dates justes, et les confusions les plus fréquentes. Comparez le modèle entraîné au modèle de départ.

## Faire progresser DocuBot

- **Nouvelles procédures** : ajoutez une phrase par idée dans `backend/src/config/connaissancesAfgc.js`. Elles servent tout de suite, sans réentraînement.
- **Nouvelles façons de demander** : ajoutez des modèles de questions dans `backend/src/services/jeuDocubotService.js`, puis réentraînez (étapes 1 à 3).
- **Une question mal comprise** par DocuBot : notez-la telle quelle et ajoutez-la au jeu avec la bonne lecture.

## Fichiers

| Fichier | Rôle |
|---|---|
| `ia-documentaire/entrainer.py` | Le code d'entraînement (source du carnet) |
| `ia-documentaire/entrainer-docubot.ipynb` | Le carnet Colab (refait par `python3 ia-documentaire/construire-carnet.py`) |
| `backend/src/services/jeuDocubotService.js` | La fabrique du jeu d'exemples |
| `backend/scripts/ia-documentaire/generer-jeu.js` | Le jeu en ligne de commande (option `--noms-reels`) |
| `backend/scripts/ia-documentaire/evaluer.js` | La mesure d'un modèle Ollama |
| `backend/src/services/ollamaService.js` | Le lien entre DocuFlow et Ollama (mêmes consignes que le jeu) |
| `backend/src/config/connaissancesAfgc.js` | Les procédures dans lesquelles DocuBot puise |
| `deploiement/windows-server/installer-docubot.ps1` | L'installation dans Ollama sur Windows Server |
