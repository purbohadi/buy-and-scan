export type ReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ReceiptLocation = {
  latitude?: number;
  longitude?: number;
  label?: string;
};

export type ParsedReceipt = {
  vendor?: string;
  receiptDatetime?: string;
  currency: string;
  total: number;
  category?: string;
  description?: string;
  items: ReceiptItem[];
  location?: ReceiptLocation;
};

export type ParseResponse = {
  draft: ParsedReceipt;
  contentHash: string;
  duplicate: boolean;
  duplicateCount: number;
  totalReceipts: number;
};

export type SubmitBody = {
  contentHash: string;
  imageMime: string;
  imageBase64: string;
  receipt: ParsedReceipt;
  /** When true, server stores minimal receipt row (image only); ignores rich parsed fields from client except optional note. */
  imageOnly?: boolean;
  confirmDuplicate?: boolean;
};

export type SubmitResponse = {
  ok: boolean;
  id: string;
  imageUrl: string;
  totalReceipts: number;
  duplicateBlocked?: boolean;
  duplicateCount?: number;
  sheetsAppended?: boolean;
  sheetsError?: string;
};

/** Row for GET /api/receipts (user-scoped list). */
export type StoredReceiptListItem = {
  id: string;
  createdAt: string;
  receiptDatetime: string | null;
  description: string | null;
  vendor: string | null;
  total: number;
  currency: string;
  imageUrl: string;
};

export type ReceiptsDeleteBody = {
  ids: string[];
};

export type ReceiptsDeleteResponse = {
  deleted: number;
  totalReceipts: number;
};

export type SheetRebuildResponse = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  rowsWritten: number;
};
