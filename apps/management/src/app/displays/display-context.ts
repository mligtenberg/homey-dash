import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { DisplaysStore } from './displays-store';

/** The display whose pages are open. Provided by DisplayPage, so the page of each tab reads it from there. */
@Injectable()
export class DisplayContext {
  private readonly store = inject(DisplaysStore);
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });

  readonly display = computed(() => this.store.get(this.id()));
}
