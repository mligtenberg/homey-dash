import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Injectable, input, signal } from '@angular/core';
import { timerLength } from '@homey-dash/tiles';
import { LucideCheck, LucideMic, LucideMicOff, LucideTriangleAlert } from '@homey-dash/design-system';
import { t, tr, TranslatePipe } from '@homey-dash/i18n';
import { LucideDynamicIcon } from '@lucide/angular';
import { safeStorage, screenId } from './screen-id';

/** Where a screen remembers that it listens, switched in its screen settings. */
const VOICE_KEY = 'homeydash.voice';
const MUTE_KEY = 'homeydash.voice-muted';
/** Whether this screen leaves hearing the wake word to the voice service, because it is too slow to do it itself. */
const SERVER_KEY = 'homeydash.voice.server';
/** Set when this screen listens without the browser's own echo and noise filters, which cost a slow tablet processing time. */
const RAW_KEY = 'homeydash.voice.raw';

/** How long a result stays up after it arrives. */
export const RESULT_MS = 6_000;

/** Where the voice service's pages and assets are reached, through HomeyDash. */
const VOICE_BASE = '/voice/';
/** The score (0 to 1) from which the voice service counts the wake word as said, when it hears it for a screen (`WAKE_THRESHOLD` in its app.py); the detector on a screen has its own. */
export const SERVER_WAKE_THRESHOLD = 0.5;
/** How much of the audio before the wake word goes with it; how long a command may take to come. */
const PREROLL = 16000 * 2;
const SESSION_MS = 12_000;
/** Below this loudness (and 3 times the room's own) the detector rests; it keeps going for GATE_TAIL blocks of 80 ms after the sound, and starts from GATE_PREROLL blocks before it. */
const GATE_MIN = 0.012;
const GATE_TAIL = 20;
const GATE_PREROLL = 24;
/** How many blocks of 80 ms may wait for the detector: a longer queue means the wake word is heard that much later. */
const MAX_BACKLOG = 5;

/**
 * What this browser can do that the wake word depends on, as lines of text, for a screen that cannot say why it does
 * not listen (a tablet has no console): WebAssembly, workers, and whether the voice service hands out the module.
 */
export async function diagnose(): Promise<string> {
  const module = await fetch(VOICE_BASE + 'mww/mww.wasm', { method: 'HEAD' }).then((r) => (r.ok ? 'ok' : `HTTP ${r.status}`), () => 'no answer');
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    `WebAssembly: ${typeof WebAssembly !== 'undefined'}, workers: ${typeof Worker !== 'undefined'}, secure: ${window.isSecureContext}, RAM: ${nav.deviceMemory ?? '?'} GB`,
    `wake word module from the voice service: ${module}`,
    nav.userAgent,
  ].join('\n');
}

/** What listening needs of a wake word detector. */
export interface Detector {
  /** Where it runs: in a worker, or on the page itself. */
  readonly kind: 'worker' | 'page';
  /** How many blocks are being worked on. */
  readonly busy: number;
  /** The score (0 to 1) from which the wake word counts as said. */
  readonly threshold: number;
  /** The highest score of what was fed (0 to 1). */
  feed(samples: Float32Array): Promise<number>;
  reset(): void;
  stop(): void;
}

/** The same detector on the page's own thread, for a browser whose workers cannot run it. */
class InlineDetector implements Detector {
  readonly kind = 'page';
  readonly busy = 0; // it answers at once, and the next block waits for it

  constructor(private readonly ww: { threshold: number; feed(samples: Float32Array): number; reset(): void }) {}

  static async start(): Promise<InlineDetector> {
    const { MicroWakeWord } = (await import(/* @vite-ignore */ VOICE_BASE + 'mww/mww.js')) as { MicroWakeWord: { create(): Promise<InlineDetector['ww']> } };
    return new InlineDetector(await MicroWakeWord.create());
  }

  get threshold() {
    return this.ww.threshold;
  }

  feed(samples: Float32Array) {
    return Promise.resolve(this.ww.feed(samples));
  }

  reset() {
    this.ww.reset();
  }

  stop() {}
}

/** The wake word detector, which runs in a worker so that listening does not slow the page down. */
class WakeDetector implements Detector {
  readonly kind = 'worker';
  private readonly waiting: ((score: number) => void)[] = [];

