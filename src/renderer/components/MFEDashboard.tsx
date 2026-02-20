import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	GitBranch,
	RefreshCw,
	FolderTree,
	Puzzle,
	Package,
	Maximize2,
	X,
	Play,
	Terminal,
	Search,
	Brain,
} from 'lucide-react';
import type { Theme } from '../types';
import { mfeService, type MfePackageInfo, type MfePackageRole, type MfeProposal } from '../services/mfe';
import { adoService, type AdoSprintWorkItem } from '../services/ado';
import { signalService, type SignalState } from '../services/signal';
import { ProposedTaskCard } from './ProposedTaskCard';
import { SprintProvider, useSprintContext } from '../contexts/SprintContext';
import { MfeFocusWorkspace, type QuickAddDraft } from './MfeFocusWorkspace';
import { FileContextPickerModal } from './FileContextPickerModal';
import { SprintCommandCenterModal } from './SprintCommandCenterModal';
import { notifyToast } from '../stores/notificationStore';
import { useSessionStore } from '../stores/sessionStore';
import type {
	OrchestratorState,
	SprintExecutionPlan,
	SprintExecutionResult,
	WorkerActionType,
} from '../../shared/orchestrator-types';
import { getTaskProfileIcon, resolveTaskProfile } from '../../shared/task-routing';

export interface MFEDashboardAssignPayload {
	packageName: string;
	packagePath: string;
	role: MfePackageRole;
	agentId: string;
}

export interface MFEDashboardWorkItemPayload {
	packageName: string;
	packagePath: string;
	role: MfePackageRole;
	workItem: AdoSprintWorkItem;
}

export interface MFEDashboardExecutePayload extends MFEDashboardWorkItemPayload {
	agentId: string;
}

export interface MFEDashboardExecuteResult {
	sessionId: string;
	tabId: string;
}

interface MFEDashboardProps {
	theme: Theme;
	monorepoRoot: string;
	availableAgents?: Array<{ id: string; name: string }>;
	initialAssignments?: Record<string, string>;
	onAssignAgent?: (payload: MFEDashboardAssignPayload) => void;
	onDropWorkItem?: (payload: MFEDashboardWorkItemPayload) => void;
	onExecuteTask?: (payload: MFEDashboardExecutePayload) => Promise<MFEDashboardExecuteResult>;
	onViewAgentTerminal?: (sessionId: string, tabId: string) => void;
	onEnsureWorkerAgent?: (payload: {
		packageName: string;
		packagePath: string;
		action: WorkerActionType;
		suggestedName: string;
		suggestedType: string;
		existingSessionId?: string;
	}) => Promise<{ sessionId: string; name: string }>;
	onClose?: () => void;
}

const ROLE_LABELS: Record<MfePackageRole, string> = {
	host: 'Host',
	remote: 'Remotes',
	shared: 'Shared',
};

const ROLE_ICONS: Record<MfePackageRole, typeof FolderTree> = {
	host: FolderTree,
	remote: Puzzle,
	shared: Package,
};

type TaskExecutionState = {
	status: 'idle' | 'initializing' | 'running' | 'error';
	sessionId?: string;
	tabId?: string;
	error?: string;
};

type ProposalScanState = {
	status: 'idle' | 'scanning' | 'error';
	error?: string;
};

type ProposedTaskItem = MfeProposal & { id: string };

function roleOrder(role: MfePackageRole): number {
	if (role === 'host') return 0;
	if (role === 'remote') return 1;
	return 2;
}

function taskKey(packagePath: string, workItemId: number): string {
	return `${packagePath}::${workItemId}`;
}

function proposalId(pkgPath: string, proposal: MfeProposal, index: number): string {
	const slug = `${proposal.title}-${proposal.location}-${proposal.type}-${index}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `${pkgPath}::${slug || index}`;
}

function shortFileName(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/');
	const segments = normalized.split('/');
	return segments[segments.length - 1] || normalized;
}

function parseDroppedAgentId(event: React.DragEvent<HTMLDivElement>): string | null {
	const jsonPayload = event.dataTransfer.getData('application/json');
	if (jsonPayload) {
		try {
			const parsed = JSON.parse(jsonPayload) as { id?: string; sessionId?: string; type?: string };
			if (parsed.type === 'ado-work-item') return null;
			return parsed.id || parsed.sessionId || null;
		} catch {
			// fall through
		}
	}

	const plain = event.dataTransfer.getData('text/plain');
	return plain?.trim() || null;
}

function parseDroppedWorkItem(event: React.DragEvent<HTMLDivElement>): AdoSprintWorkItem | null {
	const custom = event.dataTransfer.getData('application/x-maestro-ado-work-item');
	const jsonPayload = custom || event.dataTransfer.getData('application/json');
	if (!jsonPayload) return null;

	try {
		const parsed = JSON.parse(jsonPayload) as Partial<AdoSprintWorkItem> & { type?: string };
		if (parsed.type !== 'ado-work-item' || typeof parsed.id !== 'number') return null;
		return {
			id: parsed.id,
			title: parsed.title || `Work Item #${parsed.id}`,
			description: parsed.description || '',
			acceptanceCriteria: parsed.acceptanceCriteria || '',
			state: parsed.state || 'Unknown',
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
			url: parsed.url || '',
		};
	} catch {
		return null;
	}
}

