import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Homey/HomeyModels.cs.

export type HomeyConnection = 'connecting' | 'connected' | 'disconnected';

export interface HomeyStatus {
  connection: HomeyConnection;
  lastError: string | null;
  since: string;
  fake: boolean;
}

export type CapabilityValue = boolean | number | string | null;

export interface HomeyCapability {
  id: string;
  title: string;
  type: string;
  value: CapabilityValue;
  units: string | null;
  setable: boolean;
  getable: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  lastUpdated: string | null;
}

export interface HomeyDevice {
  id: string;
  name: string;
  zoneId: string | null;
  zoneName: string | null;
  class: string;
  available: boolean;
  unavailableMessage: string | null;
  capabilities: Record<string, HomeyCapability>;
}

export interface HomeyFlow {
  id: string;
  name: string;
  advanced: boolean;
  enabled: boolean;
}

export interface HomeyMood {
  id: string;
  name: string;
  zoneId: string | null;
}

export interface HomeyInsightLog {
  id: string;
  ownerUri: string;
  ownerName: string | null;
  title: string;
  type: string;
  units: string | null;
}

/** What Management reads from Homey to pick tile targets. */
@Injectable({ providedIn: 'root' })
export class HomeyApi {
  private readonly http = inject(HttpClient);

  status() {
    return this.http.get<HomeyStatus>('/api/homey/status');
  }

  devices() {
    return this.http.get<HomeyDevice[]>('/api/homey/devices');
  }

  flows() {
    return this.http.get<HomeyFlow[]>('/api/homey/flows');
  }

  moods() {
    return this.http.get<HomeyMood[]>('/api/homey/moods');
  }

  insights() {
    return this.http.get<HomeyInsightLog[]>('/api/homey/insights');
  }
}
