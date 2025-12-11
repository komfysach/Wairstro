/**
 * Tests for shortcutMatcher.ts
 *
 * These tests verify that keyboard shortcuts are correctly matched,
 * particularly for macOS where Alt key produces special characters.
 *
 * On macOS, pressing Alt+<key> produces special characters in e.key:
 * - Alt+P = π
 * - Alt+L = ¬
 * - Alt+T = †
 * - Alt+1 = ¡
 * - Alt+2 = ™
 * etc.
 *
 * The shortcut matcher must use e.code to detect the physical key pressed.
 */

import { describe, it, expect } from 'vitest';
import {
  matchShortcut,
  isAltMetaShortcut,
  isAltMetaNumberShortcut,
} from '../../../renderer/utils/shortcutMatcher';
import type { Shortcut } from '../../../renderer/types';

/**
 * Helper to create a mock KeyboardEvent
 */
function createKeyboardEvent(options: {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    key: options.key,
    code: options.code || `Key${options.key.toUpperCase()}`,
    metaKey: options.metaKey || false,
    ctrlKey: options.ctrlKey || false,
    altKey: options.altKey || false,
    shiftKey: options.shiftKey || false,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as KeyboardEvent;
}

describe('shortcutMatcher', () => {
  describe('matchShortcut', () => {
    describe('basic shortcuts without Alt', () => {
      it('matches Cmd+K', () => {
        const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Meta', 'k'] };
        const event = createKeyboardEvent({ key: 'k', code: 'KeyK', metaKey: true });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Cmd+Shift+N', () => {
        const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Meta', 'Shift', 'n'] };
        const event = createKeyboardEvent({ key: 'N', code: 'KeyN', metaKey: true, shiftKey: true });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('does not match when modifier is missing', () => {
        const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Meta', 'k'] };
        const event = createKeyboardEvent({ key: 'k', code: 'KeyK', metaKey: false });
        expect(matchShortcut(event, shortcut)).toBe(false);
      });

      it('does not match wrong key', () => {
        const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Meta', 'k'] };
        const event = createKeyboardEvent({ key: 'j', code: 'KeyJ', metaKey: true });
        expect(matchShortcut(event, shortcut)).toBe(false);
      });
    });

    describe('macOS Alt+Meta shortcuts (special character handling)', () => {
      it('matches Alt+Meta+P when e.key is π (macOS)', () => {
        // On macOS, Alt+P produces π in e.key
        const shortcut: Shortcut = { id: 'processMonitor', label: 'Process Monitor', keys: ['Alt', 'Meta', 'p'] };
        const event = createKeyboardEvent({
          key: 'π', // macOS Alt+P produces this
          code: 'KeyP',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Alt+Meta+L when e.key is ¬ (macOS)', () => {
        // On macOS, Alt+L produces ¬ in e.key
        const shortcut: Shortcut = { id: 'systemLogs', label: 'System Logs', keys: ['Alt', 'Meta', 'l'] };
        const event = createKeyboardEvent({
          key: '¬', // macOS Alt+L produces this
          code: 'KeyL',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Alt+Meta+T when e.key is † (macOS)', () => {
        // On macOS, Alt+T produces † in e.key
        const shortcut: Shortcut = { id: 'tabSwitcher', label: 'Tab Switcher', keys: ['Alt', 'Meta', 't'] };
        const event = createKeyboardEvent({
          key: '†', // macOS Alt+T produces this
          code: 'KeyT',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('still matches Alt+Meta+P with normal e.key (non-macOS or different keyboard)', () => {
        const shortcut: Shortcut = { id: 'processMonitor', label: 'Process Monitor', keys: ['Alt', 'Meta', 'p'] };
        const event = createKeyboardEvent({
          key: 'p',
          code: 'KeyP',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('does not match Alt+Meta+P when wrong key is pressed', () => {
        const shortcut: Shortcut = { id: 'processMonitor', label: 'Process Monitor', keys: ['Alt', 'Meta', 'p'] };
        const event = createKeyboardEvent({
          key: '¬', // This is Alt+L, not Alt+P
          code: 'KeyL',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(false);
      });

      it('does not match without Alt modifier', () => {
        const shortcut: Shortcut = { id: 'processMonitor', label: 'Process Monitor', keys: ['Alt', 'Meta', 'p'] };
        const event = createKeyboardEvent({
          key: 'p',
          code: 'KeyP',
          altKey: false,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(false);
      });

      it('does not match without Meta modifier', () => {
        const shortcut: Shortcut = { id: 'processMonitor', label: 'Process Monitor', keys: ['Alt', 'Meta', 'p'] };
        const event = createKeyboardEvent({
          key: 'π',
          code: 'KeyP',
          altKey: true,
          metaKey: false,
        });
        expect(matchShortcut(event, shortcut)).toBe(false);
      });
    });

    describe('Alt+Meta+Number shortcuts (session jump)', () => {
      it('matches Alt+Meta+1 when e.key is ¡ (macOS)', () => {
        // On macOS, Alt+1 produces ¡ in e.key
        const shortcut: Shortcut = { id: 'jump1', label: 'Jump to 1', keys: ['Alt', 'Meta', '1'] };
        const event = createKeyboardEvent({
          key: '¡', // macOS Alt+1 produces this
          code: 'Digit1',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Alt+Meta+2 when e.key is ™ (macOS)', () => {
        // On macOS, Alt+2 produces ™ in e.key
        const shortcut: Shortcut = { id: 'jump2', label: 'Jump to 2', keys: ['Alt', 'Meta', '2'] };
        const event = createKeyboardEvent({
          key: '™', // macOS Alt+2 produces this
          code: 'Digit2',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Alt+Meta+0 when e.key is º (macOS)', () => {
        // On macOS, Alt+0 produces º in e.key
        const shortcut: Shortcut = { id: 'jump0', label: 'Jump to 10', keys: ['Alt', 'Meta', '0'] };
        const event = createKeyboardEvent({
          key: 'º', // macOS Alt+0 produces this
          code: 'Digit0',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });
    });

    describe('arrow key shortcuts', () => {
      it('matches Alt+Meta+ArrowLeft', () => {
        const shortcut: Shortcut = { id: 'toggleSidebar', label: 'Toggle Sidebar', keys: ['Alt', 'Meta', 'ArrowLeft'] };
        const event = createKeyboardEvent({
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Alt+Meta+ArrowRight', () => {
        const shortcut: Shortcut = { id: 'toggleRightPanel', label: 'Toggle Right Panel', keys: ['Alt', 'Meta', 'ArrowRight'] };
        const event = createKeyboardEvent({
          key: 'ArrowRight',
          code: 'ArrowRight',
          altKey: true,
          metaKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });
    });

    describe('Shift+bracket shortcuts', () => {
      it('matches Cmd+Shift+[ when e.key is {', () => {
        const shortcut: Shortcut = { id: 'prevTab', label: 'Previous Tab', keys: ['Meta', 'Shift', '['] };
        const event = createKeyboardEvent({
          key: '{', // Shift+[ produces { on US keyboard
          code: 'BracketLeft',
          metaKey: true,
          shiftKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Cmd+Shift+] when e.key is }', () => {
        const shortcut: Shortcut = { id: 'nextTab', label: 'Next Tab', keys: ['Meta', 'Shift', ']'] };
        const event = createKeyboardEvent({
          key: '}', // Shift+] produces } on US keyboard
          code: 'BracketRight',
          metaKey: true,
          shiftKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });
    });

    describe('Shift+number shortcuts', () => {
      it('matches Cmd+Shift+1 when e.key is !', () => {
        const shortcut: Shortcut = { id: 'goToAutoRun', label: 'Go to Auto Run', keys: ['Meta', 'Shift', '1'] };
        const event = createKeyboardEvent({
          key: '!', // Shift+1 produces ! on US keyboard
          code: 'Digit1',
          metaKey: true,
          shiftKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });

      it('matches Cmd+Shift+2 when e.key is @', () => {
        const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Meta', 'Shift', '2'] };
        const event = createKeyboardEvent({
          key: '@', // Shift+2 produces @ on US keyboard
          code: 'Digit2',
          metaKey: true,
          shiftKey: true,
        });
        expect(matchShortcut(event, shortcut)).toBe(true);
      });
    });
  });

  describe('isAltMetaShortcut', () => {
    it('returns true for Alt+Meta+L with allowed keys [l, p]', () => {
      const event = createKeyboardEvent({
        key: '¬', // macOS Alt+L
        code: 'KeyL',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaShortcut(event, ['l', 'p'])).toBe(true);
    });

    it('returns true for Alt+Meta+P with allowed keys [l, p]', () => {
      const event = createKeyboardEvent({
        key: 'π', // macOS Alt+P
        code: 'KeyP',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaShortcut(event, ['l', 'p'])).toBe(true);
    });

    it('returns false for Alt+Meta+T when not in allowed keys', () => {
      const event = createKeyboardEvent({
        key: '†', // macOS Alt+T
        code: 'KeyT',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaShortcut(event, ['l', 'p'])).toBe(false);
    });

    it('returns false without Alt modifier', () => {
      const event = createKeyboardEvent({
        key: 'p',
        code: 'KeyP',
        altKey: false,
        metaKey: true,
      });
      expect(isAltMetaShortcut(event, ['l', 'p'])).toBe(false);
    });

    it('returns false without Meta modifier', () => {
      const event = createKeyboardEvent({
        key: 'π',
        code: 'KeyP',
        altKey: true,
        metaKey: false,
      });
      expect(isAltMetaShortcut(event, ['l', 'p'])).toBe(false);
    });
  });

  describe('isAltMetaNumberShortcut', () => {
    it('returns true for Alt+Meta+1 (macOS e.key = ¡)', () => {
      const event = createKeyboardEvent({
        key: '¡', // macOS Alt+1
        code: 'Digit1',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaNumberShortcut(event)).toBe(true);
    });

    it('returns true for Alt+Meta+5', () => {
      const event = createKeyboardEvent({
        key: '∞', // macOS Alt+5
        code: 'Digit5',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaNumberShortcut(event)).toBe(true);
    });

    it('returns true for Alt+Meta+0', () => {
      const event = createKeyboardEvent({
        key: 'º', // macOS Alt+0
        code: 'Digit0',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaNumberShortcut(event)).toBe(true);
    });

    it('returns false for Alt+Meta+Letter', () => {
      const event = createKeyboardEvent({
        key: 'π', // macOS Alt+P
        code: 'KeyP',
        altKey: true,
        metaKey: true,
      });
      expect(isAltMetaNumberShortcut(event)).toBe(false);
    });

    it('returns false without Alt modifier', () => {
      const event = createKeyboardEvent({
        key: '1',
        code: 'Digit1',
        altKey: false,
        metaKey: true,
      });
      expect(isAltMetaNumberShortcut(event)).toBe(false);
    });

    it('returns false without Meta modifier', () => {
      const event = createKeyboardEvent({
        key: '¡',
        code: 'Digit1',
        altKey: true,
        metaKey: false,
      });
      expect(isAltMetaNumberShortcut(event)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles missing e.code gracefully', () => {
      const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Alt', 'Meta', 'p'] };
      const event = {
        key: 'π',
        code: undefined,
        metaKey: true,
        altKey: true,
        shiftKey: false,
        ctrlKey: false,
      } as unknown as KeyboardEvent;
      // Should fall back to e.key comparison (won't match 'π' to 'p')
      expect(matchShortcut(event, shortcut)).toBe(false);
    });

    it('handles empty e.code string', () => {
      const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Alt', 'Meta', 'p'] };
      const event = {
        key: 'π',
        code: '',
        metaKey: true,
        altKey: true,
        shiftKey: false,
        ctrlKey: false,
      } as unknown as KeyboardEvent;
      // Should fall back to e.key comparison (won't match 'π' to 'p')
      expect(matchShortcut(event, shortcut)).toBe(false);
    });

    it('treats Ctrl as equivalent to Meta', () => {
      const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Meta', 'k'] };
      const event = createKeyboardEvent({
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        metaKey: false,
      });
      expect(matchShortcut(event, shortcut)).toBe(true);
    });

    it('matches shortcut with Ctrl in config using metaKey', () => {
      const shortcut: Shortcut = { id: 'test', label: 'Test', keys: ['Ctrl', 'k'] };
      const event = createKeyboardEvent({
        key: 'k',
        code: 'KeyK',
        metaKey: true,
        ctrlKey: false,
      });
      expect(matchShortcut(event, shortcut)).toBe(true);
    });
  });
});
