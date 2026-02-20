import type { AdoCredentials } from './ado-service';
import type { TaskProfile } from '../../shared/task-routing';
import { mergeProfileTag, resolveTaskProfile } from '../../shared/task-routing';

export type KanbanLane = 'To-Do' | 'Active' | 'Review' | 'Resolved' | 'Closed';

export interface AdoBoardColumn {
	name: string;
	stateMappings: string[];
	lane: KanbanLane;
}

export interface AdoBoardItem {
	id: number;
	title: string;
	description: string;
	acceptanceCriteria: string;
	attachedContextPaths: string[];
	state: string;
	boardColumn: string;
	tags: string[];
	taskProfile: TaskProfile;
	url: string;
	lane: KanbanLane;
}

export type AdoWorkItemType = 'User Story' | 'Bug' | 'Task';

export interface AdoBoardSnapshot {
	boardName: string;
	columns: AdoBoardColumn[];
	items: AdoBoardItem[];
	debug?: {
		resolvedTeam: string | null;
		resolvedBoard: string;
		columnsUrl: string;
		wiqlUrl: string;
		teamFieldValuesUrl?: string;
		wiql: string;
	};
}

interface BoardColumnsResponse {
	value?: Array<{
		name?: string;
		stateMappings?:
			| Array<{
					stateName?: string;
			  }>
			| Record<string, unknown>;
	}>;
}

interface BoardsListResponse {
	value?: Array<{
		name?: string;
	}>;
}

interface TeamFieldValuesResponse {
	values?: Array<{
		value?: string;
		includeChildren?: boolean;
	}>;
}

interface WiqlResult {
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

interface WorkItemUpdateResponse {
	id?: number;
	url?: string;
	fields?: Record<string, unknown>;
}

const API_VERSION = '7.1';
const KANBAN_LANES: KanbanLane[] = ['To-Do', 'Active', 'Review', 'Resolved', 'Closed'];
const WORK_ITEM_TYPE_BY_LABEL: Record<AdoWorkItemType, string> = {
	'User Story': '$User Story',
	Bug: '$Bug',
	Task: '$Task',
};
const ATTACHED_CONTEXT_START = '<!-- guru-attached-context:start -->';
const ATTACHED_CONTEXT_END = '<!-- guru-attached-context:end -->';

function normalizeLabel(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasWord(normalized: string, word: string): boolean {
	return normalized.split(' ').includes(word);
}

function extractStateMappings(raw: unknown): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw
			.map((entry) => {
				if (!entry || typeof entry !== 'object') return '';
				return String((entry as { stateName?: unknown }).stateName || '').trim();
			})
			.filter(Boolean);
	}
	if (typeof raw === 'object') {
		return Object.values(raw)
			.map((value) => String(value || '').trim())
			.filter(Boolean);
	}
	return [];
}

function isBoardMissingError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return message.includes('board does not exist') || message.includes('boarddoesnotexistexception');
}

function isBoardColumnReadOnlyError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return message.includes('system.boardcolumn') && message.includes('readonly');
}

function laneRank(lane: KanbanLane): number {
	const index = KANBAN_LANES.indexOf(lane);
	return index >= 0 ? index : 0;
}

