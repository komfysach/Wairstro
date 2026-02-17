export interface AdoCredentials {
	organization: string;
	project: string;
	team?: string;
	pat: string;
}

export interface AdoSprintWorkItem {
	id: number;
	title: string;
	description: string;
	acceptanceCriteria: string;
	state: string;
	tags: string[];
	url: string;
}

export interface AdoSprintWorkItemsResult {
	iterationId: string;
	iterationName: string;
	items: AdoSprintWorkItem[];
}

export interface AdoSprintDebugResult {
	organization: string;
	project: string;
	team: string | null;
	iterationId: string;
	iterationName: string;
	iterationPath: string | null;
	idsFromIterationEndpoint: number[];
	idsFromWiql: number[];
	finalIds: number[];
	itemCount: number;
}

interface IterationListResponse {
	value?: Array<{
		id?: string;
		name?: string;
		path?: string;
	}>;
}

interface IterationWorkItemsResponse {
	workItemRelations?: Array<{
		target?: {
			id?: number;
			url?: string;
		};
	}>;
	workItems?: Array<{
		id?: number;
		url?: string;
	}>;
}

interface BatchWorkItemsResponse {
	value?: Array<{
		id?: number;
		url?: string;
		fields?: Record<string, unknown>;
	}>;
}

interface WiqlResult {
	workItems?: Array<{
		id?: number;
		url?: string;
	}>;
}

const API_VERSION = '7.1';

export class AdoService {
	private readonly projectBaseUrl: string;
	private readonly teamBaseUrl: string;
	private readonly organization: string;
	private readonly project: string;
	private readonly team: string | null;
	private readonly authHeader: string;

	constructor(credentials: AdoCredentials) {
		const organization = normalizeOrganization(credentials.organization);
		const project = normalizeProject(credentials.project);
		const team = normalizeTeam(credentials.team || '');
		this.organization = organization;
		this.project = project;
		this.team = team;
		this.projectBaseUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
		this.teamBaseUrl = team
			? `${this.projectBaseUrl}/${encodeURIComponent(team)}`
			: this.projectBaseUrl;
		this.authHeader = Buffer.from(`:${credentials.pat}`).toString('base64');
	}

