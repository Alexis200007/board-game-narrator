// Son de la conversation en direct, hors du fil principal.
// « capture » : micro → PCM 16 bits à 16 kHz, par paquets de 100 ms, avec le niveau sonore toutes les 20 ms environ.
// « voix » : joue le PCM reçu (24 kHz), peut se taire et reprendre au même endroit, et dit où il en est.

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pas = sampleRate / 16000;
    this.pos = 0; this.somme = 0; this.nb = 0;
    this.paquet = new Int16Array(1600); this.n = 0;
    this.carres = 0; this.mesures = 0;
  }
  process(entrees) {
    const x = entrees[0][0];
    if (!x) return true;
    for (let i = 0; i < x.length; i++) {
      this.carres += x[i] * x[i];
      // Moyenne des échantillons entre deux points à 16 kHz : évite le repliement.
      this.somme += x[i]; this.nb++; this.pos++;
      if (this.pos >= this.pas) {
        this.pos -= this.pas;
        const v = Math.max(-1, Math.min(1, this.somme / this.nb));
        this.somme = 0; this.nb = 0;
        this.paquet[this.n++] = v * 32767;
        if (this.n === 1600) {
          this.port.postMessage({ pcm: this.paquet.buffer }, [this.paquet.buffer]);
          this.paquet = new Int16Array(1600); this.n = 0;
        }
      }
    }
    this.mesures += x.length;
    if (this.mesures >= sampleRate / 50) {
      this.port.postMessage({ niveau: Math.sqrt(this.carres / this.mesures) });
      this.carres = 0; this.mesures = 0;
    }
    return true;
  }
}

class Voix extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pas = 24000 / sampleRate;
    this.vider();
    this.gain = 1; this.cible = 1; this.carres = 0; this.mesures = 0;
    this.port.onmessage = ({ data }) => {
      if (data.pcm) this.file.push(new Int16Array(data.pcm));
      else if (data.pause !== undefined) this.cible = data.pause ? 0 : 1;
      else if (data.vider) { this.vider(); this.cible = 1; }
    };
  }
  vider() { this.file = []; this.i = 0; this.joues = 0; }
  process(_, sorties) {
    const y = sorties[0][0];
    for (let k = 0; k < y.length; k++) {
      if (this.gain !== this.cible) this.gain = this.gain < this.cible ? Math.min(1, this.gain + 0.002) : Math.max(0, this.gain - 0.002); // ~10 ms, sans clic
      const b = this.file[0];
      if (!b || (this.gain === 0 && this.cible === 0)) { y[k] = 0; continue; }
      const j = Math.floor(this.i), f = this.i - j;
      const suivant = j + 1 < b.length ? b[j + 1] : (this.file[1]?.[0] ?? b[j]);
      y[k] = ((b[j] * (1 - f) + suivant * f) / 32768) * this.gain;
      this.carres += y[k] * y[k];
      this.i += this.pas;
      this.joues += this.pas;
      if (this.i >= b.length) { this.i -= b.length; this.file.shift(); }
    }
    for (let c = 1; c < sorties[0].length; c++) sorties[0][c].set(y);
    this.mesures += y.length;
    if (this.mesures >= sampleRate / 20) {
      this.port.postMessage({ joues: this.joues, vide: this.file.length === 0, niveau: Math.sqrt(this.carres / this.mesures) });
      this.carres = 0; this.mesures = 0;
    }
    return true;
  }
}

registerProcessor("capture", Capture);
registerProcessor("voix", Voix);
