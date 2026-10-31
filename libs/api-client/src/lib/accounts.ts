import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Accounts/AccountEndpoints.cs.

/** A Homey account: a Homey Pro on the local network. Its key never leaves HomeyDash, so only the address is shown. */
export interface HomeyAccount {
  id: number;
  /** Tells a home's Homeys apart, such as which house or floor. */
  name: string;
  address: string;
}

export interface HomeyAccounts {
  /** HomeyDash runs against a fake Homey, set in its configuration, whose one account can't be changed. */
  fake: boolean;
  /** Oldest first; a Homey tile uses the first unless it names another. */
  accounts: HomeyAccount[];
}

/** Setting up the Homey accounts HomeyDash connects to. Every change answers with all of them. */
@Injectable({ providedIn: 'root' })
export class HomeyAccountApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<HomeyAccounts>('/api/accounts/homey');
  }

  add(name: string, address: string, apiKey: string) {
    return this.http.post<HomeyAccounts>('/api/accounts/homey', { name, address, apiKey });
  }

  /** Another address or key connects again. Leave `apiKey` empty to keep the current key. */
  update(id: number, name: string, address: string, apiKey: string) {
    return this.http.put<HomeyAccounts>(`/api/accounts/homey/${id}`, { name, address, apiKey: apiKey || null });
  }

  /** Tiles that name it show as missing until they are given another account. */
  remove(id: number) {
    return this.http.delete<HomeyAccounts>(`/api/accounts/homey/${id}`);
  }
}

/** An Immich account, for photo sets. Its key never leaves HomeyDash, so only the address is shown. */
export interface ImmichAccount {
  id: number;
  /** Tells a home's Immich accounts apart, such as whose it is. */
  name: string;
  address: string;
}

export interface ImmichAccounts {
  /** HomeyDash runs against a fake Immich, set in its configuration, whose one account can't be changed. */
  fake: boolean;
  /** Oldest first; a new photo set uses the first unless it names another. */
  accounts: ImmichAccount[];
}

/** Setting up the Immich accounts, whose albums photo sets follow. Every change answers with all of them. */
@Injectable({ providedIn: 'root' })
export class ImmichAccountApi {
  private readonly http = inject(HttpClient);

  list() {
    return this.http.get<ImmichAccounts>('/api/accounts/immich');
  }

  /** Checked with Immich before it is kept. */
  add(name: string, address: string, apiKey: string) {
    return this.http.post<ImmichAccounts>('/api/accounts/immich', { name, address, apiKey });
  }

  /** A new address or key is checked with Immich first. Leave `apiKey` empty to keep the current key. */
  update(id: number, name: string, address: string, apiKey: string) {
    return this.http.put<ImmichAccounts>(`/api/accounts/immich/${id}`, { name, address, apiKey: apiKey || null });
  }

  /** Its photo sets keep their photos, but displays can't show them until each set is given another account. */
  remove(id: number) {
    return this.http.delete<ImmichAccounts>(`/api/accounts/immich/${id}`);
  }
}
