import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';
import { TranslatePipe, t } from '@homey-dash/i18n';
import { AccountPanel } from './account-panel';

/** One thing HomeyDash did for a command: a capability set in Homey, or a timer. */
export interface VoiceStep {
  device: string | null;
  name: string | null;
  what: string;
  value: unknown;
  ok: boolean;
  error: string | null;
}

/** What became of one thing a screen heard (the API's VoiceLogEntry). */
export interface VoiceLogEntry {
  id: string;
  at: string;
  screen: string;
  display: string | null;
  zone: string | null;
  outcome: 'ignored' | 'heard' | 'understood' | 'done' | 'refused' | 'failed' | 'silent' | 'unreachable';
  text: string | null;
  wake: boolean;
  armed: boolean;
  sttMs: number | null;
  command: string | null;
  action: string | null;
  value: unknown;
  zones: string[] | null;
  asked: { device: string; name?: string; zone?: string; capability: string; value: unknown }[] | null;
  reason: string | null;
  detail: string | null;
  steps: VoiceStep[];
}

const URL = '/api/voice/log';
/** How often the list is read again while the page is open. */
const EVERY_MS = 3000;

/** How an outcome reads, and how much it should stand out. */
export function outcomeOf(entry: Pick<VoiceLogEntry, 'outcome'>): { label: string; tone: '' | 'ok' | 'warn' | 'danger' } {
  switch (entry.outcome) {
    case 'done': return { label: t('Carried out'), tone: 'ok' };
    case 'failed': return { label: t('Not carried out'), tone: 'danger' };
    case 'refused': return { label: t('Not understood'), tone: 'warn' };
    case 'understood': return { label: t('Working on it…'), tone: '' };
    case 'heard': return { label: t('No command yet'), tone: '' };
    case 'silent': return { label: t('Wake word, then nothing'), tone: 'warn' };
    case 'unreachable': return { label: t('Voice service not reachable'), tone: 'danger' };
    default: return { label: t('Not said to the screen'), tone: '' };
  }
}

/** A value as it was sent: true, 0.5, {"seconds":5}. */
export function shown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
}

/**
 * The last things the screens heard, and what was done with each: the text the speech model wrote, whether it counted
 * as said to the screen, the command that was read in it, and every change that was sent to Homey with how it went.
 * It is how to tell a command that was heard wrongly from one that was understood and then not carried out.
 */
@Component({
  selector: 'hd-voice-log-panel',
  imports: [AccountPanel, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="voice-log" [title]="'Heard lately' | t" [error]="error()">
      <ng-container ngProjectAs="[status]">
        <button class="hd-btn" type="button" [disabled]="!entries().length" (click)="clear()">{{ 'Empty the list' | t }}</button>
      </ng-container>
      <p class="hd-muted">
        {{ 'What the screens heard after the wake word and what HomeyDash did with it, newest first. Kept in memory only: the last 50, gone after a restart.' | t }}
      </p>
      @for (e of entries(); track e.id) {
        <article class="hd-account__item entry">
          <div class="hd-account__info">
            <span class="hd-muted">{{ time(e) }} · {{ e.display ?? ('Unknown screen' | t) }}{{ e.zone ? ' · ' + e.zone : '' }}</span>
            @if (e.text !== null) {
              <strong>“{{ e.text }}”</strong>
            }
          </div>
          <span [class]="'hd-pill hd-pill--dot' + (outcome(e).tone ? ' hd-pill--' + outcome(e).tone : '')">{{ outcome(e).label }}</span>
          <dl>
            @if (e.text !== null) {
              <dt>{{ 'Heard' | t }}</dt>
              <dd>{{ heard(e) }}</dd>
            }
            @if (e.command !== null || e.action) {
              <dt>{{ 'Understood' | t }}</dt>
              <dd>
                @if (e.command) { “{{ e.command }}” → }
                <code>{{ e.action ?? '–' }}</code>
                @if (e.value !== null && e.value !== undefined) { <code>{{ shown(e.value) }}</code> }
                @if (e.zones?.length) { · {{ e.zones!.join(', ') }} }
              </dd>
            }
            @if (e.reason) {
              <dt>{{ 'Why not' | t }}</dt>
              <dd>{{ e.reason }}{{ e.detail ? ' (' + e.detail + ')' : '' }}</dd>
            } @else if (e.detail) {
              <dt>{{ 'Why not' | t }}</dt>
              <dd>{{ e.detail }}</dd>
            }
            @if (e.asked?.length) {
              <dt>{{ 'Asked for' | t }}</dt>
              <dd>
                @for (a of e.asked; track $index) {
                  <span class="line">{{ a.name ?? a.device }}{{ a.zone ? ' (' + a.zone + ')' : '' }}: <code>{{ a.capability }} = {{ shown(a.value) }}</code></span>
                }
              </dd>
            }
            @if (e.steps.length) {
              <dt>{{ 'Sent to Homey' | t }}</dt>
              <dd>
                @for (s of e.steps; track $index) {
                  <span class="line" [class.bad]="!s.ok">
                    {{ s.ok ? '✓' : '✗' }} {{ s.name ?? s.device ?? '' }} <code>{{ s.what }} = {{ shown(s.value) }}</code>
                    @if (s.error) { {{ s.error }} }
                  </span>
                }
              </dd>
            } @else if (e.outcome === 'done' || e.outcome === 'failed') {
              <dt>{{ 'Sent to Homey' | t }}</dt>
              <dd class="bad">{{ 'Nothing: the command came to no change.' | t }}</dd>
            }
          </dl>
        </article>
      } @empty {
        @if (loaded()) {
          <p class="hd-muted">{{ 'Nothing was heard yet. Say the wake word to a screen that listens.' | t }}</p>
        }
      }
    </hd-account-panel>
  `,
  styles: `
    .entry { align-items: flex-start; }
    dl { flex: 1 0 100%; display: grid; grid-template-columns: 9em 1fr; gap: 4px var(--space-4); margin: 0; font-size: 14px; }
    dt { color: var(--ink-muted); }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .line { display: block; }
    .bad { color: var(--danger, #b3261e); }
    code { font-size: 13px; }
    code + code { margin-left: .5em; }
  `,
})
export class VoiceLogPanel implements OnDestroy {
  protected readonly entries = signal<VoiceLogEntry[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly outcome = outcomeOf;
  protected readonly shown = shown;
  private readonly timer = setInterval(() => void this.load(), EVERY_MS);

  constructor() {
    void this.load();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  protected time(e: VoiceLogEntry) {
    return new Date(e.at).toLocaleTimeString();
  }

  /** How it counted as said to the screen, and how long the speech model took. */
  protected heard(e: VoiceLogEntry) {
    const why = e.wake ? t('wake word in the text') : e.armed ? t('after the wake word') : t('no wake word, not awake');
    return e.sttMs === null ? why : `${why} · ${t('{seconds} s to transcribe', { seconds: (e.sttMs / 1000).toFixed(1) })}`;
  }

  protected async clear() {
    await fetch(URL, { method: 'DELETE' }).catch(() => undefined);
    await this.load();
  }

  private async load() {
    try {
      const r = await fetch(URL);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.entries.set((await r.json()) as VoiceLogEntry[]);
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
    this.loaded.set(true);
  }
}