function normalizeAttachedPath(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function dedupeAttachedPaths(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawPath of paths) {
		const normalized = normalizeAttachedPath(rawPath);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function parseAttachedContextFromDescription(rawDescription: string): {
	cleanDescription: string;
	attachedContextPaths: string[];
} {
	const description = String(rawDescription || '');
	const startIndex = description.indexOf(ATTACHED_CONTEXT_START);
	const endIndex = description.indexOf(ATTACHED_CONTEXT_END);
	if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
		return { cleanDescription: description, attachedContextPaths: [] };
	}

	const metadataStart = startIndex + ATTACHED_CONTEXT_START.length;
	const metadataRaw = description.slice(metadataStart, endIndex).trim();
	let parsedPaths: string[] = [];
	try {
		const parsed = JSON.parse(metadataRaw);
		if (Array.isArray(parsed)) {
			parsedPaths = parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
		}
	} catch {
		parsedPaths = metadataRaw
			.split('\n')
			.map((line) => line.replace(/^-+\s*/, '').trim())
			.filter(Boolean);
	}

	const cleanDescription = `${description.slice(0, startIndex).trim()}\n${description.slice(endIndex + ATTACHED_CONTEXT_END.length).trim()}`
		.trim();
	return {
		cleanDescription,
		attachedContextPaths: dedupeAttachedPaths(parsedPaths),
	};
}

function buildDescriptionWithAttachedContext(
	baseDescription: string,
	attachedContextPaths: string[]
): string {
	const normalizedPaths = dedupeAttachedPaths(attachedContextPaths);
	if (normalizedPaths.length === 0) {
		return baseDescription.trim();
	}

	const metadataBlock = [
		ATTACHED_CONTEXT_START,
		JSON.stringify(normalizedPaths, null, '\t'),
		ATTACHED_CONTEXT_END,
	].join('\n');
	const base = baseDescription.trim();
	return base ? `${base}\n\n${metadataBlock}` : metadataBlock;
}

function classifyLaneByName(name: string): KanbanLane | null {
	const normalized = normalizeLabel(name);
	if (!normalized) return null;
	if (normalized.includes('closed') || normalized.includes('complete') || normalized === 'done') {
		return 'Closed';
	}
	if (
		normalized.includes('resolved') ||
		normalized.includes('ready for qa') ||
		normalized.includes('qa')
	) {
		return 'Resolved';
	}
	if (
		normalized.includes('review') ||
		hasWord(normalized, 'pr') ||
		normalized.includes('pull request')
	) {
		return 'Review';
	}
	if (
		normalized.includes('active') ||
		normalized.includes('in progress') ||
		normalized.includes('doing') ||
		normalized.includes('develop') ||
		normalized.includes('build') ||
		normalized.includes('test')
	) {
		return 'Active';
	}
	if (
		normalized.includes('to do') ||
		normalized.includes('todo') ||
		normalized.includes('new') ||
		normalized.includes('backlog')
	) {
		return 'To-Do';
	}
	return null;
}

function classifyLaneByState(state: string): KanbanLane {
	const normalized = normalizeLabel(state);
	if (!normalized) return 'To-Do';
	if (normalized.includes('closed') || normalized.includes('complete') || normalized === 'done') {
		return 'Closed';
	}
	if (normalized.includes('resolved') || normalized.includes('ready for qa') || normalized.includes('qa')) {
		return 'Resolved';
	}
	if (
		normalized.includes('review') ||
		normalized.includes('pull request') ||
		normalized === 'active' ||
		normalized.includes('in progress') ||
		normalized.includes('doing')
	) {
		return normalized.includes('review') || normalized.includes('pull request')
			? 'Review'
			: 'Active';
	}
	return 'To-Do';
}

function normalizeOrganization(value: string): string {
	const raw = value.trim();
	if (!raw) throw new Error('ADO organization is required');

	let candidate = raw;
	if (/^https?:\/\//i.test(raw)) {
		const parsed = new URL(raw);
		const host = parsed.hostname.toLowerCase();
		if (host === 'dev.azure.com') {
			const orgFromPath = parsed.pathname.split('/').filter(Boolean)[0];
			if (orgFromPath) candidate = orgFromPath;
		} else if (host.endsWith('.visualstudio.com')) {
			candidate = host.split('.')[0];
		}
	}

	return candidate.trim().replace(/^\/+|\/+$/g, '');
}

function normalizeProject(value: string): string {
	const project = value.trim();
	if (!project) throw new Error('ADO project is required');
	if (project.includes('/') || project.includes('\\')) {
		throw new Error('ADO project must be a plain project name');
	}
	return project;
}

function normalizeTeam(value: string): string | null {
	const team = value.trim();
	if (!team) return null;
	if (team.includes('/') || team.includes('\\')) {
		throw new Error('ADO team/board must be a plain team name');
	}
	return team;
}

export class AdoBoardService {
	private readonly projectBaseUrl: string;
	private readonly project: string;
	private readonly team: string | null;
	private readonly authHeader: string;

	constructor(credentials: AdoCredentials) {
		const organization = normalizeOrganization(credentials.organization);
		this.project = normalizeProject(credentials.project);
		this.team = normalizeTeam(credentials.team || '');
		this.projectBaseUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(this.project)}`;
		this.authHeader = Buffer.from(`:${credentials.pat}`).toString('base64');
	}

	private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Basic ${this.authHeader}`,
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

	private getTeamBaseUrl(teamName: string | null): string {
		if (!teamName) return this.projectBaseUrl;
		return `${this.projectBaseUrl}/${encodeURIComponent(teamName)}`;
	}

	private async listBoardNames(teamName: string | null, allowProjectFallback = true): Promise<string[]> {
		const primary = this.getTeamBaseUrl(teamName);
		const urls = [primary];
		if (allowProjectFallback && primary !== this.projectBaseUrl) {
			urls.push(this.projectBaseUrl);
		}

		for (const urlBase of urls) {
			try {
				const payload = await this.fetchJson<BoardsListResponse>(
					`${urlBase}/_apis/work/boards?api-version=${API_VERSION}`
				);
				const names = (payload.value || [])
					.map((board) => String(board.name || '').trim())
					.filter(Boolean);
				if (names.length > 0) return Array.from(new Set(names));
			} catch {
				// Try next scope.
			}
		}

		return [];
	}

	private mapColumnToLane(columnName: string, stateMappings: string[]): KanbanLane {
		const byName = classifyLaneByName(columnName);
		if (byName) return byName;
		for (const stateName of stateMappings) {
			const byStateName = classifyLaneByName(stateName);
			if (byStateName) return byStateName;
		}
		return classifyLaneByState(stateMappings[0] || '');
	}

	private async fetchColumnsForContext(teamName: string | null, boardName: string): Promise<{
		columns: AdoBoardColumn[];
		columnsUrl: string;
	}> {
		const baseUrl = this.getTeamBaseUrl(teamName);
		const url = `${baseUrl}/_apis/work/boards/${encodeURIComponent(boardName)}/columns?api-version=${API_VERSION}`;
		const payload = await this.fetchJson<BoardColumnsResponse>(url);
		const columns = (payload.value || [])
			.map((column): AdoBoardColumn | null => {
				const name = String(column.name || '').trim();
				if (!name) return null;
				const stateMappings = extractStateMappings(column.stateMappings);
				return {
					name,
					stateMappings,
					lane: this.mapColumnToLane(name, stateMappings),
				};
			})
			.filter((column): column is AdoBoardColumn => column !== null)
			.sort((a, b) => laneRank(a.lane) - laneRank(b.lane) || a.name.localeCompare(b.name));
		if (columns.length === 0) {
			throw new Error('No board columns were returned by Azure DevOps.');
		}
		return { columns, columnsUrl: url };
	}

	private async resolveBoardContext(override?: string): Promise<{
		teamName: string | null;
		boardName: string;
		columns: AdoBoardColumn[];
		columnsUrl: string;
	}> {
		const provided = (override || '').trim();
		if (provided) {
			// Team override is strict: never silently fall back to default team.
			const strictAttempts: Array<{ teamName: string | null; boardName: string }> = [
				{ teamName: provided, boardName: 'Stories' },
			];
			const boardsForProvidedTeam = await this.listBoardNames(provided, false);
			for (const board of boardsForProvidedTeam) {
				strictAttempts.push({ teamName: provided, boardName: board });
			}

			let strictError: unknown = null;
			for (const attempt of strictAttempts) {
				try {
					const resolved = await this.fetchColumnsForContext(attempt.teamName, attempt.boardName);
					return {
						teamName: attempt.teamName,
						boardName: attempt.boardName,
						columns: resolved.columns,
						columnsUrl: resolved.columnsUrl,
					};
				} catch (error) {
					strictError = error;
					if (!isBoardMissingError(error)) {
						throw error;
					}
				}
			}

			if (boardsForProvidedTeam.length > 0) {
				throw new Error(
					`Team override "${provided}" could not resolve a board context. Available boards for team: ${boardsForProvidedTeam.join(', ')}`
				);
			}
			if (strictError instanceof Error) {
				throw new Error(
					`Team override "${provided}" could not be resolved. Confirm the team exists and you have access.`
				);
			}
			throw new Error(`Team override "${provided}" could not be resolved.`);
		}

		const attempts: Array<{ teamName: string | null; boardName: string }> = [];

		const defaultTeam = this.team;
		const defaultBoards = await this.listBoardNames(defaultTeam);
		if (defaultBoards.length > 0) {
			const preferred =
				defaultBoards.find((name) => normalizeLabel(name) === 'stories') || defaultBoards[0];
			attempts.push({ teamName: defaultTeam, boardName: preferred });
			for (const board of defaultBoards) {
				attempts.push({ teamName: defaultTeam, boardName: board });
			}
		} else {
			attempts.push({ teamName: defaultTeam, boardName: 'Stories' });
		}

		const dedupedAttempts = Array.from(
			new Map(
				attempts.map((attempt) => [
					`${attempt.teamName || '(project)'}::${attempt.boardName.toLowerCase()}`,
					attempt,
				])
			).values()
		);
		let lastError: unknown = null;
		for (const attempt of dedupedAttempts) {
			try {
				const resolved = await this.fetchColumnsForContext(attempt.teamName, attempt.boardName);
				return {
					teamName: attempt.teamName,
					boardName: attempt.boardName,
					columns: resolved.columns,
					columnsUrl: resolved.columnsUrl,
				};
			} catch (error) {
				lastError = error;
				if (!isBoardMissingError(error)) {
					throw error;
				}
			}
		}

		const discovered = await this.listBoardNames(this.team);
		if (discovered.length > 0) {
			throw new Error(
				`Unable to resolve a valid ADO board context. Available boards: ${discovered.join(', ')}`
			);
		}
		if (lastError instanceof Error) throw lastError;
		throw new Error('Unable to resolve a valid ADO board context.');
	}

	async getColumns(override?: string): Promise<AdoBoardColumn[]> {
		const resolved = await this.resolveBoardContext(override);
		return resolved.columns;
	}

	private async getTeamAreaPaths(teamName: string | null): Promise<{
		teamFieldValuesUrl?: string;
		paths: Array<{ path: string; includeChildren: boolean }>;
	}> {
		if (!teamName) {
			return { paths: [] };
		}
		const teamFieldValuesUrl = `${this.getTeamBaseUrl(teamName)}/_apis/work/teamsettings/teamfieldvalues?api-version=${API_VERSION}`;
		try {
			const payload = await this.fetchJson<TeamFieldValuesResponse>(teamFieldValuesUrl);
			const paths = (payload.values || [])
				.map((entry) => ({
					path: String(entry.value || '').trim(),
					includeChildren: Boolean(entry.includeChildren),
				}))
				.filter((entry) => entry.path.length > 0);
			return { teamFieldValuesUrl, paths };
		} catch {
			return { teamFieldValuesUrl, paths: [] };
		}
	}

	private async getBoardWorkItemIds(teamName: string | null): Promise<{
		ids: number[];
		wiqlUrl: string;
		teamFieldValuesUrl?: string;
		wiql: string;
	}> {
		const { teamFieldValuesUrl, paths } = await this.getTeamAreaPaths(teamName);
		const areaClause = paths.length
			? `\n\tAND (\n${paths
					.map((entry) => {
						const safePath = entry.path.replace(/'/g, "''");
						return entry.includeChildren
							? `\t\t[System.AreaPath] UNDER '${safePath}'`
							: `\t\t[System.AreaPath] = '${safePath}'`;
					})
					.join('\n\t\tOR\n')}\n\t)`
			: '';
		const wiql = `
SELECT [System.Id]
FROM WorkItems
WHERE [System.TeamProject] = @project
	AND [System.State] <> 'Closed'
	AND [System.State] <> 'Removed'
${areaClause}
ORDER BY [System.ChangedDate] DESC
`.trim();
		const url = `${this.projectBaseUrl}/_apis/wit/wiql?api-version=${API_VERSION}`;
		const payload = await this.fetchJson<WiqlResult>(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query: wiql }),
		});

		const ids = (payload.workItems || [])
			.map((item) => item.id)
			.filter((id): id is number => typeof id === 'number');
		return { ids, wiqlUrl: url, teamFieldValuesUrl, wiql };
	}

	private async getBoardItemsByIds(ids: number[], columns: AdoBoardColumn[]): Promise<AdoBoardItem[]> {
		if (ids.length === 0) return [];

		const laneByColumn = new Map(columns.map((column) => [normalizeLabel(column.name), column.lane]));
		const url = `${this.projectBaseUrl}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`;
		const payload = await this.fetchJson<BatchWorkItemsResponse>(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				ids,
				fields: [
					'System.Title',
					'System.Description',
					'Microsoft.VSTS.Common.AcceptanceCriteria',
					'System.State',
					'System.Tags',
					'System.BoardColumn',
				],
				errorPolicy: 'Omit',
			}),
		});

		return (payload.value || [])
			.map((item): AdoBoardItem | null => {
				if (typeof item.id !== 'number') return null;
				const fields = item.fields || {};
				const tagsRaw = String(fields['System.Tags'] || '');
				const tags = tagsRaw
					.split(';')
					.map((tag) => tag.trim())
					.filter(Boolean);
				const parsedDescription = parseAttachedContextFromDescription(
					String(fields['System.Description'] || '')
				);
				const boardColumn = String(fields['System.BoardColumn'] || '').trim();
				const lane =
					laneByColumn.get(normalizeLabel(boardColumn)) || classifyLaneByState(String(fields['System.State'] || ''));

				return {
					id: item.id,
					title: String(fields['System.Title'] || `Work Item #${item.id}`),
					description: parsedDescription.cleanDescription,
					acceptanceCriteria: String(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
					attachedContextPaths: parsedDescription.attachedContextPaths,
					state: String(fields['System.State'] || 'Unknown'),
					boardColumn,
					tags,
					taskProfile: resolveTaskProfile(tags),
					url: item.url || '',
					lane,
				};
			})
			.filter((item): item is AdoBoardItem => item !== null)
			.sort((a, b) => a.id - b.id);
	}

	async getBoardSnapshot(override?: string): Promise<AdoBoardSnapshot> {
		const resolved = await this.resolveBoardContext(override);
		const scoped = await this.getBoardWorkItemIds(resolved.teamName);
		const items = await this.getBoardItemsByIds(scoped.ids, resolved.columns);
		return {
			boardName: resolved.boardName,
			columns: resolved.columns,
			items,
			debug: {
				resolvedTeam: resolved.teamName,
				resolvedBoard: resolved.boardName,
				columnsUrl: resolved.columnsUrl,
				wiqlUrl: scoped.wiqlUrl,
				teamFieldValuesUrl: scoped.teamFieldValuesUrl,
				wiql: scoped.wiql,
			},
		};
	}

	async moveItemToColumn(ticketId: number, targetColumn: string, override?: string): Promise<{
		id: number;
		state: string;
		boardColumn: string;
	}> {
		if (!Number.isFinite(ticketId) || ticketId <= 0) {
			throw new Error('A valid work item ticketId is required.');
		}
		const targetRaw = String(targetColumn || '').trim();
		if (!targetRaw) {
			throw new Error('Target column is required.');
		}

		const resolved = await this.resolveBoardContext(override);
		const columns = resolved.columns;
		const targetLane = (KANBAN_LANES.includes(targetRaw as KanbanLane)
			? (targetRaw as KanbanLane)
			: classifyLaneByName(targetRaw)) as KanbanLane | null;
		const target = columns.find(
			(column) =>
				column.name.toLowerCase() === targetRaw.toLowerCase() ||
				(targetLane ? column.lane === targetLane : false)
		);

		if (!target) {
			const available = columns.map((column) => column.name).join(', ');
			throw new Error(`Unable to map "${targetRaw}" to a board column. Available columns: ${available}`);
		}

		const url = `${this.projectBaseUrl}/_apis/wit/workitems/${ticketId}?api-version=${API_VERSION}`;
		const patchWithBoardColumn: Array<{ op: 'add'; path: string; value: string }> = [
			{ op: 'add', path: '/fields/System.BoardColumn', value: target.name },
		];
		const targetState = target.stateMappings[0];
		if (targetState) {
			patchWithBoardColumn.push({ op: 'add', path: '/fields/System.State', value: targetState });
		}

		let response: WorkItemUpdateResponse;
		try {
			response = await this.fetchJson<WorkItemUpdateResponse>(url, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json-patch+json',
				},
				body: JSON.stringify(patchWithBoardColumn),
			});
		} catch (error) {
			if (!isBoardColumnReadOnlyError(error)) {
				throw error;
			}
			if (!targetState) {
				throw new Error(
					`Board column is read-only and lane "${target.name}" has no state mapping to fall back to.`
				);
			}
			response = await this.fetchJson<WorkItemUpdateResponse>(url, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json-patch+json',
				},
				body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: targetState }]),
			});
		}

		const fields = response.fields || {};
		return {
			id: typeof response.id === 'number' ? response.id : ticketId,
			state: String(fields['System.State'] || targetState || ''),
			boardColumn: String(fields['System.BoardColumn'] || target.name),
		};
	}

	async createWorkItem(
		title: string,
		type: AdoWorkItemType,
		description = '',
		taskProfile: TaskProfile = 'Logic',
		areaPath?: string,
		override?: string,
		acceptanceCriteria?: string
	): Promise<AdoBoardItem> {
		const normalizedTitle = String(title || '').trim();
		if (!normalizedTitle) {
			throw new Error('Work item title is required.');
		}

		const normalizedType = WORK_ITEM_TYPE_BY_LABEL[type];
		if (!normalizedType) {
			throw new Error(`Unsupported work item type: ${type}`);
		}

		const resolved = await this.resolveBoardContext(override);
		const teamAreas = await this.getTeamAreaPaths(resolved.teamName);
		const defaultAreaPath = teamAreas.paths[0]?.path;
		const toDoColumn = resolved.columns.find((column) => column.lane === 'To-Do');
		const defaultState = toDoColumn?.stateMappings[0];

		const patchDocument: Array<{ op: 'add'; path: string; value: string }> = [
			{ op: 'add', path: '/fields/System.Title', value: normalizedTitle },
			{ op: 'add', path: '/fields/System.Description', value: String(description || '') },
		];
		if (defaultState) {
			patchDocument.push({
				op: 'add',
				path: '/fields/System.State',
				value: defaultState,
			});
		}

		const normalizedAreaPath = String(areaPath || defaultAreaPath || '').trim();
		if (normalizedAreaPath) {
			const resolvedAreaPath = normalizedAreaPath.includes('\\')
				? normalizedAreaPath
				: `${this.project}\\${normalizedAreaPath}`;
			patchDocument.push({
				op: 'add',
				path: '/fields/System.AreaPath',
				value: resolvedAreaPath,
			});
		}
		const normalizedAcceptanceCriteria = String(acceptanceCriteria || '').trim();
		if (normalizedAcceptanceCriteria) {
			patchDocument.push({
				op: 'add',
				path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
				value: normalizedAcceptanceCriteria,
			});
		}
		patchDocument.push({
			op: 'add',
			path: '/fields/System.Tags',
			value: mergeProfileTag([], taskProfile).join('; '),
		});

		const url = `${this.projectBaseUrl}/_apis/wit/workitems/${encodeURIComponent(normalizedType)}?api-version=${API_VERSION}`;
		const response = await this.fetchJson<WorkItemUpdateResponse>(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json-patch+json',
			},
			body: JSON.stringify(patchDocument),
		});

		const fields = response.fields || {};
		const id = typeof response.id === 'number' ? response.id : 0;
		if (id <= 0) {
			throw new Error('ADO work item create did not return a valid work item ID.');
		}

		const state = String(fields['System.State'] || 'New');
		const boardColumn = String(fields['System.BoardColumn'] || '');
		const lane = classifyLaneByName(boardColumn) || classifyLaneByState(state);

		return {
			id,
			title: String(fields['System.Title'] || normalizedTitle),
			description: parseAttachedContextFromDescription(String(fields['System.Description'] || '')).cleanDescription,
			acceptanceCriteria: String(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
			attachedContextPaths: parseAttachedContextFromDescription(
				String(fields['System.Description'] || '')
			).attachedContextPaths,
			state,
			boardColumn,
			tags: String(fields['System.Tags'] || '')
				.split(';')
				.map((tag) => tag.trim())
				.filter(Boolean),
			taskProfile: resolveTaskProfile(
				String(fields['System.Tags'] || '')
					.split(';')
					.map((tag) => tag.trim())
					.filter(Boolean)
			),
			url: String(response.url || ''),
			lane,
		};
	}

	async updateWorkItemTaskProfile(
		ticketId: number,
		taskProfile: TaskProfile
	): Promise<{ id: number; tags: string[]; taskProfile: TaskProfile }> {
		if (!Number.isFinite(ticketId) || ticketId <= 0) {
			throw new Error('A valid work item ticketId is required.');
		}

		const fetchUrl = `${this.projectBaseUrl}/_apis/wit/workitems/${ticketId}?fields=System.Tags&api-version=${API_VERSION}`;
		const existing = await this.fetchJson<WorkItemUpdateResponse>(fetchUrl);
		const existingTags = String(existing.fields?.['System.Tags'] || '')
			.split(';')
			.map((tag) => tag.trim())
			.filter(Boolean);
		const mergedTags = mergeProfileTag(existingTags, taskProfile);

		const updateUrl = `${this.projectBaseUrl}/_apis/wit/workitems/${ticketId}?api-version=${API_VERSION}`;
		const updated = await this.fetchJson<WorkItemUpdateResponse>(updateUrl, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json-patch+json',
			},
			body: JSON.stringify([
				{
					op: 'add',
					path: '/fields/System.Tags',
					value: mergedTags.join('; '),
				},
			]),
		});

		const resolvedTags = String(updated.fields?.['System.Tags'] || mergedTags.join('; '))
			.split(';')
			.map((tag) => tag.trim())
			.filter(Boolean);
		return {
			id: typeof updated.id === 'number' ? updated.id : ticketId,
			tags: resolvedTags,
			taskProfile: resolveTaskProfile(resolvedTags),
		};
	}

	async updateWorkItemAttachedContext(
		ticketId: number,
		attachedContextPaths: string[]
	): Promise<{ id: number; attachedContextPaths: string[] }> {
		if (!Number.isFinite(ticketId) || ticketId <= 0) {
			throw new Error('A valid work item ticketId is required.');
		}

		const fetchUrl = `${this.projectBaseUrl}/_apis/wit/workitems/${ticketId}?fields=System.Description&api-version=${API_VERSION}`;
		const existing = await this.fetchJson<WorkItemUpdateResponse>(fetchUrl);
		const existingDescription = String(existing.fields?.['System.Description'] || '');
		const parsed = parseAttachedContextFromDescription(existingDescription);
		const updatedDescription = buildDescriptionWithAttachedContext(
			parsed.cleanDescription,
			attachedContextPaths
		);

		const updateUrl = `${this.projectBaseUrl}/_apis/wit/workitems/${ticketId}?api-version=${API_VERSION}`;
		const updated = await this.fetchJson<WorkItemUpdateResponse>(updateUrl, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json-patch+json',
			},
			body: JSON.stringify([
				{
					op: 'add',
					path: '/fields/System.Description',
					value: updatedDescription,
				},
			]),
		});

		const resolvedDescription = String(updated.fields?.['System.Description'] || updatedDescription);
		return {
			id: typeof updated.id === 'number' ? updated.id : ticketId,
			attachedContextPaths: parseAttachedContextFromDescription(resolvedDescription).attachedContextPaths,
		};
	}
}
