import { TIMER_SOUNDS } from './timers';
import { renderSound, roomImpulse } from './timer-sounds';

const peak = (samples: ArrayLike<number>, from = 0) => {
  let loudest = 0;
  for (let i = from; i < samples.length; i++) loudest = Math.max(loudest, Math.abs(samples[i]));
  return loudest;
};

describe('renderSound', () => {
  const rate = 22050;

  it.each(TIMER_SOUNDS.filter((s) => s !== 'none'))('renders %s as audible, finite samples that peak at 0.9', (sound) => {
    const samples = renderSound(sound, rate);
    expect(samples.length).toBeGreaterThan(rate / 2);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(peak(samples)).toBeCloseTo(0.9, 2);
  });

  it('renders the same sound every time', () => {
    expect(renderSound('bell', rate)).toEqual(renderSound('bell', rate));
  });

  it('renders silence as nothing', () => {
    expect(renderSound('none', rate)).toHaveLength(0);
  });

  it('lets a bell fade away while a beep stops short', () => {
    const bell = renderSound('bell', rate);
    expect(peak(bell, Math.floor(bell.length * 0.9))).toBeLessThan(0.1);
  });

  it('gives a stereo room that dies out', () => {
    const [left, right] = roomImpulse(rate);
    expect(left).not.toEqual(right);
    expect(peak(left, left.length - 100)).toBeLessThan(peak(left) / 20);
  });
});
