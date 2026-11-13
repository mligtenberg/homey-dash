import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LOCALES, LOCALE_NAMES, locale, TranslatePipe } from '@homey-dash/i18n';
import { chooseManagementLocale } from './language';

/** Which language Management is shown in. Remembered in this browser; each display has its own language. */
@Component({
  selector: 'hd-language-page',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hd-field">
      <label class="hd-field__label" for="management-language">{{ 'Language' | t }}</label>
      <select class="hd-input" id="management-language" [value]="locale()" (change)="choose(language.value)" #language>
        @for (l of locales; track l) {
          <option [value]="l" [selected]="locale() === l">{{ names[l] }}</option>
        }
      </select>
      <span class="hd-hint">{{ 'Applies to Management in this browser. Each display has its own language, set on the display.' | t }}</span>
    </div>
  `,
  styles: `:host { display: block; } .hd-input { max-width: 280px; }`,
})
export class LanguagePage {
  protected readonly locale = locale;
  protected readonly locales = LOCALES;
  protected readonly names = LOCALE_NAMES;
  protected readonly choose = chooseManagementLocale;
}
