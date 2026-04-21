import { useCallback, useEffect, useState } from 'react';
import type {
  ReceiptsDeleteResponse,
  SheetRebuildResponse,
  StoredReceiptListItem,
} from './types';
import { Spinner } from './Spinner';

function formatDateTime(iso: string | null | undefined): string {
  const s = iso?.trim();
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

type Props = {
  signedIn: boolean;
  googleLinked: boolean;
  refreshKey?: number;
  /** Disable list actions while parent is busy (parse/submit). */
  parentBusy?: boolean;
  onAfterMutation?: () => void;
};

export function ReceiptsList({
  signedIn,
  googleLinked,
  refreshKey = 0,
  parentBusy = false,
  onAfterMutation,
}: Props) {
  const [rows, setRows] = useState<StoredReceiptListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listAction, setListAction] = useState<'idle' | 'delete' | 'rebuild'>(
    'idle',
  );

  const disabled = parentBusy || listAction !== 'idle';

  const load = useCallback(() => {
    if (!signedIn) {
      setRows(null);
      return;
    }
    setLoading(true);
    setErr(null);
    fetch('/api/receipts', { credentials: 'include' })
      .then(async (res) => {
        const j = (await res.json()) as {
          receipts?: StoredReceiptListItem[];
          error?: string;
        };
        if (!res.ok) throw new Error(j.error ?? 'Failed to load receipts');
        setRows(j.receipts ?? []);
        setSelected(new Set());
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [signedIn]);

  useEffect(() => {
    load();
  }, [signedIn, refreshKey, load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const list = rows ?? [];
    if (selected.size === list.length) setSelected(new Set());
    else setSelected(new Set(list.map((r) => r.id)));
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} receipt(s) from storage? This cannot be undone.`,
      )
    )
      return;
    setListAction('delete');
    setErr(null);
    try {
      const res = await fetch('/api/receipts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids }),
      });
      const j = (await res.json()) as ReceiptsDeleteResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? 'Delete failed');
      setSelected(new Set());
      await load();
      onAfterMutation?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setListAction('idle');
    }
  };

  const rebuildSheet = async () => {
    if (!googleLinked) {
      setErr('Connect Google Drive & Sheet first.');
      return;
    }
    if (
      !window.confirm(
        'Create a new Google Sheet and fill it with all stored receipts? Use this if the old sheet was deleted. Your previous sheet link will be replaced.',
      )
    ) {
      return;
    }
    setListAction('rebuild');
    setErr(null);
    try {
      const res = await fetch('/api/sheet/rebuild', {
        method: 'POST',
        credentials: 'include',
      });
      const j = (await res.json()) as SheetRebuildResponse & { error?: string };
      if (!res.ok) throw new Error(j.error ?? 'Rebuild failed');
      window.alert(
        `New sheet created. ${j.rowsWritten} row(s) exported. Open the sheet from the header link after refresh.`,
      );
      onAfterMutation?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Rebuild failed');
    } finally {
      setListAction('idle');
    }
  };

  if (!signedIn) {
    return <p className="muted">Sign in to see your stored receipts.</p>;
  }

  if (loading && rows === null) {
    return (
      <p
        className="muted row"
        style={{ gap: '0.5rem' }}>
        <Spinner /> Loading…
      </p>
    );
  }

  if (err) {
    return (
      <div
        className="badge warn"
        role="alert">
        {err}
      </div>
    );
  }

  const list = rows ?? [];
  if (list.length === 0) {
    return (
      <p className="muted">
        No receipts saved yet. Capture and approve one from the Scan tab.
      </p>
    );
  }

  return (
    <div className="stack">
      <div
        className="row"
        style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={selectAll}>
          {selected.size === list.length ? 'Deselect all' : 'Select all'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || selected.size === 0}
          onClick={() => void deleteSelected()}>
          {listAction === 'delete' ? <Spinner /> : null}
          Delete selected ({selected.size})
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || !googleLinked}
          onClick={() => void rebuildSheet()}>
          {listAction === 'rebuild' ? <Spinner /> : null}
          Recreate Google Sheet from stored receipts
        </button>
      </div>
      {!googleLinked ? (
        <p
          className="muted"
          style={{ margin: 0 }}>
          Connect Google to recreate a sheet or sync new saves.
        </p>
      ) : null}

      <div className="table-wrap overflow-x-auto rounded-lg border border-slate-500/20">
        <table className="min-w-full border-collapse text-left text-sm text-slate-200">
          <thead>
            <tr className="border-b border-slate-500/20 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th
                className="w-10 px-2 py-2"
                aria-label="Select"
              />
              <th className="w-10 px-2 py-2">No</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">AI Summary</th>
              <th className="px-3 py-2 whitespace-nowrap">Total</th>
              <th className="px-3 py-2">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, idx) => {
              const when = formatDateTime(r.receiptDatetime ?? r.createdAt);
              const desc =
                [r.vendor, r.description].filter(Boolean).join(' · ') || '—';
              const isSel = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={`border-b border-slate-500/10 ${isSel ? 'bg-sky-950/30' : ''}`}>
                  <td className="px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={isSel}
                      disabled={disabled}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select receipt ${r.id}`}
                    />
                  </td>
                  <td className="px-2 py-2 align-top text-center">{idx + 1}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap tabular-nums text-slate-300">
                    {when}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-200">{desc}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap tabular-nums">
                    {r.total} {r.currency}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <a
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                      href={r.imageUrl}
                      target="_blank"
                      rel="noreferrer">
                      Image
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
