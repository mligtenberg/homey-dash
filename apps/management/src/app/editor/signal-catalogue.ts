import { computed, inject, Injectable, signal } from '@angular/core';
import { Realtime, RulesApi, SignalInfo, stopOnDestroy } from '@homey-dash/api-client';
import { firstValueFrom } from 'rxjs';

/** A source's signals that belong together, such as one device's capabilities, for the signal picker. */
export interface SignalGroup {
  key: string;
  /** What the group is within its source: a device, "Variables", "Clock". */
  label: string;
  /** Where it comes from: "Homey — Home", "Clock", "Plex — Attic". */
  source: string;
  signals: SignalInfo[];
}

/** The group key of a signal. */
export function groupKey(signal: SignalInfo) {
  return `${signal.source}|${signal.account ?? ''}|${signal.group}`;
}

function sourceLabel(signal: SignalInfo) {
  const name = signal.source.replace(/^./, (c) => c.toUpperCase());
  return signal.accountName ? `${name} — ${signal.accountName}` : name;
}

/** Signals in groups, sources in the catalogue's order. */
export function groupSignals(signals: readonly SignalInfo[]): SignalGroup[] {
  const groups = new Map<string, SignalGroup>();
  for (const signal of signals) {
    const key = groupKey(signal);
    const group = groups.get(key) ?? { key, label: signal.group, source: sourceLabel(signal), signals: [] };
    group.signals.push(signal);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * The signals rules can use, from the API's signal catalogue (ADR-0010). Loads again whenever what they come from may
 * have changed: a Homey or Plex account, or the displays.
 */
@Injectable({ providedIn: 'root' })
export class SignalCatalogue {
  private readonly api = inject(RulesApi);
  private readonly realtime = inject(Realtime);
  private loading = false;
  private again = false;

  /** Null until it first loaded. */
  readonly signals = signal<SignalInfo[] | null>(null);
  readonly byId = computed(() => new Map((this.signals() ?? []).map((s) => [s.id, s])));
  readonly groups = computed(() => groupSignals(this.signals() ?? []));

  constructor() {
    stopOnDestroy(
      this.realtime.whenConnected(() => this.load()),
      this.realtime.on('Homeys', () => this.load()),
      this.realtime.on('Plex', () => this.load()),
      this.realtime.on('Displays', () => this.load()),
    );
  }

  // One load at a time; changes during one load once more after it.
  private async load() {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      this.signals.set(await firstValueFrom(this.api.signals()));
    } catch {
      // HomeyDash out of reach; the next reconnect loads them.
    } finally {
      this.loading = false;
      if (this.again) {
        this.again = false;
        this.load();
      }
    }
  }
}
