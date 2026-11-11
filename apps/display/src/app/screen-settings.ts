import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output, signal, viewChild } from '@angular/core';
import { LucideMonitorCog } from '@homey-dash/design-system';
import { TileDetails } from '@homey-dash/tiles';
import { Camera, LightMeter } from './light-meter';
import { TranslatePipe } from '@homey-dash/i18n';

/**
 * Screen settings: what is set on this screen itself rather than in Management, such as the camera it estimates the
 * light falling on it with, where it has no light sensor. Hidden from the household, it opens with five quick taps in the top-right corner.
 */
@Component({
  selector: 'hd-screen-settings',
  imports: [DecimalPipe, TileDetails, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <hd-tile-details name="Screen settings" [closeOnBackdrop]="false" subtitle="This screen only" [icon]="icon">
      <div class="hd-details__row">
        <label class="hd-details__label" for="screen-camera">{{ 'Camera for light' | t }}</label>
        @if (meter.hasCamera) {
          <select id="screen-camera" class="hd-select" (change)="choose($any($event.target).value)">
            <option value="" [selected]="!meter.camera()">{{ 'Automatic' | t }}</option>
            @for (camera of cameras(); track camera.deviceId) {
              <option [value]="camera.deviceId" [selected]="camera.deviceId === meter.camera()">{{ camera.label }}</option>
            }
          </select>
        } @else {
          <span class="hd-details__state">{{ 'Needs https' | t }}</span>
        }
      </div>
      <div class="hd-details__row">
        <label class="hd-details__label" for="screen-scale">{{ 'Camera reads too high' | t }}</label>
        <select id="screen-scale" class="hd-select" (change)="calibrate($any($event.target).value)">
          @for (option of scales; track option.value) {
            <option [value]="option.value" [selected]="option.value === meter.scale()">{{ option.label | t }}</option>
          }
        </select>
      </div>
      <div class="hd-details__row">
        <span class="hd-details__label">{{ 'Light' | t }}</span>
        <span class="hd-details__state level">
          @if (meter.reading(); as reading) {
            {{ reading.lux | number: '1.0-0' }} lx · {{ reading.source === 'sensor' ? 'light sensor' : 'estimated with camera' }}
          } @else {
            Not measured yet
          }
        </span>
      </div>
    </hd-tile-details>
  `,
  styles: `
    .hd-select { min-width: 0; max-width: 60%; font-size: var(--text-touch); }
    .level { font-variant-numeric: tabular-nums; }
  `,
})
export class ScreenSettings {
  /** Another camera was picked, so the room is best measured again now. */
  readonly cameraChanged = output<void>();

  protected readonly meter = inject(LightMeter);
  protected readonly cameras = signal<Camera[]>([]);
  protected readonly scales = [
    { value: 1, label: 'No' },
    { value: 0.5, label: 'Halve it' },
    { value: 0.25, label: 'Quarter it' },
    { value: 0.1, label: 'Tenth' },
    { value: 0.05, label: '1/20' },
  ];
  protected readonly icon = LucideMonitorCog;
  private readonly details = viewChild.required(TileDetails);

  async open() {
    this.details().open();
    if (this.meter.hasCamera) this.cameras.set(await this.meter.cameras().catch(() => []));
  }

  protected calibrate(scale: string) {
    this.meter.calibrate(Number(scale));
    this.cameraChanged.emit();
  }

  protected choose(deviceId: string) {
    this.meter.choose(deviceId || null);
    this.cameraChanged.emit();
  }
}