function MfeTaskCard({
	theme,
	pkg,
	workItem,
	agentAssigned,
	executionState,
	onExecute,
	onViewTerminal,
	onRemove,
}: {
	theme: Theme;
	pkg: MfePackageInfo;
	workItem: AdoSprintWorkItem;
	agentAssigned: boolean;
	executionState: TaskExecutionState;
	onExecute: () => void;
	onViewTerminal: () => void;
	onRemove: () => void;
}) {
	const statusLabel =
		executionState.status === 'initializing'
			? 'Initializing...'
			: executionState.status === 'running'
				? 'Running'
				: executionState.status === 'error'
					? executionState.error || 'Execution failed'
					: 'Ready';
	const canExecute = executionState.status !== 'initializing' && executionState.status !== 'running';
	const taskProfile = resolveTaskProfile(workItem.tags || []);

	return (
		<div
			className="rounded border px-2 py-2 space-y-2"
			style={{ borderColor: theme.colors.border, backgroundColor: `${theme.colors.accent}14` }}
		>
			<div
				className="text-[11px] font-semibold flex items-center gap-1.5"
				style={{ color: theme.colors.textMain }}
				title={workItem.title}
			>
				<span className="text-[12px]" title={`Task Profile: ${taskProfile}`}>
					{getTaskProfileIcon(taskProfile)}
				</span>
				<span className="truncate">
				{workItem.id > 0 ? `#${workItem.id}` : 'Planned'} {workItem.title}
				</span>
			</div>
			<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
				{statusLabel}
			</div>
			<div className="flex items-center gap-2">
				{executionState.status === 'running' && executionState.sessionId && executionState.tabId ? (
					<button
						type="button"
						onClick={onViewTerminal}
						className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold border flex items-center justify-center gap-1.5"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						<Terminal className="w-3.5 h-3.5" />
						View Agent Terminal
					</button>
				) : (
					<button
						type="button"
						onClick={onExecute}
						disabled={!agentAssigned || !canExecute}
						className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold border flex items-center justify-center gap-1.5 disabled:opacity-60"
						style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
					>
						<Play className="w-3.5 h-3.5" />
						Execute
					</button>
				)}
				<button
					type="button"
					onClick={onRemove}
					className="px-2 py-1.5 rounded text-[11px] font-semibold border"
					style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
				>
					Remove
				</button>
			</div>
			<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
				<p className="truncate">Path: {pkg.rootPath}</p>
			</div>
		</div>
	);
}

