import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DisplayInfo } from '@homey-dash/api-client';
import { DisplaysStore } from './displays-store';
import { TranslatePipe } from '@homey-dash/i18n';

/** Whether a display is connected, runs in Fully Kiosk, shows the latest version of its dashboards, and how bright it is. */
@Component({
  selector: 'hd-display-status',
  imports: [DecimalPipe, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'status' },
  template: `
    @let status = display().status;
    @if (!status.held) {
      <span class="hd-pill hd-pill--warn" [title]="'Its screen became another display. Take it over from setup on a screen.' | t">{{ 'No screen' | t }}</span>
    } @else if (status.connected) {
      <span class="hd-pill hd-pill--ok hd-pill--dot">{{ 'Connected' | t }}</span>
    } @else {
      <!-- Seen before but not now is stale, in warn, as on the Overview and in the sidebar. -->
      <span class="hd-pill hd-pill--dot" [class.hd-pill--warn]="status.lastSeenAt">{{ status.lastSeenAt ? 'Last seen ' + store.ago(status.lastSeenAt) : 'Never connected' }}</span>
    }
    @if (status.connected) {
      @if (status.kiosk) {
        <span class="hd-pill hd-pill--ok" [title]="'This screen runs in Fully Kiosk Browser, so idle rules can turn it off.' | t">{{ 'Fully Kiosk' | t }}</span>
      }
      @if (status.lux !== null) {
        <span class="hd-pill" [title]="'Light falling on the screen' | t">{{ status.lux | number: '1.0-0' }} lx</span>
      }
    }
    @if (!display().dashboardIds.length) {
      <span class="hd-pill hd-pill--dot">{{ 'Waiting for a dashboard' | t }}</span>
    } @else if (status.held) {
      @for (version of status.versions; track version.dashboardId) {
        @if (version.shownVersion !== version.latestVersion) {
          <span class="hd-pill hd-pill--warn">{{ store.behind(version, status.versions.length > 1) }}</span>
        }
      }
    }
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  `,
})
export class DisplayStatus {
  protected readonly store = inject(DisplaysStore);
  readonly display = input.required<DisplayInfo>();
}
