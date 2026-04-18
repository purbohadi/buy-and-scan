import type { ParsedReceipt } from "./types";

export type SheetAppendContext = {
  appsScriptUrl: string | undefined;
  appsScriptSecret: string | undefined;
  rowNumber: number;
  id: string;
  createdAtIso: string;
  receipt: ParsedReceipt;
  imagePublicUrl: string;
};

function itemsDetail(receipt: ParsedReceipt): string {
  return receipt.items
    .map(
      (it) =>
        `${it.name} x${it.quantity} @ ${it.unitPrice.toFixed(2)} = ${it.lineTotal.toFixed(2)}`
    )
    .join(" | ");
}

function locationCell(receipt: ParsedReceipt): string {
  const loc = receipt.location;
  if (!loc) return "";
  if (loc.label) return loc.label;
  if (loc.latitude != null && loc.longitude != null) {
    return `${loc.latitude},${loc.longitude}`;
  }
  return "";
}

export async function appendReceiptToSheet(ctx: SheetAppendContext): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.appsScriptUrl) {
    return { ok: false, error: "GOOGLE_APPS_SCRIPT_URL is not configured" };
  }

  const row = [
    String(ctx.rowNumber),
    ctx.id,
    ctx.createdAtIso,
    locationCell(ctx.receipt),
    ctx.receipt.description ?? "",
    ctx.receipt.category ?? "",
    itemsDetail(ctx.receipt),
    String(ctx.receipt.total),
    ctx.receipt.currency,
    ctx.imagePublicUrl
  ];

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const payload: Record<string, unknown> = { row };
  if (ctx.appsScriptSecret) {
    payload.secret = ctx.appsScriptSecret;
  }

  const res = await fetch(ctx.appsScriptUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Sheet webhook HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: true };
  }
  const o = body as { ok?: boolean; error?: string };
  if (o && o.ok === false) {
    return { ok: false, error: o.error ?? "Apps Script reported failure" };
  }
  return { ok: true };
}
