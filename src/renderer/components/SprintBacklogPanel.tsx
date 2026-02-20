import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, Save, AlertTriangle, Bug } from 'lucide-react';
import type { Theme } from '../types';
import {
	adoService,
	type AdoSprintWorkItem,
	type AdoCurrentSprintDebug,
	type SprintReviewResponse,
} from '../services/ado';
import { SprintReviewModal } from './SprintReviewModal';

interface SprintBacklogPanelProps {
	theme: Theme;
}

function stripHtml(input: string): string {
	return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

export function SprintBacklogPanel({ theme }: SprintBacklogPanelProps) {
	const [organization, setOrganization] = useState('');
	const [project, setProject] = useState('');
	const [team, setTeam] = useState('');
	const [pat, setPat] = useState('');
	const [patDirty, setPatDirty] = useState(false);
	const [hasPat, setHasPat] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isLoadingSprint, setIsLoadingSprint] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [sprintError, setSprintError] = useState<string | null>(null);
	const [iterationName, setIterationName] = useState<string | null>(null);
	const [items, setItems] = useState<AdoSprintWorkItem[]>([]);
	const [debugInfo, setDebugInfo] = useState<AdoCurrentSprintDebug | null>(null);
	const [sprintReviewOpen, setSprintReviewOpen] = useState(false);
	const [isGeneratingReview, setIsGeneratingReview] = useState(false);
	const [sprintReview, setSprintReview] = useState<SprintReviewResponse | null>(null);

	const loadSettings = useCallback(async () => {
		const settings = await adoService.getSettings();
		setOrganization(settings.organization);
		setProject(settings.project);
		setTeam(settings.team || '');
		setHasPat(settings.hasPat);
		setPat('');
		setPatDirty(false);
	}, []);

	const refreshSprint = useCallback(async () => {
		setIsLoadingSprint(true);
		setSprintError(null);
		try {
			const result = await adoService.getCurrentSprintWorkItems();
			setIterationName(result.iterationName);
			setItems(result.items);
			setDebugInfo(null);
		} catch (error) {
			setItems([]);
			setIterationName(null);
			setSprintError(error instanceof Error ? error.message : 'Failed to load sprint work items');
		} finally {
			setIsLoadingSprint(false);
		}
	}, []);

	useEffect(() => {
		loadSettings().catch((error) => {
			setSaveError(error instanceof Error ? error.message : 'Failed to load ADO settings');
		});
	}, [loadSettings]);

	const canLoadSprint = useMemo(
		() => organization.trim().length > 0 && project.trim().length > 0 && hasPat,
		[organization, project, hasPat]
	);

	const handleSave = useCallback(async () => {
		setIsSaving(true);
		setSaveError(null);
		try {
			const result = await adoService.setSettings({
				organization,
				project,
				team,
				pat: patDirty ? pat : undefined,
			});
			setHasPat(result.hasPat);
			setPat('');
			setPatDirty(false);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'Failed to save ADO settings');
		} finally {
			setIsSaving(false);
		}
	}, [organization, project, team, patDirty, pat]);

	const runDebug = useCallback(async () => {
		setSprintError(null);
		try {
			const debug = await adoService.getCurrentSprintDebug();
			setDebugInfo(debug);
		} catch (error) {
			setDebugInfo(null);
			setSprintError(error instanceof Error ? error.message : 'Failed to fetch sprint debug details');
		}
	}, []);

	const generateSprintReview = useCallback(async () => {
		setSprintReviewOpen(true);
		setIsGeneratingReview(true);
		try {
			const result = await adoService.generateSprintReview();
			setSprintReview(result);
		} catch (error) {
			setSprintReview({
				success: false,
				markdown: '',
				error: error instanceof Error ? error.message : 'Failed to generate sprint review',
				warnings: [],
			});
		} finally {
			setIsGeneratingReview(false);
		}
	}, []);

	return (
		<>
			<div className="h-full flex flex-col gap-4">
				<div className="rounded border p-3 mt-3 space-y-3" style={{ borderColor: theme.colors.border }}>
					<div className="text-xs font-semibold uppercase" style={{ color: theme.colors.textDim }}>
						Azure DevOps
					</div>
					<div className="space-y-2">
						<div>
							<label className="block text-[11px] mb-1" style={{ color: theme.colors.textDim }}>
								Organization
							</label>
							<input
								value={organization}
								onChange={(e) => setOrganization(e.target.value)}
								className="w-full rounded border px-2 py-1.5 text-sm bg-transparent outline-none"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								placeholder="my-org"
							/>
						</div>
						<div>
							<label className="block text-[11px] mb-1" style={{ color: theme.colors.textDim }}>
								Project
							</label>
							<input
								value={project}
								onChange={(e) => setProject(e.target.value)}
								className="w-full rounded border px-2 py-1.5 text-sm bg-transparent outline-none"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								placeholder="my-project"
							/>
						</div>
						<div>
							<label className="block text-[11px] mb-1" style={{ color: theme.colors.textDim }}>
								Team / Board (optional)
							</label>
							<input
								value={team}
								onChange={(e) => setTeam(e.target.value)}
								className="w-full rounded border px-2 py-1.5 text-sm bg-transparent outline-none"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								placeholder="Team Name"
							/>
						</div>
						<div>
							<label className="block text-[11px] mb-1" style={{ color: theme.colors.textDim }}>
								PAT {hasPat && !patDirty ? '(stored)' : ''}
							</label>
							<div className="flex items-center gap-2 rounded border px-2 py-1.5" style={{ borderColor: theme.colors.border }}>
								<KeyRound className="w-3.5 h-3.5 opacity-70" />
								<input
									type="password"
									value={pat}
									onChange={(e) => {
										setPat(e.target.value);
										setPatDirty(true);
									}}
									className="w-full text-sm bg-transparent outline-none"
									style={{ color: theme.colors.textMain }}
									placeholder={hasPat ? 'Leave blank to keep current token' : 'Enter PAT'}
								/>
							</div>
							<div className="mt-1 text-[10px]" style={{ color: theme.colors.textDim }}>
								Credentials are encrypted with Electron secure storage.
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={handleSave}
							disabled={isSaving || !organization.trim() || !project.trim()}
							className="px-2.5 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							<Save className="w-3.5 h-3.5" />
							{isSaving ? 'Saving...' : 'Save'}
						</button>
						<button
							onClick={refreshSprint}
							disabled={isLoadingSprint || !canLoadSprint}
							className="px-2.5 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							<RefreshCw className={`w-3.5 h-3.5 ${isLoadingSprint ? 'animate-spin' : ''}`} />
							Refresh
						</button>
						<button
							onClick={runDebug}
							disabled={isLoadingSprint || !canLoadSprint}
							className="px-2.5 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							title="Shows which API steps returned work item IDs"
						>
							<Bug className="w-3.5 h-3.5" />
							Debug
						</button>
						<button
							onClick={generateSprintReview}
							disabled={!canLoadSprint || isGeneratingReview}
							className="px-2.5 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							title="Generate sprint changelog from active worktree diffs + ADO sprint status"
						>
							<RefreshCw className={`w-3.5 h-3.5 ${isGeneratingReview ? 'animate-spin' : ''}`} />
							{isGeneratingReview ? 'Reviewing...' : 'Review'}
						</button>
					</div>
					{saveError && (
						<div className="text-xs rounded p-2 flex items-start gap-1.5" style={{ backgroundColor: `${theme.colors.error}20`, color: theme.colors.error }}>
							<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
							{saveError}
						</div>
					)}
					{!hasPat && (
						<div className="text-xs rounded p-2" style={{ backgroundColor: `${theme.colors.warning}20`, color: theme.colors.warning }}>
							Save a PAT to load sprint work items.
						</div>
					)}
				</div>

				<div className="flex items-center justify-between">
					<div className="text-xs font-semibold" style={{ color: theme.colors.textMain }}>
						Sprint Backlog {iterationName ? `- ${iterationName}` : ''}
					</div>
					<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
						{items.length} item{items.length === 1 ? '' : 's'}
					</div>
				</div>

				{!canLoadSprint && items.length === 0 && !sprintError && (
					<div className="text-xs" style={{ color: theme.colors.textDim }}>
						Configure organization, project, and PAT, then click Refresh Sprint.
					</div>
				)}

				{sprintError && (
					<div className="text-xs rounded p-2" style={{ backgroundColor: `${theme.colors.error}20`, color: theme.colors.error }}>
						{sprintError}
					</div>
				)}

				{debugInfo && (
					<div
						className="text-[11px] rounded p-2 space-y-1"
						style={{ backgroundColor: `${theme.colors.accent}14`, color: theme.colors.textMain }}
					>
						<div>Org: {debugInfo.organization}</div>
						<div>Project: {debugInfo.project}</div>
						<div>Team: {debugInfo.team || '(default team)'}</div>
						<div>
							Iteration: {debugInfo.iterationName} ({debugInfo.iterationId})
						</div>
						<div>Iteration Path: {debugInfo.iterationPath || '(none)'}</div>
						<div>IDs from team iteration endpoint: {debugInfo.idsFromIterationEndpoint.length}</div>
						<div>IDs from WIQL fallback: {debugInfo.idsFromWiql.length}</div>
						<div>Final IDs used: {debugInfo.finalIds.length}</div>
						<div>Items returned after batch details: {debugInfo.itemCount}</div>
					</div>
				)}

				<div className="space-y-2 overflow-y-auto pr-1">
					{items.map((item) => {
						const preview =
							stripHtml(item.description || item.acceptanceCriteria).slice(0, 180) || 'No description';
						return (
							<div
								key={item.id}
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
								className="rounded border p-2.5 cursor-grab active:cursor-grabbing"
								style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
								title={`Drag to an MFE package card: #${item.id}`}
							>
								<div className="flex items-start justify-between gap-2">
									<div className="text-xs font-semibold leading-4" style={{ color: theme.colors.textMain }}>
										#{item.id} {item.title}
									</div>
									<div
										className="text-[10px] px-1.5 py-0.5 rounded uppercase font-bold"
										style={{ backgroundColor: `${theme.colors.accent}20`, color: theme.colors.accent }}
									>
										{item.state}
									</div>
								</div>
								<div className="mt-1 text-[11px] leading-4" style={{ color: theme.colors.textDim }}>
									{preview}
								</div>
								{item.tags.length > 0 && (
									<div className="mt-2 flex flex-wrap gap-1">
										{item.tags.map((tag) => (
											<span
												key={`${item.id}-${tag}`}
												className="text-[10px] px-1.5 py-0.5 rounded"
												style={{
													backgroundColor: `${theme.colors.border}80`,
													color: theme.colors.textMain,
												}}
											>
												{tag}
											</span>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
			<SprintReviewModal
				theme={theme}
				isOpen={sprintReviewOpen}
				isGenerating={isGeneratingReview}
				markdown={sprintReview?.markdown || ''}
				error={sprintReview?.error || null}
				warnings={sprintReview?.warnings || []}
				generatedAt={sprintReview?.generatedAt || null}
				onClose={() => setSprintReviewOpen(false)}
				onGenerate={generateSprintReview}
			/>
		</>
	);
}

export default SprintBacklogPanel;
