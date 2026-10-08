import { useEffect, useState } from 'react';
import { CircleHalf, Moon, Sun } from '@phosphor-icons/react';

type Theme = 'system' | 'light' | 'dark';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('scan-parse-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* The system theme works when storage is unavailable. */
  }
  return 'system';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('scan-parse-theme', theme);
    } catch {
      /* Optional preference. */
    }
  }, [theme]);

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : CircleHalf;
  return (
    <label className="theme-control">
      <Icon size={18} aria-hidden="true" />
      <span className="sr-only">Color theme</span>
      <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
