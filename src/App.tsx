import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeDiscountItemName } from "../shared/discount-label";
import { sanitizeMoneyAmount, sanitizeReceiptMoney } from "../shared/money";
import { sha256Hex } from "./hash";
import { MoneyField } from "./MoneyField";
import { ReceiptsList } from "./ReceiptsList";
import { Spinner } from "./Spinner";
import type { ParseResponse, ParsedReceipt, ReceiptItem, SubmitBody, SubmitResponse } from "./types";

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

function recalcLine(it: ReceiptItem, currency: string): ReceiptItem {
  const c = String(currency ?? "JPY").toUpperCase().slice(0, 8);
  const quantity = Math.max(1, Math.round(Number(it.quantity) || 0) || 1);
  let unitPrice = sanitizeMoneyAmount(Number(it.unitPrice) || 0, c);
  let lineTotal = sanitizeMoneyAmount(Number(it.lineTotal) || 0, c);
  if (lineTotal === 0 && unitPrice !== 0 && quantity > 0) {
    lineTotal = sanitizeMoneyAmount(unitPrice * quantity, c);
  } else if (unitPrice === 0 && lineTotal !== 0 && quantity > 0) {
    unitPrice = sanitizeMoneyAmount(lineTotal / quantity, c);
  } else if (unitPrice !== 0 && lineTotal !== 0 && quantity > 0) {
    lineTotal = sanitizeMoneyAmount(unitPrice * quantity, c);
  }
  const name = normalizeDiscountItemName(it.name, lineTotal, unitPrice);
  return { ...it, name, quantity, unitPrice, lineTotal };
}

function sumItems(items: ReceiptItem[], currency: string): number {
  const c = String(currency ?? "JPY").toUpperCase().slice(0, 8);
  return sanitizeMoneyAmount(items.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0), c);
}

type LoadingAction = "idle" | "parse" | "submit" | "upload";

type MainTab = "scan" | "receipts";

function fileToBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((ab) => new Uint8Array(ab));
}

