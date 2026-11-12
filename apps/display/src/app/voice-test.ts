import { ChangeDetectionStrategy, Component, inject, OnDestroy, signal } from '@angular/core';
import { t, TranslatePipe } from '@homey-dash/i18n';
import { openMicrophone, startDetector, Voice, WAKE_THRESHOLD } from './voice';

/** What a test of the microphone found out about a recording. */
export interface Recording {
  samples: Float32Array;
  /** How many 1280 sample blocks the microphone delivered, and how many it should have in that time; a shortfall is audio that was lost. */
  blocks: number;
  expected: number;
  /** Loudness in dB below full scale: of the whole recording and of its loudest sample. */
  averageDb: number;
  peakDb: number;
  /** Share of the samples at the limit, which sounds distorted. */
  clipped: number;
}

/** The numbers of a recording of 16 kHz samples; blocks is how many arrived for the `seconds` it ran. */
export function measure(samples: Float32Array, blocks: number, seconds: number): Recording {
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  for (const v of samples) {
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) >= 0.99) clipped++;
  }
  const db = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x)) : -Infinity);
  return {
    samples,
    blocks,
    expected: Math.round((seconds * 16000) / 1280),
    averageDb: db(Math.sqrt(sum / Math.max(1, samples.length))),
    peakDb: db(peak),
    clipped: clipped / Math.max(1, samples.length),
  };
}

/** What the wake word did with a recording. */
export interface WakeRun {
  /** The highest score (0 to 1) and when in the recording (s) it came. */
  score: number;
  at: number;
  detector: 'worker' | 'page' | 'server';
  loadMs: number;
  /** Time to work on 80 ms of sound: on average and at the slowest; above 80 the screen cannot keep up with its microphone. */
  averageMs: number;
  slowestMs: number;
}

/** Runs the wake word over 16 kHz samples, as it does for the microphone, and says how fast it went. */
export async function runWake(samples: Float32Array): Promise<WakeRun> {
  const started = performance.now();
  const detector = await startDetector();
  const loadMs = performance.now() - started;
  try {
    const padded = new Float32Array(samples.length + 8000); // half a second of quiet, so a word at the very end is still scored
    padded.set(samples);
    const times: number[] = [];
    let score = 0;
    let at = 0;
    for (let i = 0; i + 1280 <= padded.length; i += 1280) {
      const t0 = performance.now();
      const s = await detector.feed(padded.slice(i, i + 1280));
      times.push(performance.now() - t0);
      if (s > score) {
        score = s;
        at = i / 16000;
      }
    }
    return {
      score, at, detector: detector.kind, loadMs,
      averageMs: times.reduce((a, b) => a + b, 0) / Math.max(1, times.length),
      slowestMs: Math.max(0, ...times),
    };
  } finally {
    detector.stop();
  }
}

/** The same over a recording sent to the voice service, which has its own detector: then `averageMs` is its time per 80 ms of sound and `slowestMs` the whole round trip. */
export async function runWakeOnServer(samples: Float32Array): Promise<WakeRun> {
  const padded = new Int16Array(samples.length + 8000);
  samples.forEach((v, i) => (padded[i] = Math.max(-1, Math.min(1, v)) * 32767));
  const started = performance.now();
  const response = await fetch('/voice/api/wake', { method: 'POST', body: padded.buffer });
  if (!response.ok) throw new Error(`/voice/api/wake: HTTP ${response.status}`);
  const { score, at, ms } = (await response.json()) as { score: number; at: number; ms: number };
  return { score, at, detector: 'server', loadMs: 0, averageMs: ms / Math.max(1, padded.length / 1280), slowestMs: performance.now() - started };
}

/** A recording shipped with the voice service, as 16 kHz samples. */
async function sample(name: string): Promise<Float32Array> {
  const response = await fetch(`/voice/samples/${name}`);
  if (!response.ok) throw new Error(`/voice/samples/${name}: HTTP ${response.status}`);
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await response.arrayBuffer());
  return audio.getChannelData(0);
}

const RECORD_S = 5;

/** A recording to run the wake word over: its name, its samples, and whether it should be heard (undefined: no expectation). */
type Subject = [name: string, samples: Float32Array, shouldHear: boolean | undefined];

