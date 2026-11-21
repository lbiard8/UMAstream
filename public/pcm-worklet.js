// Lecteur de son "brut" pour le mélangeur du stream (application de bureau uniquement).
//
// Le son d'une application arrive par petits morceaux (flottants 32 bits, stéréo entrelacé,
// 48 kHz), envoyés par umastream-audio.exe. Ce processeur les range dans un tampon circulaire
// et les restitue en continu au moteur audio, 128 images à la fois.
//
// Un AudioWorklet tourne dans un fil dédié au son : il ne saccade pas quand la page est occupée.

const SAMPLE_RATE = 48000;
const CAPACITY = SAMPLE_RATE; // 1 s de tampon maximum
const TARGET = Math.round(SAMPLE_RATE * 0.06); // on vise ~60 ms de retard
const MAX_LATENCY = Math.round(SAMPLE_RATE * 0.2); // au-delà de 200 ms de retard, on rattrape

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.read = 0; // prochaine image à jouer
    this.size = 0; // nombre d'images en attente
    this.started = false; // on attend un peu de réserve avant de commencer à jouer

    this.port.onmessage = (event) => {
      const samples = new Float32Array(event.data); // gauche, droite, gauche, droite…
      for (let i = 0; i + 1 < samples.length; i += 2) {
        if (this.size === CAPACITY) {
          // Tampon plein : on oublie la plus vieille image
          this.read = (this.read + 1) % CAPACITY;
          this.size--;
        }
        const write = (this.read + this.size) % CAPACITY;
        this.left[write] = samples[i];
        this.right[write] = samples[i + 1];
        this.size++;
      }
      // Trop de retard accumulé (l'appli a "rafalé") : on saute au plus récent
      if (this.size > MAX_LATENCY) {
        const skip = this.size - TARGET;
        this.read = (this.read + skip) % CAPACITY;
        this.size -= skip;
      }
    };
  }

  process(_inputs, outputs) {
    const [outLeft, outRight] = outputs[0];
    if (!this.started && this.size >= TARGET) this.started = true;
    for (let i = 0; i < outLeft.length; i++) {
      if (this.started && this.size > 0) {
        outLeft[i] = this.left[this.read];
        if (outRight) outRight[i] = this.right[this.read];
        this.read = (this.read + 1) % CAPACITY;
        this.size--;
      } else {
        // Plus rien à jouer (appli silencieuse) : du silence, et on se remet en réserve
        outLeft[i] = 0;
        if (outRight) outRight[i] = 0;
        this.started = false;
      }
    }
    return true; // le processeur reste actif tant que l'appli UMAstream est ouverte
  }
}

registerProcessor("pcm-player", PcmPlayer);
