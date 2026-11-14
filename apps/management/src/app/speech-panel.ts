import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core';
import { TranslatePipe, t } from '@homey-dash/i18n';
import { AccountPanel } from './account-panel';
import { VoiceLogPanel } from './voice-log-panel';

interface SpeechModel {
  id: string;
  label: string;
  note: string;
  size_mb: number;
  installed: boolean;
  usable: boolean;
  selected: boolean;
  downloading: boolean;
  progress: number | null;
  error: string | null;
  last_ms: number | null;
}

/** The voice service's models for turning speech into text, reached through HomeyDash at /voice (the service has no pages of its own). */
const BASE = '/voice/api/stt';

/**
 * Which model hears spoken commands. A bigger one understands Dutch better but is slower on a small computer; one
 * downloaded ahead of time means the first command doesn't wait. Shows "Not set up" when HomeyDash has no voice service.
 */
@Component({
  selector: 'hd-speech-panel',
  imports: [AccountPanel, TranslatePipe, VoiceLogPanel],
  host: { style: 'display: flex; flex-direction: column; gap: var(--space-5)' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-account-panel key="speech" [title]="'Speech recognition' | t" [error]="error()">
      <ng-container ngProjectAs="[status]">
        @if (models() === null && !error()) {
          <span class="hd-pill hd-pill--dot">{{ 'Looking…' | t }}</span>
        } @else if (models() === null) {
          <span class="hd-pill hd-pill--warn hd-pill--dot">{{ 'Not set up' | t }}</span>
        } @else {
          <span class="hd-pill hd-pill--ok hd-pill--dot">{{ 'Connected' | t }}</span>
        }
      </ng-container>
      @if (models(); as models) {
        <p class="hd-muted">
          {{ 'Choose which model turns speech into text. Download one ahead of time and the first command does not have to wait. On a small CPU tiny and base are the fastest; bigger models write better Dutch but are slower.' | t }}
        </p>
        @for (m of models; track m.id) {
          <div class="hd-account__item">
            <div class="hd-account__info">
              <strong>{{ m.label }}</strong>
              <span class="hd-muted">{{ m.note }}</span>
              <span class="hd-muted">
                {{ size(m) }}{{ lastTime(m) }}
              </span>
            </div>
            @if (m.selected) {
              <span class="hd-pill hd-pill--ok hd-pill--dot">{{ 'In use' | t }}</span>
            } @else if (m.installed) {
              <span class="hd-pill hd-pill--dot">{{ 'Downloaded' | t }}</span>
            }
            @if (m.downloading) {
              <progress max="100" [value]="pct(m)"></progress> {{ pct(m) }}%
            }
            <div class="hd-actions">
              @if (!m.selected) {
                <button class="hd-btn hd-btn--primary" type="button" [disabled]="!m.usable" (click)="act('select', m)">{{ 'Use' | t }}</button>
              }
              @if (!m.installed && !m.downloading) {
                <button class="hd-btn" type="button" (click)="act('download', m)">{{ 'Download' | t }}</button>
              }
              @if (m.installed && !m.selected && m.size_mb) {
                <button class="hd-btn" type="button" (click)="act('delete', m)">{{ 'Delete' | t }}</button>
              }
            </div>
            @if (m.error) {
              <p class="hd-error" role="alert">{{ m.error }}</p>
            }
          </div>
        }
      }
    </hd-account-panel>
    <hd-voice-log-panel />
  `,
})
export class SpeechPanel implements OnDestroy {
  protected readonly models = signal<SpeechModel[] | null>(null);
  protected readonly error = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.call(BASE, 'GET', undefined, true);
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }

  protected size(m: SpeechModel) {
    return m.size_mb >= 1000 ? `${(m.size_mb / 1000).toFixed(1)} GB` : `${m.size_mb} MB`;
  }

  protected lastTime(m: SpeechModel) {
    return typeof m.last_ms !== 'number' ? '' : ` · ${(m.last_ms / 1000).toFixed(1)} s`;
  }

  protected pct(m: SpeechModel) {
    return Math.round((m.progress ?? 0) * 100);
  }

  protected act(action: 'select' | 'download' | 'delete', m: SpeechModel) {
    const id = encodeURIComponent(m.id);
    if (action === 'select') return this.call(`${BASE}/select`, 'POST', { id: m.id });
    if (action === 'download') return this.call(`${BASE}/${id}/download`, 'POST');
    if (!confirm(t('Delete this model from the disk?'))) return;
    return this.call(`${BASE}/${id}`, 'DELETE');
  }

  private async call(path: string, method: string, body?: unknown, quiet = false) {
    try {
      const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.detail ?? `HTTP ${r.status}`);
      this.models.set(json.options);
      this.error.set(null);
    } catch (e) {
      // Without a voice service the first load just finds nothing; a later failure is worth saying.
      if (!quiet) this.error.set(e instanceof Error ? e.message : t('Could not reach the voice service.'));
      return;
    }
    clearTimeout(this.timer);
    if (this.models()?.some((m) => m.downloading)) this.timer = setTimeout(() => this.call(BASE, 'GET', undefined, true), 1000);
  }
}
