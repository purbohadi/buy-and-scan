import { ArrowUpRight, Camera, Receipt, SignOut } from '@phosphor-icons/react';
import { ThemeToggle } from './ThemeToggle';

type Props = {
  email?: string;
  signedIn: boolean;
  spreadsheetUrl?: string | null;
  googleLinked?: boolean;
  busy: boolean;
  activeTab: 'scan' | 'receipts';
  totalReceipts: number | null;
  onChangeTab: (tab: 'scan' | 'receipts') => void;
  onSignOut: () => void;
};

export function AppHeader({
  email,
  signedIn,
  spreadsheetUrl,
  googleLinked,
  busy,
  activeTab,
  totalReceipts,
  onChangeTab,
  onSignOut,
}: Props) {
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="app-brand">
          <span className="brand-mark">
            <Receipt size={25} weight="duotone" aria-hidden="true" />
          </span>
          <div>
            <span className="brand-name">Scan &amp; Parse</span>
            <a className="brand-company" href="https://talktomydocument.com/">
              by Talktomydocument
            </a>
          </div>
        </div>
        <div className="account-controls">
          <ThemeToggle />
          {signedIn && email ? (
            <span className="account-email" title={email}>
              {email}
            </span>
          ) : null}
          {signedIn ? (
            <button
              className="btn btn-quiet sign-out"
              disabled={busy}
              onClick={onSignOut}
              type="button"
            >
              <SignOut size={18} aria-hidden="true" /> <span>Sign out</span>
            </button>
          ) : null}
        </div>
      </div>
      {signedIn ? (
        <div className="header-bottom">
          <nav className="app-nav" aria-label="Main">
            <button
              type="button"
              aria-current={activeTab === 'scan' ? 'page' : undefined}
              disabled={busy}
              onClick={() => onChangeTab('scan')}
            >
              <Camera size={19} aria-hidden="true" /> Scan
            </button>
            <button
              type="button"
              aria-current={activeTab === 'receipts' ? 'page' : undefined}
              disabled={busy}
              onClick={() => onChangeTab('receipts')}
            >
              <Receipt size={19} aria-hidden="true" /> My receipts
              {totalReceipts !== null ? (
                <span className="nav-count">{totalReceipts}</span>
              ) : null}
            </button>
          </nav>
          {googleLinked && spreadsheetUrl ? (
            <a
              className={`sheet-link ${busy ? 'is-disabled' : ''}`}
              href={spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              aria-disabled={busy}
              onClick={(e) => {
                if (busy) e.preventDefault();
              }}
            >
              Open sheet <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
