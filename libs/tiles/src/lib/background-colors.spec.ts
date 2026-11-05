import { hexToOklch, oklchToHex, schemeProperties } from './background-colors';

describe('hexToOklch and oklchToHex', () => {
  it('go there and back', () => {
    for (const hex of ['#3366cc', '#d9a066', '#1a1c24', '#ffffff', '#7a7a7a']) {
      expect(oklchToHex(...hexToOklch(hex))).toBe(hex);
    }
  });

  it('knows a blue from a red', () => {
    expect(hexToOklch('#ff0000')[2]).toBeCloseTo(29.2, 0);
    expect(hexToOklch('#0000ff')[2]).toBeCloseTo(264.1, 0);
  });

  it('lowers chroma, keeping the hue, until a colour fits', () => {
    const [l, c, h] = hexToOklch(oklchToHex(0.7, 0.4, 150));
    expect(l).toBeCloseTo(0.7, 2);
    expect(h).toBeCloseTo(150, 0);
    expect(c).toBeLessThan(0.4);
  });
});

describe('schemeProperties', () => {
  it('is the picked colour’s hue and chroma, and the angle', () => {
    expect(schemeProperties({ color: '#0000ff', angle: 30 })).toEqual({ '--scheme-hue': 264.1, '--scheme-angle': 30, '--scheme-chroma': 0.313 });
  });
});
