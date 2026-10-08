import {
  CheckCircle,
  MapPin,
  Plus,
  Receipt,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { MoneyField } from './MoneyField';
import { Spinner } from './Spinner';
import type { ParsedReceipt, ReceiptItem } from './types';

type Props = {
  receipt: ParsedReceipt | null;
  busy: boolean;
  parsing: boolean;
  saving: boolean;
  enabled: boolean;
  duplicateHint: string | null;
  confirmDuplicate: boolean;
  onDuplicateChange: (checked: boolean) => void;
  onChange: (receipt: ParsedReceipt) => void;
  onTotalChange: (total: number) => void;
  onCurrencyChange: (currency: string) => void;
  onUpdateItem: (index: number, patch: Partial<ReceiptItem>) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onLocation: () => void;
  onSubmit: () => void;
};

export function ReceiptReview({
  receipt,
  busy,
  parsing,
  saving,
  enabled,
  duplicateHint,
  confirmDuplicate,
  onDuplicateChange,
  onChange,
  onTotalChange,
  onCurrencyChange,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
  onLocation,
  onSubmit,
}: Props) {
  return (
    <section
      className={`review-panel ${receipt ? 'has-draft' : ''}`}
      aria-labelledby="review-heading"
      aria-busy={parsing}
    >
      <div className="panel-heading">
        <div className="step-heading">
          <span className="step-number">2</span>
          <h2 id="review-heading">Review &amp; edit</h2>
        </div>
        {receipt && !parsing ? (
          <span className="status-tag">Ready to review</span>
        ) : null}
      </div>
      {parsing ? (
        <div className="review-loading" role="status">
          <div className="loading-message">
            <Spinner />
            <div>
              <strong>Reading the details</strong>
              <p>
                Extracting the vendor, date, totals, and line items. This can
                take a moment.
              </p>
            </div>
          </div>
          <div className="skeleton-fields" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="skeleton-field" key={i}>
                <span className="skeleton skeleton-label" />
                <span className="skeleton skeleton-input" />
              </div>
            ))}
          </div>
          <div className="skeleton skeleton-block" aria-hidden="true" />
        </div>
      ) : receipt ? (
        <>
          <p className="panel-intro">
            Check the details against your photo. AI can make mistakes.
          </p>
          <div className="review-fields">
            <div className="field">
              <label htmlFor="vendor">Vendor</label>
              <input
                id="vendor"
                value={receipt.vendor ?? ''}
                disabled={busy}
                onChange={(e) =>
                  onChange({ ...receipt, vendor: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="when">Receipt date/time (ISO)</label>
              <input
                id="when"
                value={receipt.receiptDatetime ?? ''}
                disabled={busy}
                placeholder="2025-04-15T12:30:00"
                onChange={(e) =>
                  onChange({ ...receipt, receiptDatetime: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <input
                id="currency"
                value={receipt.currency}
                disabled={busy}
                onChange={(e) => onCurrencyChange(e.target.value.toUpperCase())}
              />
            </div>
            <MoneyField
              id="total"
              label="Total"
              value={receipt.total}
              currency={receipt.currency}
              disabled={busy}
              onCommit={onTotalChange}
            />
            <div className="field">
              <label htmlFor="category">Category</label>
              <input
                id="category"
                value={receipt.category ?? ''}
                disabled={busy}
                onChange={(e) =>
                  onChange({ ...receipt, category: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="desc">AI summary</label>
              <input
                id="desc"
                value={receipt.description ?? ''}
                disabled={busy}
                onChange={(e) =>
                  onChange({ ...receipt, description: e.target.value })
                }
              />
            </div>
          </div>
          <div className="location-section">
            <div className="field">
              <label htmlFor="loc">
                Location label{' '}
                <span className="label-optional">(optional)</span>
              </label>
              <input
                id="loc"
                value={receipt.location?.label ?? ''}
                disabled={busy}
                onChange={(e) =>
                  onChange({
                    ...receipt,
                    location: { ...receipt.location, label: e.target.value },
                  })
                }
              />
            </div>
            <div className="row">
              <button
                className="btn btn-quiet btn-small"
                type="button"
                disabled={busy}
                onClick={onLocation}
              >
                <MapPin size={17} aria-hidden="true" /> Use GPS coordinates
              </button>
              {receipt.location?.latitude != null ? (
                <span className="coordinates">
                  {receipt.location.latitude.toFixed(5)},{' '}
                  {receipt.location.longitude?.toFixed(5)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="line-items-heading">
            <h3>
              Line items{' '}
              <span className="count-note">{receipt.items.length}</span>
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              disabled={busy}
              onClick={onAddItem}
            >
              <Plus size={16} aria-hidden="true" /> Add row
            </button>
          </div>
          {receipt.items.length === 0 ? (
            <p className="items-empty">
              No line items extracted. Add a row if you need an itemized record.
            </p>
          ) : (
            <div className="line-items">
              {receipt.items.map((item, index) => (
                <div className="line-item" key={index}>
                  <div className="field item-name">
                    <label htmlFor={`item-${index}-name`}>
                      Item {index + 1}
                    </label>
                    <input
                      id={`item-${index}-name`}
                      value={item.name}
                      disabled={busy}
                      onChange={(e) =>
                        onUpdateItem(index, { name: e.target.value })
                      }
                    />
                  </div>
                  <div className="field item-quantity">
                    <label htmlFor={`item-${index}-quantity`}>Qty</label>
                    <input
                      id={`item-${index}-quantity`}
                      type="number"
                      min={1}
                      step={1}
                      value={item.quantity}
                      disabled={busy}
                      onChange={(e) =>
                        onUpdateItem(index, {
                          quantity: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <MoneyField
                    id={`item-${index}-unit`}
                    label="Unit price"
                    value={item.unitPrice}
                    currency={receipt.currency}
                    compact
                    disabled={busy}
                    onCommit={(value) =>
                      onUpdateItem(index, { unitPrice: value })
                    }
                  />
                  <MoneyField
                    id={`item-${index}-total`}
                    label="Line total"
                    value={item.lineTotal}
                    currency={receipt.currency}
                    compact
                    disabled={busy}
                    onCommit={(value) =>
                      onUpdateItem(index, { lineTotal: value })
                    }
                  />
                  <button
                    className="btn btn-quiet item-remove"
                    type="button"
                    disabled={busy}
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => onRemoveItem(index)}
                  >
                    <Trash size={18} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="approval-section">
            {duplicateHint ? (
              <div className="notice notice-warning" role="status">
                <WarningCircle size={20} aria-hidden="true" />
                <p>
                  {duplicateHint} Confirm below if you want to save it again.
                </p>
              </div>
            ) : null}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmDuplicate}
                disabled={busy}
                onChange={(e) => onDuplicateChange(e.target.checked)}
              />
              <span>
                Confirm duplicate image{' '}
                <span className="muted">(allow saving again)</span>
              </span>
            </label>
            <div className="approval-actions">
              <p>
                The photo and approved details will be saved to your account.
              </p>
              <button
                type="button"
                className="btn"
                disabled={busy || !enabled}
                onClick={onSubmit}
              >
                {saving ? (
                  <Spinner />
                ) : (
                  <CheckCircle size={20} aria-hidden="true" />
                )}
                {saving ? 'Saving receipt...' : 'Approve & save'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="review-empty">
          <span className="empty-icon">
            <Receipt size={34} weight="light" aria-hidden="true" />
          </span>
          <h3>Your receipt details will appear here</h3>
          <p>
            Choose a photo, then select Parse with AI. Review the extracted
            details and approve them when you are ready.
          </p>
          <ol className="review-guide">
            <li>
              <span>01</span> Capture a clear photo
            </li>
            <li>
              <span>02</span> Check and edit the details
            </li>
            <li>
              <span>03</span> Approve and save your record
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}
