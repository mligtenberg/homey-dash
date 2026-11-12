import { measure } from './voice-test';

describe('measure', () => {
  it('says how loud a recording is, and counts what is distorted', () => {
    const half = new Float32Array(16000).fill(0.5);
    const r = measure(half, 125, 1);
    expect(r.averageDb).toBe(-6);
    expect(r.peakDb).toBe(-6);
    expect(r.clipped).toBe(0);
    expect(r.expected).toBe(125);

    const loud = new Float32Array(100).fill(1);
    expect(measure(loud, 1, 1).clipped).toBe(1);
  });

  it('knows silence', () => {
    expect(measure(new Float32Array(1600), 12, 0.1).peakDb).toBe(-Infinity);
  });
});
