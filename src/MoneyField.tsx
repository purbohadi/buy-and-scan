import { useEffect, useState } from 'react';
import {
  coerceMoneyScalar,
  formatMoneyDisplay,
  sanitizeMoneyAmount,
} from '../shared/money';

type Props = {
  id?: string;
  label?: string;
  value: number;
  currency: string;
  onCommit: (value: number) => void;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
};

export function MoneyField({
  id,
  label,
  value,
  currency,
  onCommit,
  className = '',
  compact,
  disabled,
}: Props) {
  const normalizedCurrency = String(currency ?? 'JPY')
    .toUpperCase()
    .slice(0, 8);
  const [text, setText] = useState(() =>
    formatMoneyDisplay(value, normalizedCurrency),
  );
  useEffect(() => {
    setText(formatMoneyDisplay(value, normalizedCurrency));
  }, [value, normalizedCurrency]);

  const commit = () => {
    const amount = sanitizeMoneyAmount(
      coerceMoneyScalar(text),
      normalizedCurrency,
    );
    onCommit(amount);
    setText(formatMoneyDisplay(amount, normalizedCurrency));
  };

  return (
    <div
      className={`field money-field ${compact ? 'money-compact' : ''} ${className}`}
    >
      {label ? <label htmlFor={id}>{label}</label> : null}
      <div className="money-input-wrap">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {!compact ? (
          <span className="currency-code" aria-hidden="true">
            {normalizedCurrency}
          </span>
        ) : null}
      </div>
    </div>
  );
}
