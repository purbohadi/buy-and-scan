import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  MagnifyingGlass,
  Receipt,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { formatMoneyDisplay } from '../shared/money';
import type {
  ReceiptsDeleteResponse,
  SheetRebuildResponse,
  StoredReceiptListItem,
} from './types';
import { Spinner } from './Spinner';
import { ConfirmationDialog } from './ConfirmationDialog';

function formatDateTime(iso: string | null | undefined): string {
  const value = iso?.trim();
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

type Props = {
  signedIn: boolean;
  googleLinked: boolean;
  refreshKey?: number;
  parentBusy?: boolean;
  onAfterMutation?: () => void;
  onCaptureNew?: () => void;
};

export function ReceiptsList({
  signedIn,
  googleLinked,
  refreshKey = 0,
  parentBusy = false,
  onAfterMutation,
  onCaptureNew,
}: Props) {
  const [rows, setRows] = useState<StoredReceiptListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [listAction, setListAction] = useState<'idle' | 'delete' | 'rebuild'>(
    'idle',
  );
  const [confirmation, setConfirmation] = useState<'delete' | 'rebuild' | null>(
    null,
  );
  const requestId = useRef(0);
  const disabled = parentBusy || listAction !== 'idle' || loading;

  const load = useCallback(async () => {
    const request = ++requestId.current;
    if (!signedIn) {
      setRows(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/receipts', { credentials: 'include' });
      const data = (await res.json()) as {
        receipts?: StoredReceiptListItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load receipts');
      if (request !== requestId.current) return;
      setRows(data.receipts ?? []);
      setSelected(new Set());
    } catch (error) {
      if (request === requestId.current)
        setErr(
          error instanceof Error ? error.message : 'Failed to load receipts',
        );
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [refreshKey, load]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (rows ?? []).filter(
      (row) =>
        !search ||
        [
          row.vendor,
          row.description,
          row.currency,
          row.receiptDatetime,
          row.createdAt,
          formatDateTime(row.receiptDatetime ?? row.createdAt),
        ].some((value) => value?.toLocaleLowerCase().includes(search)),
    );
  }, [rows, query]);

  const allSelected =
    filtered.length > 0 && filtered.every((row) => selected.has(row.id));
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setListAction('delete');
    setErr(null);
    setNotice(null);
    try {
      const res = await fetch('/api/receipts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json()) as ReceiptsDeleteResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Delete failed');
      setSelected(new Set());
      await load();
      setNotice(
        `${data.deleted} receipt${data.deleted === 1 ? '' : 's'} deleted.`,
      );
      onAfterMutation?.();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Delete failed');
    } finally {
      setListAction('idle');
      setConfirmation(null);
    }
  };

  const rebuildSheet = async () => {
    if (!googleLinked) {
      setErr('Connect Google Drive & Sheet first.');
      return;
    }
    setListAction('rebuild');
    setErr(null);
    setNotice(null);
    try {
      const res = await fetch('/api/sheet/rebuild', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as SheetRebuildResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Rebuild failed');
      setNotice(
        `New Google Sheet created with ${data.rowsWritten} row${data.rowsWritten === 1 ? '' : 's'}. Use Open sheet above to view it.`,
      );
      onAfterMutation?.();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Rebuild failed');
    } finally {
      setListAction('idle');
      setConfirmation(null);
    }
  };

  if (!signedIn)
    return <p className="muted">Sign in to see your stored receipts.</p>;

  return (
    <section
      className="receipts-panel"
      aria-label="Saved receipts"
      aria-busy={loading}
    >
      {notice ? (
        <div className="notice notice-success" role="status">
          <CheckCircle size={20} aria-hidden="true" />
          <p>{notice}</p>
        </div>
      ) : null}
      {err ? (
        <div className="notice notice-warning" role="alert">
          <WarningCircle size={20} aria-hidden="true" />
          <div>
            <strong>Could not complete that action.</strong>
            <p>{err}</p>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => void load()}
            >
              Retry loading receipts
            </button>
          </div>
        </div>
      ) : null}
      {loading && rows === null ? (
        <div className="list-loading" role="status">
          <span className="sr-only">Loading receipts</span>
          <div className="skeleton skeleton-input" aria-hidden="true" />
          {Array.from({ length: 4 }, (_, index) => (
            <div
              className="skeleton skeleton-row"
              key={index}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : rows !== null && rows.length === 0 ? (
        <div className="receipts-empty">
          <span className="empty-icon">
            <Receipt size={35} weight="light" aria-hidden="true" />
          </span>
          <h2>Your first receipt starts here</h2>
          <p>
            Once you capture and approve a receipt, its image and details will
            appear in this list.
          </p>
          {onCaptureNew ? (
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={onCaptureNew}
            >
              Scan a receipt <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : rows !== null ? (
        <>
          <div className="receipts-toolbar">
            <label className="receipt-search">
              <MagnifyingGlass size={19} aria-hidden="true" />
              <span className="sr-only">Search receipts</span>
              <input
                type="search"
                placeholder="Search vendor, summary, or date"
                value={query}
                disabled={listAction !== 'idle' || parentBusy}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(new Set());
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={disabled}
              onClick={() => void load()}
            >
              <ArrowClockwise size={17} aria-hidden="true" /> Refresh
            </button>
          </div>
          <div className="receipts-actions">
            <div className="selection-actions">
              <button
                type="button"
                className="btn btn-quiet btn-small"
                disabled={disabled || filtered.length === 0}
                onClick={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(filtered.map((row) => row.id)),
                  )
                }
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              {selected.size > 0 ? (
                <button
                  type="button"
                  className="btn btn-danger-outline btn-small"
                  disabled={disabled}
                  onClick={() => setConfirmation('delete')}
                >
                  <Trash size={16} aria-hidden="true" /> Delete selected (
                  {selected.size})
                </button>
              ) : null}
              <span className="results-count" role="status">
                {selected.size
                  ? `${selected.size} selected`
                  : `${filtered.length} receipt${filtered.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-small"
              disabled={disabled || !googleLinked}
              onClick={() => setConfirmation('rebuild')}
            >
              <ArrowClockwise size={16} aria-hidden="true" /> Recreate Google
              Sheet from stored receipts
            </button>
          </div>
          {!googleLinked ? (
            <p className="list-note">
              Connect Google to recreate a sheet or sync new saves.
            </p>
          ) : null}
          {loading ? (
            <div className="list-refresh" role="status">
              <Spinner /> Updating receipts...
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <div className="search-empty">
              <h2>No receipts match your search</h2>
              <p>Try another vendor, summary, or date.</p>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setQuery('');
                  setSelected(new Set());
                }}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="receipts-table-wrap">
              <table className="receipts-table" role="table">
                <caption className="sr-only">
                  Saved receipts, newest first. Date uses the receipt date when
                  available, otherwise the time it was saved.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col">AI Summary</th>
                    <th scope="col">Date</th>
                    <th scope="col" className="amount-heading">
                      Total
                    </th>
                    <th scope="col">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={selected.has(row.id) ? 'is-selected' : ''}
                    >
                      <td className="receipt-select">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          disabled={disabled}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select receipt ${row.id}`}
                        />
                      </td>
                      <td className="receipt-summary">
                        <strong>{row.vendor || 'Vendor not specified'}</strong>
                        <span>{row.description || 'No summary available'}</span>
                      </td>
                      <td className="receipt-date">
                        {formatDateTime(row.receiptDatetime ?? row.createdAt)}
                      </td>
                      <td className="receipt-amount">
                        <strong>
                          {formatMoneyDisplay(row.total, row.currency)}
                        </strong>
                        <span>{row.currency}</span>
                      </td>
                      <td className="receipt-image">
                        <a
                          className="image-link"
                          href={row.imageUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open receipt image${row.vendor ? ` for ${row.vendor}` : ''}`}
                        >
                          Image <ArrowUpRight size={16} aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="list-note">
            Date uses the receipt date when available, otherwise the time it was
            saved.
          </p>
        </>
      ) : null}
      <ConfirmationDialog
        open={confirmation !== null}
        title={
          confirmation === 'delete'
            ? `Delete ${selected.size} receipt${selected.size === 1 ? '' : 's'}?`
            : 'Recreate your Google Sheet?'
        }
        description={
          confirmation === 'delete'
            ? 'These records and their images will be removed from storage. This cannot be undone.'
            : 'Create a new Google Sheet with all your stored receipts. Your previous sheet link will be replaced. Use this if the old sheet was deleted.'
        }
        confirmLabel={
          listAction !== 'idle'
            ? listAction === 'delete'
              ? 'Deleting...'
              : 'Creating sheet...'
            : confirmation === 'delete'
              ? 'Delete receipts'
              : 'Create new sheet'
        }
        destructive={confirmation === 'delete'}
        busy={listAction !== 'idle'}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation === 'delete') void deleteSelected();
          else void rebuildSheet();
        }}
      />
    </section>
  );
}
