import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, PanelRightClose, PanelRightOpen, Play, Terminal } from 'lucide-react';
import type { Theme } from '../types';
import type { AdoSprintWorkItem } from '../services/ado';
import type { MfePackageInfo, MfeProposal } from '../services/mfe';

const DESIGN_CONTEXT_SETTINGS_KEY = 'kanbanDesignContextByTicket';

export type FocusWorkspaceMode = 'planning' | 'execution';

export type FocusTaskExecutionState = {
	status: 'idle' | 'initializing' | 'running' | 'error';
	sessionId?: string;
	tabId?: string;
	error?: string;
};

export type FocusProposedTaskItem = MfeProposal & { id: string };
type TerminalMode = 'thought' | 'dev-logs';

export interface FocusDevLogLine {
	source: 'stdout' | 'stderr';
	text: string;
}

export interface QuickAddDraft {
	title: string;
	description: string;
	acceptanceCriteria: string;
}

interface MfeFocusWorkspaceProps {
	theme: Theme;
	mfePackage: MfePackageInfo;
	assignedAgentName?: string;
	activeItems: AdoSprintWorkItem[];
	proposedItems: FocusProposedTaskItem[];
	globalBacklogItems: AdoSprintWorkItem[];
	taskStates: Record<string, FocusTaskExecutionState>;
	onBack: () => void;
	onQuickAdd: (draft: QuickAddDraft) => void;
	onLinkWorkItem: (workItem: AdoSprintWorkItem) => void;
	onRemoveWorkItem: (workItemId: number) => void;
	onAttachContext?: (workItem: AdoSprintWorkItem) => void;
	onExecuteTask: (workItem: AdoSprintWorkItem) => void;
	onViewTaskTerminal: (workItem: AdoSprintWorkItem) => void;
	onGetAgentThoughtStream?: (
		workItem: AdoSprintWorkItem,
		state: FocusTaskExecutionState
	) => string;
	onGetDevServerLogs?: (workItem: AdoSprintWorkItem) => Promise<FocusDevLogLine[]>;
}

interface DesignContextEntry {
	url: string;
	verifiedNodeName?: string;
	imagePath?: string;
	imageUrl?: string;
}

