/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { ReceiptsList } from '../src/ReceiptsList';
import { ThemeToggle } from '../src/ThemeToggle';
import type { ParseResponse, StoredReceiptListItem } from '../src/types';

jest.mock('../src/hash', () => ({
  sha256Hex: jest.fn(async () => 'image-hash'),
}));

const draft: ParseResponse = {
  draft: {
    vendor: 'Market',
    receiptDatetime: '2025-04-15T12:30:00',
    currency: 'JPY',
    total: 500,
    category: 'groceries',
    description: 'Lunch ingredients',
    items: [{ name: 'Rice', quantity: 1, unitPrice: 500, lineTotal: 500 }],
  },
  contentHash: 'image-hash',
  duplicate: false,
  duplicateCount: 0,
  totalReceipts: 2,
};
const records: StoredReceiptListItem[] = [
  {
    id: 'market',
    vendor: 'Market',
    description: 'Lunch ingredients',
    currency: 'JPY',
    total: 500,
    receiptDatetime: '2025-04-15T12:30:00',
    createdAt: '2025-04-16T00:00:00Z',
    imageUrl: '/api/receipt-image/market',
  },
  {
    id: 'cafe',
    vendor: 'Cafe',
    description: 'Team breakfast',
    currency: 'USD',
    total: 12.5,
    receiptDatetime: null,
    createdAt: '2025-04-17T00:00:00Z',
    imageUrl: '/api/receipt-image/cafe',
  },
];

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function api({
  linked = true,
  signedIn = true,
  parse = draft,
}: { linked?: boolean; signedIn?: boolean; parse?: ParseResponse } = {}) {
  return jest.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
    switch (String(url)) {
      case '/api/auth/me':
        return response({
          user: signedIn
            ? { sub: 'account', email: 'purbo@talktomydocument.com' }
            : null,
          authConfigured: true,
          googleLinked: linked,
          spreadsheetUrl: linked
            ? 'https://docs.google.com/spreadsheets/d/example'
            : null,
        });
      case '/api/stats':
        return response({ totalReceipts: 2 });
      case '/api/parse':
        return response(parse);
      case '/api/receipts':
        return response({ receipts: records });
      case '/api/submit':
        return response({
          ok: true,
          id: 'saved',
          imageUrl: '/api/receipt-image/saved',
          sheetsAppended: true,
        });
      default:
        throw new Error(`Unexpected API request: ${String(url)}`);
    }
  });
}

function receiptFile(name = 'receipt.png') {
  return new File(['a'.repeat(500)], name, { type: 'image/png' });
}

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn(() => 'blob:receipt-preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    configurable: true,
    value: jest.fn(async () => new Uint8Array(500).buffer),
  });
  // jsdom has no native modal implementation. Model its open state for component tests.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
});

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  global.fetch = api();
});

test('signed-out users get a Google sign-in link and visible policy links', async () => {
  global.fetch = api({ signedIn: false });
  render(<App />);
  expect(screen.getByText('Loading your workspace')).toBeTruthy();
  const signIn = await screen.findByRole('link', {
    name: /Continue with Google/,
  });
  expect(signIn.getAttribute('href')).toBe('/api/auth/login');
  expect(
    screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href'),
  ).toBe('/privacy');
  expect(screen.queryByRole('button', { name: 'Choose image' })).toBeNull();
});

