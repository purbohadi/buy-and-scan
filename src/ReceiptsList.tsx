import { useEffect, useState } from "react";
import type { StoredReceiptListItem } from "./types";
import { Spinner } from "./Spinner";

function formatDateTime(iso: string | null | undefined): string {
  const s = iso?.trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function ReceiptsList({ signedIn, refreshKey = 0 }: { signedIn: boolean; refreshKey?: number }) {
  const [rows, setRows] = useState<StoredReceiptListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch("/api/receipts", { credentials: "include" })
      .then(async (res) => {
        const j = (await res.json()) as { receipts?: StoredReceiptListItem[]; error?: string };
        if (!res.ok) throw new Error(j.error ?? "Failed to load receipts");
        if (!cancelled) setRows(j.receipts ?? []);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, refreshKey]);

  if (!signedIn) {
    return <p className="muted">Sign in to see your stored receipts.</p>;
  }

  if (loading && rows === null) {
    return (
      <p className="muted row" style={{ gap: "0.5rem" }}>
        <Spinner /> Loading…
      </p>
    );
  }

  if (err) {
    return (
      <div className="badge warn" role="alert">
        {err}
      </div>
    );
  }

  const list = rows ?? [];
  if (list.length === 0) {
    return <p className="muted">No receipts saved yet. Capture and approve one from the Scan tab.</p>;
  }

  return (
    <div className="table-wrap overflow-x-auto rounded-lg border border-slate-500/20">
      <table className="min-w-full border-collapse text-left text-sm text-slate-200">
        <thead>
          <tr className="border-b border-slate-500/20 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Date Time</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2 whitespace-nowrap">Total</th>
            <th className="px-3 py-2">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const when = formatDateTime(r.receiptDatetime ?? r.createdAt);
            const desc = [r.vendor, r.description].filter(Boolean).join(" · ") || "—";
            return (
              <tr key={r.id} className="border-b border-slate-500/10">
                <td className="px-3 py-2 align-top whitespace-nowrap tabular-nums text-slate-300">{when}</td>
                <td className="px-3 py-2 align-top text-slate-200">{desc}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap tabular-nums">
                  {r.total} {r.currency}
                </td>
                <td className="px-3 py-2 align-top">
                  <a className="btn btn-secondary" style={{ padding: "0.35rem 0.65rem", fontSize: "0.8rem" }} href={r.imageUrl} target="_blank" rel="noreferrer">
                    Image
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
