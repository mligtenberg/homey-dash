import { signal } from '@angular/core';
import { clamp } from './device-view';

/**
 * A finger dragging along sliders: which slider it is on, by `key`, and where, from 0 to 1, until the new value has been
 * sent and the slider can show the real one again. Wire a slider's pointer events to `start`, `move`, `end` and `cancel`.
 */
export class SliderDrag {
  private readonly drag = signal<{ key: string; value: number } | null>(null);

  /** The value to show for a slider: where the finger is, or `actual` when it is not on this one. */
  shown(key: string, actual: number) {
    const drag = this.drag();
    return drag?.key === key ? drag.value : actual;
  }

  start(event: PointerEvent, key: string) {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.move(event, key, true);
  }

  move(event: PointerEvent, key: string, starting = false) {
    if (!starting && this.drag()?.key !== key) return;
    const track = (event.currentTarget as Element).getBoundingClientRect();
    this.drag.set({ key, value: clamp((event.clientX - track.left) / (track.width || 1), 0, 1) });
  }

  /** Lets go: `commit` gets the value, and the slider keeps showing it until that is done. */
  async end(event: PointerEvent, key: string, commit: (value: number) => Promise<unknown>) {
    this.move(event, key);
    const drag = this.drag();
    if (drag?.key !== key) return;
    await commit(drag.value);
    this.drag.set(null);
  }

  cancel() {
    this.drag.set(null);
  }
}