  constructor(
    private readonly worker: Worker,
    readonly threshold: number,
  ) {
    worker.onmessage = ({ data }) => data.type === 'score' && this.waiting.shift()?.(data.score);
  }

  /** The worker once it has loaded the wake word, or why it could not. */
  static async start(): Promise<WakeDetector> {
    const worker = new Worker(VOICE_BASE + 'wakeword-worker.js');
    const threshold = await new Promise<number>((resolve, reject) => {
      worker.onmessage = ({ data }) => (data.type === 'ready' ? resolve(data.threshold) : data.type === 'error' && reject(new Error(data.message)));
      worker.onerror = (e) => reject(new Error(`The wake word could not be loaded: ${e.message || VOICE_BASE + 'wakeword-worker.js'}`));
      worker.postMessage({ type: 'init' });
    });
    return new WakeDetector(worker, threshold);
  }

  /** How many blocks are being worked on. */
  get busy() {
    return this.waiting.length;
  }

  /** The highest score of what was fed; the samples are handed over to the worker. */
  feed(samples: Float32Array): Promise<number> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.worker.postMessage({ type: 'feed', samples }, [samples.buffer]);
    });
  }

  reset() {
    this.worker.postMessage({ type: 'reset' });
  }

  stop() {
    this.worker.terminate();
  }
}

/** Starts the wake word detector: in a worker, or on the page where the browser cannot run it in one. */
export function startDetector(): Promise<Detector> {
  return WakeDetector.start().catch((e) => {
    // Some browsers (an older Android WebView, such as Fully Kiosk's) cannot run it in a worker.
    console.warn('Wake word worker failed, running it on the page instead:', e);
    return InlineDetector.start();
  });
}

/** The microphone as 16 kHz mono blocks of 1280 samples (80 ms) (floats, -1 to 1), which is what the wake word and the voice service take. */
export async function openMicrophone(onBlock: (samples: Float32Array) => void, filters = true) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, noiseSuppression: filters, echoCancellation: filters },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  // The browser hands the worklet 128 samples at a time; 1280 (80 ms) go to the page at once, a tenth of the messages.
  const worklet = `class P extends AudioWorkletProcessor {
      constructor() { super(); this.b = new Float32Array(1280); this.n = 0; }
      process(i) {
        const c = i[0][0];
        if (c) { this.b.set(c, this.n); this.n += c.length; if (this.n >= 1280) { this.port.postMessage(this.b.slice()); this.n = 0; } }
        return true;
      }
    }
    registerProcessor('pcm', P);`;
  const url = URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const node = new AudioWorkletNode(ctx, 'pcm');
  ctx.createMediaStreamSource(mic).connect(node);
  node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => onBlock(data);
  return {
    mic,
    ctx,
    stop: () => {
      mic.getTracks().forEach((track) => track.stop());
      void ctx.close();
    },
  };
}

/** What HomeyDash answers to a command it heard, once it has carried it out (the fields a screen shows). */
export interface VoiceResult {
  ok: boolean;
  action: string | null;
  value: number | { seconds: number; name: string | null } | null;
  zones: string[];
  reason: string | null;
  command_text?: string;
  /** What Homey said when it refused all or part of it. */
  detail?: string;
}

/** What a screen shows of voice: nothing, waiting for a command, working it out, or the answer. */
export type VoicePhase =
  | { kind: 'off' }
  | { kind: 'awake' }
  | { kind: 'thinking'; heard?: string }
  | { kind: 'result'; result: VoiceResult };

export type VoiceEvent =
  | { type: 'state'; state: 'idle' | 'speech' | 'thinking' | 'awake' }
  | { type: 'heard'; text: string; wake: boolean; armed: boolean }
  | ({ type: 'result' } & VoiceResult);

/**
 * What an event from HomeyDash does to what is shown. Nothing shows until the wake word was heard; a result stays up
 * until it times out.
 */
export function nextPhase(phase: VoicePhase, event: VoiceEvent): VoicePhase {
  switch (event.type) {
    case 'state':
      if (event.state === 'awake') return phase.kind === 'result' ? phase : { kind: 'awake' };
      if (event.state === 'thinking') return phase.kind === 'awake' ? { kind: 'thinking' } : phase;
      if (event.state === 'idle') return phase.kind === 'result' ? phase : { kind: 'off' };
      return phase;
    case 'heard':
      return event.wake || event.armed ? { kind: 'thinking', heard: event.text } : phase.kind === 'thinking' ? { kind: 'off' } : phase;
    case 'result':
      return { kind: 'result', result: event };
  }
}