function stripHtml(input: string): string {
	return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

function createDragPayload(item: AdoSprintWorkItem) {
	return {
		type: 'ado-work-item',
		id: item.id,
		title: item.title,
		description: item.description,
		acceptanceCriteria: item.acceptanceCriteria,
		state: item.state,
		tags: item.tags,
		url: item.url,
	};
}

function taskKey(packagePath: string, workItemId: number): string {
	return `${packagePath}::${workItemId}`;
}

function renderLongText(text: string): string {
	const cleaned = stripHtml(text || '');
	return cleaned.length > 0 ? cleaned : 'None provided.';
}

export function MfeFocusWorkspace({
	theme,
	mfePackage,
	assignedAgentName,
	activeItems,
	proposedItems,
	globalBacklogItems,
	taskStates,
	onBack,
	onQuickAdd,
	onLinkWorkItem,
	onRemoveWorkItem,
	onAttachContext,
	onExecuteTask,
	onViewTaskTerminal,
	onGetAgentThoughtStream,
	onGetDevServerLogs,
}: MfeFocusWorkspaceProps) {
	const [mode, setMode] = useState<FocusWorkspaceMode>('planning');
	const [quickAddTitle, setQuickAddTitle] = useState('');
	const [quickAddDescription, setQuickAddDescription] = useState('');
	const [quickAddAcceptanceCriteria, setQuickAddAcceptanceCriteria] = useState('');
	const [drawerOpen, setDrawerOpen] = useState(true);
	const [designContextByTicket, setDesignContextByTicket] = useState<Record<number, DesignContextEntry>>({});
	const [referenceImageSrcByTicket, setReferenceImageSrcByTicket] = useState<Record<number, string>>({});
	const [terminalMode, setTerminalMode] = useState<TerminalMode>('thought');
	const [selectedTerminalTicketId, setSelectedTerminalTicketId] = useState<number | null>(null);
	const [devLogByTicket, setDevLogByTicket] = useState<Record<number, FocusDevLogLine[]>>({});
	const [devLogLoading, setDevLogLoading] = useState(false);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onBack();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [onBack]);

	useEffect(() => {
		window.maestro.settings
			.get(DESIGN_CONTEXT_SETTINGS_KEY)
			.then((value) => {
				const rawMap = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
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
							typeof typedEntry.verifiedNodeName === 'string' ? typedEntry.verifiedNodeName : undefined,
						imagePath: typeof typedEntry.imagePath === 'string' ? typedEntry.imagePath : undefined,
						imageUrl: typeof typedEntry.imageUrl === 'string' ? typedEntry.imageUrl : undefined,
					};
				}
				setDesignContextByTicket(normalized);
			})
			.catch(() => {
				// Figma reference preview is optional.
			});
	}, [activeItems]);

	useEffect(() => {
		const imageCandidates = activeItems
			.map((item) => ({ id: item.id, imagePath: designContextByTicket[item.id]?.imagePath }))
			.filter((entry): entry is { id: number; imagePath: string } => Boolean(entry.imagePath?.trim()));
		if (imageCandidates.length === 0) {
			setReferenceImageSrcByTicket({});
			return;
		}

		let cancelled = false;
		Promise.all(
			imageCandidates.map(async ({ id, imagePath }) => {
				try {
					const dataUrl = await window.maestro.fs.readFile(imagePath);
					if (!dataUrl.startsWith('data:')) return null;
					return { id, dataUrl };
				} catch {
					return null;
				}
			})
		).then((results) => {
			if (cancelled) return;
			const next: Record<number, string> = {};
			for (const entry of results) {
				if (!entry) continue;
				next[entry.id] = entry.dataUrl;
			}
			setReferenceImageSrcByTicket(next);
		});

		return () => {
			cancelled = true;
		};
	}, [activeItems, designContextByTicket]);

	const globalBacklogLookup = useMemo(() => new Set(activeItems.map((item) => item.id)), [activeItems]);
	const referenceDesigns = useMemo(
		() =>
			activeItems
				.map((item) => {
					const designContext = designContextByTicket[item.id];
					const imageSrc = referenceImageSrcByTicket[item.id];
					if (!imageSrc) return null;
					return {
						item,
						designContext,
						imageSrc,
					};
				})
				.filter(
					(entry): entry is { item: AdoSprintWorkItem; designContext: DesignContextEntry; imageSrc: string } =>
						Boolean(entry)
				),
		[activeItems, designContextByTicket, referenceImageSrcByTicket]
	);
	const primaryReferenceDesign = referenceDesigns[0];
	const runningItems = useMemo(
		() =>
			activeItems.filter((item) => {
				const state = taskStates[taskKey(mfePackage.rootPath, item.id)];
				return state?.status === 'running';
			}),
		[activeItems, mfePackage.rootPath, taskStates]
	);
	const selectedTerminalItem = useMemo(
		() => runningItems.find((item) => item.id === selectedTerminalTicketId) || runningItems[0] || null,
		[runningItems, selectedTerminalTicketId]
	);
	const selectedTerminalState = selectedTerminalItem
		? taskStates[taskKey(mfePackage.rootPath, selectedTerminalItem.id)] || { status: 'idle' as const }
		: ({ status: 'idle' } as FocusTaskExecutionState);
	const thoughtStreamText = selectedTerminalItem
		? onGetAgentThoughtStream?.(selectedTerminalItem, selectedTerminalState) || 'No agent thought stream available.'
		: 'Select a running task to inspect terminal output.';

	useEffect(() => {
		if (!selectedTerminalItem) return;
		if (!onGetDevServerLogs) return;
		if (terminalMode !== 'dev-logs') return;

		let cancelled = false;
		setDevLogLoading(true);
		onGetDevServerLogs(selectedTerminalItem)
			.then((lines) => {
				if (cancelled) return;
				setDevLogByTicket((prev) => ({
					...prev,
					[selectedTerminalItem.id]: lines,
				}));
			})
			.catch(() => {
				if (cancelled) return;
				setDevLogByTicket((prev) => ({
					...prev,
					[selectedTerminalItem.id]: [
						{ source: 'stderr', text: 'Unable to load dev server logs for this task.' },
					],
				}));
			})
			.finally(() => {
				if (!cancelled) setDevLogLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [onGetDevServerLogs, selectedTerminalItem, terminalMode]);

	return (
		<div className="h-full flex flex-col">
			<div
				className="px-4 py-3 border-b flex items-center justify-between gap-3"
				style={{ borderColor: theme.colors.border }}
			>
				<div className="min-w-0">
					<div className="text-[11px] uppercase font-semibold" style={{ color: theme.colors.textDim }}>
						Sprint Workspace
					</div>
					<div className="text-lg font-bold truncate" style={{ color: theme.colors.textMain }}>
						Sprint Active &gt; {mfePackage.name}
					</div>
					<div className="text-xs truncate" style={{ color: theme.colors.textDim }} title={mfePackage.rootPath}>
						{mfePackage.rootPath}
					</div>
				</div>
				<button
					type="button"
					onClick={onBack}
					className="px-3 py-1.5 rounded text-xs font-semibold border inline-flex items-center gap-1.5"
					style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
				>
					<ChevronLeft className="w-4 h-4" />
					Back to Board (Esc)
				</button>
			</div>

			<div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-4 p-4">
				<div
					className="min-h-0 rounded-lg border p-3 flex flex-col"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgSidebar }}
				>
					<div className="text-xs uppercase font-semibold mb-3" style={{ color: theme.colors.textDim }}>
						Backlog ({activeItems.length})
					</div>
					<div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
						{activeItems.length === 0 ? (
							<div className="text-xs" style={{ color: theme.colors.textDim }}>
								No linked sprint work items yet.
							</div>
						) : (
							activeItems.map((item) => {
								const state = taskStates[taskKey(mfePackage.rootPath, item.id)] || { status: 'idle' as const };
								const statusText =
									state.status === 'initializing'
										? 'Initializing...'
										: state.status === 'running'
											? 'Running'
											: state.status === 'error'
												? state.error || 'Execution failed'
												: 'Ready';

								return (
									<div
										key={item.id}
										className="rounded border p-3 space-y-2"
										style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
									>
										<div className="flex items-start justify-between gap-2">
											<div className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
												#{item.id} {item.title}
											</div>
											<div
												className="text-[10px] px-2 py-0.5 rounded uppercase font-bold"
												style={{ backgroundColor: `${theme.colors.accent}20`, color: theme.colors.accent }}
											>
												{item.state}
											</div>
										</div>
										<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
											Execution: {statusText}
										</div>
										<div className="text-[11px] leading-5 whitespace-pre-wrap" style={{ color: theme.colors.textMain }}>
											Description: {renderLongText(item.description)}
										</div>
										<div className="text-[11px] leading-5 whitespace-pre-wrap" style={{ color: theme.colors.textMain }}>
											Acceptance Criteria: {renderLongText(item.acceptanceCriteria)}
										</div>
										<div className="flex items-center gap-2 pt-1">
											<button
												type="button"
												onClick={() => onAttachContext?.(item)}
												disabled={!onAttachContext}
												className="px-2 py-1 rounded text-[11px] border font-semibold disabled:opacity-60"
												style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
											>
												📎 Attach Context
												{Array.isArray(item.attachedContextPaths) && item.attachedContextPaths.length > 0
													? ` (${item.attachedContextPaths.length})`
													: ''}
											</button>
											{state.status === 'running' && state.sessionId && state.tabId ? (
												<button
													type="button"
													onClick={() => onViewTaskTerminal(item)}
													className="px-2 py-1 rounded text-[11px] border font-semibold inline-flex items-center gap-1.5"
													style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
												>
													<Terminal className="w-3.5 h-3.5" />
													Open Terminal
												</button>
											) : (
												<button
													type="button"
													onClick={() => onExecuteTask(item)}
													disabled={!assignedAgentName || state.status === 'initializing'}
													className="px-2 py-1 rounded text-[11px] border font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
													style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
												>
													<Play className="w-3.5 h-3.5" />
													Execute
												</button>
											)}
											<button
												type="button"
												onClick={() => onRemoveWorkItem(item.id)}
												className="px-2 py-1 rounded text-[11px] border font-semibold"
												style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
											>
												Remove
											</button>
										</div>
									</div>
								);
							})
						)}

						{proposedItems.length > 0 && (
							<div className="pt-2 border-t" style={{ borderColor: theme.colors.border }}>
								<div className="text-[11px] uppercase font-semibold mb-2" style={{ color: theme.colors.textDim }}>
									Proposed Ghost Items ({proposedItems.length})
								</div>
								<div className="space-y-2">
									{proposedItems.map((item) => (
										<div
											key={item.id}
											className="rounded border p-2.5"
											style={{ borderColor: theme.colors.border, backgroundColor: `${theme.colors.accent}12` }}
										>
											<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
												{item.title}
											</div>
											<div className="text-[11px] mt-1 leading-5" style={{ color: theme.colors.textDim }}>
												{item.description}
											</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				<div
					className="min-h-0 rounded-lg border p-3 flex flex-col"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgSidebar }}
				>
					<div className="flex items-center justify-between gap-3 mb-3">
						<div className="flex items-center gap-2 rounded border p-1" style={{ borderColor: theme.colors.border }}>
							<button
								type="button"
								onClick={() => setMode('planning')}
								className="px-2.5 py-1 rounded text-xs font-semibold"
								style={{
									backgroundColor: mode === 'planning' ? `${theme.colors.accent}20` : 'transparent',
									color: mode === 'planning' ? theme.colors.accent : theme.colors.textDim,
								}}
							>
								Planning Mode
							</button>
							<button
								type="button"
								onClick={() => setMode('execution')}
								className="px-2.5 py-1 rounded text-xs font-semibold"
								style={{
									backgroundColor: mode === 'execution' ? `${theme.colors.accent}20` : 'transparent',
									color: mode === 'execution' ? theme.colors.accent : theme.colors.textDim,
								}}
							>
								Execution Mode
							</button>
						</div>
						<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
							Agent: {assignedAgentName || 'Unassigned'}
						</div>
					</div>

					{mode === 'planning' ? (
						<div className="flex-1 min-h-0 flex flex-col gap-3">
							<div
								className="rounded border p-3 text-xs"
								style={{ borderColor: theme.colors.border }}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault();
									const workItem = parseDroppedWorkItem(event);
									if (workItem) {
										onLinkWorkItem(workItem);
									}
								}}
							>
								Drop from Global Backlog here to link quickly.
							</div>

							<div className="rounded border p-3 space-y-2" style={{ borderColor: theme.colors.border }}>
								<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
									Quick Add
								</div>
								<input
									value={quickAddTitle}
									onChange={(event) => setQuickAddTitle(event.target.value)}
									placeholder="Ticket title"
									className="w-full rounded border px-2 py-1.5 text-sm bg-transparent outline-none"
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								/>
								<textarea
									value={quickAddDescription}
									onChange={(event) => setQuickAddDescription(event.target.value)}
									placeholder="Description"
									className="w-full rounded border px-2 py-1.5 text-sm bg-transparent outline-none min-h-[82px] resize-y"
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								/>
								<textarea
									value={quickAddAcceptanceCriteria}
									onChange={(event) => setQuickAddAcceptanceCriteria(event.target.value)}
									placeholder="Acceptance criteria"
									className="w-full rounded border px-2 py-1.5 text-sm bg-transparent outline-none min-h-[82px] resize-y"
									style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								/>
								<button
									type="button"
									onClick={() => {
										const title = quickAddTitle.trim();
										if (!title) return;
										onQuickAdd({
											title,
											description: quickAddDescription.trim(),
											acceptanceCriteria: quickAddAcceptanceCriteria.trim(),
										});
										setQuickAddTitle('');
										setQuickAddDescription('');
										setQuickAddAcceptanceCriteria('');
									}}
									disabled={!quickAddTitle.trim()}
									className="px-2.5 py-1.5 rounded text-xs font-semibold border disabled:opacity-60"
									style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
								>
									Add Ticket
								</button>
							</div>

							<div className="rounded border min-h-0 flex flex-col" style={{ borderColor: theme.colors.border }}>
								<div
									className="px-3 py-2 border-b flex items-center justify-between"
									style={{ borderColor: theme.colors.border }}
								>
									<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
										Global Backlog Drawer
									</div>
									<button
										type="button"
										onClick={() => setDrawerOpen((prev) => !prev)}
										className="p-1 rounded"
										style={{ color: theme.colors.textDim }}
									>
										{drawerOpen ? (
											<PanelRightClose className="w-4 h-4" />
										) : (
											<PanelRightOpen className="w-4 h-4" />
										)}
									</button>
								</div>
								{drawerOpen && (
									<div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
										{globalBacklogItems.length === 0 ? (
											<div className="text-xs px-1" style={{ color: theme.colors.textDim }}>
												No global items available.
											</div>
										) : (
											globalBacklogItems.map((item) => (
												<div
													key={`global-${item.id}`}
													draggable
													onDragStart={(event) => {
														const payload = createDragPayload(item);
														event.dataTransfer.effectAllowed = 'copy';
														event.dataTransfer.setData(
															'application/x-maestro-ado-work-item',
															JSON.stringify(payload)
														);
														event.dataTransfer.setData('application/json', JSON.stringify(payload));
														event.dataTransfer.setData('text/plain', `#${item.id} ${item.title}`);
													}}
													className="rounded border p-2"
													style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
												>
													<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
														#{item.id} {item.title}
													</div>
													<div className="mt-1 text-[11px]" style={{ color: theme.colors.textDim }}>
														{renderLongText(item.description).slice(0, 160)}
													</div>
													<div className="mt-2 flex items-center justify-between">
														<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
															{globalBacklogLookup.has(item.id) ? 'Already linked' : 'Drag or add'}
														</div>
														<button
															type="button"
															onClick={() => onLinkWorkItem(item)}
															disabled={globalBacklogLookup.has(item.id)}
															className="px-2 py-1 rounded text-[11px] font-semibold border disabled:opacity-60"
															style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
														>
															Add
														</button>
													</div>
												</div>
											))
										)}
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-3">
							<div className="min-h-0 rounded border p-3 flex flex-col gap-3" style={{ borderColor: theme.colors.border }}>
								<div className="text-xs font-semibold mb-2" style={{ color: theme.colors.textMain }}>
									Live Task Console Routing
								</div>
								<div className="text-[11px] mb-3" style={{ color: theme.colors.textDim }}>
									Open the running tab for this MFE to watch stdout/stderr in real-time.
								</div>
								<div className="space-y-2 overflow-y-auto">
									{activeItems.length === 0 ? (
										<div className="text-xs" style={{ color: theme.colors.textDim }}>
											No linked tasks yet.
										</div>
									) : (
										activeItems.map((item) => {
											const state =
												taskStates[taskKey(mfePackage.rootPath, item.id)] || ({ status: 'idle' } as FocusTaskExecutionState);
											return (
												<div
													key={`exec-${item.id}`}
													className="rounded border p-2.5 flex items-center justify-between gap-2"
													style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
												>
													<div className="min-w-0">
														<div className="text-xs font-semibold truncate" style={{ color: theme.colors.textMain }}>
															#{item.id} {item.title}
														</div>
														<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
															State: {state.status}
														</div>
													</div>
													<div className="flex items-center gap-2">
														<button
															type="button"
															onClick={() => setSelectedTerminalTicketId(item.id)}
															className="px-2 py-1 rounded text-[11px] font-semibold border"
															style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
														>
															Inspect
														</button>
														<button
															type="button"
															onClick={() => onExecuteTask(item)}
															disabled={!assignedAgentName || state.status === 'initializing'}
															className="px-2 py-1 rounded text-[11px] font-semibold border disabled:opacity-60"
															style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
														>
															Run
														</button>
														<button
															type="button"
															onClick={() => onViewTaskTerminal(item)}
															disabled={!state.sessionId || !state.tabId}
															className="px-2 py-1 rounded text-[11px] font-semibold border inline-flex items-center gap-1 disabled:opacity-60"
															style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
														>
															<Terminal className="w-3.5 h-3.5" />
															Console
														</button>
														<button
															type="button"
															onClick={() => onRemoveWorkItem(item.id)}
															className="px-2 py-1 rounded text-[11px] font-semibold border"
															style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
														>
															Remove
														</button>
													</div>
												</div>
											);
										})
									)}
								</div>
								<div className="min-h-[220px] rounded border p-2.5 flex flex-col" style={{ borderColor: theme.colors.border }}>
									<div className="flex items-center justify-between gap-2 mb-2">
										<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
											Agent Terminal
										</div>
										<div className="flex items-center gap-1 rounded border p-1" style={{ borderColor: theme.colors.border }}>
											<button
												type="button"
												onClick={() => setTerminalMode('thought')}
												className="px-2 py-1 rounded text-[11px] font-semibold"
												style={{
													backgroundColor: terminalMode === 'thought' ? `${theme.colors.accent}20` : 'transparent',
													color: terminalMode === 'thought' ? theme.colors.accent : theme.colors.textDim,
												}}
											>
												Agent Thought Stream
											</button>
											<button
												type="button"
												onClick={() => setTerminalMode('dev-logs')}
												className="px-2 py-1 rounded text-[11px] font-semibold"
												style={{
													backgroundColor: terminalMode === 'dev-logs' ? `${theme.colors.accent}20` : 'transparent',
													color: terminalMode === 'dev-logs' ? theme.colors.accent : theme.colors.textDim,
												}}
											>
												Dev Server Logs
											</button>
										</div>
									</div>
									<div className="text-[11px] mb-2" style={{ color: theme.colors.textDim }}>
										{selectedTerminalItem
											? `Task #${selectedTerminalItem.id} • ${selectedTerminalItem.title}`
											: 'No running task selected'}
									</div>
									<div
										className="flex-1 min-h-0 rounded border overflow-auto p-2 font-mono text-[11px] space-y-1"
										style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
									>
										{terminalMode === 'thought' ? (
											<pre className="whitespace-pre-wrap break-words m-0" style={{ color: theme.colors.textMain }}>
												{thoughtStreamText}
											</pre>
										) : devLogLoading ? (
											<div style={{ color: theme.colors.textDim }}>Loading dev server logs...</div>
										) : (
											(devLogByTicket[selectedTerminalItem?.id || -1] || []).map((line, idx) => (
												<div
													key={`${selectedTerminalItem?.id || 'none'}-${idx}`}
													className="whitespace-pre-wrap break-words"
													style={{
														color:
															line.source === 'stderr' ? theme.colors.error : theme.colors.textMain,
													}}
												>
													{line.text}
												</div>
											))
										)}
									</div>
								</div>
							</div>
							<div className="min-h-0 rounded border p-3 flex flex-col" style={{ borderColor: theme.colors.border }}>
								<div className="text-xs font-semibold mb-2" style={{ color: theme.colors.textMain }}>
									Reference Design
								</div>
								{primaryReferenceDesign ? (
									<>
										<div className="text-[11px] mb-2" style={{ color: theme.colors.textDim }}>
											#{primaryReferenceDesign.item.id} {primaryReferenceDesign.item.title}
											{primaryReferenceDesign.designContext.verifiedNodeName
												? ` • ${primaryReferenceDesign.designContext.verifiedNodeName}`
												: ''}
										</div>
											<div
												className="flex-1 min-h-0 rounded border p-1"
												style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
											>
												<img
													src={primaryReferenceDesign.imageSrc}
													alt="Reference design"
													className="w-full h-full object-contain rounded"
												/>
										</div>
									</>
								) : (
									<div className="text-xs" style={{ color: theme.colors.textDim }}>
										Attach and verify a Figma link on a Kanban card to show its design reference here.
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default MfeFocusWorkspace;
