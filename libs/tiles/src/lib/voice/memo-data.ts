import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { TileSettings } from '../tile-data';

/** A voice memo tile has nothing to set. */
export type VoiceMemoTileSettings = TileSettings;

/** One memo: when it was spoken (ms since the epoch) and what it said, in Dutch as the voice service heard it. */
export interface Memo {
  id: string;
  at: number;
  text: string;
}

/** Where HomeyDash hands the voice service's memo transcription out (the voice service's `/api/transcribe`, behind `/voice`). */
export const TRANSCRIBE_URL = '/voice/api/transcribe';
/** A memo is cut off here: the voice service transcribes on a small CPU, and longer is a recording, not a memo. */
export const MAX_MEMO_MS = 120_000;
/** How many memos the screen keeps. */
export const KEEP = 20;
const KEY = 'hd-voice-memos';

export type MemoState = 'idle' | 'recording' | 'working';
export type MemoError = 'no-microphone' | 'no-service' | 'failed' | 'nothing-heard';

/** What a screen sends when Management asks for its memos: each recording with its text beside it. */
export async function memoUpload(memos: Memo[], get: (id: string) => Promise<Blob | undefined>): Promise<FormData> {
  const body = new FormData();
  for (const memo of memos) {
    const audio = await get(memo.id).catch(() => undefined);
    if (!audio) continue;
    const name = memoFileName(memo.at);
    body.append('files', audio, `${name}.${audio.type.includes('mp4') ? 'm4a' : 'webm'}`);
    body.append('files', new Blob([memo.text], { type: 'text/plain' }), `${name}.txt`);
  }
  return body;
}

/** The recording format this browser can make; Chrome and Android give webm, Safari mp4. The voice service reads both. */
export function recorderType(supported: (type: string) => boolean): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(supported);
}

/** What the voice service answered, as the text of a memo ('' when nothing was heard). */
export function textFrom(answer: unknown): string {
  return typeof (answer as { text?: unknown })?.text === 'string' ? (answer as { text: string }).text.trim() : '';
}

/** `2026-11-13_23-40-12`, the name a memo's files get when Management downloads them. */
export function memoFileName(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** The recordings, kept in the browser (IndexedDB) next to the memos' texts, so they stay on the screen until Management asks for them. */
const audioStore = {
  open: () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('hd-voice-memos', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('audio');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    }),
  async run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = use(db.transaction('audio', mode).objectStore('audio'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },
  put: (id: string, audio: Blob) => audioStore.run('readwrite', (s) => s.put(audio, id)).then(() => undefined),
  get: (id: string) => audioStore.run<Blob | undefined>('readonly', (s) => s.get(id)),
  remove: (id: string) => audioStore.run('readwrite', (s) => s.delete(id)).then(() => undefined),
};

function load(): Memo[] {
  try {
    const memos = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(memos) ? memos.filter((m) => typeof m?.id === 'string' && typeof m.text === 'string' && typeof m.at === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * The voice memos of this screen: record from its microphone, have the voice service write the speech down in Dutch, and
 * keep the newest in the browser, so every memo tile on the screen shows the same ones, as timers do.
 */
@Injectable({ providedIn: 'root' })
export class VoiceMemos {
  /** Newest first. */
  readonly memos = signal<Memo[]>(load());
  readonly state = signal<MemoState>('idle');
  readonly error = signal<MemoError | null>(null);
  /** How long the running recording has gone on (ms). */
  readonly elapsed = signal(0);

  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private tick?: ReturnType<typeof setInterval>;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abandon());
  }

  async start() {
    if (this.state() !== 'idle') return;
    this.error.set(null);
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.error.set('no-microphone');
      return;
    }
    const type = recorderType((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(mic, type ? { mimeType: type } : undefined);
    this.chunks = [];
    recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    recorder.onstop = () => {
      mic.getTracks().forEach((track) => track.stop());
      void this.keep(new Blob(this.chunks, { type: recorder.mimeType }));
    };
    this.recorder = recorder;
    recorder.start();
    const began = Date.now();
    this.elapsed.set(0);
    this.state.set('recording');
    this.tick = setInterval(() => {
      this.elapsed.set(Date.now() - began);
      if (Date.now() - began >= MAX_MEMO_MS) this.stop();
    }, 250);
  }

  /** Ends the recording; it is then sent to be written down. */
  stop() {
    clearInterval(this.tick);
    if (this.recorder?.state === 'recording') {
      this.state.set('working');
      this.recorder.stop();
    }
  }

  remove(id: string) {
    this.set(this.memos().filter((m) => m.id !== id));
    void audioStore.remove(id).catch(() => undefined);
  }

  /** The recording of a memo, when this screen still has it. */
  audio(id: string): Promise<Blob | undefined> {
    return audioStore.get(id).catch(() => undefined);
  }

  /** What Management is sent when it asks: every kept recording, with its text. */
  upload(): Promise<FormData> {
    return memoUpload(this.memos(), (id) => audioStore.get(id));
  }

  /** Keeps the recording on the screen first, so it survives a failed transcription, then has it written down. */
  private async keep(audio: Blob) {
    const memo: Memo = { id: crypto.randomUUID(), at: Date.now(), text: '' };
    try {
      await audioStore.put(memo.id, audio);
    } catch {
      // Without storage the text is all that is kept.
    }
    try {
      const body = new FormData();
      body.append('audio', audio, audio.type.includes('mp4') ? 'memo.m4a' : 'memo.webm');
      const response = await fetch(TRANSCRIBE_URL, { method: 'POST', body });
      if (response.status === 404 || response.status === 502) this.error.set('no-service');
      else if (!response.ok) this.error.set('failed');
      else {
        memo.text = textFrom(await response.json());
        if (!memo.text) this.error.set('nothing-heard');
      }
    } catch {
      this.error.set('failed');
    } finally {
      const all = [memo, ...this.memos()];
      all.slice(KEEP).forEach((old) => void audioStore.remove(old.id).catch(() => undefined));
      this.set(all.slice(0, KEEP));
      this.state.set('idle');
    }
  }

  private abandon() {
    clearInterval(this.tick);
    if (this.recorder?.state === 'recording') {
      this.recorder.onstop = null;
      this.recorder.stop();
      this.recorder.stream.getTracks().forEach((track) => track.stop());
    }
  }

  private set(memos: Memo[]) {
    this.memos.set(memos);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(memos));
    } catch {
      // Without storage the memos just don't survive a reload.
    }
  }
}
