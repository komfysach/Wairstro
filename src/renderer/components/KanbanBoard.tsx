import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import type { Theme } from '../types';
import {
	adoService,
	type AdoBoardItem,
	type AdoBoardSnapshot,
	type PreviewStatusResult,
	type AdoWorkItemType,
	type KanbanLane,
} from '../services/ado';
import { useKanbanController } from '../services/KanbanController';
import { KanbanColumnHeader } from './KanbanColumnHeader';
import { KanbanCard } from './KanbanCard';
import { FileContextPickerModal } from './FileContextPickerModal';
import type { TaskProfile } from '../../shared/task-routing';
import { getTaskProfileIcon, resolveTaskProfile } from '../../shared/task-routing';

interface KanbanBoardProps {
	theme: Theme;
	monorepoRoot: string;
	onRunTicket?: (item: AdoBoardItem) => Promise<void>;
	onQuickPrTicket?: (item: AdoBoardItem) => Promise<void>;
	onMergeCompleteTicket?: (item: AdoBoardItem, prId?: number) => Promise<void>;
}

const LANES: KanbanLane[] = ['To-Do', 'Active', 'Review', 'Resolved', 'Closed'];
const KANBAN_QUICK_ADD_FOCUS_EVENT = 'maestro:kanbanQuickAddFocus';

type GhostCardStatus = 'creating' | 'error';

interface GhostCard {
	ghostId: string;
	lane: KanbanLane;
	status: GhostCardStatus;
	errorMessage?: string;
	request: {
		title: string;
		type: AdoWorkItemType;
		description: string;
		taskProfile: TaskProfile;
		areaPath?: string;
		boardName?: string;
		acceptanceCriteria?: string;
	};
}

const DESIGN_CONTEXT_SETTINGS_KEY = 'kanbanDesignContextByTicket';
const PREVIEW_CONTEXT_SETTINGS_KEY = 'kanbanPreviewContextByTicket';

interface PreviewContextEntry {
	worktreePath: string;
	mfeName: string;
	updatedAt?: number;
}

interface PreviewCardState extends PreviewStatusResult {
	status: 'idle' | 'starting' | 'running' | 'error';
	worktreePath: string;
	mfeName: string;
	error?: string;
}

interface DesignContextEntry {
	url: string;
	verifiedNodeName?: string;
	imagePath?: string;
	imageUrl?: string;
}

function laneDescription(lane: KanbanLane): string {
	if (lane === 'To-Do') return 'Backlog items ready for assignment';
	if (lane === 'Active') return 'Items currently being processed by an MFE Agent';
	if (lane === 'Review') return 'Items where the Agent has opened a PR';
	if (lane === 'Resolved') return 'PR merged, waiting for QA';
	return 'Done';
}

function mapAreaTagToPath(tag: string): string | undefined {
	const normalized = tag.trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === 'auth') return 'Remote-Auth';
	return undefined;
}

function parseQuickAddTitle(rawInput: string, selectedType: AdoWorkItemType): {
	title: string;
	type: AdoWorkItemType;
	areaPath?: string;
} {
	let input = rawInput.trim();
	let resolvedType = selectedType;

	if (/^\/bug\b/i.test(input)) {
		resolvedType = 'Bug';
		input = input.replace(/^\/bug\b\s*/i, '');
	} else if (/^\/task\b/i.test(input)) {
		resolvedType = 'Task';
		input = input.replace(/^\/task\b\s*/i, '');
	} else if (/^\/(story|userstory|user-story)\b/i.test(input)) {
		resolvedType = 'User Story';
		input = input.replace(/^\/(story|userstory|user-story)\b\s*/i, '');
	}

	let areaPath: string | undefined;
	const areaMatch = input.match(/@([a-z0-9-]+)\s*$/i);
	if (areaMatch) {
		areaPath = mapAreaTagToPath(areaMatch[1] || '');
		input = input.replace(/@([a-z0-9-]+)\s*$/i, '').trim();
	}

	const title = input.trim();
	return { title, type: resolvedType, areaPath };
}

function generatePromptWithAssistant(input: {
	title: string;
	description: string;
	type: AdoWorkItemType;
}): string {
	const description = input.description.trim() || 'No extra context supplied.';
	return [
		`Prompt Assistant Agent`,
		'',
		`Work Item Type: ${input.type}`,
		`Goal: ${input.title.trim()}`,
		'',
		'Implementation Plan:',
		`1. Understand and validate current behavior related to "${input.title.trim()}".`,
		'2. Implement the minimal safe code changes needed.',
		'3. Add/adjust tests for both happy path and edge cases.',
		'4. Verify build/lint/tests and capture any follow-up risks.',
		'',
		'Context:',
		description,
	].join('\n');
}

