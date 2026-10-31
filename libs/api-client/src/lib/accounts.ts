import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Accounts/AccountEndpoints.cs.

/** The Homey account. Its key never leaves HomeyDash, so only the address is shown. */
export interface HomeyAccountInfo {
  /** HomeyDash runs against a fake Homey, set in its configuration, so no account can be set up. */
  fake: boolean;
  /** Null while no Homey account is set up. */
  address: string | null;
}

/** The accounts HomeyDash holds for the home, set up in Management. */
@Injectable({ providedIn: 'root' })
export class AccountsApi {
  private readonly http = inject(HttpClient);

  homey() {
    return this.http.get<HomeyAccountInfo>('/api/accounts/homey');
  }

  /** Leave `apiKey` empty to keep the current key. */
  setHomey(address: string, apiKey: string) {
    return this.http.put<HomeyAccountInfo>('/api/accounts/homey', { address, apiKey: apiKey || null });
  }

  removeHomey() {
    return this.http.delete<void>('/api/accounts/homey');
  }
}

/** The Immich account, for photo sets. Its key never leaves HomeyDash, so only the address is shown. */
export interface ImmichAccountInfo {
  /** HomeyDash runs against a fake Immich, set in its configuration, so no account can be set up. */
  fake: boolean;
  /** Null while no Immich account is set up. */
  address: string | null;
}

/** Setting up Immich, whose albums photo sets follow. */
@Injectable({ providedIn: 'root' })
export class ImmichAccountApi {
  private readonly http = inject(HttpClient);

  get() {
    return this.http.get<ImmichAccountInfo>('/api/accounts/immich');
  }

  /** Checked with Immich before it is kept. Leave `apiKey` empty to keep the current key. */
  set(address: string, apiKey: string) {
    return this.http.put<ImmichAccountInfo>('/api/accounts/immich', { address, apiKey: apiKey || null });
  }

  remove() {
    return this.http.delete<void>('/api/accounts/immich');
  }
}
