import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

// Mirrors apps/api/Homey/HomeyModels.cs.

/** `notSetUp` while no Homey account is set up in Management. */
export type HomeyConnection = 'connecting' | 'connected' | 'disconnected' | 'notSetUp';

/** How HomeyDash's connection to the Homey of one account is doing. */
export interface HomeyStatus {
  accountId: number;
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
  /** What a speaker is playing, as a picture, for `homeyImageUrl`; null when Homey has none for the device. */
  albumArt: HomeyImage | null;
}

/** A picture Homey keeps; `version` changes whenever the picture does. */
export interface HomeyImage {
  id: string;
  version: string | null;
}

/** Where a display gets a picture of a Homey: from HomeyDash, which fetches it from Homey. */
export function homeyImageUrl(accountId: number, image: HomeyImage) {
  return `/api/homey/images/${encodeURIComponent(image.id)}?account=${accountId}&v=${encodeURIComponent(image.version ?? '')}`;
}

/** A room or area in Homey; zones nest, and only the top one (Home) has no parent. */
export interface HomeyZone {
  id: string;
  name: string;
  parentId: string | null;
}

export interface HomeyFlow {
  id: string;
  name: string;
  advanced: boolean;
  enabled: boolean;
  folderId: string | null;
}

/** A folder of flows in Homey; folders nest. */
export interface HomeyFlowFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface HomeyMood {
  id: string;
  name: string;
  zoneId: string | null;
  /** The colours the mood sets, one per light it turns on in colour or white mode. */
  colors: HomeyLightColor[];
}

/** A light's colour, each part 0–1: hue and saturation in colour mode, or temperature (0 cool, 1 warm) for white. */
export interface HomeyLightColor {
  hue: number | null;
  saturation: number | null;
  temperature: number | null;
}

export interface HomeyInsightLog {
  id: string;
  ownerUri: string;
  ownerName: string | null;
  title: string;
  type: string;
  units: string | null;
}

export type InsightResolution = 'lastHour' | 'last24Hours' | 'last7Days' | 'last31Days';

/** One point of an insight log: `t` is an ISO time, `v` the value (null for a gap). */
export interface HomeyInsightEntry {
  t: string;
  v: number | null;
}

/** Reads from the Homey of an account; without one, of the oldest. */
@Injectable({ providedIn: 'root' })
export class HomeyApi {
  private readonly http = inject(HttpClient);

  insights(account?: number) {
    return this.http.get<HomeyInsightLog[]>('/api/homey/insights', { params: accountParam(account) });
  }

  insightEntries(log: string, resolution: InsightResolution, account?: number) {
    return this.http.get<HomeyInsightEntry[]>('/api/homey/insights/entries', { params: { log, resolution, ...accountParam(account) } });
  }
}

function accountParam(account: number | undefined): Record<string, number> {
  return account === undefined ? {} : { account };
}
