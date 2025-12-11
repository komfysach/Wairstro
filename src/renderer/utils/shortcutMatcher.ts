/**
 * Utility for matching keyboard events against shortcut configurations.
 *
 * Handles platform-specific quirks like macOS Alt key producing special characters
 * in e.key (e.g., Alt+P = π, Alt+L = ¬) by falling back to e.code.
 */

import type { Shortcut } from '../types';

/**
 * Check if a keyboard event matches a shortcut configuration.
 *
 * @param e - The keyboard event to check
 * @param shortcut - The shortcut configuration to match against
 * @returns true if the event matches the shortcut
 *
 * @example
 * // Shortcut config: { keys: ['Alt', 'Meta', 'p'] }
 * // On macOS, Alt+Meta+P produces e.key = 'π', but e.code = 'KeyP'
 * matchShortcut(event, shortcut) // Returns true when Alt+Meta+P is pressed
 */
export function matchShortcut(e: KeyboardEvent, shortcut: Shortcut): boolean {
  const keys = shortcut.keys.map(k => k.toLowerCase());

  const metaPressed = e.metaKey || e.ctrlKey;
  const shiftPressed = e.shiftKey;
  const altPressed = e.altKey;
  const key = e.key.toLowerCase();

  const configMeta = keys.includes('meta') || keys.includes('ctrl') || keys.includes('command');
  const configShift = keys.includes('shift');
  const configAlt = keys.includes('alt');

  // Check modifier keys match exactly
  if (metaPressed !== configMeta) return false;
  if (shiftPressed !== configShift) return false;
  if (altPressed !== configAlt) return false;

  const mainKey = keys[keys.length - 1];

  // Direct key matches for special keys
  if (mainKey === '/' && key === '/') return true;
  if (mainKey === 'arrowleft' && key === 'arrowleft') return true;
  if (mainKey === 'arrowright' && key === 'arrowright') return true;
  if (mainKey === 'arrowup' && key === 'arrowup') return true;
  if (mainKey === 'arrowdown' && key === 'arrowdown') return true;
  if (mainKey === 'backspace' && key === 'backspace') return true;

  // Handle Shift+[ producing { and Shift+] producing }
  if (mainKey === '[' && (key === '[' || key === '{')) return true;
  if (mainKey === ']' && (key === ']' || key === '}')) return true;

  // Handle Shift+number producing symbol (US keyboard layout)
  // Shift+1='!', Shift+2='@', Shift+3='#', etc.
  const shiftNumberMap: Record<string, string> = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0'
  };
  if (shiftNumberMap[key] === mainKey) return true;

  // For Alt+Meta shortcuts on macOS, e.key produces special characters (e.g., Alt+p = π, Alt+l = ¬)
  // Use e.code to get the physical key pressed instead
  if (altPressed && e.code) {
    const codeKey = e.code.replace('Key', '').replace('Digit', '').toLowerCase();
    return codeKey === mainKey;
  }

  return key === mainKey;
}

/**
 * Check if a keyboard event matches the pattern for Alt+Meta+Letter shortcuts
 * when modals are open (used for system utility shortcuts that should work
 * even when modals are blocking other shortcuts).
 *
 * @param e - The keyboard event to check
 * @param allowedKeys - Array of allowed main keys (e.g., ['l', 'p'] for logs/process monitor)
 * @returns true if the event matches an allowed Alt+Meta shortcut
 *
 * @example
 * // Allow Alt+Meta+L and Alt+Meta+P even when modals are open
 * isAltMetaShortcut(event, ['l', 'p'])
 */
export function isAltMetaShortcut(e: KeyboardEvent, allowedKeys: string[]): boolean {
  if (!e.altKey || !(e.metaKey || e.ctrlKey)) return false;

  // Must use e.code for Alt key combos on macOS because e.key produces special characters
  const codeKey = e.code?.replace('Key', '').replace('Digit', '').toLowerCase() || '';
  return allowedKeys.includes(codeKey);
}

/**
 * Check if a keyboard event matches Alt+Meta+Number (for session jump shortcuts).
 *
 * @param e - The keyboard event to check
 * @returns true if the event is Alt+Meta+[0-9]
 */
export function isAltMetaNumberShortcut(e: KeyboardEvent): boolean {
  if (!e.altKey || !(e.metaKey || e.ctrlKey)) return false;

  // Must use e.code for Alt key combos on macOS because e.key produces special characters
  // Alt+1 produces '¡', Alt+2 produces '™', etc. instead of digits
  return /^Digit[0-9]$/.test(e.code || '');
}
