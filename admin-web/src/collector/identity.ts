/**
 * Explicit local identity for a browser collector: a generated WEB-<uuid> stored on this browser.
 * No fingerprinting of any kind.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DeviceIdentity {
  id: string;
  name: string;
}

const DEVICE_KEY = "givova.coleta.device";
export const DEFAULT_DEVICE_NAME = "Coletor Web";

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Idempotency key created once per physical reading, before any network attempt, reused on every retry. */
export function newClientScanId(deviceId: string): string {
  return `${deviceId}-${uuid()}`;
}

export function getDeviceIdentity(storage: KeyValueStorage): DeviceIdentity {
  try {
    const stored = storage.getItem(DEVICE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DeviceIdentity>;
      if (parsed.id && /^WEB-[0-9a-f-]{36}$/.test(parsed.id)) {
        return { id: parsed.id, name: parsed.name?.trim() || DEFAULT_DEVICE_NAME };
      }
    }
  } catch {
    /* corrupted value: create a new identity below */
  }
  const identity = { id: `WEB-${uuid()}`, name: DEFAULT_DEVICE_NAME };
  try {
    storage.setItem(DEVICE_KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable: identity lives for this page only */
  }
  return identity;
}

export function setDeviceName(storage: KeyValueStorage, name: string): DeviceIdentity {
  const current = getDeviceIdentity(storage);
  const next = { id: current.id, name: name.replace(/\s+/g, " ").trim().slice(0, 100) || DEFAULT_DEVICE_NAME };
  storage.setItem(DEVICE_KEY, JSON.stringify(next));
  return next;
}
