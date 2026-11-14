/** The sounds that tell a screen's voice control apart without looking: heard, understood, or failed. */
export type VoiceCue = 'listen' | 'ok' | 'fail';

/** One soft tone: its pitch (Hz), when it starts (s), how long it sounds (s) and how loud it is. */
type Note = readonly [hz: number, at: number, length: number, level: number];

const CUES: Record<VoiceCue, readonly Note[]> = {
  /** Two quick rising tones: the wake word was heard, go ahead. */
  listen: [[660, 0, 0.12, 0.25], [990, 0.09, 0.2, 0.25]],
  /** A high ping: the command was understood. */
  ok: [[1760, 0, 0.45, 0.3], [2637, 0, 0.3, 0.08]],
  /** A low, short tone: the command failed. */
  fail: [[196, 0, 0.5, 0.4], [147, 0.12, 0.5, 0.4]],
};

let ctx: AudioContext | undefined;

/** Plays a cue; silent where the browser has no audio or has not allowed it yet. */
export function playCue(cue: VoiceCue) {
  try {
    ctx ??= new AudioContext();
    const audio = ctx;
    void audio.resume();
    const now = audio.currentTime;
    for (const [hz, at, length, level] of CUES[cue]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      // A quick attack and an exponential fall, so it pings instead of clicking.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(level, now + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + length + 0.05);
    }
  } catch {
    // no audio here: the strip on screen still says it
  }
}