export default function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [totalReceipts, setTotalReceipts] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingAction>("idle");
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [lastSubmit, setLastSubmit] = useState<SubmitResponse | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("scan");
  const [receiptsListNonce, setReceiptsListNonce] = useState(0);

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
    setLoading("idle");
    setMainTab("scan");
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
    if (loading !== "idle") return;
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
    setLoading("parse");
    setError(null);
    setLastSubmit(null);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await fetch("/api/parse", { method: "POST", body: fd, credentials: "include" });
      const data = (await res.json()) as ParseResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Parse failed");
      setParseResult(data);
      setReceipt(sanitizeReceiptMoney(data.draft));
      setContentHash(data.contentHash);
      setConfirmDuplicate(false);
      setTotalReceipts(data.totalReceipts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setLoading("idle");
    }
  };

  const submitImageOnly = async (imageFile?: File | null) => {
    const f = imageFile ?? file;
    if (!f) return;
    setLoading("upload");
    setError(null);
    setLastSubmit(null);
    try {
      const bytes = await fileToBytes(f);
      const hash = await sha256Hex(bytes);
      const imageBase64 = await fileToBase64(f);
      const receipt = sanitizeReceiptMoney({
        currency: "JPY",
        total: 0,
        items: [],
        category: "other",
        description: ""
      });
      const body: SubmitBody = {
        contentHash: hash,
        imageMime: f.type || "image/jpeg",
        imageBase64,
        receipt,
        imageOnly: true,
        confirmDuplicate
      };
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body)
      });
      const data = (await res.json()) as SubmitResponse & { error?: string };
      if (res.status === 409 && data.duplicateBlocked) {
        setError(
          `This receipt image was already stored (${data.duplicateCount ?? 0} time(s)). Check "Confirm duplicate" to save anyway.`
        );
        setLastSubmit(data);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setLastSubmit(data);
      setTotalReceipts(data.totalReceipts);
      setReceiptsListNonce((n) => n + 1);
      setFile(null);
      setParseResult(null);
      setReceipt(null);
      setContentHash(null);
      setConfirmDuplicate(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading("idle");
    }
  };

  const updateItem = (idx: number, patch: Partial<ReceiptItem>) => {
    setReceipt((r) => {
      if (!r) return r;
      const items = [...r.items];
      const merged = { ...items[idx], ...patch };
      const next = recalcLine(merged, r.currency);
      items[idx] = next;
      const total = sumItems(items, r.currency);
      return { ...r, items, total };
    });
  };

  const addItem = () => {
    setReceipt((r) => (r ? { ...r, items: [...r.items, recalcLine(emptyItem(), r.currency)] } : r));
  };

  const removeItem = (idx: number) => {
    setReceipt((r) => {
      if (!r) return r;
      const items = r.items.filter((_, i) => i !== idx);
      return { ...r, items, total: sumItems(items, r.currency) };
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
    setLoading("submit");
    setError(null);
    setLastSubmit(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const payload = sanitizeReceiptMoney(receipt);
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          contentHash,
          imageMime: file.type || "image/jpeg",
          imageBase64,
          receipt: payload,
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
      setReceiptsListNonce((n) => n + 1);
      setFile(null);
      setParseResult(null);
      setReceipt(null);
      setContentHash(null);
      setConfirmDuplicate(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setLoading("idle");
    }
  };

  const duplicateHint = useMemo(() => {
    if (!parseResult?.duplicate) return null;
    return `This image matches a previous upload (${parseResult.duplicateCount} saved).`;
  }, [parseResult]);

  const signedIn = Boolean(auth?.user);
  const authReady = auth !== null;
  const isBusy = loading !== "idle";
  const parseFailedShowUpload = Boolean(error && file && !receipt);
  const uploadOnlyInputRef = useRef<HTMLInputElement>(null);

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
          <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
            <a href="/privacy">Privacy policy</a>
            {" · "}
            <a href="/terms">Terms</a>
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
            <a
              className={`btn btn-secondary ${isBusy ? "pointer-events-none opacity-50" : ""}`}
              href={auth.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              aria-disabled={isBusy}
              onClick={(e) => {
                if (isBusy) e.preventDefault();
              }}
            >
              Open sheet
            </a>
          ) : null}
          {signedIn ? (
            <button type="button" className="btn btn-secondary" disabled={isBusy} onClick={() => void logout()}>
              Sign out
            </button>
          ) : null}
          <span className="badge" title="Receipts stored in D1 after approval">
            Stored: {!signedIn ? "—" : totalReceipts === null ? "…" : totalReceipts}
          </span>
        </div>
      </header>

      <div className="stack">
        {signedIn ? (
          <nav className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }} aria-label="Main">
            <button
              type="button"
              className={mainTab === "scan" ? "btn" : "btn btn-secondary"}
              disabled={isBusy}
              onClick={() => setMainTab("scan")}
            >
              Scan
            </button>
            <button
              type="button"
              className={mainTab === "receipts" ? "btn" : "btn btn-secondary"}
              disabled={isBusy}
              onClick={() => setMainTab("receipts")}
            >
              My receipts
            </button>
          </nav>
        ) : null}

        {signedIn && auth && !auth.googleLinked ? (
          <section className="card stack">
            <strong>Connect Google Drive &amp; Sheets</strong>
            <p className="muted" style={{ margin: 0 }}>
              Approve access so we can create a <strong>Scan &amp; Parse</strong> spreadsheet in your Drive and append
              each saved receipt. Google may ask you to confirm again so we can keep access while you travel.
            </p>
            <button
              type="button"
              className="btn"
              disabled={isBusy}
              onClick={() => {
                if (!isBusy) window.location.href = "/api/auth/link-google";
              }}
            >
              Connect Google Drive &amp; Sheet
            </button>
          </section>
        ) : null}

        {mainTab === "scan" ? (
          <>
        {duplicateHint ? (
          <div className="badge warn" role="status">
            {duplicateHint}
          </div>
        ) : null}

        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>1. Capture</strong>
            <button type="button" className="btn btn-secondary" onClick={resetFlow} disabled={isBusy}>
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
              disabled={isBusy}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {previewUrl ? <img className="preview-img" src={previewUrl} alt="Receipt preview" /> : null}
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={parseImage}
              disabled={!file || isBusy || !signedIn || !auth?.googleLinked}
            >
              {loading === "parse" ? <Spinner /> : null}
              {loading === "parse" ? "Parsing…" : "Parse with AI"}
            </button>
            {parseFailedShowUpload ? (
              <>
                <label className="row" style={{ gap: "0.35rem" }}>
                  <input
                    type="checkbox"
                    checked={confirmDuplicate}
                    disabled={isBusy}
                    onChange={(e) => setConfirmDuplicate(e.target.checked)}
                  />
                  <span className="muted">Confirm duplicate image (required if this file was saved before)</span>
                </label>
                <input
                  ref={uploadOnlyInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  disabled={isBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (f) {
                      onPickFile(f);
                      void submitImageOnly(f);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isBusy || !signedIn || !auth?.googleLinked}
                  onClick={() => void submitImageOnly()}
                >
                  {loading === "upload" ? <Spinner /> : null}
                  {loading === "upload" ? "Saving…" : "Save current image only"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isBusy || !signedIn || !auth?.googleLinked}
                  onClick={() => uploadOnlyInputRef.current?.click()}
                >
                  Choose different image to upload
                </button>
              </>
            ) : null}
          </div>
        </section>

        {receipt ? (
          <section className="card stack">
            <strong>2. Review & edit</strong>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="vendor">Vendor</label>
                <input
                  id="vendor"
                  value={receipt.vendor ?? ""}
                  disabled={isBusy}
                  onChange={(e) => setReceipt({ ...receipt, vendor: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="when">Receipt date/time (ISO)</label>
                <input
                  id="when"
                  value={receipt.receiptDatetime ?? ""}
                  disabled={isBusy}
                  onChange={(e) => setReceipt({ ...receipt, receiptDatetime: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <input
                  id="currency"
                  value={receipt.currency}
                  disabled={isBusy}
                  onChange={(e) =>
                  setReceipt(sanitizeReceiptMoney({ ...receipt, currency: e.target.value.toUpperCase() }))
                }
                />
              </div>
              <MoneyField
                id="total"
                label="Total"
                value={receipt.total}
                currency={receipt.currency}
                disabled={isBusy}
                onCommit={(n) => setReceipt((r) => (r ? { ...r, total: n } : r))}
              />
              <div className="field">
                <label htmlFor="category">Category</label>
                <input
                  id="category"
                  value={receipt.category ?? ""}
                  disabled={isBusy}
                  onChange={(e) => setReceipt({ ...receipt, category: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="desc">AI summary</label>
                <input
                  id="desc"
                  value={receipt.description ?? ""}
                  disabled={isBusy}
                  onChange={(e) => setReceipt({ ...receipt, description: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="loc">Location label (optional)</label>
              <input
                id="loc"
                value={receipt.location?.label ?? ""}
                disabled={isBusy}
                onChange={(e) =>
                  setReceipt({
                    ...receipt,
                    location: { ...receipt.location, label: e.target.value }
                  })
                }
              />
            </div>
            <div className="row">
              <button type="button" className="btn btn-secondary" disabled={isBusy} onClick={attachLocation}>
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
              <button type="button" className="btn btn-secondary" disabled={isBusy} onClick={addItem}>
                Add row
              </button>
            </div>
            <div className="table-wrap overflow-x-auto rounded-lg border border-slate-500/20">
              <table className="min-w-full border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-slate-500/20 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2">Name</th>
                    <th className="w-20 px-2 py-2">Qty</th>
                    <th className="min-w-[9rem] px-2 py-2">Unit</th>
                    <th className="min-w-[9rem] px-2 py-2">Line</th>
                    <th className="w-24 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((it, idx) => (
                    <tr key={idx} className="border-b border-slate-500/10 align-top">
                      <td className="px-2 py-2">
                        <input
                          className="w-full min-w-[8rem] rounded-lg border border-slate-500/40 bg-slate-950/60 px-2 py-1.5 text-sm outline-none ring-sky-400/30 focus:ring-2"
                          value={it.name}
                          disabled={isBusy}
                          onChange={(e) => updateItem(idx, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          className="w-full rounded-lg border border-slate-500/40 bg-slate-950/60 px-2 py-1.5 font-mono text-sm tabular-nums outline-none ring-sky-400/30 focus:ring-2"
                          value={it.quantity}
                          disabled={isBusy}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyField
                          value={it.unitPrice}
                          currency={receipt.currency}
                          compact
                          disabled={isBusy}
                          onCommit={(n) => updateItem(idx, { unitPrice: n })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyField
                          value={it.lineTotal}
                          currency={receipt.currency}
                          compact
                          disabled={isBusy}
                          onCommit={(n) => updateItem(idx, { lineTotal: n })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={isBusy}
                          onClick={() => removeItem(idx)}
                        >
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
                disabled={isBusy}
                onChange={(e) => setConfirmDuplicate(e.target.checked)}
              />
              <span className="muted">Confirm duplicate image (allow saving again)</span>
            </label>

            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={isBusy || !signedIn || !auth?.googleLinked}
              >
                {loading === "submit" ? <Spinner /> : null}
                {loading === "submit" ? "Saving…" : "Approve & save"}
              </button>
            </div>
          </section>
        ) : null}
          </>
        ) : (
          <section className="card stack">
            <strong>My receipts</strong>
            <p className="muted" style={{ margin: 0 }}>
              Saved receipts for your account (newest first). Date Time uses receipt date when set, otherwise saved
              time.
            </p>
            <ReceiptsList signedIn={signedIn} refreshKey={receiptsListNonce} />
          </section>
        )}

        {error ? (
          <div className="badge warn" role="alert" aria-live="polite">
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