/** The timer a result asks for, when it asks for one. */
export function timerOf(result: VoiceResult): { seconds: number; name: string | null } | null {
  return result.action === 'timer' && typeof result.value === 'object' && result.value ? result.value : null;
}

/** The short sentence for what was understood, in the screen's language. */
export function understood(result: VoiceResult): string {
  switch (result.action) {
    case 'lights_on': return t('Lights on');
    case 'lights_off': return t('Lights off');
    case 'lights_dim': return t('Lights at {percent}%', { percent: Math.round((typeof result.value === 'number' ? result.value : 0) * 100) });
    case 'timer': return t('Timer for {length}', { length: timerLength(timerOf(result)?.seconds ?? 0) });
    case 'lights_warmer': return t('Lights warmer');
    case 'lights_cooler': return t('Lights cooler');
    case 'warmer': return t('Warmer');
    case 'colder': return t('Colder');
    default: return t("That didn't work");
  }
}

/**
 * A screen that listens, once it has been switched on: it waits for the wake word on the screen itself, then streams
 * the command to HomeyDash (/api/voice/listen). HomeyDash has it understood by the voice service and carries it out in
 * Homey, and answers with the result. This only shows what HomeyDash says.
 */
@Injectable({ providedIn: 'root' })
export class Voice {
  readonly phase = signal<VoicePhase>({ kind: 'off' });
  /** Whether this screen listens; a setting of this screen alone, kept in its own storage. */
  readonly enabled = signal(false);
  /** Whether the wake word is heard by the voice service: the screen then streams all it hears. */
  readonly server = signal(false);
  /** Whether the microphone is muted; remembered across reloads. */
  readonly muted = signal(false);
  /** Whether the browser filters echo and noise out of the microphone; off saves a slow screen some work. */
  readonly filters = signal(true);
  /** Why listening could not start, as the browser says it, until it is tried again. */
  readonly error = signal('');
  /** Whether this browser can listen at all: it needs a microphone, which browsers give only to pages on https. */
  readonly available = !!navigator.mediaDevices?.getUserMedia;

