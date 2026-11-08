import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BackLink } from './back-link';

@Component({ imports: [BackLink], template: `<hd-back-link link="/displays">Displays</hd-back-link>` })
class Host {}

describe('BackLink', () => {
  it('links to the list with its name and an arrow icon', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const a = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/displays');
    expect(a.textContent?.trim()).toBe('Displays');
    expect(a.querySelector('svg')).not.toBeNull();
  });
});
