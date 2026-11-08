import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TomTomAccounts } from '@homey-dash/api-client';
import { TomTomAccountPanel } from './tomtom-account-panel';

describe('TomTomAccountPanel', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));

  const stable = () => TestBed.inject(ApplicationRef).whenStable();
  const http = () => TestBed.inject(HttpTestingController);

  async function render(answer: TomTomAccounts) {
    const fixture = TestBed.createComponent(TomTomAccountPanel);
    fixture.detectChanges();
    http().expectOne('/api/accounts/tomtom').flush(answer);
    await stable();
    return fixture.nativeElement as HTMLElement;
  }

  it('says TomTom is not set up, and offers to set it up', async () => {
    const root = await render({ fake: false, accounts: [] });

    expect(root.querySelector('.hd-pill')?.textContent).toContain('Not set up');
    expect(root.textContent).toContain('Set up TomTom');
  });

  it('adds an account with a name and a key, and never shows a key', async () => {
    const root = await render({ fake: false, accounts: [] });
    (root.querySelector('.hd-actions button') as HTMLButtonElement).click();
    await stable();
    (root.querySelector('#tomtom-name') as HTMLInputElement).value = 'Home';
    (root.querySelector('#tomtom-key') as HTMLInputElement).value = 'secret-key';

    (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    const request = http().expectOne('/api/accounts/tomtom');
    expect(request.request.body).toEqual({ name: 'Home', apiKey: 'secret-key' });
    request.flush({ fake: false, accounts: [{ id: 1, name: 'Home' }] });
    await stable();
    expect(root.querySelector('.hd-pill')?.textContent).toContain('Set up');
    expect(root.textContent).toContain('Home');
    expect(root.textContent).not.toContain('secret-key');
  });

  it('shows a key TomTom refused next to the key', async () => {
    const root = await render({ fake: false, accounts: [{ id: 1, name: 'Home' }] });
    (root.querySelector('.hd-actions button') as HTMLButtonElement).click();
    await stable();

    (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http().expectOne('/api/accounts/tomtom/1').flush({ errors: { apiKey: ["TomTom doesn't accept that API key."] } }, { status: 400, statusText: 'Bad Request' });
    await stable();

    expect(root.textContent).toContain("TomTom doesn't accept that API key.");
    expect(root.querySelector('form')).not.toBeNull();
    expect(HttpErrorResponse).toBeDefined();
  });

  it('has no form for the fake, whose one account cannot be changed', async () => {
    const root = await render({ fake: true, accounts: [{ id: 1, name: 'TomTom' }] });

    expect(root.querySelector('.hd-pill')?.textContent).toContain('Fake TomTom');
    expect(root.querySelector('button')).toBeNull();
  });
});