function MfeCard({
	theme,
	pkg,
	assignedAgentName,
	assignedWorkItems,
	proposedItems,
	rejectingProposalIds,
	taskStates,
	scanState,
	onScanForProposals,
	onApproveProposal,
	onRejectProposal,
	onDropAgent,
	onDropWorkItem,
	onExecuteTask,
	onViewTaskTerminal,
	onFocus,
	onRemoveWorkItem,
}: {
	theme: Theme;
	pkg: MfePackageInfo;
	assignedAgentName?: string;
	assignedWorkItems?: AdoSprintWorkItem[];
	proposedItems?: ProposedTaskItem[];
	rejectingProposalIds?: Set<string>;
	taskStates: Record<string, TaskExecutionState>;
	scanState?: ProposalScanState;
	onScanForProposals: (pkg: MfePackageInfo) => void;
	onApproveProposal: (pkg: MfePackageInfo, proposal: ProposedTaskItem) => void;
	onRejectProposal: (pkg: MfePackageInfo, proposal: ProposedTaskItem) => void;
	onDropAgent: (pkg: MfePackageInfo, agentId: string) => void;
	onDropWorkItem: (pkg: MfePackageInfo, workItem: AdoSprintWorkItem) => void;
	onExecuteTask: (pkg: MfePackageInfo, workItem: AdoSprintWorkItem) => void;
	onViewTaskTerminal: (pkg: MfePackageInfo, workItem: AdoSprintWorkItem) => void;
	onFocus: (pkg: MfePackageInfo) => void;
	onRemoveWorkItem: (pkg: MfePackageInfo, workItemId: number) => void;
}) {
	return (
		<div
			className="rounded-lg border p-3 space-y-2"
			style={{
				backgroundColor: theme.colors.bgActivity,
				borderColor: theme.colors.border,
			}}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="font-semibold text-sm truncate" style={{ color: theme.colors.textMain }}>
						{pkg.name}
					</div>
					<div className="text-xs truncate" style={{ color: theme.colors.textDim }} title={pkg.rootPath}>
						{pkg.rootPath}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => onFocus(pkg)}
						className="p-1.5 rounded border"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						title={`Focus ${pkg.name}`}
						aria-label={`Focus ${pkg.name}`}
					>
						<Maximize2 className="w-3.5 h-3.5" />
					</button>
					{/* <span
						className="text-[10px] px-2 py-0.5 rounded uppercase font-bold"
						style={{
							backgroundColor: `${theme.colors.accent}20`,
							color: theme.colors.accent,
						}}
					>
						{pkg.role}
					</span> */}
					<button
						type="button"
						onClick={() => onScanForProposals(pkg)}
						disabled={scanState?.status === 'scanning'}
						className="px-2 py-1 rounded text-[10px] border font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						<Search className={`w-3 h-3 ${scanState?.status === 'scanning' ? 'animate-pulse' : ''}`} />
						Scan
					</button>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2 text-xs">
				<div
					className="rounded px-2 py-1 border flex items-center gap-1.5"
					style={{ borderColor: theme.colors.border }}
				>
					<GitBranch className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />
					<span style={{ color: theme.colors.textMain }}>{pkg.git.branch || 'N/A'}</span>
				</div>
				<div className="rounded px-2 py-1 border" style={{ borderColor: theme.colors.border }}>
					<span style={{ color: theme.colors.textDim }}>Pending:</span>{' '}
					<span style={{ color: theme.colors.textMain }}>{pkg.git.pendingChanges}</span>
				</div>
			</div>

			<div
				className="rounded border border-dashed px-2 py-2 text-xs transition-colors"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textDim,
				}}
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => {
					event.preventDefault();
					const workItem = parseDroppedWorkItem(event);
					if (workItem) {
						onDropWorkItem(pkg, workItem);
						return;
					}
					const agentId = parseDroppedAgentId(event);
					if (!agentId) return;
					onDropAgent(pkg, agentId);
				}}
			>
				<div>
					{assignedAgentName ? (
						<>
							Assigned Agent:{' '}
							<span style={{ color: theme.colors.textMain, fontWeight: 600 }}>
								{assignedAgentName}
							</span>
						</>
					) : (
						'Drop Agent or Sprint Item'
					)}
				</div>
			</div>

			{scanState?.status === 'error' && scanState.error && (
				<div className="text-[10px]" style={{ color: theme.colors.error }}>
					{scanState.error}
				</div>
			)}

			{proposedItems && proposedItems.length > 0 && (
				<div className="space-y-2">
					<div className="pt-1 border-t text-[10px] font-semibold uppercase" style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}>
						Suggestions
					</div>
					{proposedItems.map((proposal) => (
						<ProposedTaskCard
							key={proposal.id}
							theme={theme}
							proposal={proposal}
							isRejecting={Boolean(rejectingProposalIds?.has(proposal.id))}
							onApprove={() => onApproveProposal(pkg, proposal)}
							onReject={() => onRejectProposal(pkg, proposal)}
						/>
					))}
				</div>
			)}

			{assignedWorkItems && assignedWorkItems.length > 0 && (
				<div className="space-y-2">
					<div className="text-[10px] font-semibold uppercase" style={{ color: theme.colors.textDim }}>
						Linked Work Items
					</div>
					{assignedWorkItems.map((workItem) => (
						<MfeTaskCard
							key={taskKey(pkg.rootPath, workItem.id)}
							theme={theme}
							pkg={pkg}
							workItem={workItem}
							agentAssigned={Boolean(assignedAgentName)}
							executionState={taskStates[taskKey(pkg.rootPath, workItem.id)] || { status: 'idle' }}
							onExecute={() => onExecuteTask(pkg, workItem)}
							onViewTerminal={() => onViewTaskTerminal(pkg, workItem)}
							onRemove={() => onRemoveWorkItem(pkg, workItem.id)}
						/>
					))}
				</div>
			)}

			<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
				{pkg.detectionReason}
			</div>
		</div>
	);
}