  private readonly storage = safeStorage();
  private ws?: WebSocket;
  private ctx?: AudioContext;
  private mic?: MediaStream;
  private detector?: Detector;
  private session?: ReturnType<typeof setTimeout>;
  private clear?: ReturnType<typeof setTimeout>;
  private stopped = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    this.server.set(this.storage?.getItem(SERVER_KEY) === 'on');
    this.filters.set(this.storage?.getItem(RAW_KEY) !== 'on');
    if (this.storage?.getItem(VOICE_KEY) === 'on') this.set(true);
  }

  /** Listens with or without the browser's echo and noise filters; restarts listening to change over. */
  setFilters(on: boolean) {
    if (on === this.filters()) return;
    this.filters.set(on);
    if (on) this.storage?.removeItem(RAW_KEY);
    else this.storage?.setItem(RAW_KEY, 'on');
    this.restart();
  }

  private restart() {
    if (this.enabled() && !this.stopped) {
      this.stop();
      void this.start();
    }
  }

  /** Has the wake word heard here on the screen, or by the voice service; restarts listening to change over. */
  setServer(on: boolean) {
    if (on === this.server()) return;
    this.server.set(on);
    if (on) this.storage?.setItem(SERVER_KEY, 'on');
    else this.storage?.removeItem(SERVER_KEY);
    if (this.enabled() && !this.stopped) {
      this.stop();
      void this.start();
    }
  }

  /** Starts or stops listening, and remembers which. */
  set(on: boolean) {
    if (on && !this.available) return;
    if (on === this.enabled()) return;
    this.enabled.set(on);
    this.muted.set(on && this.storage?.getItem(MUTE_KEY) === 'on');
    this.error.set('');
    if (on) this.storage?.setItem(VOICE_KEY, 'on');
    else this.storage?.removeItem(VOICE_KEY);
    if (on && !this.muted()) void this.start();
    else this.stop();
  }

  /** Stops listening for a while without forgetting that this screen listens, so the microphone and the processor are free to test. */
  suspend() {
    if (this.enabled() && !this.stopped) this.stop();
  }

  /** Mutes the microphone, or listens again. */
  toggleMute() {
    if (!this.enabled()) return;
    const mute = !this.muted();
    this.muted.set(mute);
    if (mute) this.storage?.setItem(MUTE_KEY, 'on');
    else this.storage?.removeItem(MUTE_KEY);
    if (mute) this.stop();
    else void this.start();
  }

  /** Listens again after `suspend`. */
  resume() {
    if (this.enabled() && this.stopped && !this.muted()) void this.start();
  }

  /** Takes an event the way HomeyDash sends it; also how a screen is tried without a microphone. */
  receive(event: VoiceEvent) {
    clearTimeout(this.clear);
    this.phase.update((phase) => nextPhase(phase, event));
    if (this.phase().kind === 'result') this.clear = setTimeout(() => this.phase.set({ kind: 'off' }), RESULT_MS);
  }

  // The wake word is listened for here on the screen (microWakeWord's "hey jarvis", run in the browser), so no audio
  // leaves the screen until it is said. Then the last two seconds and what follows go to HomeyDash, which has the command
  // understood and carried out, and answers with how it went.
  private async start() {
    this.stopped = false;
    try {
      if (this.server()) return await this.startRemote();
      this.detector = await startDetector();
      if (this.stopped) return this.stop();
      const blocks: ((samples: Float32Array) => void)[] = [];
      const opened = await openMicrophone((samples) => blocks[0]?.(samples), this.filters());
      this.mic = opened.mic;
      this.ctx = opened.ctx;
      if (this.stopped) return this.stop();
      blocks[0] = this.listen(this.detector);
    } catch (e) {
      this.error.set((e instanceof Error ? `${e.name}: ${e.message}` : String(e)) + '\n' + (await diagnose().catch(() => '')));
      this.stop(); // no microphone, no permission or no voice service: the screen stays as it was
      this.enabled.set(false);
      this.storage?.removeItem(VOICE_KEY);
    }
  }

  /** Streams everything the microphone hears to HomeyDash, which has the voice service listen for the wake word. */
  private async startRemote() {
    const blocks: ((samples: Float32Array) => void)[] = [];
    const opened = await openMicrophone((samples) => blocks[0]?.(samples), this.filters());
    this.mic = opened.mic;
    this.ctx = opened.ctx;
    if (this.stopped) return this.stop();
    let block: Float32Array[] = [];
    let n = 0;
    const connect = () => {
      const ws = (this.ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice/listen?screen=${screenId()}&detect=1`,
      ));
      ws.onmessage = (e) => this.receive(JSON.parse(e.data as string) as VoiceEvent);
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = undefined;
        if (!this.stopped) this.session = setTimeout(connect, 3000); // the service restarted, or the network blinked
      };
    };
    connect();
    blocks[0] = (data) => {
      block.push(data);
      n += data.length;
      if (n < 1280) return;
      const pcm = new Int16Array(n);
      let o = 0;
      for (const b of block) for (const v of b) pcm[o++] = Math.max(-1, Math.min(1, v)) * 32767;
      block = [];
      n = 0;
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer); // while it reconnects, that audio is lost
    };
  }

  /** Gives the handler of what the microphone sends: the wake word is listened for, and once heard the audio goes on to HomeyDash. */
  private listen(ww: Detector) {
    const ring: Int16Array[] = []; // the last PREROLL samples, to replay the wake word and what follows it
    let ringLen = 0;
    let block: Float32Array[] = [];
    let n = 0;
    let cool = 0;
    const quiet: Float32Array[] = []; // the blocks of the last couple of seconds, while the detector rests
    let open = false;
    let tail = 0;
    let floor = 0.005; // how loud the room is when nobody speaks
    const detect = (samples: Float32Array) =>
      void ww.feed(samples).then((score) => {
        if (!this.stopped && !this.ws && score >= ww.threshold && performance.now() > cool) trigger();
      });
    const toPcm = (f: Float32Array) => {
      const pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
      return pcm;
    };
    const end = () => {
      clearTimeout(this.session);
      this.ws?.close();
      this.ws = undefined;
      ww.reset();
      cool = performance.now() + 1500;
      if (this.phase().kind !== 'result') this.phase.set({ kind: 'off' });
    };
    const trigger = () => {
      this.phase.set({ kind: 'awake' });
      const ws = (this.ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/voice/listen?screen=${screenId()}`,
      ));
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'arm' }));
        const pre = new Int16Array(ringLen);
        let o = 0;
        for (const b of ring) (pre.set(b, o), (o += b.length));
        ws.send(pre.buffer);
      };
      ws.onmessage = (e) => {
        const event = JSON.parse(e.data as string) as VoiceEvent;
        if (event.type === 'state' && event.state === 'idle') return; // the service starts out idle; we are awake
        this.receive(event);
        if (event.type === 'result') end();
      };
      ws.onclose = () => this.ws === ws && end();
      this.session = setTimeout(end, SESSION_MS);
    };
    return (data: Float32Array) => {
      const pcm = toPcm(data);
      ring.push(pcm);
      ringLen += pcm.length;
      while (ringLen > PREROLL) ringLen -= ring.shift()!.length;
      block.push(data);
      n += data.length;
      if (n < 1280) return;
      const f = new Float32Array(n);
      let o = 0;
      for (const b of block) (f.set(b, o), (o += b.length));
      block = [];
      n = 0;
      if (this.ws) {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send(toPcm(f).buffer);
        return;
      }
      // Most of the time nobody speaks, and then there is nothing to detect: the detector runs while there is sound, and
      // for a moment after, and is first given the last two seconds, which hold the start of what made the sound.
      let sum = 0;
      for (const v of f) sum += v * v;
      const rms = Math.sqrt(sum / f.length);
      const loud = rms > Math.max(GATE_MIN, 3 * floor);
      if (!open) floor = 0.95 * floor + 0.05 * rms;
      if (loud) tail = GATE_TAIL;
      if (!open && loud) {
        open = true;
        ww.reset();
        for (const b of quiet.splice(0)) detect(b);
      }
      if (open) {
        if (!loud && --tail <= 0) open = false;
        if (ww.busy < MAX_BACKLOG) detect(f); // too slow for real time: drop rather than hear the wake word seconds late
      } else {
        quiet.push(f);
        if (quiet.length > GATE_PREROLL) quiet.shift();
      }
    };
  }

  private stop() {
    this.stopped = true;
    this.phase.set({ kind: 'off' });
    clearTimeout(this.clear);
    clearTimeout(this.session);
    this.ws?.close();
    void this.ctx?.close();
    this.mic?.getTracks().forEach((track) => track.stop());
    this.detector?.stop();
    this.ws = this.ctx = this.mic = this.detector = undefined;
  }
}

