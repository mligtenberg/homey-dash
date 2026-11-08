import { TestBed } from '@angular/core/testing';
import { brokenImages } from './loadable-art';

describe('brokenImages', () => {
  it('remembers the pictures that failed', () => {
    const images = brokenImages();
    expect(images.has('a.png')).toBe(false);
    images.mark('a.png');
    expect(images.has('a.png')).toBe(true);
    expect(images.has('b.png')).toBe(false);
  });
});