/**
 * Tools for finding out why a screen does not hear its wake word, in the screen settings: record the microphone for a
 * few seconds and see how loud it is and whether it loses audio, play it back, and run the wake word over known
 * recordings (one that has it, one that has not) or over what was just recorded, with how fast the screen manages it.
 * While one runs, listening is paused.
 */
@Component({
  selector: 'hd-voice-test',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="column">
      <ng-content />
      <div class="setting">
        <div class="setting__text">
          <span class="setting__label">{{ 'Test the microphone' | t }}</span>
        </div>
        <button type="button" class="setting-btn setting-btn--solid" [disabled]="!!busy()" (click)="record()">
          {{ (busy() === 'recording' ? 'Recording…' : 'Record 5 seconds') | t }}
        </button>
      </div>
      @if (recording()) {
        <div class="setting">
          <div class="setting__text">
            <span class="setting__label">{{ 'What was recorded' | t }}</span>
          </div>
          <span class="buttons">
            <button type="button" class="setting-btn" [disabled]="!!busy()" (click)="play()">{{ 'Play' | t }}</button>
            <button type="button" class="setting-btn" [disabled]="!!busy()" (click)="wakeOnRecording()">{{ 'Wake word on it' | t }}</button>
          </span>
        </div>
      }
      <div class="setting">
        <div class="setting__text">
          <span class="setting__label">{{ 'Test the wake word' | t }}</span>
        </div>
        <button type="button" class="setting-btn setting-btn--solid" [disabled]="!!busy()" (click)="wakeOnSamples()">
          {{ (busy() === 'wake' ? 'Testing…' : 'Known recordings') | t }}
        </button>
      </div>
    </div>
    <div class="well" aria-live="polite">
      @if (busy() === 'recording') {
        <div class="meter" role="meter" [attr.aria-label]="'Level' | t" [attr.aria-valuenow]="level()" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="level()"></span></div>
      }
      @if (report().length) {
        <div class="report">
          @for (line of report(); track $index) {
            <p>{{ line }}</p>
          }
        </div>
      } @else if (busy() !== 'recording') {
        <p class="well__empty">{{ 'The result of a test shows here.' | t }}</p>
      }
    </div>
  `,
  // Two columns beside each other on a wide screen, the rows and the well; stacked on a tall one.
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(var(--cell) * .3); min-height: 0; }
    @media (max-aspect-ratio: 1 / 1) { :host { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); } }
    .column { min-height: 0; overflow-y: auto; scrollbar-width: none; align-content: start; }
    .buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: calc(var(--cell) * .08); }
    .meter { flex: none; height: calc(var(--cell) * .14); border-radius: 999px; background: var(--state-off-bg); overflow: hidden; }
    .meter span { display: block; height: 100%; background: var(--k-ink); transition: width .08s linear; }
    .report { display: flex; flex-direction: column; gap: calc(var(--cell) * .1); user-select: text; -webkit-user-select: text; }
    .report p { margin: 0; overflow-wrap: anywhere; font-size: max(var(--t-name-min), calc(var(--cell) * var(--t-name))); line-height: 1.4; font-weight: 600; font-variant-numeric: tabular-nums; text-wrap: pretty; }
    @media (prefers-reduced-motion: reduce) { .meter span { transition: none; } }
  `,
})
export class VoiceTest implements OnDestroy {
  private readonly voice = inject(Voice);
  protected readonly busy = signal<'recording' | 'wake' | ''>('');
  protected readonly level = signal(0);
  protected readonly recording = signal<Recording | null>(null);
  protected readonly report = signal<string[]>([]);
  private playing?: AudioContext;

  ngOnDestroy() {
    void this.playing?.close();
    if (this.busy()) this.voice.resume();
  }

