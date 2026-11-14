import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { LucideMonitorCog } from '@homey-dash/design-system';
import { TileDetails } from '@homey-dash/tiles';
import { Camera, LightMeter } from './light-meter';
import { TranslatePipe } from '@homey-dash/i18n';
import { Voice } from './voice';
import { VoiceTest } from './voice-test';

/**
 * Screen settings: what is set on this screen itself rather than in Management, such as the camera it estimates the
 * light falling on it with, where it has no light sensor, and whether it hears its wake word. Hidden from the household,
 * it opens with five quick taps in the top-right corner, over the whole screen: a Voice tab and a Light tab, each a list
 * of large rows beside a well that shows what a test or the camera found.
 */
@Component({
  selector: 'hd-screen-settings',
  imports: [DecimalPipe, TileDetails, TranslatePipe, VoiceTest],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <hd-tile-details name="Screen settings" [closeOnBackdrop]="false" [screen]="true" (closed)="closed()" subtitle="This screen only" [icon]="icon">
      <div hdDetailsHead class="hd-segmented" role="group" [attr.aria-label]="'Screen settings' | t">
        @for (item of tabs; track item.id) {
          <button type="button" [attr.aria-pressed]="tab() === item.id" (click)="tab.set(item.id)">{{ item.label | t }}</button>
        }
      </div>
      @switch (tab()) {
        @case ('voice') {
          <hd-voice-test>
            <div class="setting">
              <div class="setting__text">
                <span id="voice-label" class="setting__label">{{ 'Listen for voice commands' | t }}</span>
                @if (!voice.available) {
                  <span class="setting__hint">{{ 'Needs https' | t }}</span>
                }
              </div>
              @if (voice.available) {
                <button id="screen-voice" type="button" class="switch" role="switch" [attr.aria-checked]="voice.enabled()" aria-labelledby="voice-label" (click)="voice.set(!voice.enabled())">
                  <span class="switch__state">{{ (voice.enabled() ? 'On' : 'Off') | t }}</span>
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </button>
              }
            </div>
            @if (voice.available) {
              <div class="setting">
                <div class="setting__text">
                  <span id="voice-server-label" class="setting__label">{{ 'Wake word on the server' | t }}</span>
                  <span class="setting__hint">{{ 'For a screen that is too slow to hear it itself' | t }}</span>
                </div>
                <button id="screen-voice-server" type="button" class="switch" role="switch" [attr.aria-checked]="voice.server()" aria-labelledby="voice-server-label" (click)="voice.setServer(!voice.server())">
                  <span class="switch__state">{{ (voice.server() ? 'On' : 'Off') | t }}</span>
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </button>
              </div>
            }
            @if (voice.available) {
              <div class="setting">
                <div class="setting__text">
                  <span id="voice-filters-label" class="setting__label">{{ 'Noise and echo filters' | t }}</span>
                  <span class="setting__hint">{{ 'Off saves a slow screen some work' | t }}</span>
                </div>
                <button id="screen-voice-filters" type="button" class="switch" role="switch" [attr.aria-checked]="voice.filters()" aria-labelledby="voice-filters-label" (click)="voice.setFilters(!voice.filters())">
                  <span class="switch__state">{{ (voice.filters() ? 'On' : 'Off') | t }}</span>
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                </button>
              </div>
            }
            @if (voice.available) {
              <div class="group">
                <div class="setting__text">
                  <span id="voice-gain-label" class="setting__label">{{ 'Microphone level' | t }}</span>
                  <span class="setting__hint">{{ 'Turn it down when the wake word is not heard because the sound comes in too loud' | t }}</span>
                </div>
                <div class="hd-segmented scale" role="group" aria-labelledby="voice-gain-label">
                  @for (option of gains; track option.value) {
                    <button type="button" [attr.aria-pressed]="option.value === voice.gain()" (click)="voice.setGain(option.value)">{{ option.label | t }}</button>
                  }
                </div>
              </div>
            }
            @if (voice.error(); as error) {
              <p class="diagnosis">{{ error }}</p>
            }
          </hd-voice-test>
        }
        @case ('light') {
          <div class="pane">
            <div class="column">
              <div class="setting">
                <div class="setting__text">
                  <span class="setting__label">{{ 'Light' | t }}</span>
                  @if (meter.reading(); as reading) {
                    <span class="setting__hint">{{ (reading.source === 'sensor' ? 'Light sensor' : 'Estimated with camera') | t }}</span>
                  }
                </div>
                <span class="level">
                  @if (meter.reading(); as reading) {
                    {{ reading.lux | number: '1.0-0' }} lx
                  } @else {
                    <span class="level__none">{{ 'Not measured yet' | t }}</span>
                  }
                </span>
              </div>
              <div class="group" role="radiogroup" aria-labelledby="camera-label">
                <span id="camera-label" class="setting__label">{{ 'Camera for light' | t }}</span>
                @if (meter.hasCamera) {
                  <button type="button" role="radio" class="choice" [attr.aria-checked]="!meter.camera()" (click)="choose('')">
                    {{ 'Automatic' | t }}
                  </button>
                  @for (camera of cameras(); track camera.deviceId) {
                    <button type="button" role="radio" class="choice" [attr.aria-checked]="camera.deviceId === meter.camera()" (click)="choose(camera.deviceId)">
                      {{ camera.label }}
                    </button>
                  }
                } @else {
                  <span class="setting__hint">{{ 'Needs https' | t }}</span>
                }
              </div>
              <div class="group">
                <span id="scale-label" class="setting__label">{{ 'Camera reads too high' | t }}</span>
                <div class="hd-segmented scale" role="group" aria-labelledby="scale-label">
                  @for (option of scales; track option.value) {
                    <button type="button" [attr.aria-pressed]="option.value === meter.scale()" (click)="calibrate(option.value)">{{ option.label | t }}</button>
                  }
                </div>
              </div>
            </div>
            <div class="well">
              <div class="well__head">
                <span class="setting__label">{{ 'Camera preview' | t }}</span>
                @if (meter.hasCamera) {
                  <button type="button" class="setting-btn" [class.setting-btn--solid]="!previewing()" (click)="previewing.set(!previewing())">
                    {{ (previewing() ? 'Hide' : 'Show') | t }}
                  </button>
                }
              </div>
              @if (previewing()) {
                <video #preview class="preview" muted playsinline autoplay></video>
                @if (previewError(); as error) {
                  <p class="diagnosis">{{ error }}</p>
                }
              } @else {
                <p class="well__empty">{{ 'Show the preview to see what the camera sees.' | t }}</p>
              }
            </div>
          </div>
        }
      }
    </hd-tile-details>
  `,
  styles: `
    :host {
      display: contents;
      /* Settings have no kind of their own, so they take the neutral hue, as a tile without one does. */
      --k-ink: var(--kind-neutral-ink);
      --k-fill: var(--kind-neutral-fill);
    }
    hd-voice-test, .pane { flex: 1; min-height: 0; }
    .pane { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(var(--cell) * .3); }
    @media (max-aspect-ratio: 1 / 1) { .pane { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); } }
    .column { min-height: 0; overflow-y: auto; scrollbar-width: none; align-content: start; }
    .group { display: flex; flex-direction: column; gap: calc(var(--cell) * .1); padding-block: calc(var(--cell) * .14); border-bottom: 1px solid var(--line); }
    .group:last-child, .column > .setting:last-child { border-bottom: 0; }
    /* One camera to a row, picked by touch rather than from a drop-down; the picked one is filled with the hue. */
    .choice {
      display: flex; align-items: center; gap: calc(var(--cell) * .12);
      min-height: 56px; padding: 0 calc(var(--cell) * .16); border: 0; text-align: start;
      border-radius: calc(var(--cell) * var(--tile-radius) * .75);
      background: color-mix(in oklab, var(--k-ink) 8%, transparent); color: var(--ink);
      font: 600 max(var(--t-name-min), calc(var(--cell) * var(--t-name)))/1.25 var(--font-sans);
      cursor: pointer; overflow-wrap: anywhere;
    }
    .choice::before { content: ""; flex: none; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 2px var(--ink-muted); }
    .choice[aria-checked='true'] { background: var(--k-ink); color: var(--on-kind); font-weight: 700; }
    .choice[aria-checked='true']::before { background: radial-gradient(circle, var(--on-kind) 0 36%, transparent 40%); box-shadow: inset 0 0 0 2px var(--on-kind); }
    .choice:active { transform: scale(.98); }
    .choice:focus-visible, .switch:focus-visible { outline: 3px solid var(--k-ink); outline-offset: 3px; }
    .scale { --segment-height: .36; }
    .scale button { flex: 1 1 0; min-width: 0; padding-inline: calc(var(--cell) * .04); line-height: 1.1; }
    .well__head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--cell) * .1); }
    .preview { flex: 1; min-height: 0; width: 100%; border-radius: calc(var(--cell) * var(--tile-radius) * .75); background: #000; object-fit: contain; }
    /* A switch shows what is, by its colour and where its knob sits, and says it in words beside it. */
    .switch { display: flex; align-items: center; gap: var(--space-3); min-height: 56px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
    .switch__state { font-size: max(var(--t-name-min), calc(var(--cell) * var(--t-name))); font-weight: 700; min-width: 3ch; text-align: right; color: var(--ink-muted); }
    .switch[aria-checked='true'] .switch__state { color: var(--k-ink); }
    .switch__track { position: relative; width: 64px; height: 36px; border-radius: 999px; background: var(--state-off-bg); box-shadow: inset 0 0 0 2px var(--line); transition: background-color .2s; }
    .switch[aria-checked='true'] .switch__track { background: var(--k-ink); box-shadow: none; }
    .switch__thumb { position: absolute; top: 4px; left: 4px; width: 28px; height: 28px; border-radius: 50%; background: var(--ink-muted); transition: translate .2s, background-color .2s; }
    .switch[aria-checked='true'] .switch__thumb { translate: 28px 0; background: var(--on-kind); }
    @media (prefers-reduced-motion: reduce) { .switch__track, .switch__thumb, .choice { transition: none; } }
    .diagnosis { margin: 0; padding-block: calc(var(--cell) * .1); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; color: var(--danger); font-size: max(var(--t-detail-min), calc(var(--cell) * var(--t-detail))); line-height: 1.4; font-weight: 600; }
    .level { font-size: max(var(--t-title-min), calc(var(--cell) * var(--t-title))); font-weight: 700; font-variant-numeric: tabular-nums; }
    .level__none { font-size: max(var(--t-name-min), calc(var(--cell) * var(--t-name))); color: var(--ink-muted); font-weight: 600; }
  `,
})
export class ScreenSettings {
  /** Another camera was picked, so the room is best measured again now. */
  readonly cameraChanged = output<void>();

  protected readonly meter = inject(LightMeter);
  protected readonly voice = inject(Voice);
  protected readonly cameras = signal<Camera[]>([]);
  protected readonly scales = [
    { value: 1, label: 'No' },
    { value: 0.5, label: 'Halve it' },
    { value: 0.25, label: 'Quarter it' },
    { value: 0.1, label: 'Tenth' },
    { value: 0.05, label: '1/20' },
  ];
  protected readonly gains = [
    { value: 1, label: 'Full' },
    { value: 0.5, label: 'Half' },
    { value: 0.25, label: 'Quarter' },
    { value: 0.1, label: 'Tenth' },
    { value: 0.05, label: '1/20' },
  ];
  protected readonly icon = LucideMonitorCog;
  protected readonly tabs = [
    { id: 'voice', label: 'Voice' },
    { id: 'light', label: 'Light' },
  ] as const;
  protected readonly tab = signal<'voice' | 'light'>('voice');
  protected readonly previewing = signal(false);
  protected readonly previewError = signal('');
  private readonly details = viewChild.required(TileDetails);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('preview');
  private stream: MediaStream | null = null;

  constructor() {
    // Runs the camera only while the preview is showing, and again when another camera is picked.
    effect(() => {
      const video = this.video()?.nativeElement;
      this.meter.camera();
      this.stopPreview();
      if (!video) return;
      this.previewError.set('');
      void this.meter.preview().then(
        (stream) => {
          if (this.video()?.nativeElement !== video) return stream.getTracks().forEach((t) => t.stop());
          this.stream = stream;
          video.srcObject = stream;
        },
        (e) => this.previewError.set(e instanceof Error ? e.message : 'No camera picture'),
      );
    });
    inject(DestroyRef).onDestroy(() => this.stopPreview());
  }

  private stopPreview() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** It closed, however; the next time it opens on the first tab, with no preview running. */
  protected closed() {
    this.previewing.set(false);
    this.tab.set('voice');
  }

  async open() {
    this.details().open();
    if (this.meter.hasCamera) this.cameras.set(await this.meter.cameras().catch(() => []));
  }

  protected calibrate(scale: number) {
    this.meter.calibrate(scale);
    this.cameraChanged.emit();
  }

  protected choose(deviceId: string) {
    this.meter.choose(deviceId || null);
    this.cameraChanged.emit();
  }
}
