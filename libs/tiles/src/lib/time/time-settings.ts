import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SettingSelect } from '../core/setting-select';
import { ClockTileSettings, DateTileSettings } from './time-data';
import { TranslatePipe } from '@homey-dash/i18n';

/** Management's settings of a clock tile: its look, 12 or 24 hours, the seconds, and the date. */
@Component({
  selector: 'hd-clock-tile-settings',
  imports: [SettingSelect, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-setting-select
      [label]="'Look' | t"
      selectId="clock-style"
      [options]="styles"
      [value]="settings().style ?? 'digital'"
      (picked)="changed.emit({ style: $event === 'analog' ? 'analog' : 'digital' })"
    />
    <hd-setting-select
      [label]="'Hours' | t"
      selectId="clock-hours"
      emptyLabel="Automatic"
      [options]="hours"
      [value]="settings().hours"
      (picked)="changed.emit({ hours: $event === '' ? undefined : $event === '12' ? 12 : 24 })"
    />
    <hd-setting-select
      [label]="'Seconds' | t"
      selectId="clock-seconds"
      [options]="yesNo"
      [value]="settings().seconds ? 'yes' : 'no'"
      (picked)="changed.emit({ seconds: $event === 'yes' })"
    />
    <hd-setting-select
      [label]="'Date' | t"
      selectId="clock-date"
      [options]="yesNo"
      [value]="settings().showDate === false ? 'no' : 'yes'"
      (picked)="changed.emit({ showDate: $event === 'yes' })"
    />
  `,
})
export class ClockTileSettingsEditor {
  readonly settings = input.required<ClockTileSettings>();
  readonly changed = output<Partial<ClockTileSettings>>();

  protected readonly styles = [
    { value: 'digital', label: 'Digital' },
    { value: 'analog', label: 'Analog' },
  ];
  protected readonly hours = [
    { value: 24, label: '24 hours' },
    { value: 12, label: '12 hours' },
  ];
  protected readonly yesNo = [
    { value: 'yes', label: 'Show' },
    { value: 'no', label: 'Hide' },
  ];
}

/** Management's settings of a date tile: whether a large tile numbers the weeks. */
@Component({
  selector: 'hd-date-tile-settings',
  imports: [SettingSelect, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hd-setting-select
      [label]="'Week numbers' | t"
      selectId="date-weeks"
      [options]="yesNo"
      [value]="settings().weekNumbers ? 'yes' : 'no'"
      (picked)="changed.emit({ weekNumbers: $event === 'yes' })"
    />
  `,
})
export class DateTileSettingsEditor {
  readonly settings = input.required<DateTileSettings>();
  readonly changed = output<Partial<DateTileSettings>>();

  protected readonly yesNo = [
    { value: 'no', label: 'Hide' },
    { value: 'yes', label: 'Show' },
  ];
}
