import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeDiscountItemName } from '../shared/discount-label';
import { sanitizeMoneyAmount, sanitizeReceiptMoney } from '../shared/money';
import { sha256Hex } from './hash';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  GoogleLogo,
  LinkSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { AppHeader } from './AppHeader';
import { ReceiptCapture } from './ReceiptCapture';
import { ReceiptReview } from './ReceiptReview';
import { ReceiptsList } from './ReceiptsList';
import { Spinner } from './Spinner';
import type {
  ParseResponse,
  ParsedReceipt,
  ReceiptItem,
  SubmitBody,
  SubmitResponse,
} from './types';

type AuthMe = {
  user: { sub: string; email: string } | null;
  authConfigured: boolean;
  googleLinked?: boolean;
  spreadsheetUrl?: string | null;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  return (await res.json()) as T;
}

async function fetchStats(): Promise<number> {
  const res = await fetch('/api/stats', { credentials: 'include' });
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
      const b64 = r.split(',')[1] ?? r;
      resolve(b64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function emptyItem(): ReceiptItem {
  return { name: '', quantity: 1, unitPrice: 0, lineTotal: 0 };
}

function recalcLine(it: ReceiptItem, currency: string): ReceiptItem {
  const c = String(currency ?? 'JPY')
    .toUpperCase()
    .slice(0, 8);
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
  const c = String(currency ?? 'JPY')
    .toUpperCase()
    .slice(0, 8);
  return sanitizeMoneyAmount(
    items.reduce((s, it) => s + (Number(it.lineTotal) || 0), 0),
    c,
  );
}

type LoadingAction = 'idle' | 'parse' | 'submit' | 'upload';

type MainTab = 'scan' | 'receipts';

function fileToBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((ab) => new Uint8Array(ab));
}

export default function App() {
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [totalReceipts, setTotalReceipts] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingAction>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parseFailed, setParseFailed] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [lastSubmit, setLastSubmit] = useState<SubmitResponse | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('scan');
  const [receiptsListNonce, setReceiptsListNonce] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'error') {
      const raw = params.get('reason') ?? 'unknown';
      let reason = raw;
      try {
        reason = decodeURIComponent(raw);
      } catch {
        /* keep raw */
      }
      setError(`Sign-in failed: ${reason}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetchJson<AuthMe>('/api/auth/me')
      .then((me) => {
        setAuth(me);
        if (me.user) {
          fetchStats()
            .then(setTotalReceipts)
            .catch(() => setTotalReceipts(0));
        } else {
          setTotalReceipts(null);
        }
      })
      .catch(() => setAuth({ user: null, authConfigured: false }));
  }, []);

  const resetFlow = useCallback(() => {
    setParseFailed(false);
    setParseResult(null);
    setReceipt(null);
    setContentHash(null);
    setConfirmDuplicate(false);
    setLastSubmit(null);
    setError(null);
    setFile(null);
    setLoading('idle');
    setMainTab('scan');
  }, []);

  const refreshAuth = useCallback(async () => {
    const me = await fetchJson<AuthMe>('/api/auth/me');
    setAuth(me);
    if (me.user)
      fetchStats()
        .then(setTotalReceipts)
        .catch(() => setTotalReceipts(0));
    else setTotalReceipts(null);
  }, []);

  const bumpReceiptsUi = useCallback(() => {
    setReceiptsListNonce((n) => n + 1);
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'linked') {
      window.history.replaceState({}, '', window.location.pathname);
      void refreshAuth();
    }
  }, [refreshAuth]);

  const logout = async () => {
    if (loading !== 'idle') return;
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
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
    if (f && f.type && !f.type.startsWith('image/')) {
      setError('Choose a receipt image. JPEG or PNG works best.');
      return false;
    }
    setParseFailed(false);
    setError(null);
    setLastSubmit(null);
    setParseResult(null);
    setReceipt(null);
    setContentHash(null);
    setConfirmDuplicate(false);
    setFile(f);
    return true;
  };

  const parseImage = async () => {
    if (!file) return;
    setLoading('parse');
    setParseFailed(false);
    setError(null);
    setLastSubmit(null);
    try {
      const fd = new FormData();
      fd.set('image', file);
      const res = await fetch('/api/parse', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = (await res.json()) as ParseResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Parse failed');
      setParseResult(data);
      setReceipt(sanitizeReceiptMoney(data.draft));
      setContentHash(data.contentHash);
      setConfirmDuplicate(false);
      setTotalReceipts(data.totalReceipts);
    } catch (e) {
      setParseFailed(true);
      setError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setLoading('idle');
    }
  };

  const submitImageOnly = async (imageFile?: File | null) => {
    const f = imageFile ?? file;
    if (!f) return;
    setLoading('upload');
    setError(null);
    setLastSubmit(null);
    try {
      const bytes = await fileToBytes(f);
      const hash = await sha256Hex(bytes);
      const imageBase64 = await fileToBase64(f);
      const receipt = sanitizeReceiptMoney({
        currency: 'JPY',
        total: 0,
        items: [],
        category: 'other',
        description: '',
      });
      const body: SubmitBody = {
        contentHash: hash,
        imageMime: f.type || 'image/jpeg',
        imageBase64,
        receipt,
        imageOnly: true,
        confirmDuplicate,
      };
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SubmitResponse & { error?: string };
      if (res.status === 409 && data.duplicateBlocked) {
        setError(
          `This receipt image was already stored (${data.duplicateCount ?? 0} time(s)). Check "Confirm duplicate" to save anyway.`,
        );
        setLastSubmit(data);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setLastSubmit(data);
      bumpReceiptsUi();
      setFile(null);
      setParseResult(null);
      setReceipt(null);
      setContentHash(null);
      setConfirmDuplicate(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading('idle');
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
    setReceipt((r) =>
      r
        ? { ...r, items: [...r.items, recalcLine(emptyItem(), r.currency)] }
        : r,
    );
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
      setError('Geolocation is not available in this browser.');
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
                  label: r.location?.label,
                },
              }
            : r,
        );
      },
      () => setError('Could not read location. Check permissions.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submit = async () => {
    if (!file || !receipt || !contentHash) return;
    setLoading('submit');
    setError(null);
    setLastSubmit(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const payload = sanitizeReceiptMoney(receipt);
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contentHash,
          imageMime: file.type || 'image/jpeg',
          imageBase64,
          receipt: payload,
          confirmDuplicate,
        }),
      });
      const data = (await res.json()) as SubmitResponse;
      if (res.status === 409 && data.duplicateBlocked) {
        setError(
          `This receipt image was already stored (${data.duplicateCount ?? 0} time(s)). Check "Confirm duplicate" to save anyway.`,
        );
        setLastSubmit(data);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Submit failed');
      setLastSubmit(data);
      bumpReceiptsUi();
      setFile(null);
      setParseResult(null);
      setReceipt(null);
      setContentHash(null);
      setConfirmDuplicate(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setLoading('idle');
    }
  };

  const duplicateHint = useMemo(() => {
    if (!parseResult?.duplicate) return null;
    return `This image matches a previous upload (${parseResult.duplicateCount} saved).`;
  }, [parseResult]);

  const signedIn = Boolean(auth?.user);
  const authReady = auth !== null;
  const isBusy = loading !== 'idle';
  const parseFailedShowUpload = Boolean(parseFailed && file && !receipt);
  const uploadOnlyInputRef = useRef<HTMLInputElement>(null);
  const canScan = signedIn && Boolean(auth?.googleLinked);
  const sheetSyncFailed = lastSubmit?.ok && lastSubmit.sheetsAppended === false;

  const showReceipts = () => setMainTab('receipts');

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <AppHeader
        signedIn={signedIn}
        email={auth?.user?.email}
        spreadsheetUrl={auth?.spreadsheetUrl}
        googleLinked={auth?.googleLinked}
        busy={isBusy}
        activeTab={mainTab}
        totalReceipts={totalReceipts}
        onChangeTab={setMainTab}
        onSignOut={() =>
          void logout().catch(() =>
            setError('Could not sign out. Please try again.'),
          )
        }
      />
      <main id="workspace" className="app-main" tabIndex={-1}>
        {!authReady ? (
          <div className="workspace-loading" role="status">
            <span className="sr-only">Loading your workspace</span>
            <div className="skeleton skeleton-title" aria-hidden="true" />
            <div className="skeleton skeleton-subtitle" aria-hidden="true" />
            <div className="workspace-grid" aria-hidden="true">
              <div className="skeleton skeleton-capture" />
              <div className="skeleton skeleton-review" />
            </div>
          </div>
        ) : !signedIn ? (
          <section className="sign-in-layout" aria-labelledby="sign-in-heading">
            <div className="sign-in-story">
              <span className="product-note">Receipt workspace</span>
              <h1 id="sign-in-heading">
                Less paper.
                <br />
                Clearer records.
              </h1>
              <p>
                Turn receipt photos into details you can check, edit, and keep.
                Your expenses, a little more organized.
              </p>
              <ol className="sign-in-steps">
                <li>
                  <span>01</span>
                  <div>
                    <strong>Capture a receipt</strong>
                    <p>Take a photo or choose one from your device.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Review the AI results</strong>
                    <p>Check the vendor, line items, currency, and total.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Save your approved record</strong>
                    <p>
                      Keep the image and optionally sync to your Google Sheet.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
            <div className="sign-in-panel">
              <h2>Your receipt workspace</h2>
              <p>Sign in to capture, parse, and save your receipts.</p>
              {error ? (
                <div className="notice notice-warning" role="alert">
                  <WarningCircle size={20} aria-hidden="true" />
                  <p>{error}</p>
                </div>
              ) : null}
              {auth.authConfigured ? (
                <a className="btn btn-block" href="/api/auth/login">
                  <GoogleLogo size={20} aria-hidden="true" /> Continue with
                  Google <ArrowRight size={18} aria-hidden="true" />
                </a>
              ) : (
                <div className="notice notice-warning" role="status">
                  <WarningCircle size={20} aria-hidden="true" />
                  <p>
                    Sign-in is temporarily unavailable. Please try again later
                    or{' '}
                    <a href="mailto:purbo@talktomydocument.com">contact us</a>.
                  </p>
                </div>
              )}
              <p className="sign-in-privacy">
                Sign-in identifies your account. We do not receive your Google
                password. Google Drive and Sheets access is requested separately
                when you connect them.
              </p>
              <div className="sign-in-legal">
                <a href="/privacy">Privacy policy</a>
                <a href="/terms">Terms of service</a>
              </div>
            </div>
          </section>
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <h1>
                  {mainTab === 'scan'
                    ? 'From receipt to record.'
                    : 'My receipts'}
                </h1>
                <p>
                  {mainTab === 'scan'
                    ? 'Capture a photo, review the details, and save with confidence.'
                    : 'Your saved receipts, newest first. Find a record or open the original image.'}
                </p>
              </div>
              {mainTab === 'receipts' ? (
                <button
                  className="btn"
                  type="button"
                  disabled={isBusy}
                  onClick={() => setMainTab('scan')}
                >
                  Scan a receipt <ArrowRight size={18} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {!auth.googleLinked ? (
              <section
                className="connection-notice"
                aria-labelledby="connection-heading"
              >
                <span className="connection-icon">
                  <LinkSimple size={23} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="connection-heading">
                    Connect Google Drive &amp; Sheets
                  </h2>
                  <p>
                    Finish setup to scan and save receipts. We create a Scan
                    &amp; Parse spreadsheet in your Drive and append each
                    approved record. Google may ask you to confirm access again
                    so it remains available while you travel.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isBusy}
                  onClick={() => {
                    if (!isBusy) window.location.href = '/api/auth/link-google';
                  }}
                >
                  Connect Google Drive &amp; Sheet{' '}
                  <ArrowUpRight size={17} aria-hidden="true" />
                </button>
              </section>
            ) : null}
            {lastSubmit?.ok ? (
              <div
                className={`notice ${sheetSyncFailed ? 'notice-warning' : 'notice-success'} save-notice`}
                role="status"
              >
                <CheckCircle size={22} aria-hidden="true" />
                <div>
                  <strong>Receipt saved.</strong>
                  <p>
                    {sheetSyncFailed
                      ? 'Your record is safe in My receipts, but it was not added to your Google Sheet. You can recreate the sheet from your saved receipts.'
                      : 'Your photo and approved details are ready in My receipts.'}
                  </p>
                  <div className="notice-links">
                    <button
                      type="button"
                      className="text-button"
                      disabled={isBusy}
                      onClick={showReceipts}
                    >
                      View my receipts
                    </button>
                    <a
                      href={lastSubmit.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open image <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="notice notice-warning" role="alert">
                <WarningCircle size={21} aria-hidden="true" />
                <div>
                  <strong>
                    {parseFailedShowUpload
                      ? 'We could not read this receipt.'
                      : 'Something needs your attention.'}
                  </strong>
                  <p>{error}</p>
                </div>
              </div>
            ) : null}
            {mainTab === 'scan' ? (
              <>
                <div className="workspace-grid">
                  <div className="capture-column">
                    <ReceiptCapture
                      file={file}
                      previewUrl={previewUrl}
                      busy={isBusy}
                      parsing={loading === 'parse'}
                      enabled={canScan}
                      reviewed={Boolean(receipt)}
                      onPickFile={onPickFile}
                      onParse={() => void parseImage()}
                      onReset={resetFlow}
                    />
                    {parseFailedShowUpload ? (
                      <section
                        className="upload-recovery"
                        aria-labelledby="upload-recovery-heading"
                      >
                        <h3 id="upload-recovery-heading">
                          Keep the photo, even without the details
                        </h3>
                        <p>
                          You can retry parsing, or save just the image.
                          Extracted fields will not be included.
                        </p>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={confirmDuplicate}
                            disabled={isBusy}
                            onChange={(e) =>
                              setConfirmDuplicate(e.target.checked)
                            }
                          />
                          <span>
                            Confirm duplicate image{' '}
                            <span className="muted">
                              (required if already saved)
                            </span>
                          </span>
                        </label>
                        <input
                          ref={uploadOnlyInputRef}
                        tabIndex={-1}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          aria-label="Choose different image to upload"
                          disabled={isBusy}
                          onChange={(e) => {
                            const next = e.target.files?.[0];
                            e.target.value = '';
                            if (next && onPickFile(next)) {
                              void submitImageOnly(next);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-block"
                          disabled={isBusy || !canScan}
                          onClick={() => void submitImageOnly()}
                        >
                          {loading === 'upload' ? <Spinner /> : null}
                          {loading === 'upload'
                            ? 'Saving image...'
                            : 'Save current image only'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-block"
                          disabled={isBusy || !canScan}
                          onClick={() => uploadOnlyInputRef.current?.click()}
                        >
                          Choose different image to upload
                        </button>
                      </section>
                    ) : null}
                  </div>
                  <ReceiptReview
                    receipt={receipt}
                    busy={isBusy}
                    parsing={loading === 'parse'}
                    saving={loading === 'submit'}
                    enabled={canScan}
                    duplicateHint={duplicateHint}
                    confirmDuplicate={confirmDuplicate}
                    onDuplicateChange={setConfirmDuplicate}
                    onChange={setReceipt}
                    onTotalChange={(total) =>
                      setReceipt((current) =>
                        current ? { ...current, total } : current,
                      )
                    }
                    onCurrencyChange={(currency) =>
                      setReceipt((current) =>
                        current
                          ? sanitizeReceiptMoney({ ...current, currency })
                          : current,
                      )
                    }
                    onUpdateItem={updateItem}
                    onAddItem={addItem}
                    onRemoveItem={removeItem}
                    onLocation={attachLocation}
                    onSubmit={() => void submit()}
                  />
                </div>
              </>
            ) : (
              <ReceiptsList
                signedIn={signedIn}
                googleLinked={Boolean(auth.googleLinked)}
                refreshKey={receiptsListNonce}
                parentBusy={isBusy}
                onAfterMutation={bumpReceiptsUi}
                onCaptureNew={() => setMainTab('scan')}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