/**
 * What a screen shows of voice, over the dashboard and under the timer alert: one strip at the bottom that appears
 * when the wake phrase was heard, says it is listening or working, and then states what was understood or why not,
 * for a few seconds. It never takes touches, and it is absent while nobody is talking to the screen.
 */
@Component({
  selector: 'hd-voice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, TranslatePipe],
  host: { role: 'status', 'aria-live': 'polite', '[class.is-open]': 'phase().kind !== "off"' },
  template: `
    @if (shown(); as s) {
      <div class="strip" [class]="'strip is-' + s.tone" [attr.data-kind]="phase().kind">
        <span class="badge">
          @if (s.icon) { <svg [lucideIcon]="s.icon" /> } @else { <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span> }
        </span>
        <span class="text">
          <span class="main">{{ s.main }}</span>
          @if (s.sub) { <span class="sub">{{ s.sub }}</span> }
        </span>
      </div>
    }
    @if (enabled() && onDashboard()) {
      <div class="mic">
        @if (!muted()) { <span class="hint">Hey Jarvis</span> }
        <button type="button" class="mute" [attr.aria-pressed]="muted()" [attr.aria-label]="(muted() ? 'Unmute microphone' : 'Mute microphone') | t" (click)="voice.toggleMute()">
          <svg [lucideIcon]="muted() ? micOff : mic" />
        </button>
      </div>
    }
  `,
  styles: `
    /* Bottom left, in the gutter beside the tiles (in line with the tape's toggle and the people above it). */
    .mic { position: fixed; left: var(--space-3); bottom: var(--space-4); display: flex; flex-direction: column; align-items: flex-start; gap: 12px; pointer-events: none; }
    /* A speech bubble above the button, its tail pointing down at it. */
    .hint { position: relative; padding: 8px 14px; border-radius: 16px; background: #fff; box-shadow: 0 2px 8px rgb(0 0 0 / .22);
      font-size: 13px; font-weight: 600; color: #22252f; white-space: nowrap; }
    .hint::after { content: ''; position: absolute; left: 14px; top: calc(100% - 1px); width: 16px; height: 10px; background: #fff; clip-path: polygon(0 0, 100% 0, 0 100%); }
    .mute { flex: none; pointer-events: auto; display: grid; place-items: center;
      width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; color: var(--ink-muted); opacity: .7;
      background: var(--tile-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 0 0 1.5px var(--glass-rim) inset; }
    .mute[aria-pressed='true'] { color: var(--warn); opacity: 1; }
    .mute svg { width: 22px; height: 22px; }
    :host { position: fixed; z-index: 15; left: 0; right: 0; bottom: var(--space-5); display: flex; justify-content: center; pointer-events: none; padding-inline: var(--space-4); }
    .strip { --tone-ink: var(--kind-neutral-ink); --tone-fill: var(--kind-neutral-fill);
      display: flex; align-items: center; gap: var(--space-4); max-width: min(92vw, 56rem); min-height: max(72px, 10vh);
      padding: var(--space-3) var(--space-6) var(--space-3) var(--space-3); border-radius: 999px; box-sizing: border-box;
      color: var(--ink); background: var(--tile-glass); backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3);
      box-shadow: 0 0 0 1.5px var(--glass-rim) inset, 0 .6vh 3vh rgb(0 0 0 / .22); animation: rise .35s cubic-bezier(.2, .8, .2, 1) both; }
    .strip.is-ok { --tone-ink: var(--ok); --tone-fill: color-mix(in oklab, var(--ok) 22%, transparent); }
    .strip.is-warn { --tone-ink: var(--warn); --tone-fill: color-mix(in oklab, var(--warn) 22%, transparent); }
    @keyframes rise { from { opacity: 0; translate: 0 2vh; scale: .96; } }
    .badge { flex: none; display: grid; place-items: center; width: max(56px, 7.5vh); aspect-ratio: 1; border-radius: 50%; background: var(--tone-fill); color: var(--tone-ink); }
    .badge svg { width: 55%; height: 55%; }
    .text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
    .main { font-size: max(22px, 3.6vh); font-weight: 700; line-height: 1.15; text-wrap: balance; overflow-wrap: anywhere; }
    .sub { font-size: max(var(--text-floor, 14px), 2.2vh); font-weight: 500; color: var(--ink-muted); text-wrap: balance; overflow-wrap: anywhere; }
    /* Listening: four bars that breathe, the one thing that moves while the screen waits for a command. */
    .bars { display: flex; align-items: center; gap: 4px; height: 50%; }
    .bars i { width: 5px; height: 100%; border-radius: 3px; background: currentColor; transform-origin: center; animation: breathe .9s ease-in-out infinite alternate; }
    .bars i:nth-child(2) { animation-delay: .15s; } .bars i:nth-child(3) { animation-delay: .3s; } .bars i:nth-child(4) { animation-delay: .45s; }
    @keyframes breathe { from { transform: scaleY(.3); } to { transform: scaleY(1); } }
    [data-kind='thinking'] .bars i { animation-duration: .5s; }
    @media (prefers-reduced-motion: reduce) { .strip, .bars i { animation: none; } .bars i { transform: scaleY(.7); } }
  `,
})
export class VoiceFeedback {
  protected readonly voice = inject(Voice);
  /** Whether the dashboard is what the screen shows: the microphone control belongs there, and not over a photo or a lock screen. */
  readonly onDashboard = input(true);
  protected readonly phase = this.voice.phase;
  protected readonly enabled = this.voice.enabled;
  protected readonly muted = this.voice.muted;
  protected readonly mic = LucideMic;
  protected readonly micOff = LucideMicOff;

  protected readonly shown = computed(() => {
    const phase = this.phase();
    switch (phase.kind) {
      case 'awake':
        return { tone: 'neutral', icon: LucideMic, main: t("I'm listening"), sub: '' };
      case 'thinking':
        return { tone: 'neutral', icon: null, main: t('One moment…'), sub: phase.heard ? `“${phase.heard}”` : '' };
      case 'result': {
        const r = phase.result;
        const heard = r.command_text ? `“${r.command_text}”` : '';
        return r.ok
          ? { tone: 'ok', icon: LucideCheck, main: understood(r), sub: [timerOf(r)?.name, r.zones.join(', '), heard].filter(Boolean).join(' · ') }
          : { tone: 'warn', icon: LucideTriangleAlert, main: r.reason ? tr(r.reason) : t("That didn't work"), sub: r.detail ?? heard };
      }
      default:
        return null;
    }
  });
}
