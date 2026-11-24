# Deploy on a server

*[En français](#en-français)*

Use this if you want the app on a server on the Internet instead of on your own computer with Tailscale. One server is for **one household or group**: there is a single shared password, and everyone who has it sees the same games and uses your API credit.

You need a small Linux server with [Docker](https://docs.docker.com/engine/install/), a domain name pointing to it, ports 80 and 443 open, an [Anthropic API key](https://platform.claude.com) and an [ElevenLabs](https://elevenlabs.io) key.

```
git clone https://github.com/Alexis200007/board-game-narrator.git
cd board-game-narrator
cp .env.server.example .env
chmod 600 .env
nano .env
docker compose up -d --build
```

Open `https://your-domain` on the phone, enter the password, and add the page to the home screen. Caddy gets and renews the HTTPS certificate by itself.

- **Update:** `git pull && docker compose up -d --build`
- **Logs:** `docker compose logs -f app`
- **Change the password:** edit `.env`, then `docker compose up -d`. Everyone is signed out.
- **Back up the games:** `docker compose cp app:/data ./backup`. `docker compose down` keeps them; **`docker compose down -v` deletes them.**

## Other hosts (Render, Railway, Fly.io, a NAS…)

Build the `Dockerfile`, attach a persistent disk at `/data` (writable by user 1000), and set `APP_PASSWORD`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`. The host must provide HTTPS; the app reads `PORT`. Run a single instance: games are files. Serverless hosts (Vercel, Netlify…) won't work.

Without Docker: `npm ci`, set the variables below in `.env.local`, `npm start`, behind your own HTTPS proxy on the same machine.

| Variable | Meaning |
|---|---|
| `APP_PASSWORD` | Turns on sign-in (12 characters or more). Required when `HOST` isn't local. |
| `HOST` | Address to listen on. Default `127.0.0.1`; the Docker image uses `0.0.0.0`. |
| `PORT` | Default `5173`. |
| `TRUST_PROXY` | `1` behind a proxy, so failed sign-ins are counted per visitor. The Docker image sets it. Don't set it if visitors reach the app directly. |
| `DATA_DIR` | Where games are kept. Default `./data`; `/data` in Docker. |
| `CLAUDE_MODE` | `api` in Docker. The image doesn't include Claude Code. |

## Security

- The server refuses to start on a public address without a password.
- 8 sign-in attempts per visitor every 15 minutes; sessions last 30 days in a signed, HttpOnly cookie.
- Choose a long, unique password, and set a **spending limit** in both the Anthropic and ElevenLabs consoles.
- Photos, questions and rulebooks are sent to Anthropic, and text to read and voice-chat audio to ElevenLabs. Games stay unencrypted on your server.
- Don't publish copyrighted rulebooks: the app is meant for private use.

## En français

Pour installer l'app sur un serveur Internet plutôt que sur ton ordinateur avec Tailscale. Un serveur sert **un seul foyer ou groupe** : un mot de passe commun, les mêmes jeux, et tes crédits d'API.

Il faut un petit serveur Linux avec Docker, un nom de domaine qui pointe dessus, les ports 80 et 443 ouverts, une clé Anthropic et une clé ElevenLabs. Suis les commandes ci-dessus : remplis `.env` (domaine, mot de passe d'au moins 12 caractères, clés), puis lance `docker compose up -d --build`. Ouvre `https://ton-domaine` et entre le mot de passe.

Mets une **limite de dépenses** chez Anthropic et ElevenLabs. Attention : `docker compose down -v` efface les jeux.
