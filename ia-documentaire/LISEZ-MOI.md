# L'IA documentaire de l'AFGC : DocuBot avec Hugging Face et Ollama

DocuBot répond déjà avec ses règles : où est un dossier, qui l'a, l'état des demandes, les retards, les chiffres. Ce dossier ajoute un **modèle de langue** qui tourne sur un serveur de l'AFGC grâce à **Ollama**. Ce modèle est **entraîné** sur Google Colab avec les outils de **Hugging Face**.

Le modèle ne remplace pas les données. Il a deux rôles :

1. **Comprendre** une question que les règles ne reconnaissent pas, par exemple « le dossier des Ets Kpadonou est-il revenu ? ». Il en tire l'intention, l'entreprise, l'acte et la date, puis DocuFlow calcule la réponse sur la base. Le modèle n'invente donc jamais un nom, un chiffre ou une date.
2. **Rédiger** une réponse d'aide à partir des procédures de l'archive (`backend/src/config/connaissancesAfgc.js`), et seulement d'elles.

Sans Ollama, ou si le modèle ne répond pas, DocuBot fonctionne comme avant.

## Le modèle choisi

**Qwen3 4B Instruct 2507** (`Qwen/Qwen3-4B-Instruct-2507` sur Hugging Face), sous **licence Apache 2.0**, ce qui permet l'usage en entreprise. Il est bon en français, assez petit pour tourner sans carte graphique sur le serveur (environ 3 Go de mémoire, quelques secondes par question), et assez grand pour bien apprendre.

## Les quatre étapes

### 1. Le jeu d'exemples

Dans DocuFlow, ouvrez **Réglages → DocuBot : modèle de langue → Entraîner DocuBot** et téléchargez :

- `jeu-docubot-entrainement.jsonl` : environ 4 000 questions, chacune avec la bonne lecture ;
- `jeu-docubot-test.jsonl` : environ 400 autres questions, pour mesurer.

Les noms d'entreprise y sont **inventés**. Rien de l'AFGC ne part donc sur Colab, et les noms du test diffèrent de ceux de l'entraînement : on mesure si le modèle a compris, pas s'il a appris par cœur.

Variante avec les vrais noms, à réserver à un entraînement sur un poste de l'AFGC :

```
cd backend
node scripts/ia-documentaire/generer-jeu.js --noms-reels --espace afgc --sortie ..\ia-documentaire\jeu
```

### 2. L'entraînement, sur Google Colab (gratuit)

1. Dans Réglages, téléchargez le **carnet d'entraînement** (`entrainer-docubot.ipynb`).
2. Ouvrez https://colab.research.google.com → *Importer* → choisissez le carnet.
3. Menu *Exécution → Modifier le type d'exécution* → **GPU T4** → Enregistrer.
4. *Exécution → Tout exécuter*. À la cellule 2, choisissez les deux fichiers `.jsonl`.
5. Comptez **40 à 70 minutes**. La cellule 5 affiche le score sur les questions de test.
6. À la fin, le navigateur télécharge **`docubot-afgc.zip`** (environ 4,3 Go) : le modèle au format GGUF et son `Modelfile`.

Le carnet apprend avec la méthode LoRA, c'est-à-dire de petits « adaptateurs » ajoutés au modèle. Il les fusionne ensuite au modèle et le convertit pour Ollama (GGUF, 8 bits), avec les outils de llama.cpp.

### 3. L'installation sur le serveur

1. Installez **Ollama** pour Windows : https://ollama.com/download/windows (`OllamaSetup.exe`).
2. Copiez `docubot-afgc.zip` sur le serveur.
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