function MFEDashboardContent({
	theme,
	monorepoRoot,
	availableAgents = [],
	initialAssignments = {},
	onAssignAgent,
	onDropWorkItem,
	onExecuteTask,
	onViewAgentTerminal,
	onEnsureWorkerAgent,
	onClose,
}: MFEDashboardProps) {
	const { focusedMfeId, setFocusedMfeId } = useSprintContext();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [packages, setPackages] = useState<MfePackageInfo[]>([]);
	const [assignments, setAssignments] = useState<Record<string, string>>(initialAssignments);
	const [workItemAssignments, setWorkItemAssignments] = useState<Record<string, AdoSprintWorkItem[]>>({});
	const [proposedItems, setProposedItems] = useState<Record<string, ProposedTaskItem[]>>({});
	const [proposalScanStates, setProposalScanStates] = useState<Record<string, ProposalScanState>>({});
	const [rejectingProposalIds, setRejectingProposalIds] = useState<Record<string, Set<string>>>({});
	const [taskStates, setTaskStates] = useState<Record<string, TaskExecutionState>>({});
	const [attachContextTicketId, setAttachContextTicketId] = useState<number | null>(null);
	const [commandCenterOpen, setCommandCenterOpen] = useState(false);
	const [orchestratorState, setOrchestratorState] = useState<OrchestratorState>('ready');
	const [orchestrationPlan, setOrchestrationPlan] = useState<SprintExecutionPlan | null>(null);
	const [orchestrationExecution, setOrchestrationExecution] = useState<SprintExecutionResult | null>(null);
	const [orchestrationError, setOrchestrationError] = useState<string | null>(null);
	const [signalState, setSignalState] = useState<SignalState>({ locks: {}, announcements: [] });
	const proposalToPlannedIdCounter = useRef(-1);
	const sessions = useSessionStore((state) => state.sessions);

	useEffect(() => {
		setAssignments(initialAssignments);
	}, [initialAssignments]);

	useEffect(() => {
		let mounted = true;
		void signalService
			.getState()
			.then((state) => {
				if (mounted) setSignalState(state);
			})
			.catch(() => {
				// Live signals are optional in this view.
			});

		const unsubscribe = signalService.onStateUpdated((state) => {
			if (mounted) setSignalState(state);
		});

		return () => {
			mounted = false;
			unsubscribe();
		};
	}, []);

	const scanWorkspace = useCallback(async () => {
		if (!monorepoRoot) {
			setPackages([]);
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const result = await mfeService.scanWorkspace(monorepoRoot);
			setPackages(result.packages);
		} catch (scanError) {
			setError(scanError instanceof Error ? scanError.message : 'Failed to scan MFE workspace');
		} finally {
			setIsLoading(false);
		}
	}, [monorepoRoot]);

	useEffect(() => {
		scanWorkspace();
	}, [scanWorkspace]);

	useEffect(() => {
		if (focusedMfeId && !packages.some((pkg) => pkg.rootPath === focusedMfeId)) {
			setFocusedMfeId(null);
		}
	}, [focusedMfeId, packages, setFocusedMfeId]);

	const grouped = useMemo(() => {
		const groups: Record<MfePackageRole, MfePackageInfo[]> = {
			host: [],
			remote: [],
			shared: [],
		};

		for (const pkg of packages) {
			groups[pkg.role].push(pkg);
		}

		for (const role of Object.keys(groups) as MfePackageRole[]) {
			groups[role].sort((a, b) => a.name.localeCompare(b.name));
		}

		return groups;
	}, [packages]);

	const agentNameById = useMemo(
		() =>
			Object.fromEntries(availableAgents.map((agent) => [agent.id, agent.name])) as Record<string, string>,
		[availableAgents]
	);

	const focusedPackage = useMemo(
		() => (focusedMfeId ? packages.find((pkg) => pkg.rootPath === focusedMfeId) || null : null),
		[focusedMfeId, packages]
	);

	const globalBacklogItems = useMemo(() => {
		const byId = new Map<number, AdoSprintWorkItem>();
		for (const packageItems of Object.values(workItemAssignments)) {
			for (const item of packageItems) {
				if (!byId.has(item.id)) {
					byId.set(item.id, item);
				}
			}
		}
		return Array.from(byId.values()).sort((a, b) => {
			const aPlanned = a.id < 0;
			const bPlanned = b.id < 0;
			if (aPlanned !== bPlanned) return aPlanned ? 1 : -1;
			return a.id - b.id;
		});
	}, [workItemAssignments]);

	const signalTickerItems = useMemo(() => {
		const lockItems = Object.entries(signalState.locks).map(([filePath, agentId]) => ({
			id: `lock:${filePath}:${agentId}`,
			kind: 'lock' as const,
			message: `🔒 ${agentId} locked ${shortFileName(filePath)}`,
		}));
		const announcementItems = [...signalState.announcements]
			.slice(-12)
			.reverse()
			.map((entry, index) => ({
				id: `announcement:${entry.timestamp}:${index}`,
				kind: 'announcement' as const,
				message: `📢 ${entry.agentId}: ${entry.message}`,
			}));
		return [...lockItems, ...announcementItems];
	}, [signalState]);

	const unlinkWorkItem = useCallback((packagePath: string, workItemId: number) => {
		setWorkItemAssignments((prev) => {
			const existing = prev[packagePath] || [];
			const nextItems = existing.filter((item) => item.id !== workItemId);
			if (nextItems.length === existing.length) return prev;
			if (nextItems.length === 0) {
				const next = { ...prev };
				delete next[packagePath];
				return next;
			}
			return {
				...prev,
				[packagePath]: nextItems,
			};
		});

		setTaskStates((prev) => {
			const key = taskKey(packagePath, workItemId);
			if (!(key in prev)) return prev;
			const next = { ...prev };
			delete next[key];
			return next;
		});
	}, []);

	const runTask = useCallback(
		async (pkg: MfePackageInfo, workItem: AdoSprintWorkItem) => {
			const key = taskKey(pkg.rootPath, workItem.id);
			const agentId = assignments[pkg.rootPath];
			if (!agentId || !onExecuteTask) {
				setTaskStates((prev) => ({
					...prev,
					[key]: {
						status: 'error',
						error: !agentId ? 'Assign an agent before executing.' : 'Execute handler unavailable.',
					},
				}));
				return;
			}

			setTaskStates((prev) => ({
				...prev,
				[key]: { status: 'initializing' },
			}));

			try {
				const result = await onExecuteTask({
					packageName: pkg.name,
					packagePath: pkg.rootPath,
					role: pkg.role,
					workItem,
					agentId,
				});
				setTaskStates((prev) => ({
					...prev,
					[key]: {
						status: 'running',
						sessionId: result.sessionId,
						tabId: result.tabId,
					},
				}));
			} catch (executionError) {
				setTaskStates((prev) => ({
					...prev,
					[key]: {
						status: 'error',
						error:
							executionError instanceof Error
								? executionError.message
								: 'Failed to execute task.',
					},
				}));
			}
		},
		[assignments, onExecuteTask]
	);

	const runRoleBatch = useCallback(
		async (role: MfePackageRole) => {
			const rolePackages = grouped[role];
			const tasks = rolePackages.flatMap((pkg) =>
				(workItemAssignments[pkg.rootPath] || []).map((workItem) => ({ pkg, workItem }))
			);
			await Promise.all(tasks.map((task) => runTask(task.pkg, task.workItem)));
		},
		[grouped, runTask, workItemAssignments]
	);

	const startSprint = useCallback(async () => {
		if (!monorepoRoot) {
			setOrchestrationError('Monorepo root is required to start sprint orchestration.');
			setCommandCenterOpen(true);
			setOrchestratorState('error');
			return;
		}

		setCommandCenterOpen(true);
		setOrchestrationError(null);
		setOrchestrationPlan(null);
		setOrchestrationExecution(null);
		setOrchestratorState('planning');

		try {
			const plan = await adoService.generateSprintPlan({
				monorepoRoot,
			});
			setOrchestrationPlan(plan);
			if (plan.contextRefreshed) {
				notifyToast({
					type: 'info',
					title: '♻️ Orchestrator context refreshed',
					message: 'Previous planning history was condensed and restored.',
				});
			}
			setOrchestratorState('delegating');

			const execution = await adoService.executeSprintPlan(plan);
			setOrchestrationExecution(execution);

			const nextAssignments: Record<string, string> = {};
			for (const worker of execution.workers) {
				let ensuredSessionId = worker.workerSessionId;
				if (onEnsureWorkerAgent) {
					const ensured = await onEnsureWorkerAgent({
						packageName: worker.packageName,
						packagePath: worker.packagePath,
						action: worker.action,
						suggestedName: worker.workerName,
						suggestedType: worker.workerType,
						existingSessionId: worker.workerSessionId,
					});
					ensuredSessionId = ensured.sessionId;
				}
				if (ensuredSessionId) {
					nextAssignments[worker.packagePath] = ensuredSessionId;
				}
			}

			setAssignments((prev) => ({ ...prev, ...nextAssignments }));
			setWorkItemAssignments((prev) => {
				const next = { ...prev };
				for (const pkg of plan.packages) {
					const mappedItems: AdoSprintWorkItem[] = pkg.tasks.map((task) => ({
						id: task.id,
						title: task.title,
						description: task.description,
						acceptanceCriteria: task.acceptanceCriteria,
						state: task.state,
						tags: task.tags,
						url: task.url,
					}));
					next[pkg.packagePath] = mappedItems;
				}
				return next;
			});

			setOrchestratorState('ready');
		} catch (error) {
			setOrchestratorState('error');
			setOrchestrationError(
				error instanceof Error ? error.message : 'Sprint orchestration failed.'
			);
		}
	}, [monorepoRoot, onEnsureWorkerAgent]);

	const scanForProposals = useCallback(async (pkg: MfePackageInfo) => {
		setProposalScanStates((prev) => ({
			...prev,
			[pkg.rootPath]: { status: 'scanning' },
		}));

		try {
			const proposals = await mfeService.scanForProposals(pkg.rootPath);
			setProposedItems((prev) => ({
				...prev,
				[pkg.rootPath]: proposals.map((proposal, index) => ({
					...proposal,
					id: proposalId(pkg.rootPath, proposal, index),
				})),
			}));
			setProposalScanStates((prev) => ({
				...prev,
				[pkg.rootPath]: { status: 'idle' },
			}));
		} catch (scanError) {
			setProposalScanStates((prev) => ({
				...prev,
				[pkg.rootPath]: {
					status: 'error',
					error: scanError instanceof Error ? scanError.message : 'Failed to scan for proposals.',
				},
			}));
		}
	}, []);

	const approveProposal = useCallback(
		(pkg: MfePackageInfo, proposal: ProposedTaskItem) => {
			setProposedItems((prev) => ({
				...prev,
				[pkg.rootPath]: (prev[pkg.rootPath] || []).filter((candidate) => candidate.id !== proposal.id),
			}));

			const nextId = proposalToPlannedIdCounter.current;
			proposalToPlannedIdCounter.current -= 1;
			const plannedItem: AdoSprintWorkItem = {
				id: nextId,
				title: proposal.title,
				description: `${proposal.description}\nLocation: ${proposal.location}`,
				acceptanceCriteria: '',
				state: 'Planned',
				tags: ['AI Proposal', proposal.type, proposal.priority],
				url: '',
			};

			setWorkItemAssignments((prev) => ({
				...prev,
				[pkg.rootPath]: [plannedItem, ...(prev[pkg.rootPath] || [])],
			}));
		},
		[]
	);

	const rejectProposal = useCallback((pkg: MfePackageInfo, proposal: ProposedTaskItem) => {
		setRejectingProposalIds((prev) => {
			const next = new Set(prev[pkg.rootPath] || []);
			next.add(proposal.id);
			return { ...prev, [pkg.rootPath]: next };
		});

		window.setTimeout(() => {
			setProposedItems((prev) => ({
				...prev,
				[pkg.rootPath]: (prev[pkg.rootPath] || []).filter((candidate) => candidate.id !== proposal.id),
			}));
			setRejectingProposalIds((prev) => {
				const next = new Set(prev[pkg.rootPath] || []);
				next.delete(proposal.id);
				return { ...prev, [pkg.rootPath]: next };
			});
		}, 220);
	}, []);

	const getThoughtStreamForWorkItem = useCallback(
		(workItem: AdoSprintWorkItem, state: TaskExecutionState): string => {
			if (!state.sessionId || !state.tabId) return 'No active session/tab found for this task.';
			const session = sessions.find((candidate) => candidate.id === state.sessionId);
			if (!session) return 'Session not found.';
			const tab = session.aiTabs.find((candidate) => candidate.id === state.tabId);
			if (!tab) return 'Tab not found.';
			const text = tab.logs
				.filter((log) => log.source !== 'user')
				.map((log) => log.text)
				.join('\n')
				.trim();
			if (!text) {
				return `No agent thought stream available yet for #${workItem.id}.`;
			}
			return text;
		},
		[sessions]
	);

	const getDevLogsForWorkItem = useCallback(
		async (workItem: AdoSprintWorkItem) => {
			const rawPreviewContext = (await window.maestro.settings.get('kanbanPreviewContextByTicket')) as
				| Record<string, { worktreePath?: string; mfeName?: string; updatedAt?: number }>
				| undefined;
			const context = rawPreviewContext?.[String(workItem.id)];
			if (!context?.worktreePath || !context?.mfeName) {
				return [{ source: 'stderr' as const, text: 'No preview context found. Start preview first.' }];
			}
			return adoService.getDevServerLogs({
				worktreePath: context.worktreePath,
				mfeName: context.mfeName,
				lineCount: 120,
			});
		},
		[]
	);

	const attachContextItem = useMemo(() => {
		if (attachContextTicketId === null) return null;
		for (const items of Object.values(workItemAssignments)) {
			const found = items.find((item) => item.id === attachContextTicketId);
			if (found) return found;
		}
		return null;
	}, [attachContextTicketId, workItemAssignments]);

	const handleSaveAttachedContext = useCallback(
		async (selectedPaths: string[]) => {
			if (!attachContextItem) return;
			try {
				if (attachContextItem.id > 0) {
					await adoService.updateWorkItemAttachedContext({
						ticketId: attachContextItem.id,
						attachedContextPaths: selectedPaths,
					});
				}
				setWorkItemAssignments((prev) => {
					const next: Record<string, AdoSprintWorkItem[]> = {};
					for (const [packagePath, items] of Object.entries(prev)) {
						next[packagePath] = items.map((item) =>
							item.id === attachContextItem.id
								? { ...item, attachedContextPaths: selectedPaths }
								: item
						);
					}
					return next;
				});
				setAttachContextTicketId(null);
			} catch (error) {
				notifyToast({
					type: 'error',
					title: 'Context Attach Failed',
					message:
						error instanceof Error ? error.message : 'Failed to update ADO attached context.',
				});
			}
		},
		[attachContextItem]
	);

	return (
		<div className="h-full flex flex-col">
			<div
				className="flex items-center justify-between px-4 py-3 border-b"
				style={{ borderColor: theme.colors.border }}
			>
				<div>
					<h2 className="text-lg font-bold" style={{ color: theme.colors.textMain }}>
						MFE Dashboard
					</h2>
					<p className="text-xs" style={{ color: theme.colors.textDim }}>
						{monorepoRoot || 'No monorepo root configured'}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => {
							void startSprint();
						}}
						disabled={isLoading || !monorepoRoot}
						className="px-3 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5"
						style={{
							borderColor: theme.colors.accent,
							color: theme.colors.accent,
							opacity: isLoading ? 0.7 : 1,
						}}
					>
						<Brain className="w-3.5 h-3.5" />
						Start Sprint
					</button>
					<button
						onClick={scanWorkspace}
						disabled={isLoading || !monorepoRoot}
						className="px-3 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							opacity: isLoading ? 0.7 : 1,
						}}
					>
						<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
						Rescan
					</button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							className="p-1.5 rounded border"
							style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
							aria-label="Close MFE dashboard"
						>
							<X className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>

			{error && (
				<div
					className="mx-4 mt-3 p-2 rounded text-xs"
					style={{ backgroundColor: `${theme.colors.error}20`, color: theme.colors.error }}
				>
					{error}
				</div>
			)}

			<div className="flex-1 relative overflow-hidden">
				<div
					className={`absolute inset-0 overflow-auto p-4 transition-all duration-200 ${
						focusedPackage
							? 'opacity-0 scale-[0.985] pointer-events-none'
							: 'opacity-100 scale-100 pointer-events-auto'
					}`}
				>
					<div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
						{(['host', 'remote', 'shared'] as MfePackageRole[])
							.sort((a, b) => roleOrder(a) - roleOrder(b))
							.map((role) => {
								const Icon = ROLE_ICONS[role];
								const rolePackages = grouped[role];
								return (
									<div
										key={role}
										className="rounded-lg border min-h-[220px] flex flex-col"
										style={{
											backgroundColor: theme.colors.bgSidebar,
											borderColor: theme.colors.border,
										}}
									>
										<div
											className="px-3 py-2 border-b text-sm font-semibold flex items-center justify-between gap-2"
											style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
										>
											<span className="flex items-center gap-2">
												<Icon className="w-4 h-4" style={{ color: theme.colors.accent }} />
												{ROLE_LABELS[role]}
											</span>
											<div className="flex items-center gap-2">
												<span className="text-xs" style={{ color: theme.colors.textDim }}>
													{rolePackages.length}
												</span>
												<button
													type="button"
													onClick={() => {
														void runRoleBatch(role);
													}}
													className="px-2 py-1 rounded text-[11px] border font-semibold flex items-center gap-1"
													style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
												>
													<Play className="w-3 h-3" />
													Batch
												</button>
											</div>
										</div>

										<div className="p-3 space-y-3">
											{rolePackages.length === 0 ? (
												<div className="text-xs" style={{ color: theme.colors.textDim }}>
													No packages detected
												</div>
											) : (
												rolePackages.map((pkg) => (
													<MfeCard
														key={pkg.rootPath}
														theme={theme}
														pkg={pkg}
														assignedAgentName={agentNameById[assignments[pkg.rootPath]]}
														assignedWorkItems={workItemAssignments[pkg.rootPath]}
														proposedItems={proposedItems[pkg.rootPath]}
														rejectingProposalIds={rejectingProposalIds[pkg.rootPath]}
														taskStates={taskStates}
														scanState={proposalScanStates[pkg.rootPath]}
														onScanForProposals={(targetPkg) => {
															void scanForProposals(targetPkg);
														}}
														onApproveProposal={approveProposal}
														onRejectProposal={rejectProposal}
														onFocus={(targetPkg) => {
															setFocusedMfeId(targetPkg.rootPath);
														}}
														onRemoveWorkItem={(targetPkg, workItemId) => {
															unlinkWorkItem(targetPkg.rootPath, workItemId);
														}}
														onDropAgent={(targetPkg, agentId) => {
															setAssignments((prev) => ({ ...prev, [targetPkg.rootPath]: agentId }));
															onAssignAgent?.({
																packageName: targetPkg.name,
																packagePath: targetPkg.rootPath,
																role: targetPkg.role,
																agentId,
															});
														}}
														onDropWorkItem={(targetPkg, workItem) => {
															setWorkItemAssignments((prev) => {
																const existing = prev[targetPkg.rootPath] || [];
																if (existing.some((item) => item.id === workItem.id)) {
																	return prev;
																}
																return {
																	...prev,
																	[targetPkg.rootPath]: [...existing, workItem],
																};
															});
															onDropWorkItem?.({
																packageName: targetPkg.name,
																packagePath: targetPkg.rootPath,
																role: targetPkg.role,
																workItem,
															});
														}}
														onExecuteTask={(targetPkg, workItem) => {
															void runTask(targetPkg, workItem);
														}}
														onViewTaskTerminal={(targetPkg, workItem) => {
															const key = taskKey(targetPkg.rootPath, workItem.id);
															const state = taskStates[key];
															if (state?.sessionId && state?.tabId) {
																onViewAgentTerminal?.(state.sessionId, state.tabId);
															}
														}}
													/>
												))
											)}
										</div>
									</div>
								);
							})}
					</div>
				</div>

				<div
					className={`absolute inset-0 transition-all duration-200 ${
						focusedPackage
							? 'opacity-100 scale-100 pointer-events-auto'
							: 'opacity-0 scale-[1.015] pointer-events-none'
					}`}
				>
					{focusedPackage ? (
						<MfeFocusWorkspace
							theme={theme}
							mfePackage={focusedPackage}
							assignedAgentName={agentNameById[assignments[focusedPackage.rootPath]]}
							activeItems={workItemAssignments[focusedPackage.rootPath] || []}
							proposedItems={proposedItems[focusedPackage.rootPath] || []}
							globalBacklogItems={globalBacklogItems}
							taskStates={taskStates}
							onBack={() => setFocusedMfeId(null)}
							onQuickAdd={(draft: QuickAddDraft) => {
								const nextId = proposalToPlannedIdCounter.current;
								proposalToPlannedIdCounter.current -= 1;
								const plannedItem: AdoSprintWorkItem = {
									id: nextId,
									title: draft.title,
									description: draft.description,
									acceptanceCriteria: draft.acceptanceCriteria,
									state: 'Planned',
									tags: ['Manual Draft'],
									url: '',
								};
								setWorkItemAssignments((prev) => ({
									...prev,
									[focusedPackage.rootPath]: [plannedItem, ...(prev[focusedPackage.rootPath] || [])],
								}));
							}}
							onLinkWorkItem={(workItem) => {
								setWorkItemAssignments((prev) => {
									const existing = prev[focusedPackage.rootPath] || [];
									if (existing.some((candidate) => candidate.id === workItem.id)) return prev;
									return {
										...prev,
										[focusedPackage.rootPath]: [...existing, workItem],
									};
								});
								onDropWorkItem?.({
									packageName: focusedPackage.name,
									packagePath: focusedPackage.rootPath,
									role: focusedPackage.role,
									workItem,
								});
							}}
							onExecuteTask={(workItem) => {
								void runTask(focusedPackage, workItem);
							}}
							onViewTaskTerminal={(workItem) => {
								const key = taskKey(focusedPackage.rootPath, workItem.id);
								const state = taskStates[key];
								if (state?.sessionId && state?.tabId) {
									onViewAgentTerminal?.(state.sessionId, state.tabId);
								}
							}}
							onGetAgentThoughtStream={(workItem, state) => getThoughtStreamForWorkItem(workItem, state)}
							onGetDevServerLogs={getDevLogsForWorkItem}
							onAttachContext={(workItem) => setAttachContextTicketId(workItem.id)}
							onRemoveWorkItem={(workItemId) => {
								unlinkWorkItem(focusedPackage.rootPath, workItemId);
							}}
						/>
					) : null}
				</div>
			</div>
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

			<SprintCommandCenterModal
				theme={theme}
				isOpen={commandCenterOpen}
				state={orchestratorState}
				plan={orchestrationPlan}
				execution={orchestrationExecution}
				error={orchestrationError}
				onClose={() => setCommandCenterOpen(false)}
			/>
			<div
				className="px-4 py-2 border-t flex items-center gap-2 overflow-x-auto whitespace-nowrap text-[11px]"
				style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgSidebar }}
			>
				<span className="font-semibold" style={{ color: theme.colors.textDim }}>
					Live Signals
				</span>
				{signalTickerItems.length === 0 ? (
					<span style={{ color: theme.colors.textDim }}>No active locks or announcements.</span>
				) : (
					signalTickerItems.map((item) => (
						<span
							key={item.id}
							className="px-2 py-0.5 rounded border"
							style={{
								borderColor: item.kind === 'lock' ? '#EAB308' : '#EF4444',
								color: item.kind === 'lock' ? '#EAB308' : '#EF4444',
							}}
						>
							{item.message}
						</span>
					))
				)}
			</div>
		</div>
	);
}

export function MFEDashboard(props: MFEDashboardProps) {
	return (
		<SprintProvider>
			<MFEDashboardContent {...props} />
		</SprintProvider>
	);
}

export default MFEDashboard;
