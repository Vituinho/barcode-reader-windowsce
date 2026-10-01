export interface User {
  id: string;
  username: string;
  fullName: string;
  role: "ADMIN" | "OPERATOR";
  isActive: boolean;
  createdAt: string;
}

export interface Device {
  id: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  connectivity: "ONLINE" | "OFFLINE" | "DISABLED";
  appVersion: string | null;
  lastSeenAt: string | null;
  lastSeenAgeSeconds: number | null;
  lastOperatorName: string | null;
  lastIp: string | null;
  batteryLevel: number | null;
  pendingScans: number | null;
  clockSkewSeconds: number | null;
  syncIntervalSeconds: number | null;
  duplicateWindowSeconds: number | null;
}

export interface Session {
  id: string;
  name: string;
  sessionType: string;
  status: "OPEN" | "CLOSED";
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
  scanCount: number;
  conflictCount: number;
}

export interface Item {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  barcodes: string[];
}

export interface Barcode {
  id: string;
  code: string;
  status: "KNOWN" | "UNKNOWN";
  itemId: string | null;
  itemName: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  scanCount: number;
}

export interface Scan {
  id: string;
  clientScanId: string;
  deviceId: string;
  operatorId: string | null;
  operatorName: string | null;
  sessionId: string | null;
  sessionName: string | null;
  requestedSessionId: string | null;
  barcode: string;
  barcodeStatus: string;
  itemName: string | null;
  result: string;
  syncState: string;
  scannedAtDevice: string;
  receivedAtServer: string;
  resolutionNote: string | null;
}

export interface Dashboard {
  scansToday: number;
  unknownScansToday: number;
  unknownBarcodes: number;
  conflictsOpen: number;
  openSessions: number;
  devicesOnline: number;
  devicesOffline: number;
  devicesDisabled: number;
  serverTime: string;
}

export type Platform = "WINDOWS_CE" | "WINDOWS_DESKTOP";

export interface SoftwareRelease {
  id: string;
  platform: Platform;
  version: string;
  fileName: string;
  downloadUrl: string;
  sha256: string | null;
  fileSize: number | null;
  releaseNotes: string | null;
  releasedAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