interface QuickAddModalProps {
	theme: Theme;
	isOpen: boolean;
	focusToken: number;
	initialType: AdoWorkItemType;
	initialTaskProfile: TaskProfile;
	onClose: () => void;
	onSubmit: (payload: {
		title: string;
		type: AdoWorkItemType;
		description: string;
		taskProfile: TaskProfile;
		areaPath?: string;
		acceptanceCriteria?: string;
	}) => void;
}

function QuickAddModal({
	theme,
	isOpen,
	focusToken,
	initialType,
	initialTaskProfile,
	onClose,
	onSubmit,
}: QuickAddModalProps) {
	const [titleInput, setTitleInput] = useState('');
	const [typeInput, setTypeInput] = useState<AdoWorkItemType>(initialType);
	const [descriptionInput, setDescriptionInput] = useState('');
	const [promptInput, setPromptInput] = useState('');
	const [taskProfile, setTaskProfile] = useState<TaskProfile>(initialTaskProfile);
	const [inlineError, setInlineError] = useState<string | null>(null);
	const titleRef = useRef<HTMLInputElement>(null);

	const parsed = useMemo(() => parseQuickAddTitle(titleInput, typeInput), [titleInput, typeInput]);

	useEffect(() => {
		if (!isOpen) return;
		const timeoutId = window.setTimeout(() => {
			titleRef.current?.focus();
			titleRef.current?.select();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [isOpen, focusToken]);

	useEffect(() => {
		if (!isOpen) return;
		setTypeInput(initialType);
		setTaskProfile(initialTaskProfile);
	}, [initialTaskProfile, initialType, isOpen]);

	const handleClose = () => {
		setTitleInput('');
		setTypeInput(initialType);
		setDescriptionInput('');
		setPromptInput('');
		setTaskProfile(initialTaskProfile);
		setInlineError(null);
		onClose();
	};

	const handleSubmit = () => {
		const title = parsed.title.trim();
		if (!title) {
			setInlineError('Title is required.');
			return;
		}
		onSubmit({
			title,
			type: parsed.type,
			description: descriptionInput.trim(),
			taskProfile,
			areaPath: parsed.areaPath,
			acceptanceCriteria: promptInput.trim() || undefined,
		});
		handleClose();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			handleClose();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			handleSubmit();
		}
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
			onKeyDown={handleKeyDown}
		>
			<div
				className="w-full max-w-2xl rounded border p-4 space-y-3"
				style={{ backgroundColor: theme.colors.bgMain, borderColor: theme.colors.border }}
			>
				<div className="flex items-center justify-between">
					<div className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
						Quick Add Work Item
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="px-2 py-1 rounded text-xs border"
						style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
					>
						Esc
					</button>
				</div>
				<div className="grid grid-cols-[1fr_auto] gap-2">
					<input
						ref={titleRef}
						value={titleInput}
						onChange={(event) => {
							setTitleInput(event.target.value);
							if (inlineError) setInlineError(null);
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault();
								handleSubmit();
							}
						}}
						placeholder="Enter task title..."
						className="w-full rounded border px-2 py-2 text-xs bg-transparent outline-none"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					/>
					<div className="flex items-center justify-center rounded border px-2 py-2 text-xs bg-transparent outline-none"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain, backgroundColor: theme.colors.bgMain }}
					>
					<select
						value={typeInput}
						onChange={(event) => setTypeInput(event.target.value as AdoWorkItemType)}
						className="text-xs bg-transparent outline-none"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						<option value="User Story">User Story</option>
						<option value="Bug">Bug</option>
						<option value="Task">Task</option>
					</select>
					</div>
					
				</div>
				<div className="flex items-center gap-2">
					<div className="text-[11px] font-semibold" style={{ color: theme.colors.textDim }}>
						Task Profile
					</div>
					<button
						type="button"
						onClick={() => setTaskProfile('UI')}
						className="px-2 py-1 rounded border text-xs"
						style={{
							borderColor: taskProfile === 'UI' ? theme.colors.accent : theme.colors.border,
							color: taskProfile === 'UI' ? theme.colors.accent : theme.colors.textDim,
						}}
					>
						{getTaskProfileIcon('UI')} UI
					</button>
					<button
						type="button"
						onClick={() => setTaskProfile('Logic')}
						className="px-2 py-1 rounded border text-xs"
						style={{
							borderColor: taskProfile === 'Logic' ? theme.colors.accent : theme.colors.border,
							color: taskProfile === 'Logic' ? theme.colors.accent : theme.colors.textDim,
						}}
					>
						{getTaskProfileIcon('Logic')} Logic
					</button>
				</div>
				<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
					Resolved Type: {parsed.type}
					{` | Profile: ${taskProfile}`}
					{parsed.areaPath ? ` | Area Path: ${parsed.areaPath}` : ''}
					{!parsed.areaPath ? ' | Area path defaults to board team scope' : ''}
				</div>
				<textarea
					value={descriptionInput}
					onChange={(event) => setDescriptionInput(event.target.value)}
					placeholder="Description (required for execution context)"
					className="w-full rounded border px-2 py-2 text-xs bg-transparent outline-none min-h-[88px]"
					style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
				/>
				<div className="space-y-1.5">
					<div className="flex items-center justify-between">
						<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
							Execution Prompt
						</div>
						<button
							type="button"
							onClick={() =>
								setPromptInput(
									generatePromptWithAssistant({
										title: parsed.title || titleInput,
										description: descriptionInput,
										type: parsed.type,
									})
								)
							}
							className="px-2 py-1 rounded text-[11px] font-semibold border"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							Generate with Prompt Assistant
						</button>
					</div>
					<textarea
						value={promptInput}
						onChange={(event) => setPromptInput(event.target.value)}
						placeholder="Generated prompt used by worker agent during execution"
						className="w-full rounded border px-2 py-2 text-xs bg-transparent outline-none min-h-[128px]"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					/>
				</div>
				{inlineError && (
					<div className="text-xs" style={{ color: theme.colors.error }}>
						{inlineError}
					</div>
				)}
				<div className="flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={handleClose}
						className="px-3 py-1.5 rounded text-xs font-semibold border"
						style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSubmit}
						className="px-3 py-1.5 rounded text-xs font-semibold border"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						Create (Enter / Cmd+Enter)
					</button>
				</div>
			</div>
		</div>
	);
}

