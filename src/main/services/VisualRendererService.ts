import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright-core';

interface ScreenshotRequest {
	url: string;
	selector: string;
	workspaceCwd: string;
}

interface ParsedCaptureTarget {
	url: string;
	selector: string;
}

const AUTH_TIMEOUT_MS = 45_000;
const DEV_SERVER_TIMEOUT_MS = 120_000;
const SCREENSHOT_PATH = path.join(process.cwd(), '.wairstro', 'snapshots', 'current_render.png');
const AUTH_STATE_DIR = path.join(process.cwd(), '.wairstro', 'auth');
const USER_STATE_PATH = path.join(AUTH_STATE_DIR, 'user.json');
const SESSION_STATE_PATH = path.join(AUTH_STATE_DIR, 'session.json');

export class VisualRendererService {
	private browser: Browser | null = null;
	private readonly devServerProcesses = new Map<string, ChildProcess>();

	private loadPlaywright(): typeof import('playwright-core') {
		// Runtime require prevents esbuild from trying to bundle Playwright internals.
		const req = (0, eval)('require') as NodeRequire;
		return req('playwright-core') as typeof import('playwright-core');
	}

	parseCaptureTarget(baseUrl: string, routeOrComponent?: string | null): ParsedCaptureTarget {
		const raw = (routeOrComponent || '').trim();
		if (!raw) {
			return { url: baseUrl, selector: 'body' };
		}

		const splitIndex = raw.indexOf('::');
		if (splitIndex >= 0) {
			const route = raw.slice(0, splitIndex).trim();
			const selector = raw.slice(splitIndex + 2).trim() || 'body';
			if (/^https?:\/\//i.test(route)) {
				return { url: route, selector };
			}
			if (route.startsWith('/')) {
				return { url: new URL(route, baseUrl).toString(), selector };
			}
			return { url: baseUrl, selector: route || selector };
		}

		if (/^https?:\/\//i.test(raw)) {
			return { url: raw, selector: 'body' };
		}
		if (raw.startsWith('/')) {
			return { url: new URL(raw, baseUrl).toString(), selector: 'body' };
		}
		return { url: baseUrl, selector: raw };
	}

	async takeScreenshot(request: ScreenshotRequest): Promise<string> {
		await this.ensureDevServerRunning(request.workspaceCwd, request.url);
		const browser = await this.getBrowser();
		const context = await this.createAuthenticatedContext(browser, this.originFromUrl(request.url));
		try {
			const page = await context.newPage();

			await this.ensureAuthenticatedSession(page, request.url);
			await page.goto(request.url, { waitUntil: 'domcontentloaded' });
			await page.waitForLoadState('networkidle', { timeout: AUTH_TIMEOUT_MS });

			const locator = page.locator(request.selector).first();
			await locator.waitFor({ state: 'visible', timeout: AUTH_TIMEOUT_MS });

			const box = await locator.boundingBox();
			if (!box) {
				throw new Error(`Selector '${request.selector}' is not visible for screenshot capture.`);
			}

			await fs.mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
			await page.screenshot({
				path: SCREENSHOT_PATH,
				clip: {
					x: Math.max(0, box.x),
					y: Math.max(0, box.y),
					width: Math.max(1, box.width),
					height: Math.max(1, box.height),
				},
				animations: 'disabled',
			});

			await this.persistSessionState(page);
			return SCREENSHOT_PATH;
		} finally {
			await context.close();
		}
	}

	private async getBrowser(): Promise<Browser> {
		if (this.browser && this.browser.isConnected()) {
			return this.browser;
		}
		const { chromium } = this.loadPlaywright();
		this.browser = await chromium.launch({ headless: true });
		return this.browser;
	}

	private async createAuthenticatedContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
		await fs.mkdir(AUTH_STATE_DIR, { recursive: true });
		const hasUserState = await this.fileExists(USER_STATE_PATH);
		const context = hasUserState
			? await browser.newContext({
					storageState: USER_STATE_PATH,
					baseURL,
					viewport: { width: 1920, height: 1080 },
				})
			: await browser.newContext({
					baseURL,
					viewport: { width: 1920, height: 1080 },
				});

