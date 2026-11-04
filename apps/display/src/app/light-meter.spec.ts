import { cameraOf, lightOf, luxOf } from './light-meter';

const pixels = (...rgb: [number, number, number][]) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('lightOf', () => {
  it('is 0 for black and 1 for white', () => {
    expect(lightOf(pixels([0, 0, 0]))).toBe(0);
    expect(lightOf(pixels([255, 255, 255]))).toBeCloseTo(1);
  });

  it('undoes the gamma, so middle grey in a picture is 18% of the light', () => {
    expect(lightOf(pixels([118, 118, 118]))).toBeCloseTo(0.18, 2);
  });

  it('averages the pixels, weighing green most as the eye does', () => {
    expect(lightOf(pixels([0, 0, 0], [255, 255, 255]))).toBeCloseTo(0.5);
    expect(lightOf(pixels([0, 255, 0]))).toBeGreaterThan(lightOf(pixels([255, 0, 0])));
  });
});

describe('luxOf', () => {
  it('meters middle grey at 2.5·N²/t·100/ISO lux', () => {
    expect(luxOf(0.18, { time: 1 / 60, iso: 100 })).toBeCloseTo(726, 0);
  });

  it('follows the light, and the exposure it was taken at', () => {
    expect(luxOf(0.36, { time: 1 / 60, iso: 100 })).toBeCloseTo(2 * luxOf(0.18, { time: 1 / 60, iso: 100 }));
    expect(luxOf(0.18, { time: 1 / 8, iso: 800 })).toBeCloseTo(luxOf(0.18, { time: 1 / 60, iso: 100 }) / 60);
  });
});

describe('cameraOf', () => {
  const cam = (label: string, deviceId = label) => ({ kind: 'videoinput' as const, label, deviceId });
  const front = { facingMode: 'user', width: { ideal: 160 }, height: { ideal: 120 } };

  it('asks for the front camera', () => {
    expect(cameraOf([cam('camera2 1, facing front'), cam('camera2 0, facing back')])).toEqual(front);
  });

  it('passes over virtual cameras for the first real one', () => {
    const cameras = [cam('Insta360 Virtual Camera'), { kind: 'audioinput' as const, label: 'Mic', deviceId: 'm' }, cam('FaceTime HD Camera', 'f'), cam('OBS Virtual Camera')];
    expect(cameraOf(cameras)).toEqual({ ...front, deviceId: { ideal: 'f' } });
  });

  it('asks for the camera picked for the screen while it has it', () => {
    const cameras = [cam('FaceTime HD Camera', 'f'), cam('iPhone Camera', 'i')];
    expect(cameraOf(cameras, 'i')).toEqual({ width: { ideal: 160 }, height: { ideal: 120 }, deviceId: { exact: 'i' } });
    expect(cameraOf(cameras, 'gone')).toEqual(front);
  });

  it('leaves the choice to the browser while it names no cameras, or only virtual ones', () => {
    expect(cameraOf([cam(''), cam('')])).toEqual(front);
    expect(cameraOf([cam('OBS Virtual Camera')])).toEqual(front);
  });
});