export function KanbanBoard({
	theme,
	monorepoRoot,
	onRunTicket,
	onQuickPrTicket,
	onMergeCompleteTicket,
}: KanbanBoardProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<AdoBoardSnapshot | null>(null);
	const [organization, setOrganization] = useState('');
	const [project, setProject] = useState('');
	const [team, setTeam] = useState('');
	const [hasPat, setHasPat] = useState(false);
	const [boardNameInput, setBoardNameInput] = useState('');
	const [activeTeamOverride, setActiveTeamOverride] = useState<string | null>(null);
	const [ghostCards, setGhostCards] = useState<GhostCard[]>([]);
	const [quickAddFocusToken, setQuickAddFocusToken] = useState(0);
	const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
	const [quickAddProfile, setQuickAddProfile] = useState<TaskProfile>('Logic');
	const [designContextByTicket, setDesignContextByTicket] = useState<
		Record<number, DesignContextEntry>
	>({});
	const [designContextLoaded, setDesignContextLoaded] = useState(false);
	const [runningTicketIds, setRunningTicketIds] = useState<Record<number, boolean>>({});
	const [quickPrTicketIds, setQuickPrTicketIds] = useState<Record<number, boolean>>({});
	const [mergeCompleteTicketIds, setMergeCompleteTicketIds] = useState<Record<number, boolean>>({});
	const [previewContextByTicket, setPreviewContextByTicket] = useState<Record<number, PreviewContextEntry>>({});
	const [previewByTicket, setPreviewByTicket] = useState<Record<number, PreviewCardState>>({});
	const [attachContextTicketId, setAttachContextTicketId] = useState<number | null>(null);
	const previewByTicketRef = useRef(previewByTicket);

	useEffect(() => {
		previewByTicketRef.current = previewByTicket;
	}, [previewByTicket]);

	const refreshBoard = useCallback(async (boardOverride?: string) => {
		setIsLoading(true);
		setError(null);
		try {
			const resolvedBoard = (boardOverride ?? activeTeamOverride ?? '').trim() || undefined;
			const result = await adoService.getBoardSnapshot(resolvedBoard);
			setSnapshot(result);
			if (typeof boardOverride === 'string') {
				setActiveTeamOverride(boardOverride.trim() || null);
			}
		} catch (refreshError) {
			setSnapshot(null);
			setError(
				refreshError instanceof Error ? refreshError.message : 'Failed to load Azure DevOps board state.'
			);
		} finally {
			setIsLoading(false);
		}
	}, [activeTeamOverride]);

	const { liveStatusByTicket, errorByTicket, prUrlByTicket, prIdByTicket } = useKanbanController({
		boardName: activeTeamOverride || undefined,
		onBoardMutation: refreshBoard,
	});

	const loadSettings = useCallback(async () => {
		try {
			const settings = await adoService.getSettings();
			setOrganization(settings.organization);
			setProject(settings.project);
			setTeam(settings.team || '');
			setBoardNameInput('');
			setActiveTeamOverride(null);
			setHasPat(settings.hasPat);
		} catch (settingsError) {
			setError(settingsError instanceof Error ? settingsError.message : 'Failed to load ADO settings.');
		}
	}, []);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	useEffect(() => {
		if (!organization || !project || !hasPat) return;
		void refreshBoard();
	}, [organization, project, hasPat, refreshBoard]);

	useEffect(() => {
		const handleFocusQuickAdd = () => {
			setQuickAddModalOpen(true);
			setQuickAddFocusToken((prev) => prev + 1);
		};
		window.addEventListener(KANBAN_QUICK_ADD_FOCUS_EVENT, handleFocusQuickAdd);
		return () => window.removeEventListener(KANBAN_QUICK_ADD_FOCUS_EVENT, handleFocusQuickAdd);
	}, []);

	useEffect(() => {
		window.maestro.settings
			.get(DESIGN_CONTEXT_SETTINGS_KEY)
			.then((value) => {
				const rawMap =
					value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
				const normalized: Record<number, DesignContextEntry> = {};
				for (const [ticketIdText, entry] of Object.entries(rawMap)) {
					const ticketId = Number(ticketIdText);
					if (!Number.isFinite(ticketId) || ticketId <= 0) continue;
					if (!entry || typeof entry !== 'object') continue;
					const typedEntry = entry as Record<string, unknown>;
					const url = typeof typedEntry.url === 'string' ? typedEntry.url : '';
					if (!url.trim()) continue;
					normalized[ticketId] = {
						url,
						verifiedNodeName:
							typeof typedEntry.verifiedNodeName === 'string'
								? typedEntry.verifiedNodeName
								: undefined,
						imagePath: typeof typedEntry.imagePath === 'string' ? typedEntry.imagePath : undefined,
						imageUrl: typeof typedEntry.imageUrl === 'string' ? typedEntry.imageUrl : undefined,
					};
				}
				setDesignContextByTicket(normalized);
			})
			.catch((loadError) => {
				console.error('Failed to load design context links:', loadError);
			})
			.finally(() => {
				setDesignContextLoaded(true);
			});
	}, []);

	useEffect(() => {
		window.maestro.settings
			.get(PREVIEW_CONTEXT_SETTINGS_KEY)
			.then((value) => {
				const rawMap =
					value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
				const normalized: Record<number, PreviewContextEntry> = {};
				for (const [ticketIdText, entry] of Object.entries(rawMap)) {
					const ticketId = Number(ticketIdText);
					if (!Number.isFinite(ticketId) || ticketId <= 0) continue;
					if (!entry || typeof entry !== 'object') continue;
					const typedEntry = entry as Record<string, unknown>;
					const worktreePath =
						typeof typedEntry.worktreePath === 'string' ? typedEntry.worktreePath.trim() : '';
					const mfeName = typeof typedEntry.mfeName === 'string' ? typedEntry.mfeName.trim() : '';
					if (!worktreePath || !mfeName) continue;
					normalized[ticketId] = {
						worktreePath,
						mfeName,
						updatedAt: typeof typedEntry.updatedAt === 'number' ? typedEntry.updatedAt : undefined,
					};
				}
				setPreviewContextByTicket(normalized);
			})
			.catch((loadError) => {
				console.error('Failed to load preview context links:', loadError);
			});
	}, []);

	useEffect(() => {
		if (!designContextLoaded) return;
		window.maestro.settings.set(DESIGN_CONTEXT_SETTINGS_KEY, designContextByTicket);
	}, [designContextByTicket, designContextLoaded]);

	const groupedItems = useMemo(() => {
		const result: Record<KanbanLane, AdoBoardItem[]> = {
			'To-Do': [],
			Active: [],
			Review: [],
			Resolved: [],
			Closed: [],
		};
		for (const item of snapshot?.items || []) {
			result[item.lane].push(item);
		}
		return result;
	}, [snapshot]);

	const ghostCardsByLane = useMemo(() => {
		const grouped: Record<KanbanLane, GhostCard[]> = {
			'To-Do': [],
			Active: [],
			Review: [],
			Resolved: [],
			Closed: [],
		};
		for (const card of ghostCards) {
			grouped[card.lane].push(card);
		}
		return grouped;
	}, [ghostCards]);

	const createWorkItemWithOptimisticState = useCallback(
		async (
			ghostId: string,
			request: {
				title: string;
				type: AdoWorkItemType;
				description: string;
				taskProfile: TaskProfile;
				areaPath?: string;
				boardName?: string;
				acceptanceCriteria?: string;
			}
		) => {
			try {
				const createdItem = await adoService.createWorkItem(request);
				setGhostCards((prev) => prev.filter((card) => card.ghostId !== ghostId));
				setSnapshot((prev) => {
					if (!prev) return prev;
					const withoutDuplicate = prev.items.filter((item) => item.id !== createdItem.id);
					return { ...prev, items: [createdItem, ...withoutDuplicate] };
				});
			} catch (createError) {
				const message =
					createError instanceof Error ? createError.message : 'Failed to create work item.';
				setGhostCards((prev) =>
					prev.map((card) =>
						card.ghostId === ghostId
							? {
									...card,
									status: 'error',
									errorMessage: message,
								}
							: card
					)
				);
			}
		},
		[]
	);

	const handleQuickAdd = useCallback(
		(request: {
			title: string;
			type: AdoWorkItemType;
			description: string;
			taskProfile: TaskProfile;
			areaPath?: string;
			acceptanceCriteria?: string;
		}) => {
			setQuickAddProfile(request.taskProfile);
			const ghostId = `ghost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const requestWithBoard = {
				...request,
				boardName: activeTeamOverride || undefined,
			};
			setGhostCards((prev) => [
				{
					ghostId,
					lane: 'To-Do',
					status: 'creating',
					request: requestWithBoard,
				},
				...prev,
			]);
			void createWorkItemWithOptimisticState(ghostId, requestWithBoard);
		},
		[activeTeamOverride, createWorkItemWithOptimisticState]
	);

	const retryGhostCard = useCallback(
		(ghostId: string) => {
			let retryRequest: GhostCard['request'] | null = null;
			setGhostCards((prev) =>
				prev.map((card) => {
					if (card.ghostId !== ghostId) return card;
					retryRequest = card.request;
					return {
						...card,
						status: 'creating',
						errorMessage: undefined,
					};
				})
			);
			if (retryRequest) {
				void createWorkItemWithOptimisticState(ghostId, retryRequest);
			}
		},
		[createWorkItemWithOptimisticState]
	);

	const handleDropToLane = useCallback(
		async (event: DragEvent<HTMLDivElement>, lane: KanbanLane) => {
			event.preventDefault();
			const raw = event.dataTransfer.getData('application/x-maestro-kanban-item-id');
			const ticketId = Number(raw);
			if (!Number.isFinite(ticketId) || ticketId <= 0) return;
			try {
				await adoService.moveItemToColumn(ticketId, lane, activeTeamOverride || undefined);
				if (lane === 'Review' || lane === 'Closed') {
					const runningPreview = previewByTicket[ticketId];
					if (runningPreview) {
						setPreviewByTicket((prev) => {
							const next = { ...prev };
							delete next[ticketId];
							return next;
						});
						void adoService.stopPreview({
							worktreePath: runningPreview.worktreePath,
							mfeName: runningPreview.mfeName,
						});
					}
				}
				await refreshBoard();
			} catch (moveError) {
				setError(moveError instanceof Error ? moveError.message : 'Failed to move work item.');
			}
		},
		[activeTeamOverride, previewByTicket, refreshBoard]
	);

	const handleStartPreview = useCallback(
		async (item: AdoBoardItem) => {
			const context = previewContextByTicket[item.id];
			if (!context?.worktreePath || !context?.mfeName) {
				setPreviewByTicket((prev) => ({
					...prev,
					[item.id]: {
						status: 'error',
						running: false,
						worktreePath: '',
						mfeName: '',
						error: 'No worktree found for this ticket. Run the ticket first.',
					},
				}));
				return;
			}

			setPreviewByTicket((prev) => ({
				...prev,
				[item.id]: {
					status: 'starting',
					running: false,
					worktreePath: context.worktreePath,
					mfeName: context.mfeName,
				},
			}));
			try {
				const status = await adoService.getPreviewStatus({
					worktreePath: context.worktreePath,
					mfeName: context.mfeName,
				});
				if (status.running && status.url) {
					setPreviewByTicket((prev) => ({
						...prev,
						[item.id]: {
							status: 'running',
							...status,
							worktreePath: context.worktreePath,
							mfeName: context.mfeName,
						},
					}));
					return;
				}

				const result = await adoService.startPreview({
					worktreePath: context.worktreePath,
					mfeName: context.mfeName,
				});
				setPreviewByTicket((prev) => ({
					...prev,
					[item.id]: {
						status: 'running',
						running: true,
						port: result.port,
						url: result.url,
						worktreePath: context.worktreePath,
						mfeName: context.mfeName,
					},
				}));
			} catch (previewError) {
				setPreviewByTicket((prev) => ({
					...prev,
					[item.id]: {
						status: 'error',
						running: false,
						worktreePath: context.worktreePath,
						mfeName: context.mfeName,
						error:
							previewError instanceof Error ? previewError.message : 'Failed to start preview server.',
					},
				}));
			}
		},
		[previewContextByTicket]
	);

	useEffect(() => {
		const ticketLaneMap = new Map<number, KanbanLane>();
		for (const item of snapshot?.items || []) {
			ticketLaneMap.set(item.id, item.lane);
		}

		const toStop: Array<{ ticketId: number; worktreePath: string; mfeName: string }> = [];
		for (const [ticketIdText, preview] of Object.entries(previewByTicket)) {
			const ticketId = Number(ticketIdText);
			const lane = ticketLaneMap.get(ticketId);
			if (lane === 'Active') continue;
			toStop.push({
				ticketId,
				worktreePath: preview.worktreePath,
				mfeName: preview.mfeName,
			});
		}

		if (toStop.length === 0) return;
		setPreviewByTicket((prev) => {
			const next = { ...prev };
			for (const preview of toStop) {
				delete next[preview.ticketId];
			}
			return next;
		});
		for (const preview of toStop) {
			void adoService.stopPreview({
				worktreePath: preview.worktreePath,
				mfeName: preview.mfeName,
			});
		}
	}, [previewByTicket, snapshot]);

	useEffect(
		() => () => {
			for (const preview of Object.values(previewByTicketRef.current)) {
				void adoService.stopPreview({
					worktreePath: preview.worktreePath,
					mfeName: preview.mfeName,
				});
			}
		},
		[]
	);

	const handleDesignContextChange = useCallback(
		(
			ticketId: number,
			url: string,
			verifiedNodeName?: string,
			image?: { imagePath?: string; imageUrl?: string }
		) => {
			setDesignContextByTicket((prev) => {
				const next = { ...prev };
				const trimmedUrl = url.trim();
				if (!trimmedUrl) {
					delete next[ticketId];
					return next;
				}
				const previous = next[ticketId];
				next[ticketId] = {
					url,
					verifiedNodeName: verifiedNodeName ?? previous?.verifiedNodeName,
					imagePath: image?.imagePath ?? previous?.imagePath,
					imageUrl: image?.imageUrl ?? previous?.imageUrl,
				};
				return next;
			});
		},
		[]
	);

	const handleRunTicket = useCallback(
		async (item: AdoBoardItem) => {
			if (!onRunTicket) {
				setError('Ticket execution is unavailable in this view.');
				return;
			}
			setError(null);
			setRunningTicketIds((prev) => ({ ...prev, [item.id]: true }));
			try {
				await onRunTicket(item);
			} catch (runError) {
				setError(
					runError instanceof Error
						? runError.message
						: `Failed to run ticket #${item.id}.`
				);
			} finally {
				setRunningTicketIds((prev) => {
					const next = { ...prev };
					delete next[item.id];
					return next;
				});
			}
		},
		[onRunTicket]
	);

	const handleQuickPr = useCallback(
		async (item: AdoBoardItem) => {
			if (!onQuickPrTicket) {
				setError('Quick PR is unavailable in this view.');
				return;
			}
			setError(null);
			setQuickPrTicketIds((prev) => ({ ...prev, [item.id]: true }));
			try {
				await onQuickPrTicket(item);
			} catch (quickPrError) {
				setError(
					quickPrError instanceof Error
						? quickPrError.message
						: `Failed to create quick PR for #${item.id}.`
				);
			} finally {
				setQuickPrTicketIds((prev) => {
					const next = { ...prev };
					delete next[item.id];
					return next;
				});
			}
		},
		[onQuickPrTicket]
	);

	const handleMergeAndComplete = useCallback(
		async (item: AdoBoardItem, prId?: number) => {
			if (!onMergeCompleteTicket) {
				setError('Merge & Complete is unavailable in this view.');
				return;
			}
			setError(null);
			setMergeCompleteTicketIds((prev) => ({ ...prev, [item.id]: true }));
			try {
				await onMergeCompleteTicket(item, prId);
			} catch (mergeError) {
				setError(
					mergeError instanceof Error
						? mergeError.message
						: `Failed to merge and complete ticket #${item.id}.`
				);
			} finally {
				setMergeCompleteTicketIds((prev) => {
					const next = { ...prev };
					delete next[item.id];
					return next;
				});
			}
		},
		[onMergeCompleteTicket]
	);

	const attachContextItem = useMemo(
		() => snapshot?.items.find((item) => item.id === attachContextTicketId) || null,
		[attachContextTicketId, snapshot]
	);

	const handleSaveAttachedContext = useCallback(
		async (selectedPaths: string[]) => {
			if (!attachContextItem) return;
			try {
				await adoService.updateWorkItemAttachedContext({
					ticketId: attachContextItem.id,
					attachedContextPaths: selectedPaths,
				});
				setSnapshot((prev) => {
					if (!prev) return prev;
					return {
						...prev,
						items: prev.items.map((item) =>
							item.id === attachContextItem.id ? { ...item, attachedContextPaths: selectedPaths } : item
						),
					};
				});
				setAttachContextTicketId(null);
			} catch (saveError) {
				setError(
					saveError instanceof Error
						? saveError.message
						: `Failed to save attached context for #${attachContextItem.id}.`
				);
			}
		},
		[attachContextItem]
	);

	return (
		<>
			<div className="h-full flex flex-col gap-3">
			<div className="rounded border p-3 mt-3 space-y-2" style={{ borderColor: theme.colors.border }}>
				<div className="flex items-center justify-between gap-2">
					<div>
						<div className="text-xs font-semibold uppercase" style={{ color: theme.colors.textDim }}>
							Kanban Flow
						</div>
						<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
							{organization && project ? `${organization} / ${project}` : 'Azure DevOps not configured'}
						</div>
					</div>
					<button
						onClick={() => void refreshBoard(boardNameInput.trim() || undefined)}
						disabled={isLoading || !hasPat}
						className="px-2.5 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
						Refresh
					</button>
				</div>
				<div className="flex items-center gap-2">
					<label className="text-[11px]" style={{ color: theme.colors.textDim }}>
						Team
					</label>
					<input
						value={boardNameInput}
						onChange={(event) => setBoardNameInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								void refreshBoard(boardNameInput.trim() || undefined);
							}
						}}
						className="w-full rounded border px-2 py-1.5 text-xs bg-transparent outline-none"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						placeholder={activeTeamOverride || team || 'CacheFlow-Frontend'}
					/>
				</div>
				<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
					Active team override: {activeTeamOverride || '(default from ADO settings)'} | Board:{' '}
					{snapshot?.boardName || 'Stories'}
				</div>
				{!hasPat && (
					<div className="text-xs rounded p-2" style={{ backgroundColor: `${theme.colors.warning}20`, color: theme.colors.warning }}>
						Save ADO credentials in Sprint Planning before using Kanban Flow.
					</div>
				)}
				{error && (
					<div className="text-xs rounded p-2 flex items-start gap-1.5" style={{ backgroundColor: `${theme.colors.error}20`, color: theme.colors.error }}>
						<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
						{error}
					</div>
				)}
			</div>

			<div className="overflow-x-auto flex-1">
				<div className="min-w-[90rem] grid grid-flow-col auto-cols-[minmax(17rem,1fr)] gap-3 h-full">
					{LANES.map((lane, index) => (
						<div
							key={lane}
							className="rounded border h-full min-h-[24rem] flex flex-col"
							style={{ borderColor: theme.colors.border, backgroundColor: `${theme.colors.bgActivity}88` }}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => void handleDropToLane(event, lane)}
						>
							<KanbanColumnHeader
								theme={theme}
								lane={lane}
								isFirstColumn={index === 0}
								itemCount={groupedItems[lane].length + ghostCardsByLane[lane].length}
								taskProfile={quickAddProfile}
								onTaskProfileChange={setQuickAddProfile}
								onOpenQuickAdd={() => setQuickAddModalOpen(true)}
							/>
							<div className="px-2 pb-1 text-[10px]" style={{ color: theme.colors.textDim }}>
								{laneDescription(lane)}
							</div>
							<div className="p-2 space-y-2 overflow-y-auto">
								{ghostCardsByLane[lane].map((ghost) => (
									<div
										key={ghost.ghostId}
										className="rounded border p-2"
										style={{
											borderColor:
												ghost.status === 'error' ? theme.colors.error : theme.colors.accent,
											backgroundColor:
												ghost.status === 'error'
													? `${theme.colors.error}20`
													: `${theme.colors.accent}12`,
										}}
									>
										<div className="text-xs font-semibold leading-4" style={{ color: theme.colors.textMain }}>
											{ghost.request.title}
										</div>
										<div className="mt-1 text-[10px]" style={{ color: theme.colors.textDim }}>
											{ghost.request.type}
											{` • ${getTaskProfileIcon(ghost.request.taskProfile)} ${ghost.request.taskProfile}`}
											{ghost.request.areaPath ? ` • ${ghost.request.areaPath}` : ''}
										</div>
										{ghost.status === 'creating' && (
											<div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: theme.colors.textDim }}>
												<Loader2 className="w-3 h-3 animate-spin" />
												Creating...
											</div>
										)}
										{ghost.status === 'error' && (
											<div className="mt-2 flex items-center justify-between gap-2">
												<div className="text-[10px]" style={{ color: theme.colors.error }}>
													{ghost.errorMessage || 'Create failed.'}
												</div>
												<button
													type="button"
													onClick={() => retryGhostCard(ghost.ghostId)}
													className="px-2 py-0.5 rounded border text-[10px] font-semibold"
													style={{
														borderColor: theme.colors.error,
														color: theme.colors.error,
													}}
												>
													Retry
												</button>
											</div>
										)}
									</div>
								))}
								{groupedItems[lane].map((item) => (
									<KanbanCard
										key={item.id}
										theme={theme}
										item={item}
										lane={lane}
										taskProfileIcon={getTaskProfileIcon(item.taskProfile || resolveTaskProfile(item.tags))}
										liveStatus={liveStatusByTicket[item.id]}
										cardError={errorByTicket[item.id]}
										prUrl={prUrlByTicket[item.id]}
										designContextUrl={designContextByTicket[item.id]?.url || ''}
										designContextImageUrl={designContextByTicket[item.id]?.imageUrl}
										designContextImagePath={designContextByTicket[item.id]?.imagePath}
										onDesignContextChange={handleDesignContextChange}
										onAttachContext={(targetItem) => setAttachContextTicketId(targetItem.id)}
										attachedContextCount={item.attachedContextPaths?.length || 0}
										onRunTicket={handleRunTicket}
										isExecuting={Boolean(runningTicketIds[item.id])}
										onQuickPr={handleQuickPr}
										isQuickPring={Boolean(quickPrTicketIds[item.id])}
										prId={prIdByTicket[item.id]}
										onMergeAndComplete={handleMergeAndComplete}
										isMergeCompleting={Boolean(mergeCompleteTicketIds[item.id])}
										previewState={previewByTicket[item.id]}
										onStartPreview={handleStartPreview}
									/>
								))}
								{groupedItems[lane].length === 0 && ghostCardsByLane[lane].length === 0 && (
									<div className="text-[11px] px-2 py-4 text-center" style={{ color: theme.colors.textDim }}>
										No items
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
			</div>
			<QuickAddModal
				theme={theme}
				isOpen={quickAddModalOpen}
				focusToken={quickAddFocusToken}
				initialType="User Story"
				initialTaskProfile={quickAddProfile}
				onClose={() => setQuickAddModalOpen(false)}
				onSubmit={handleQuickAdd}
			/>
			<FileContextPickerModal
				theme={theme}
				isOpen={Boolean(attachContextItem)}
				monorepoRoot={monorepoRoot}
				title={
					attachContextItem
						? `Attach Context • #${attachContextItem.id} ${attachContextItem.title}`
						: 'Attach Context'
				}
				initialSelectedPaths={attachContextItem?.attachedContextPaths || []}
				onClose={() => setAttachContextTicketId(null)}
				onSave={(paths) => {
					void handleSaveAttachedContext(paths);
				}}
			/>
		</>
	);
}

export default KanbanBoard;
