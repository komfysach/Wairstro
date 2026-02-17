/**
 * Web interface utilities for Guru
 */

export {
	generateCSSProperties,
	generateCSSString,
	injectCSSProperties,
	removeCSSProperties,
	setElementCSSProperties,
	removeElementCSSProperties,
	getCSSProperty,
	cssVar,
	THEME_CSS_PROPERTIES,
} from './cssCustomProperties';
export type { ThemeCSSProperty } from './cssCustomProperties';

export {
	registerServiceWorker,
	unregisterServiceWorker,
	isServiceWorkerSupported,
	isOffline,
	skipWaiting,
	pingServiceWorker,
} from './serviceWorker';
export type { ServiceWorkerConfig } from './serviceWorker';
