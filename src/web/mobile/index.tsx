/**
 * Maestro Mobile Web Entry Point
 *
 * This is the entry point for the mobile web interface.
 * It exports the main MobileApp component and any mobile-specific
 * utilities needed for the remote control interface.
 *
 * The mobile interface is designed for:
 * - Quick command input from your phone
 * - Session monitoring and status checking
 * - Lightweight interaction when away from desk
 *
 * This module can be directly imported for code splitting:
 * ```typescript
 * const Mobile = lazy(() => import('./mobile'));
 * ```
 */

import React from 'react';
import MobileApp from './App';

// Re-export the main app component as both default and named
export { MobileApp };
export default MobileApp;

/**
 * Mobile-specific configuration options
 */
export interface MobileConfig {
  /** Enable haptic feedback for interactions (if supported) */
  enableHaptics?: boolean;
  /** Enable voice input button */
  enableVoiceInput?: boolean;
  /** Enable offline command queue */
  enableOfflineQueue?: boolean;
  /** Maximum lines for expandable input (default: 4) */
  maxInputLines?: number;
  /** Enable pull-to-refresh gesture */
  enablePullToRefresh?: boolean;
}

/**
 * Default mobile configuration
 */
export const defaultMobileConfig: MobileConfig = {
  enableHaptics: true,
  enableVoiceInput: true,
  enableOfflineQueue: true,
  maxInputLines: 4,
  enablePullToRefresh: true,
};

/**
 * Mobile viewport constants
 */
export const MOBILE_BREAKPOINTS = {
  /** Maximum width for small phones */
  small: 320,
  /** Maximum width for standard phones */
  medium: 375,
  /** Maximum width for large phones / small tablets */
  large: 428,
  /** Maximum width considered "mobile" */
  max: 768,
} as const;

/**
 * Safe area padding values (for notched devices)
 * These are CSS env() fallback values in pixels
 */
export const SAFE_AREA_DEFAULTS = {
  top: 44,
  bottom: 34,
  left: 0,
  right: 0,
} as const;

/**
 * Check if the current viewport is mobile-sized
 */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_BREAKPOINTS.max;
}

/**
 * Check if the device supports haptic feedback
 */
export function supportsHaptics(): boolean {
  if (typeof window === 'undefined') return false;
  return 'vibrate' in navigator;
}

/**
 * Trigger haptic feedback (if supported and enabled)
 * @param pattern - Vibration pattern in milliseconds
 */
export function triggerHaptic(pattern: number | number[] = 10): void {
  if (supportsHaptics()) {
    navigator.vibrate(pattern);
  }
}

/**
 * Haptic patterns for different interactions
 */
export const HAPTIC_PATTERNS = {
  /** Light tap for button presses */
  tap: 10,
  /** Medium feedback for sends */
  send: [10, 30, 10],
  /** Strong feedback for interrupts */
  interrupt: [50, 30, 50],
  /** Success pattern */
  success: [10, 50, 20],
  /** Error pattern */
  error: [100, 30, 100, 30, 100],
} as const;

/**
 * Check if the device supports the Web Speech API for voice input
 */
export function supportsVoiceInput(): boolean {
  if (typeof window === 'undefined') return false;
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

/**
 * Mobile gesture detection utilities
 */
export const GESTURE_THRESHOLDS = {
  /** Minimum distance (px) for swipe detection */
  swipeDistance: 50,
  /** Maximum time (ms) for swipe gesture */
  swipeTime: 300,
  /** Distance (px) for pull-to-refresh trigger */
  pullToRefresh: 80,
  /** Long press duration (ms) */
  longPress: 500,
} as const;
