/**
 * useKeyboardShortcuts - Global keyboard shortcuts hook
 */
import { useEffect, useCallback, useState } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: () => void;
  description: string;
  category?: string;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        // Monaco Editor uses divs with role="textbox" or has the monaco-editor class
        target.getAttribute('role') === 'textbox' ||
        target.closest('.monaco-editor') !== null
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;

        // Handle special keys
        let keyMatch = false;
        if (shortcut.key === 'Space') {
          keyMatch = e.code === 'Space';
        } else if (shortcut.key === 'Escape') {
          keyMatch = e.key === 'Escape';
        } else if (shortcut.key === 'Enter') {
          keyMatch = e.key === 'Enter';
        } else if (shortcut.key.startsWith('Arrow')) {
          keyMatch = e.key === shortcut.key;
        } else {
          keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        }

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}

/**
 * Hook to show/hide keyboard shortcuts help modal
 */
export function useShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return { isOpen, open, close, toggle };
}

/**
 * Format a shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  if (shortcut.ctrl) {
    // Use Cmd on Mac, Ctrl on others
    const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
    parts.push(isMac ? '\u2318' : 'Ctrl');
  }
  if (shortcut.alt) {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
    parts.push(isMac ? '\u2325' : 'Alt');
  }
  if (shortcut.shift) {
    parts.push('\u21E7');
  }

  // Format key
  let keyDisplay = shortcut.key;
  if (shortcut.key === 'Space') keyDisplay = 'Space';
  else if (shortcut.key === 'Escape') keyDisplay = 'Esc';
  else if (shortcut.key === 'ArrowLeft') keyDisplay = '\u2190';
  else if (shortcut.key === 'ArrowRight') keyDisplay = '\u2192';
  else if (shortcut.key === 'ArrowUp') keyDisplay = '\u2191';
  else if (shortcut.key === 'ArrowDown') keyDisplay = '\u2193';
  else keyDisplay = shortcut.key.toUpperCase();

  parts.push(keyDisplay);

  return parts.join(' + ');
}

/**
 * Default global shortcuts
 */
export const globalShortcuts = {
  goHome: {
    key: 'g',
    description: 'Go to Command Center',
    category: 'Navigation',
  },
  goIncidents: {
    key: 'i',
    description: 'Go to Incidents',
    category: 'Navigation',
  },
  goSetup: {
    key: 's',
    description: 'Go to Setup',
    category: 'Navigation',
  },
  createIncident: {
    key: 'c',
    description: 'Create new incident',
    category: 'Actions',
  },
  showHelp: {
    key: '?',
    shift: true,
    description: 'Show keyboard shortcuts',
    category: 'Help',
  },
  escape: {
    key: 'Escape',
    description: 'Close modal / Cancel',
    category: 'General',
  },
};
