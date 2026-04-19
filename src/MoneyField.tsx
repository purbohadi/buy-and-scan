import { useEffect, useState } from "react";
import { coerceMoneyScalar, formatMoneyDisplay, sanitizeMoneyAmount } from "../shared/money";

type Props = {
  id?: string;
  label?: string;
  value: number;
  currency: string;
  onCommit: (n: number) => void;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
};

export function MoneyField({ id, label, value, currency, onCommit, className = "", compact, disabled }: Props) {
  const c = String(currency ?? "JPY").toUpperCase().slice(0, 8);
  const [text, setText] = useState(() => formatMoneyDisplay(value, c));

  useEffect(() => {
    setText(formatMoneyDisplay(value, c));
  }, [value, c]);

  const commit = () => {
    const raw = coerceMoneyScalar(text);
    const n = sanitizeMoneyAmount(raw, c);
    onCommit(n);
    setText(formatMoneyDisplay(n, c));
  };

  const row = compact ? "flex flex-col gap-0.5" : "flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label ? (
        <label htmlFor={id} className="text-xs font-medium text-slate-400">
          {label}
        </label>
      ) : null}
      <div className={row}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          className="min-w-0 flex-1 rounded-lg border border-slate-500/40 bg-slate-950/60 px-2 py-1.5 font-mono text-sm text-slate-100 tabular-nums outline-none ring-sky-400/40 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {!compact ? (
          <span
            className="whitespace-nowrap text-xs tabular-nums text-slate-500 sm:text-right"
            title="Normalized amount"
          >
            {c} · {formatMoneyDisplay(value, c)}
          </span>
        ) : (
          <span className="text-[10px] tabular-nums text-slate-500">{formatMoneyDisplay(value, c)}</span>
        )}
      </div>
    </div>
  );
}
