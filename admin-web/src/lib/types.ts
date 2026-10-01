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
  stockTotal: number;
  loadsPending: number;
  loadsReady: number;
  loadsReview: number;
  loadsDispatchedToday: number;
  readyLoads: { id: string; externalCode: string; volumes: number }[];
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

export type LoadStatus = "PENDING" | "READY" | "DISPATCHED";

export interface LoadSummary {
  id: string;
  externalCode: string;
  status: LoadStatus;
  needsReview: boolean;
  requiredVolumes: number;
  availableVolumes: number;
  missingVolumes: number;
  progress: number;
  productLines: number;
  invoiceCount: number;
  customerCount: number;
  warningInvoices: number;
  importedAt: string;
  dispatchedAt: string | null;
  dispatchedByName: string | null;
}

export interface LoadRequirement {
  id: string;
  productCode: string | null;
  description: string;
  unit: string | null;
  requiredQuantity: number | null;
  commercialQuantity: number;
  stock: number;
  available: number;
  missing: number;
  needsReview: boolean;
  reviewReason: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
}

export interface InvoiceLine {
  lineNumber: number;
  productCode: string;
  description: string | null;
  ean: string | null;
  unit: string | null;
  quantity: number;
  discrete: boolean;
}

export interface LoadInvoice {
  id: string;
  accessKey: string;
  invoiceNumber: string | null;
  issuedAt: string | null;
  customerName: string | null;
  customerDocument: string | null;
  city: string | null;
  state: string | null;
  orderNumber: string | null;
  externalCustomerCode: string | null;
  volumeCount: number | null;
  volumeSpecies: string | null;
  sourceFileName: string | null;
  warnings: { code: string; message: string }[];
  lines: InvoiceLine[];
}

export interface Movement {
  id: string;
  productCode: string | null;
  description: string;
  type: "SCAN_IN" | "DISPATCH_OUT" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";
  quantity: number;
  reason: string | null;
  deviceId: string | null;
  createdByName: string | null;
  createdAt: string;
  loadId: string | null;
  scanId: string | null;
}

export interface LoadDetail extends LoadSummary {
  requirements: LoadRequirement[];
  invoices: LoadInvoice[];
  dispatchMovements: Movement[];
}

export interface InventoryRow {
  productCode: string;
  description: string;
  unit: string | null;
  ean: string | null;
  quantity: number;
  lastInAt: string | null;
  lastOutAt: string | null;
}

export interface DispatchRow {
  loadId: string;
  externalCode: string;
  dispatchedAt: string | null;
  dispatchedByName: string | null;
  volumes: number;
  productLines: number;
}

export interface ImportIssue {
  file: string;
  code: string;
  message: string;
  accessKey?: string | null;
  load?: string | null;
}

export interface ImportReport {
  filesProcessed: number;
  xmlAccepted: number;
  duplicatesSkipped: number;
  invoicesImported: number;
  productsCreated: number;
  productsUpdated: number;
  loadsCreated: string[];
  loadsUpdated: string[];
  ignoredFiles: string[];
  invalid: ImportIssue[];
  warnings: ImportIssue[];
}

export interface UnknownCode {
  productCode: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastRawBarcode: string | null;
  lastDeviceId: string | null;
  lastOperatorName: string | null;
}