		const sessionData = await this.readSessionState();
			if (sessionData) {
				await context.addInitScript((sessionSnapshot) => {
					try {
						const parsed = JSON.parse(sessionSnapshot) as Record<string, string>;
						const win = globalThis as unknown as { sessionStorage: { setItem: (k: string, v: string) => void } };
						for (const [key, value] of Object.entries(parsed)) {
							win.sessionStorage.setItem(key, String(value));
						}
					} catch {
						// Ignore malformed snapshots and continue with runtime auth.
				}
			}, sessionData);
		}
		return context;
	}

	private async ensureAuthenticatedSession(page: Page, targetUrl: string): Promise<void> {
		const appOrigin = this.originFromUrl(targetUrl);
		await page.goto(appOrigin, { waitUntil: 'domcontentloaded' });
		await this.validateRuntimeConfig(page);

		const usernameInput = page
			.getByLabel('Username')
			.or(page.locator('input[name="username"]'))
			.or(page.locator('input#username'))
			.first();
		const loginFormVisible = await usernameInput.isVisible({ timeout: 8_000 }).catch(() => false);

		if (loginFormVisible) {
			const username = process.env.E2E_USERNAME ?? 'sachin@wairforretail.com';
			const password = process.env.E2E_PASSWORD ?? 'ikke';
			await usernameInput.fill(username);
			await page
				.getByLabel('Password')
				.or(page.locator('input[name="password"]'))
				.or(page.locator('input#password'))
				.first()
				.fill(password);
			await page
				.getByRole('button', { name: 'Sign In' })
				.or(page.locator('button[type="submit"]'))
				.first()
				.click();
		}

		await page.waitForFunction(
			() => {
				const win = globalThis as unknown as { document?: { title?: string } };
				return /WAIR/i.test(win.document?.title || '');
			},
			{},
			{ timeout: AUTH_TIMEOUT_MS }
		);
		await this.ensureDesiredTenantInSession(page);
	}

	private async validateRuntimeConfig(page: Page): Promise<void> {
		const runtimeConfig = await page.evaluate(() => {
			const cfg = (globalThis as unknown as { WAIR_CONFIG?: Record<string, unknown> }).WAIR_CONFIG ?? null;
			return {
				exists: !!cfg,
				authUrl: (cfg?.authUrl as string | null) ?? null,
				authRealm: (cfg?.authRealm as string | null) ?? null,
				authClientId: (cfg?.authClientId as string | null) ?? null,
				redirectUri: (cfg?.redirectUri as string | null) ?? null,
				whoopieUrl: (cfg?.whoopieUrl as string | null) ?? null,
			};
		});

		const invalid = (value?: string | null): boolean => {
			if (!value || typeof value !== 'string') return true;
			const trimmed = value.trim();
			return trimmed.length === 0 || trimmed.includes('undefined') || trimmed.startsWith('__');
		};

		if (
			!runtimeConfig.exists ||
			invalid(runtimeConfig.authUrl) ||
			invalid(runtimeConfig.authRealm) ||
			invalid(runtimeConfig.authClientId) ||
			invalid(runtimeConfig.redirectUri) ||
			invalid(runtimeConfig.whoopieUrl)
		) {
			throw new Error(
				`Invalid WAIR runtime config. Ensure customer-portal config is valid. Snapshot: ${JSON.stringify(runtimeConfig)}`
			);
		}
	}

	private async ensureDesiredTenantInSession(page: Page): Promise<void> {
		const normalize = (value?: string | null) => (value ?? '').trim().toUpperCase();
		const desiredTenant = process.env.E2E_TENANT_NAME ?? 'DE-CASAMODA';
		const desiredTenantNormalized = normalize(desiredTenant);
		const desiredTenantCode = process.env.E2E_TENANT_CODE ?? desiredTenant;
		const desiredTenantId = process.env.E2E_TENANT_ID ?? 'e2e-tenant';

		const isMatchingTenant = (tenant?: Record<string, unknown> | null): boolean => {
			if (!tenant || typeof tenant !== 'object') return false;
			const name = normalize(typeof tenant.name === 'string' ? tenant.name : '');
			const code = normalize(typeof tenant.code === 'string' ? tenant.code : '');
			return name === desiredTenantNormalized || code === desiredTenantNormalized;
		};

		const existingTenant = await page.evaluate(() => {
			const win = globalThis as unknown as { sessionStorage: { getItem: (key: string) => string | null } };
			const tenantRaw = win.sessionStorage.getItem('tenant-local');
			if (!tenantRaw) return null;
			try {
				return JSON.parse(tenantRaw);
			} catch {
				return null;
			}
		});
		if (isMatchingTenant(existingTenant) && !!(existingTenant as Record<string, unknown>)?.id) {
			return;
		}

		const tenantResponse = await page
			.waitForResponse(
				(response) => {
					if (!response.ok() || response.request().method() !== 'GET') return false;
					return /\/api\/v1\/Tenant(\/)?(\?|$)/i.test(response.url());
				},
				{ timeout: AUTH_TIMEOUT_MS }
			)
			.catch(() => null);

		let selectedTenant: Record<string, unknown>;
		if (tenantResponse) {
			const tenantList = await tenantResponse.json();
			if (!Array.isArray(tenantList) || tenantList.length === 0) {
				throw new Error('Tenant list is empty or invalid.');
			}
			const tenantFromApi = tenantList.find((tenant) =>
				isMatchingTenant(tenant as Record<string, unknown>)
			) as Record<string, unknown> | undefined;
			if (!tenantFromApi) {
				throw new Error(`Tenant '${desiredTenant}' was not found in /api/v1/Tenant.`);
			}
			selectedTenant = tenantFromApi;
		} else {
			selectedTenant = {
				id: desiredTenantId,
				code: desiredTenantCode,
				name: desiredTenant,
				storageCreated: true,
				keycloakDataCreated: true,
				messageQueuesCreated: true,
				databaseCreated: true,
				solutions: [{ code: 'whoopie', solutionRoute: '/solutions/whoopie' }],
			};
		}

		const readinessFlags = [
			'storageCreated',
			'keycloakDataCreated',
			'messageQueuesCreated',
			'databaseCreated',
		] as const;
		const notReady = readinessFlags.filter(
			(flag) => flag in selectedTenant && selectedTenant[flag] !== true
		);
		if (notReady.length > 0) {
			throw new Error(`Tenant '${desiredTenant}' is not ready (${notReady.join(', ')})`);
		}

		await page.evaluate((tenant) => {
			const win = globalThis as unknown as {
				sessionStorage: { setItem: (key: string, value: string) => void };
				localStorage: { setItem: (key: string, value: string) => void };
			};
			win.sessionStorage.setItem('tenant-local', JSON.stringify(tenant));
			win.localStorage.setItem(
				'tenant',
				JSON.stringify({
					id: tenant?.id,
					code: tenant?.code,
					name: tenant?.name,
				})
			);
		}, selectedTenant);

		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() => {
				const win = globalThis as unknown as {
					sessionStorage: { getItem: (key: string) => string | null };
				};
				const tenantRaw = win.sessionStorage.getItem('tenant-local');
				if (!tenantRaw) return false;
				try {
					const parsed = JSON.parse(tenantRaw);
					return !!parsed?.id;
				} catch {
					return false;
				}
			},
			{},
			{ timeout: AUTH_TIMEOUT_MS }
		);
	}

	private async persistSessionState(page: Page): Promise<void> {
		await fs.mkdir(AUTH_STATE_DIR, { recursive: true });
		await page.context().storageState({ path: USER_STATE_PATH });
		const sessionData = await page.evaluate(() => {
			const win = globalThis as unknown as { sessionStorage: Record<string, unknown> };
			return JSON.stringify(win.sessionStorage);
		});
		if (!sessionData || sessionData === '{}') {
			throw new Error('Session storage is empty after authentication.');
		}
		await fs.writeFile(SESSION_STATE_PATH, sessionData, 'utf8');
	}

	private async ensureDevServerRunning(workspaceCwd: string, targetUrl: string): Promise<void> {
		if (await this.isReachable(targetUrl)) {
			return;
		}

		const key = path.resolve(workspaceCwd);
		const existing = this.devServerProcesses.get(key);
		if (!existing || existing.exitCode !== null) {
			const child = spawn('npm', ['run', 'dev'], {
				cwd: workspaceCwd,
				detached: true,
				stdio: 'ignore',
				shell: process.platform === 'win32',
			});
			child.unref();
			this.devServerProcesses.set(key, child);
		}

		const start = Date.now();
		while (Date.now() - start < DEV_SERVER_TIMEOUT_MS) {
			if (await this.isReachable(targetUrl)) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}

		throw new Error(`Rspack dev server did not become ready at ${targetUrl} within ${DEV_SERVER_TIMEOUT_MS}ms.`);
	}

	private async isReachable(url: string): Promise<boolean> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2_500);
		try {
			const response = await fetch(url, { method: 'GET', signal: controller.signal });
			return response.ok || response.status === 401 || response.status === 403;
		} catch {
			return false;
		} finally {
			clearTimeout(timer);
		}
	}

	private async readSessionState(): Promise<string | null> {
		try {
			const content = await fs.readFile(SESSION_STATE_PATH, 'utf8');
			return content.trim().length > 0 ? content : null;
		} catch {
			return null;
		}
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private originFromUrl(url: string): string {
		return new URL(url).origin;
	}
}
