// ============================================================================
// Ce que DocuBot sait des archives de l'AFGC : les passages dans lesquels le
// modèle de langue (Ollama) puise pour rédiger une réponse d'aide. Il ne
// répond qu'à partir d'eux. À compléter par l'archive : une idée par passage.
// ============================================================================
module.exports = [
  'Les dossiers retirés sont entrés aux archives chaque jour : c\'est le « point ». La date du point et la semaine de production servent à retrouver le dossier.',
  'Une semaine de production va du vendredi au jeudi suivant ; les jours fériés (Pâques, Ascension, Pentecôte, Tabaski, Ramadan, Maouloud, fêtes nationales) sont exclus.',
  'Dans une semaine, les dossiers sont classés par lettre, selon la première lettre du nom de l\'entreprise (sans « Société », « Ets », « SARL »).',
  'Les dossiers sont rangés dans les armoires du couloir des toilettes : chaque armoire couvre une suite de semaines et de lettres ; le plan est dans « Entrée des dossiers », onglet « Rangement ».',
  'Pour demander un dossier, l\'agent tape le nom de l\'entreprise ou le n° d\'acte dans « Quel dossier vous faut-il ? », choisit le motif et la typologie, puis appuie sur Entrée ; l\'archive est prévenue par la cloche et par courriel.',
  'Plusieurs dossiers se demandent d\'un coup : on les colle un par ligne dans la boîte de demande, ou on envoie un classeur Excel avec « Demander une liste (Excel) » (par exemple pour les soldes créditeurs).',
  'Le motif de la demande (consultation, actualisation, contentieux, restitution de provision…) est retenu d\'une fois sur l\'autre sur le poste de l\'agent.',
  'La typologie du dossier (attestation, bonne exécution, avance de démarrage, caution douanière, soumission, retenue de garantie, prêt, garantie bancaire) fait partie de l\'intitulé du dossier ; certaines typologies exigent le n° d\'acte, l\'année ou la banque.',
  'Le n° d\'acte s\'écrit avec l\'année : 2025/2479. Un acte de décembre est souvent entré en janvier de l\'année suivante.',
  'Quand il manque une information, l\'archive renvoie la demande « À compléter » avec ce qui manque ; l\'agent la complète dans « Mes dossiers » et elle repart à l\'archive.',
  'L\'archive transmet le dossier papier à l\'agent ; la date de retour prévue est fixée par la durée de prêt réglée par l\'administrateur, et un rappel part en cas de retard.',
  'Pour rendre un dossier, l\'agent le rapporte à l\'archive, qui enregistre le retour dans « Dossiers sortis » ou avec la douchette.',
  'Les dossiers des années numérisées sont dans M-Files : l\'archive envoie la copie numérique (« Servi par M-Files ») et le papier ne sort pas.',
  'La douchette (lecteur de code-barres USB) lit le code du dossier ou le n° d\'acte tapé : le dossier s\'affiche avec « Sortir » ou « Rentrer ».',
  'Les points sont importés depuis le classeur Excel du jour avec « Importer des points (Excel) » ; une ligne déjà importée n\'est pas ajoutée deux fois. Un classeur importé par erreur se supprime dans l\'onglet « Classeurs importés ».',
  'Un agent crée son compte avec « Créer un compte » et son adresse professionnelle ; l\'administrateur peut aussi le créer dans « Comptes », et désactiver le compte d\'un agent qui part.',
  'Le mot de passe se change en cliquant sur son nom, en bas à gauche, puis « Mot de passe ». En cas d\'oubli, l\'administrateur le réinitialise.',
  'Le tableau de bord de la direction montre les demandes, les sorties, les retards et les entrées par période.',
  'L\'application tourne sur le serveur interne de l\'AFGC ; les documents et les questions posées à DocuBot ne sortent pas du réseau.',
];
