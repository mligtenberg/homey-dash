/**
 * A timer as it travels, shared by every screen: running, it ends at `end` (ms since the epoch); paused, `paused` is
 * what is left (ms). Mirrors apps/api/Timers/SharedTimer.cs.
 */
export interface TimerView {
  id: string;
  /** Its length so far, in seconds, which time added to it lengthens. */
  seconds: number;
  end: number;
  paused: number | null;
  name: string | null;
  sound: string;
}