	private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Basic ${this.authHeader}`,
				'Content-Type': 'application/json',
				...(init?.headers || {}),
			},
		});

		if (!response.ok) {
			const raw = (await response.text()).trim();
			const message = raw.slice(0, 500) || response.statusText;
			throw new Error(`ADO request failed (${response.status}): ${message}`);
		}

		return (await response.json()) as T;
	}

	private async getCurrentIteration(): Promise<{ id: string; name: string; path: string | null }> {
		const url = `${this.teamBaseUrl}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=${API_VERSION}`;
		const payload = await this.fetchJson<IterationListResponse>(url);
		const current = payload.value?.[0];
		if (!current?.id) {
			throw new Error('No active sprint found in Azure DevOps team settings');
		}
		return {
			id: current.id,
			name: current.name || current.id,
			path: current.path || null,
		};
	}

	private async getIterationWorkItemIds(iterationId: string): Promise<number[]> {
		const url = `${this.teamBaseUrl}/_apis/work/teamsettings/iterations/${encodeURIComponent(iterationId)}/workitems?api-version=${API_VERSION}`;
		const payload = await this.fetchJson<IterationWorkItemsResponse>(url);

		const relationIds =
			payload.workItemRelations
				?.map((relation) => relation.target?.id)
				.filter((id): id is number => typeof id === 'number') || [];

		const workItemIds =
			payload.workItems
				?.map((workItem) => workItem.id)
				.filter((id): id is number => typeof id === 'number') || [];

		return Array.from(new Set([...relationIds, ...workItemIds]));
	}

	private async getWorkItemIdsByIterationPath(iterationPath: string): Promise<number[]> {
		const safePath = iterationPath.replace(/'/g, "''");
		const wiql = `
SELECT [System.Id]
FROM WorkItems
WHERE [System.TeamProject] = @project
	AND [System.IterationPath] UNDER '${safePath}'
`.trim();
		const url = `${this.projectBaseUrl}/_apis/wit/wiql?api-version=${API_VERSION}`;
		const payload = await this.fetchJson<WiqlResult>(url, {
			method: 'POST',
			body: JSON.stringify({ query: wiql }),
		});

		return (payload.workItems || [])
			.map((item) => item.id)
			.filter((id): id is number => typeof id === 'number');
	}

	private async getWorkItemDetails(ids: number[]): Promise<AdoSprintWorkItem[]> {
		if (ids.length === 0) return [];

		const url = `${this.projectBaseUrl}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`;
		const payload = await this.fetchJson<BatchWorkItemsResponse>(url, {
			method: 'POST',
			body: JSON.stringify({
				ids,
				fields: [
					'System.Title',
					'System.Description',
					'Microsoft.VSTS.Common.AcceptanceCriteria',
					'System.State',
					'System.Tags',
				],
				errorPolicy: 'Omit',
			}),
		});

		return (payload.value || [])
			.map((item): AdoSprintWorkItem | null => {
				if (typeof item.id !== 'number') return null;

				const fields = item.fields || {};
				const tagsRaw = String(fields['System.Tags'] || '');
				const tags = tagsRaw
					.split(';')
					.map((tag) => tag.trim())
					.filter(Boolean);

				return {
					id: item.id,
					title: String(fields['System.Title'] || `Work Item #${item.id}`),
					description: String(fields['System.Description'] || ''),
					acceptanceCriteria: String(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
					state: String(fields['System.State'] || 'Unknown'),
					tags,
					url: item.url || '',
				};
			})
			.filter((item): item is AdoSprintWorkItem => item !== null)
			.sort((a, b) => a.id - b.id);
	}

	async getCurrentSprintWorkItems(): Promise<AdoSprintWorkItemsResult> {
		const debug = await this.getCurrentSprintDebug();
		const items = await this.getWorkItemDetails(debug.finalIds);

		return {
			iterationId: debug.iterationId,
			iterationName: debug.iterationName,
			items,
		};
	}

	async getCurrentSprintDebug(): Promise<AdoSprintDebugResult> {
		const iteration = await this.getCurrentIteration();
		const idsFromIterationEndpoint = await this.getIterationWorkItemIds(iteration.id);
		let idsFromWiql: number[] = [];
		if (idsFromIterationEndpoint.length === 0 && iteration.path) {
			// Fallback for team-scope edge cases: query by iteration path at project scope.
			idsFromWiql = await this.getWorkItemIdsByIterationPath(iteration.path);
		}
		const finalIds = idsFromIterationEndpoint.length > 0 ? idsFromIterationEndpoint : idsFromWiql;
		const items = await this.getWorkItemDetails(finalIds);

		return {
			organization: this.organization,
			project: this.project,
			team: this.team,
			iterationId: iteration.id,
			iterationName: iteration.name,
			iterationPath: iteration.path,
			idsFromIterationEndpoint,
			idsFromWiql,
			finalIds,
			itemCount: items.length,
		};
	}
}

function normalizeOrganization(value: string): string {
	const raw = value.trim();
	if (!raw) throw new Error('ADO organization is required');

	let candidate = raw;

	// Accept full URLs (e.g., https://dev.azure.com/my-org or https://my-org.visualstudio.com)
	if (/^https?:\/\//i.test(raw)) {
		const parsed = new URL(raw);
		const host = parsed.hostname.toLowerCase();
		if (host === 'dev.azure.com') {
			const orgFromPath = parsed.pathname.split('/').filter(Boolean)[0];
			if (orgFromPath) candidate = orgFromPath;
		} else if (host.endsWith('.visualstudio.com')) {
			candidate = host.replace(/\.visualstudio\.com$/i, '');
		} else {
			throw new Error(
				'ADO organization URL must use dev.azure.com or *.visualstudio.com'
			);
		}
	}

	candidate = candidate.replace(/^\/+|\/+$/g, '');
	if (!candidate || /[:/?#]/.test(candidate)) {
		throw new Error('ADO organization must be a plain organization name (no URL/path)');
	}
	return candidate;
}

function normalizeProject(value: string): string {
	let candidate = value.trim();
	if (!candidate) throw new Error('ADO project is required');

	// If a full URL/path is pasted, use the last non-empty segment as project.
	if (/^https?:\/\//i.test(candidate)) {
		const parsed = new URL(candidate);
		const segments = parsed.pathname.split('/').filter(Boolean);
		if (segments.length > 0) {
			candidate = segments[segments.length - 1];
		}
	}

	candidate = candidate.replace(/^\/+|\/+$/g, '');
	if (!candidate || /[:?#]/.test(candidate)) {
		throw new Error('ADO project must be a plain project name');
	}
	return candidate;
}

function normalizeTeam(value: string): string | null {
	const candidate = value.trim().replace(/^\/+|\/+$/g, '');
	if (!candidate) return null;
	if (/[:/?#]/.test(candidate)) {
		throw new Error('ADO team/board must be a plain team name');
	}
	return candidate;
}
