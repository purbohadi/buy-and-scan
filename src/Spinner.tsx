import { CircleNotch } from '@phosphor-icons/react';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <CircleNotch
      className={`spinner ${className}`}
      size={18}
      weight="bold"
      aria-hidden="true"
    />
  );
}
