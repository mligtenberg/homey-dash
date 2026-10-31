import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Realtime, Rule } from '@homey-dash/api-client';

/**
 * Whether rules hold, as HomeyDash evaluates them (ADR-0010). A listener hears true or false whenever the answer
 * changes, and null when HomeyDash refused the rule as invalid. The last answer stays while the connection is lost.
 */
export abstract class RuleAnswers {
  /** Returns a function that stops listening. */
  abstract subscribe(rule: Rule, listener: (holds: boolean | null) => void): () => void;
}

interface Subscription {
  rule: Rule;
  listener: (holds: boolean | null) => void;
  /** The latest answer's place in HomeyDash's order, so an older one arriving late is ignored. */
  seq: number;
}

/**
 * Rule answers over HomeyDash's realtime connection. HomeyDash drops a connection's subscriptions when it closes, so
 * they are made again on every reconnect. Management sees rules as on a display it picks with `seeAs`.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeRuleAnswers extends RuleAnswers {
  private readonly realtime = inject(Realtime);
  private readonly subscriptions = new Map<string, Subscription>();
  /** The display rules are seen as on, or null for none. */
  readonly seenAs = signal<string | null>(null);
  private count = 0;

  constructor() {
    super();
    const stops = [
      this.realtime.on('RuleAnswers', ({ seq, answers }) => {
        for (const [id, holds] of Object.entries(answers)) this.hear(this.subscriptions.get(id), seq, holds);
      }),
      // A restarted HomeyDash counts from the start again, so answers before the reconnect no longer order these.
      this.realtime.whenConnected(() =>
        this.subscriptions.forEach((subscription, id) => {
          subscription.seq = 0;
          this.send(id);
        }),
      ),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  subscribe(rule: Rule, listener: (holds: boolean | null) => void): () => void {
    const id = `rule-${++this.count}`;
    this.subscriptions.set(id, { rule, listener, seq: 0 });
    if (this.realtime.connected()) this.send(id);
    return () => {
      this.subscriptions.delete(id);
      if (this.realtime.connected()) this.realtime.unsubscribeRule(id).catch(() => undefined);
    };
  }

  /** Sees every rule as on this display from now on, or on none; for Management's preview. */
  seeAs(display: string | null) {
    if (display === this.seenAs()) return;
    this.seenAs.set(display);
    if (this.realtime.connected()) [...this.subscriptions.keys()].forEach((id) => this.send(id));
  }

  private async send(id: string) {
    const subscription = this.subscriptions.get(id);
    if (!subscription) return;
    try {
      const { holds, seq } = await this.realtime.subscribeRule(id, subscription.rule, this.seenAs());
      this.hear(this.subscriptions.get(id) === subscription ? subscription : undefined, seq, holds);
    } catch {
      // Refused as invalid, or the connection dropped, which subscribes again on reconnect.
      if (this.subscriptions.get(id) === subscription && this.realtime.connected()) subscription.listener(null);
    }
  }

  private hear(subscription: Subscription | undefined, seq: number, holds: boolean) {
    if (!subscription || seq <= subscription.seq) return;
    subscription.seq = seq;
    subscription.listener(holds);
  }
}