  /** Records the microphone and says how loud it was and whether blocks went missing. */
  protected async record() {
    this.voice.suspend();
    this.busy.set('recording');
    this.report.set([]);
    const chunks: Float32Array[] = [];
    try {
      const opened = await openMicrophone((block) => {
        chunks.push(block.slice());
        let sum = 0;
        for (const v of block) sum += v * v;
        this.level.set(Math.min(100, Math.round(Math.sqrt(sum / block.length) * 400)));
      }, this.voice.filters());
      const track = opened.mic.getAudioTracks()[0];
      const started = performance.now();
      await new Promise((resolve) => setTimeout(resolve, RECORD_S * 1000));
      const seconds = (performance.now() - started) / 1000;
      opened.stop();
      const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        samples.set(c, o);
        o += c.length;
      }
      const r = measure(samples, chunks.length, seconds);
      this.recording.set(r);
      const lost = Math.max(0, r.expected - r.blocks);
      this.report.set([
        `${track.label || t('Microphone')} · ${track.getSettings().sampleRate ?? opened.ctx.sampleRate} Hz`,
        t('Level {average} dB on average, {peak} dB at the loudest, {clipped}% distorted', {
          average: r.averageDb, peak: r.peakDb, clipped: (r.clipped * 100).toFixed(1),
        }),
        lost > r.expected * 0.02
          ? t('Audio was lost: {got} of {expected} blocks arrived. The screen cannot keep up with its microphone.', { got: r.blocks, expected: r.expected })
          : t('No audio was lost ({got} of {expected} blocks).', { got: r.blocks, expected: r.expected }),
        r.peakDb < -30 ? t('Very quiet: speak closer, or turn the microphone up.') : r.clipped > 0.005 ? t('Too loud: it distorts.') : t('The level is fine.'),
      ]);
    } catch (e) {
      this.report.set([e instanceof Error ? `${e.name}: ${e.message}` : String(e)]);
    } finally {
      this.level.set(0);
      this.busy.set('');
      this.voice.resume();
    }
  }

  protected async play() {
    const r = this.recording();
    if (!r) return;
    await this.playing?.close();
    const ctx = (this.playing = new AudioContext());
    const buffer = ctx.createBuffer(1, r.samples.length, 16000);
    buffer.copyToChannel(new Float32Array(r.samples), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    await ctx.resume();
    source.start();
  }

  protected async wakeOnRecording() {
    const r = this.recording();
    if (r) await this.wake([[t('Your recording'), r.samples, undefined]]);
  }

  /** The wake word over the recordings the voice service ships: "hey jarvis" must be heard, other speech must not. */
  protected async wakeOnSamples() {
    this.voice.suspend();
    this.busy.set('wake');
    this.report.set([]);
    try {
      await this.wake([
        [t('"hey jarvis" (known good)'), await sample('hey-jarvis.wav'), true],
        [t('Other speech (known)'), await sample('other-speech.wav'), false],
      ]);
    } catch (e) {
      this.report.set([e instanceof Error ? `${e.name}: ${e.message}` : String(e)]);
      this.busy.set('');
      this.voice.resume();
    }
  }

  private async wake(subjects: Subject[]) {
    this.voice.suspend();
    this.busy.set('wake');
    const lines: string[] = [];
    try {
      let last: WakeRun | undefined;
      for (const [name, samples, shouldHear] of subjects) {
        this.report.set([...lines, t('Testing…')]);
        last = await (this.voice.server() ? runWakeOnServer(samples) : runWake(samples));
        const heard = last.score >= WAKE_THRESHOLD;
        const verdict = shouldHear === undefined ? '' : heard === shouldHear ? ` ${t('✓ as expected')}` : ` ${t('✗ not as expected')}`;
        lines.push(
          t('{name}: score {score} at {at} s, {heard} (needs {limit}){verdict}', {
            name, score: last.score.toFixed(2), at: last.at.toFixed(1), heard: heard ? t('heard') : t('not heard'), limit: WAKE_THRESHOLD, verdict,
          }),
        );
      }
      if (last?.detector === 'server') {
        lines.push(
          t('Detector on the server: {avg} ms for 80 ms of sound, {total} ms for the whole recording including the network.', {
            avg: last.averageMs.toFixed(1), total: Math.round(last.slowestMs),
          }),
        );
      } else if (last) {
        const share = last.averageMs / 80;
        lines.push(
          t('Detector {kind}, loaded in {load} ms; {avg} ms on average and {max} ms at the slowest for 80 ms of sound.', {
            kind: last.detector === 'worker' ? t('in a worker') : t('on the page'),
            load: Math.round(last.loadMs), avg: last.averageMs.toFixed(1), max: Math.round(last.slowestMs),
          }),
          share > 1 ? t('Too slow: it cannot keep up with real time.') : share > 0.5 ? t('Fast enough, but with little room to spare.') : t('Fast enough.'),
        );
      }
      this.report.set(lines);
    } catch (e) {
      this.report.set([...lines, e instanceof Error ? `${e.name}: ${e.message}` : String(e)]);
    } finally {
      this.busy.set('');
      this.voice.resume();
    }
  }
}
