# Narrateur de jeux

*[English version](README.md)*

Prends en photo une carte, une règle ou un passage d'histoire d'un jeu. L'app le traduit (en français ou en anglais, au choix dans les réglages) et le lit à voix haute, avec une voix différente pour chaque personnage.

L'app tourne sur ton ordinateur et tu l'ouvres sur l'iPhone par Tailscale. La traduction passe par ton abonnement Claude (`claude -p`) ou par l'API Anthropic et les voix par ElevenLabs (modèle v4, voix francophones natives ; voix « premade » en secours).

## Ce que fait l'app

- **Profil par jeu** (bouton en haut) : glossaire des mots-clés, voix des personnages, livret de règles et parties, partagés entre les iPhone.
- **Règles** : une discussion en texte pour poser des questions. Les réponses s'appuient sur le livret ajouté dans « Le jeu » (photos des pages ou PDF).
- **Groupes** : un même jeu peut avoir plusieurs groupes de joueurs (« Le jeu » → Groupes). Chacun a ses parties, son historique, ses résumés et les voix de ses personnages. Le livret et le glossaire sont partagés. Chaque téléphone retient son groupe actif.
- **Assistant vocal** : dans Règles, le micro ouvre une conversation à voix haute. Le micro reste ouvert : la parole est transcrite en direct par ElevenLabs, Claude (gardé ouvert, livret déjà lu) répond et la voix « Règles » parle dès le premier mot. On le coupe en parlant. Après une minute sans parole, le micro se ferme. Tout reste écrit dans le chat ; le son n'est pas gardé sur l'ordinateur.
- **Pages du livret** : sous une réponse, l'app montre la page d'où vient la règle, passage surligné (PDF avec texte). Les PDF et photos sont gardés dans `data/livrets`. Pour un jeu « Legacy », la page reste floue jusqu'à ce qu'on la touche.
- **Aide-mémoire** : le bouton « Mon tour » ouvre une fiche en français (tour, actions, fin de partie), préparée une fois par jeu à partir du livret et gardée avec le jeu. Chaque section peut être écoutée.
- **Historique** : les cartes déjà lues, partie par partie, à relire sans repayer.
- **Précédemment…** : au début d'une nouvelle partie, le narrateur résume la précédente.
- **Ambiance sonore** sous la narration. Elle se coupe dans les réglages.

Toutes les données sont dans `data/` sur l'ordinateur (`data/jeux/` pour les profils, `data/audio/` pour le cache des voix et des ambiances).

## Une seule fois

1. Connecte Claude Code sur l'ordinateur :
   ```
   claude auth login
   ```
2. Installe les dépendances (`npm install`), copie `.env.example` vers `.env.local`, mets-y ta clé ElevenLabs, puis lance `npm start`.
3. Rends l'app accessible à tes appareils Tailscale, en HTTPS et seulement sur ton réseau Tailscale :
   ```
   tailscale serve --bg 5173
   ```
   La commande affiche l'adresse à ouvrir sur l'iPhone, du genre `https://<ton-ordinateur>.<ton-tailnet>.ts.net`.
4. Sur l'iPhone, ouvre cette adresse dans Safari, puis Partager → « Sur l'écran d'accueil ».

## Utiliser une clé API Claude

Par défaut, l'app passe par Claude Code et ton abonnement. Pour utiliser l'API Anthropic (facturée à l'usage), mets dans `.env.local` :

```
CLAUDE_MODE=api
ANTHROPIC_API_KEY=ta-cle
```

Une clé seule ne change rien : il faut aussi `CLAUDE_MODE=api`. Redémarre ensuite le serveur. `claude auth login` n'est alors pas nécessaire. Le livret est gardé en cache pour que les questions suivantes coûtent moins cher.

## Démarrage automatique

Sous Windows, une tâche planifiée (« Narrateur de jeux ») peut lancer le serveur à l'ouverture de session et le relancer s'il plante.

- Journal du serveur : `logs/serveur.log`
- Installer la tâche (ou la réinstaller après avoir déplacé le dossier) :
  ```
  powershell -ExecutionPolicy Bypass -File scripts\installer-demarrage.ps1
  ```
- Arrêter le serveur : `Stop-ScheduledTask -TaskName "Narrateur de jeux"`, puis termine le processus `node`.
- Retirer le démarrage automatique : `Unregister-ScheduledTask -TaskName "Narrateur de jeux" -Confirm:$false`

L'ordinateur doit rester allumé et ne pas se mettre en veille pendant la partie. Tailscale doit être actif sur l'iPhone.

## Sécurité

À la maison, le serveur n'a pas de mot de passe et utilise tes forfaits Claude et ElevenLabs. Ne l'expose pas sur Internet (pas de Tailscale Funnel) sans `APP_PASSWORD`.

## Installer sur un serveur

Sans Tailscale ni ordinateur à la maison : Docker, un nom de domaine et un mot de passe commun. Voir [docs/DEPLOY.md](docs/DEPLOY.md#en-français).

## Tests

```
npm test
```
