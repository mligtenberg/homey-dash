import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DEFAULT_NEWS_SOURCE, NEWS_SOURCES } from '@homey-dash/api-client';
import { NewsTileSettings } from './news-data';
import { TranslatePipe } from '@homey-dash/i18n';

/** Management's choice of which NOS feed a news tile shows (ADR-0016). */
@Component({
  selector: 'hd-news-tile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="news-source">{{ 'News' | t }}</label>
      <select id="news-source" class="hd-select" (change)="setSource($any($event.target).value)">
        @for (source of sources; track source.id) {
          <option [value]="source.id" [selected]="(settings().source ?? defaultSource) === source.id">{{ source.name }}</option>
        }
      </select>
    </div>
  `,
})
export class NewsTileSettingsEditor {
  readonly settings = input.required<NewsTileSettings>();
  readonly changed = output<Partial<NewsTileSettings>>();

  protected readonly sources = NEWS_SOURCES;
  protected readonly defaultSource = DEFAULT_NEWS_SOURCE;

  // The general feed is the one a tile without a source shows.
  protected setSource(id: string) {
    this.changed.emit({ source: id === DEFAULT_NEWS_SOURCE ? undefined : id });
  }
}