test('Google setup remains required and disabled capture has a recovery explanation', async () => {
  global.fetch = api({ linked: false });
  render(<App />);
  await screen.findByRole('heading', { name: 'Connect Google Drive & Sheets' });
  expect(
    (screen.getByRole('button', { name: 'Choose image' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.getByText('Connect Google Drive & Sheets above to start scanning.'),
  ).toBeTruthy();
});

test('parsing disables navigation, then editing and approval preserve the receipt payload', async () => {
  let finishParse: (value: Response) => void = () => {};
  const base = api();
  const fetchMock = jest.fn((url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === '/api/parse'
      ? new Promise<Response>((resolve) => {
          finishParse = resolve;
        })
      : base(url, init),
  );
  global.fetch = fetchMock;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: 'From receipt to record.' });
  await user.upload(
    screen.getByLabelText('Choose receipt image'),
    receiptFile(),
  );
  expect(screen.getByAltText('Receipt photo for review')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Parse with AI' }));
  expect(screen.getByText('Reading the details')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: /My receipts/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: /Sign out/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finishParse(response(draft));
  await screen.findByDisplayValue('Market');
  const vendor = screen.getByLabelText('Vendor');
  await user.clear(vendor);
  await user.type(vendor, 'Neighborhood Market');
  const quantity = screen.getByLabelText('Qty');
  fireEvent.change(quantity, { target: { value: '2' } });
  expect((screen.getByLabelText('Total') as HTMLInputElement).value).toBe(
    '1.000',
  );
  await user.click(screen.getByRole('button', { name: 'Approve & save' }));
  await screen.findByText('Receipt saved.');
  const submitted = fetchMock.mock.calls.find(
    ([url]) => String(url) === '/api/submit',
  );
  expect(submitted).toBeDefined();
  const body = JSON.parse(String(submitted?.[1]?.body));
  expect(body.receipt.vendor).toBe('Neighborhood Market');
  expect(body.receipt.total).toBe(1000);
  expect(body.receipt.items[0].quantity).toBe(2);
  expect(body.contentHash).toBe('image-hash');
  expect(body.confirmDuplicate).toBe(false);
  expect(screen.queryByLabelText('Vendor')).toBeNull();
});

test('duplicate rejection keeps edits and requires explicit confirmation to save again', async () => {
  const base = api({ parse: { ...draft, duplicate: true, duplicateCount: 1 } });
  let saves = 0;
  const fetchMock = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/api/submit') return base(url, init);
    saves += 1;
    return Promise.resolve(
      saves === 1
        ? response({ duplicateBlocked: true, duplicateCount: 1 }, 409)
        : response({
            ok: true,
            imageUrl: '/api/receipt-image/saved',
            sheetsAppended: true,
          }),
    );
  });
  global.fetch = fetchMock;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: 'From receipt to record.' });
  await user.upload(
    screen.getByLabelText('Choose receipt image'),
    receiptFile(),
  );
  await user.click(screen.getByRole('button', { name: 'Parse with AI' }));
  await screen.findByDisplayValue('Market');
  await user.click(screen.getByRole('button', { name: 'Approve & save' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Vendor') as HTMLInputElement).value).toBe(
    'Market',
  );
  await user.click(
    screen.getByRole('checkbox', { name: /Confirm duplicate image/ }),
  );
  await user.click(screen.getByRole('button', { name: 'Approve & save' }));
  await screen.findByText('Receipt saved.');
  const saveCalls = fetchMock.mock.calls.filter(
    ([url]) => String(url) === '/api/submit',
  );
  expect(JSON.parse(String(saveCalls[1][1]?.body)).confirmDuplicate).toBe(true);
});

test('parse failure allows image-only recovery and reset releases the preview', async () => {
  const base = api();
  const fetchMock = jest.fn((url: RequestInfo | URL, init?: RequestInit) =>
    String(url) === '/api/parse'
      ? Promise.resolve(response({ error: 'Try a sharper photo.' }, 502))
      : base(url, init),
  );
  global.fetch = fetchMock;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: 'From receipt to record.' });
  await user.upload(
    screen.getByLabelText('Choose receipt image'),
    receiptFile(),
  );
  await user.click(screen.getByRole('button', { name: 'Parse with AI' }));
  await screen.findByText('We could not read this receipt.');
  await user.click(
    screen.getByRole('button', { name: 'Save current image only' }),
  );
  await screen.findByText('Receipt saved.');
  const save = fetchMock.mock.calls.find(
    ([url]) => String(url) === '/api/submit',
  );
  expect(JSON.parse(String(save?.[1]?.body)).imageOnly).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt-preview');
  expect(screen.queryByAltText('Receipt photo for review')).toBeNull();
});

test('saved receipts search clears hidden selections and cancellation does not delete', async () => {
  const fetchMock = api();
  global.fetch = fetchMock;
  const user = userEvent.setup();
  render(<ReceiptsList signedIn googleLinked />);
  await screen.findByText('Market');
  await user.click(screen.getByRole('button', { name: 'Select all' }));
  expect(
    screen.getByRole('button', { name: 'Delete selected (2)' }),
  ).toBeTruthy();
  await user.type(
    screen.getByRole('searchbox', { name: 'Search receipts' }),
    'cafe',
  );
  expect(screen.queryByText('Market')).toBeNull();
  expect(screen.queryByRole('button', { name: /Delete selected/ })).toBeNull();
  await user.click(
    screen.getByRole('checkbox', { name: 'Select receipt cafe' }),
  );
  await user.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(
    fetchMock.mock.calls.some(
      ([url]) => String(url) === '/api/receipts/delete',
    ),
  ).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('confirmed deletion submits only selected IDs and reloads the list', async () => {
  let deleted = false;
  const after = jest.fn();
  const fetchMock = jest.fn(
    async (url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url) === '/api/receipts')
        return response({ receipts: deleted ? [records[0]] : records });
      if (String(url) === '/api/receipts/delete') {
        deleted = true;
        return response({ deleted: 1, totalReceipts: 1 });
      }
      throw new Error('Unexpected request');
    },
  );
  global.fetch = fetchMock;
  const user = userEvent.setup();
  render(<ReceiptsList signedIn googleLinked onAfterMutation={after} />);
  await screen.findByText('Cafe');
  await user.click(
    screen.getByRole('checkbox', { name: 'Select receipt cafe' }),
  );
  await user.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete receipts',
    }),
  );
  await screen.findByText('1 receipt deleted.');
  expect(screen.queryByText('Cafe')).toBeNull();
  expect(after).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls.find(
    ([url]) => String(url) === '/api/receipts/delete',
  );
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({ ids: ['cafe'] });
});

test('loading errors have a working retry and empty state directs users to Scan', async () => {
  let attempts = 0;
  global.fetch = jest.fn(async () =>
    ++attempts === 1
      ? response({ error: 'Please retry.' }, 503)
      : response({ receipts: [] }),
  );
  const capture = jest.fn();
  const user = userEvent.setup();
  render(<ReceiptsList signedIn googleLinked onCaptureNew={capture} />);
  await screen.findByRole('alert');
  await user.click(
    screen.getByRole('button', { name: 'Retry loading receipts' }),
  );
  await screen.findByText('Your first receipt starts here');
  await user.click(screen.getByRole('button', { name: 'Scan a receipt' }));
  expect(capture).toHaveBeenCalledTimes(1);
});

test('theme preferences persist and system mode removes the explicit override', async () => {
  const user = userEvent.setup();
  render(<ThemeToggle />);
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Color theme' }),
    'dark',
  );
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('scan-parse-theme')).toBe('dark');
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Color theme' }),
    'system',
  );
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBeUndefined(),
  );
});
