// P04-D2 declaration boundary for candidate-only PWA registration.
// Runtime lives in `./registration.js` and has no imports.

export const CANDIDATE_SW_URL: string;
export const CANDIDATE_SW_SCOPE: string;
export const CANDIDATE_PWA_CACHE: string;
export const PWA_WARM_URL_LIMIT: number;

export interface UpdateCoordination {
  canActivateUpdate(): boolean;
  activeCriticalSections?(): Array<{ readonly kind: string; readonly tabId: string }>;
}

export interface EpochCoordination {
  bumpEpoch(reason?: string): number;
}

export function registerCandidatePwa(options?: {
  readonly environment?: typeof globalThis;
  readonly swUrl?: string;
  readonly scope?: string;
  readonly coordination?: (UpdateCoordination & Partial<EpochCoordination>) | null;
}): Promise<{ readonly ok: boolean; readonly reason: string; readonly registration?: unknown }>;

export function activateCandidateUpdate(
  registration: { readonly waiting?: { postMessage(message: unknown): void } | null } | null,
  coordination: (UpdateCoordination & Partial<EpochCoordination>) | null,
  reason?: string,
  options?: { readonly hadController?: boolean },
): Promise<{ readonly activated: boolean; readonly epoch: number | null; readonly reason: string }>;

export function maybeActivateWaiting(
  registration: { readonly waiting?: { postMessage(message: unknown): void } | null } | null,
  coordination: UpdateCoordination | null,
): Promise<{ readonly activated: boolean; readonly reason: string }>;

export function describeUpdateReadiness(
  coordination: UpdateCoordination | null,
): { readonly ready: boolean; readonly activeSections: Array<{ readonly kind: string; readonly tabId: string }> };

export function selectWarmUrls(
  entries: ReadonlyArray<{ readonly url?: unknown; readonly name?: unknown } | string> | null | undefined,
  origin: string,
): string[];

export function warmPwaCache(options?: {
  readonly environment?: typeof globalThis;
  readonly cacheName?: string;
  readonly urls?: string[];
}): Promise<{ readonly warmed: number; readonly requested: number; readonly reason: string }>;
