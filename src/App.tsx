import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParseResponse, ParsedReceipt, ReceiptItem, SubmitResponse } from "./types";

type AuthMe = {
  user: { sub: string; email: string } | null;
  authConfigured: boolean;
  googleLinked?: boolean;
  spreadsheetUrl?: string | null;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  return (await res.json()) as T;
}

async function fetchStats(): Promise<number> {
  const res = await fetch("/api/stats", { credentials: "include" });
  if (res.status === 401) return 0;
  if (!res.ok) return 0;
  const j = (await res.json()) as { totalReceipts: number };
  return j.totalReceipts ?? 0;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result as string;
      const b64 = r.split(",")[1] ?? r;
      resolve(b64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function emptyItem(): ReceiptItem {
  return { name: "", quantity: 1, unitPrice: 0, lineTotal: 0 };
}

function recalcLine(it: ReceiptItem): ReceiptItem {
  const lineTotal = Math.round(it.quantity * it.unitPrice * 100) / 100;
  return { ...it, lineTotal };
}

function sumItems(items: ReceiptItem[]): number {
  return Math.round(items.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0) * 100) / 100;
}

export default function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [totalReceipts, setTotalReceipts] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [lastSubmit, setLastSubmit] = useState<SubmitResponse | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "error") {
      const raw = params.get("reason") ?? "unknown";
      let reason = raw;
      try {
        reason = decodeURIComponent(raw);
      } catch {
        /* keep raw */
      }
      setError(`Sign-in failed: ${reason}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetchJson<AuthMe>("/api/auth/me")
      .then((me) => {
        setAuth(me);
        if (me.user) {
          fetchStats().then(setTotalReceipts).catch(() => setTotalReceipts(0));
        } else {
          setTotalReceipts(null);
        }
      })
      .catch(() => setAuth({ user: null, authConfigured: false }));
  }, []);

  const resetFlow = useCallback(() => {
    setParseResult(null);
    setReceipt(null);
    setContentHash(null);
    setConfirmDuplicate(false);
    setLastSubmit(null);
    setError(null);
    setFile(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    const me = await fetchJson<AuthMe>("/api/auth/me");
    setAuth(me);
    if (me.user) fetchStats().then(setTotalReceipts).catch(() => setTotalReceipts(0));
    else setTotalReceipts(null);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "linked") {
      window.history.replaceState({}, "", window.location.pathname);
      void refreshAuth();
    }
  }, [refreshAuth]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    await refreshAuth();
    resetFlow();
  };

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPickFile = (f: File | null) => {
    setError(null);
    setLastSubmit(null);
    setParseResult(null);
    setReceipt(null);
    setContentHash(null);
    setConfirmDuplicate(false);
    setFile(f);
  };

  const parseImage = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setLastSubmit(null);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd, credentials: "include" });
      const data = (await res.json()) as ParseResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      setParseResult(data);
      setReceipt(data.draft);
      setContentHash(data.contentHash);
      setConfirmDuplicate(false);
      setTotalReceipts(data.totalReceipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<ReceiptItem>) => {
    setReceipt((r) => {
      if (!r) return r;
      const items = [...r.items];
      const next = recalcLine({ ...items[idx], ...patch });
      items[idx] = next;
      const total = sumItems(items);
      return { ...r, items, total };
    });
  };

  const addItem = () => {
    setReceipt((r) => (r ? { ...r, items: [...r.items, recalcLine(emptyItem())] } : r));
  };

  const removeItem = (idx: number) => {
    setReceipt((r) => {
      if (!r) return r;
      const items = r.items.filter((_, i) => i !== idx);
      return { ...r, items, total: sumItems(items) };
    });
  };

  const attachLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setReceipt((r) =>
          r
            ? {
                ...r,
                location: {
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  label: r.location?.label
                }
              }
            : r
        );
      },
      () => setError("Could not read location. Check permissions."),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const submit = async () => {
    if (!file || !receipt || !contentHash) return;
    setBusy(true);
    setError(null);
    setLastSubmit(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          contentHash,
          imageMime: file.type || "image/jpeg",
          imageBase64,
          receipt,
          confirmDuplicate
        })
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.status === 409 && data.duplicateBlocked) {
        setError(
          `This receipt image was already stored (${data.duplicateCount ?? 0} time(s)). Check "Confirm duplicate" to save anyway.`
        );
        setLastSubmit(data);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Submit failed");
      setLastSubmit(data);
      setTotalReceipts(data.totalReceipts);
      setFile(null);
      setParseResult(null);
      setReceipt(null);
      setContentHash(null);
      setConfirmDuplicate(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const duplicateHint = useMemo(() => {
    if (!parseResult?.duplicate) return null;
    return `This image matches a previous upload (${parseResult.duplicateCount} saved).`;
  }, [parseResult]);

  const signedIn = Boolean(auth?.user);
  const authReady = auth !== null;

  if (authReady && auth.authConfigured && !signedIn) {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "2rem 1rem" }}>
        <div className="card stack">
          <h1 style={{ margin: 0, fontSize: "1.35rem" }}>Scan &amp; Parse</h1>
          <p className="muted" style={{ margin: 0 }}>
            Photograph receipts, review AI-parsed line items and totals, then save and optionally sync to a Google Sheet
            in <strong>your</strong> Drive after you connect Google. Sign-in identifies your account; we do not use your
            Google password.
          </p>
          {error ? (
            <div className="badge warn" role="alert">
              {error}
            </div>
          ) : null}
          <a className="btn" href="/api/auth/login" style={{ textDecoration: "none" }}>
            Continue with Google
          </a>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            <a href="/privacy">Privacy policy</a>
            {" · "}
            <a href="/terms">Terms of service</a>
            {" — same links as on the OAuth consent screen."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "1rem 1rem 2.5rem" }}>
      <header className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.35rem", letterSpacing: "-0.02em" }}>Scan & Parse</h1>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Tokyo trip receipts: snap, review, approve, sync to your Google Sheet in Drive.
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
          {auth?.user ? (
            <span className="badge" title={auth.user.email}>
              {auth.user.email ? auth.user.email.split("@")[0] : "Signed in"}
            </span>
          ) : null}
          {auth?.authConfigured === false ? (
            <span className="badge warn" title="Set AUTH_SESSION_SECRET and Google OAuth vars on the Worker">
              Auth off
            </span>
          ) : null}
          {signedIn && auth?.googleLinked && auth.spreadsheetUrl ? (
            <a className="btn btn-secondary" href={auth.spreadsheetUrl} target="_blank" rel="noreferrer">
              Open sheet
            </a>
          ) : null}
          {signedIn ? (
            <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
              Sign out
            </button>
          ) : null}
          <span className="badge" title="Receipts stored in D1 after approval">
            Stored: {!signedIn ? "—" : totalReceipts === null ? "…" : totalReceipts}
          </span>
        </div>
      </header>

      <div className="stack">
        {signedIn && auth && !auth.googleLinked ? (
          <section className="card stack">
            <strong>Connect Google Drive &amp; Sheets</strong>
            <p className="muted" style={{ margin: 0 }}>
              Approve access so we can create a <strong>Scan &amp; Parse</strong> spreadsheet in your Drive and append
              each saved receipt. Google may ask you to confirm again so we can keep access while you travel.
            </p>
            <button type="button" className="btn" onClick={() => (window.location.href = "/api/auth/link-google")}>
              Connect Google Drive &amp; Sheet
            </button>
          </section>
        ) : null}

        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>1. Capture</strong>
            <button type="button" className="btn btn-secondary" onClick={resetFlow} disabled={busy}>
              Reset
            </button>
          </div>
          {!signedIn && auth?.authConfigured ? (
            <p className="muted" style={{ margin: 0 }}>
              Sign in to upload and parse receipts.
            </p>
          ) : null}
          <p className="muted" style={{ margin: 0 }}>
            Use your phone camera (install as PWA for a home-screen app). JPEG or PNG works best.
          </p>
          <div className="row">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {previewUrl ? <img className="preview-img" src={previewUrl} alt="Receipt preview" /> : null}
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={parseImage}
              disabled={!file || busy || !signedIn || !auth?.googleLinked}
            >
              {busy ? "Working…" : "Parse with AI"}
            </button>
          </div>
        </section>

        {duplicateHint ? (
          <div className="badge warn" role="status">
            {duplicateHint}
          </div>
        ) : null}

        {receipt ? (
          <section className="card stack">
            <strong>2. Review & edit</strong>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="vendor">Vendor</label>
                <input
                  id="vendor"
                  value={receipt.vendor ?? ""}
                  onChange={(e) => setReceipt({ ...receipt, vendor: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="when">Receipt date/time (ISO)</label>
                <input
                  id="when"
                  value={receipt.receiptDatetime ?? ""}
                  onChange={(e) => setReceipt({ ...receipt, receiptDatetime: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <input
                  id="currency"
                  value={receipt.currency}
                  onChange={(e) => setReceipt({ ...receipt, currency: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="field">
                <label htmlFor="total">Total</label>
                <input
                  id="total"
                  type="number"
                  step="0.01"
                  value={Number.isFinite(receipt.total) ? receipt.total : 0}
                  onChange={(e) => setReceipt({ ...receipt, total: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <input
                  id="category"
                  value={receipt.category ?? ""}
                  onChange={(e) => setReceipt({ ...receipt, category: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="desc">AI summary</label>
                <input
                  id="desc"
                  value={receipt.description ?? ""}
                  onChange={(e) => setReceipt({ ...receipt, description: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="loc">Location label (optional)</label>
              <input
                id="loc"
                value={receipt.location?.label ?? ""}
                onChange={(e) =>
                  setReceipt({
                    ...receipt,
                    location: { ...receipt.location, label: e.target.value }
                  })
                }
              />
            </div>
            <div className="row">
              <button type="button" className="btn btn-secondary" onClick={attachLocation}>
                Use GPS coordinates
              </button>
              {receipt.location?.latitude != null ? (
                <span className="muted">
                  {receipt.location.latitude.toFixed(5)}, {receipt.location.longitude?.toFixed(5)}
                </span>
              ) : null}
            </div>

            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Line items</strong>
              <button type="button" className="btn btn-secondary" onClick={addItem}>
                Add row
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Line</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <input value={it.name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
                      </td>
                      <td style={{ width: 88 }}>
                        <input
                          type="number"
                          step="0.01"
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td style={{ width: 110 }}>
                        <input
                          type="number"
                          step="0.01"
                          value={it.unitPrice}
                          onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                        />
                      </td>
                      <td style={{ width: 110 }}>
                        <input
                          type="number"
                          step="0.01"
                          value={it.lineTotal}
                          onChange={(e) => updateItem(idx, { lineTotal: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn btn-secondary" onClick={() => removeItem(idx)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="row" style={{ gap: "0.35rem" }}>
              <input
                type="checkbox"
                checked={confirmDuplicate}
                onChange={(e) => setConfirmDuplicate(e.target.checked)}
              />
              <span className="muted">Confirm duplicate image (allow saving again)</span>
            </label>

            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={busy || !signedIn || !auth?.googleLinked}
              >
                Approve & save
              </button>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className="badge warn" role="alert">
            {error}
          </div>
        ) : null}

        {lastSubmit?.ok ? (
          <div className="badge" role="status">
            Saved. Image:{" "}
            <a href={lastSubmit.imageUrl} target="_blank" rel="noreferrer">
              open
            </a>
            {lastSubmit.sheetsAppended === false ? (
              <span className="muted"> · Sheet sync skipped or failed (see server logs)</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
