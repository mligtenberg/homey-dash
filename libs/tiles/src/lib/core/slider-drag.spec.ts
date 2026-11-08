import { SliderDrag } from './slider-drag';

const event = (x: number) =>
  ({
    clientX: x,
    pointerId: 1,
    currentTarget: { setPointerCapture: () => undefined, getBoundingClientRect: () => ({ left: 100, width: 200 }) },
  }) as unknown as PointerEvent;

describe('SliderDrag', () => {
  it('follows the finger along the track, within it', () => {
    const drag = new SliderDrag();
    drag.start(event(200), 'a');
    expect(drag.shown('a', 0.9)).toBe(0.5);
    expect(drag.shown('b', 0.9)).toBe(0.9);
    drag.move(event(1000), 'a');
    expect(drag.shown('a', 0)).toBe(1);
  });

  it('ignores moves on a slider the finger is not on', () => {
    const drag = new SliderDrag();
    drag.start(event(200), 'a');
    drag.move(event(300), 'b');
    expect(drag.shown('a', 0)).toBe(0.5);
  });

  it('commits the value on release and then shows the real one', async () => {
    const drag = new SliderDrag();
    const commit = vi.fn(() => Promise.resolve());
    drag.start(event(100), 'a');
    await drag.end(event(300), 'a', commit);
    expect(commit).toHaveBeenCalledWith(1);
    expect(drag.shown('a', 0.2)).toBe(0.2);
  });

  it('does not commit after a cancel', async () => {
    const drag = new SliderDrag();
    const commit = vi.fn(() => Promise.resolve());
    drag.start(event(100), 'a');
    drag.cancel();
    await drag.end(event(300), 'a', commit);
    expect(commit).not.toHaveBeenCalled();
  });
});
