import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RealtimeRuleAnswers } from '@homey-dash/tiles';
import { SignalCatalogue } from './editor/signal-catalogue';

/**
 * Which display the Editor and the Preview pretend to be on, or none, for logic tiles' rules on display signals. The
 * displays are those the display name signal offers.
 */
@Component({
  selector: 'hd-as-display-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select class="hd-select" aria-label="Rules as on display" (change)="answers.seeAs($any($event.target).value || null)">
      <option value="" [selected]="!answers.seenAs()">As on no display</option>
      @for (display of displays(); track display.value) {
        <option [value]="display.value" [selected]="display.value === answers.seenAs()">As on {{ display.label }}</option>
      }
    </select>
  `,
})
export class AsDisplayPicker {
  protected readonly answers = inject(RealtimeRuleAnswers);
  private readonly catalogue = inject(SignalCatalogue);

  protected readonly displays = computed(() => this.catalogue.byId().get('display:name')?.allowedValues ?? []);
}
