// Narration et ambiances ElevenLabs via le SDK officiel (la clé ELEVENLABS_API_KEY vient de .env.local).

// Une description anglaise fixe par ambiance : chaque ambiance n'est générée qu'une fois.
export const AMBIANCE_PROMPTS = {
  taverne: "Cozy medieval tavern ambience, murmuring crowd, clinking mugs, crackling fireplace, no music",
  foret: "Calm forest ambience, wind through leaves, distant birds, soft creaking branches",
  donjon: "Dark stone dungeon ambience, dripping water, distant chains, low eerie wind",
  tempete: "Stormy night ambience, heavy rain, rolling distant thunder, howling wind",
  combat: "Distant battle ambience, muffled clashing swords, war drums, shouting far away",
  ville: "Medieval town square ambience, footsteps on cobblestones, distant market chatter, cart wheels",
  mer: "Open sea ambience, waves against a wooden ship, creaking hull, seagulls in the distance",
  mystere: "Mysterious ambience, low ominous drone, faint whispers, subtle wind chimes",
};

export const MODELE_VOIX = "eleven_v4";
export const MODELE_RAPIDE = "eleven_v4_turbo"; // assistant vocal : même accent que les cartes (Flash déforme les voix), plus rapide que v4

export function createElevenTts(client) {
  return {
    /** Rend l'audio MP3 du texte (balises d'émotion v4 comprises). */
    async speak(text, voiceId, { rapide = false, langue = "fr" } = {}) {
      const stream = await client.textToSpeech.convert(voiceId, {
        text,
        modelId: rapide ? MODELE_RAPIDE : MODELE_VOIX,
        languageCode: langue,
        outputFormat: "mp3_44100_128",
        voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
      });
      return Buffer.from(await new Response(stream).arrayBuffer());
    },

    /** Voix en direct : PCM 24 kHz, rendu par morceaux dès le premier son. */
    async streamPcm(text, voiceId, langue = "fr") {
      return client.textToSpeech.stream(voiceId, {
        text, modelId: MODELE_RAPIDE, languageCode: langue, outputFormat: "pcm_24000",
        voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
      });
    },

    /** Jeton à usage unique : le téléphone parle à la transcription sans connaître la clé. */
    async jetonTranscription() {
      return (await client.tokens.singleUse.create("realtime_scribe")).token;
    },

    /** Transcrit une question posée à voix haute ; termes = noms du jeu à reconnaître. */
    async transcribe(buf, type, termes = [], langue = "fr") {
      const r = await client.speechToText.convert({
        file: new Blob([buf], { type }),
        modelId: "scribe_v2",
        languageCode: langue,
        tagAudioEvents: false,
        noVerbatim: true,
        ...(termes.length ? { keyterms: termes } : {}),
      });
      return (r.text || "").trim();
    },

    /** Boucle d'ambiance de 20 s (SFX v3), à jouer doucement sous la narration. */
    async ambiance(nom) {
      const stream = await client.textToSoundEffects.convert({
        text: AMBIANCE_PROMPTS[nom],
        modelId: "eleven_text_to_sound_v3",
        durationSeconds: 20,
        promptInfluence: 0.5,
        loop: true,
      });
      return Buffer.from(await new Response(stream).arrayBuffer());
    },

    async listVoices() {
      const { voices = [] } = await client.voices.getAll();
      return voices.map((v) => ({ voice_id: v.voiceId, name: v.name, category: v.category, labels: v.labels || {} }));
    },
  };
}
