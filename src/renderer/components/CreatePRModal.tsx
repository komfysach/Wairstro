import React, { useState, useEffect, useRef } from 'react';
import { X, GitPullRequest, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import type { Theme, AdoCliStatus } from '../types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

/**
 * Renders error text with URLs converted to clickable links
 */
function renderErrorWithLinks(error: string, theme: Theme): React.ReactNode {
	// Match URLs in the error text
	const urlRegex = /(https?:\/\/[^\s]+)/g;
	const parts = error.split(urlRegex);

	if (parts.length === 1) {
		// No URLs found
		return error;
	}

	return parts.map((part, index) => {
		if (urlRegex.test(part)) {
			// Reset lastIndex since we're reusing the regex
			urlRegex.lastIndex = 0;
			// Extract PR number or use shortened URL
			const prMatch = part.match(/\/(?:pull|pullrequest)\/(\d+)/);
			const displayText = prMatch ? `PR #${prMatch[1]}` : 'View PR';
			return (
				<button
					key={index}
					type="button"
					className="inline-flex items-center gap-1 underline hover:opacity-80"
					style={{ color: theme.colors.error }}
					onClick={(e) => {
						e.stopPropagation();
						window.maestro.shell.openExternal(part);
					}}
				>
					{displayText}
					<ExternalLink className="w-3 h-3" />
				</button>
			);
		}
		return part;
	});
}

export interface PRDetails {
	prId?: number;
	url: string;
	title: string;
	description: string;
	sourceBranch: string;
	targetBranch: string;
	workItemId?: string;
}

interface CreatePRModalProps {
	isOpen: boolean;
	onClose: () => void;
	theme: Theme;
	// Worktree info
	worktreePath: string;
	worktreeBranch: string;
	// Available branches for target selection
	availableBranches: string[];
	// Callback when PR is created
	onPRCreated?: (details: PRDetails) => void;
}

/**
 * CreatePRModal - Modal for creating a pull request from a worktree branch
 *
 * Features:
 * - Branch selector with main/master as default
 * - Title input (auto-populated from branch name)
 * - Optional description
 * - gh CLI status checking
 * - Progress indicator during PR creation
 */
export function CreatePRModal({
	isOpen,
	onClose,
	theme,
	worktreePath,
	worktreeBranch,
	availableBranches,
	onPRCreated,
}: CreatePRModalProps) {
	const { registerLayer, unregisterLayer } = useLayerStack();
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Form state
	const [targetBranch, setTargetBranch] = useState('main');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [workItemId, setWorkItemId] = useState('');

	// Status state
	const [adoCliStatus, setAdoCliStatus] = useState<AdoCliStatus | null>(null);
	const [existingPrUrl, setExistingPrUrl] = useState<string | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false);
	const [uncommittedCount, setUncommittedCount] = useState(0);

	const detectWorkItemId = (branch: string): string => {
		const match = branch.match(/(?:ado[-/]|wi[-/]|work[-/]?item[-/])(\d+)|\b(\d{2,})\b/i);
		return (match?.[1] || match?.[2] || '').trim();
	};

	// Register with layer stack for Escape handling
	useEffect(() => {
		if (isOpen) {
			const id = registerLayer({
				type: 'modal',
				priority: MODAL_PRIORITIES.CREATE_PR,
				onEscape: () => onCloseRef.current(),
				blocksLowerLayers: true,
				capturesFocus: true,
				focusTrap: 'lenient',
			});
			return () => unregisterLayer(id);
		}
	}, [isOpen, registerLayer, unregisterLayer]);

	// Check az CLI status and uncommitted changes on mount
	useEffect(() => {
		if (isOpen) {
			checkAdoCli();
			checkUncommittedChanges();
			checkExistingPr();
			autofillDescriptionFromChangelog();
			// Auto-populate title from branch name
			const branchTitle = worktreeBranch
				.replace(/[-_]/g, ' ')
				.replace(/^(feat|fix|chore|docs|refactor|test|style)[\s:]/i, '$1: ')
				.trim();
			setTitle(branchTitle || worktreeBranch);
			setWorkItemId(detectWorkItemId(worktreeBranch));
		}
	}, [isOpen, worktreeBranch, worktreePath]);

	// Set default target branch (prefer main, fallback to master)
	useEffect(() => {
		if (isOpen && availableBranches.length > 0) {
			if (availableBranches.includes('main')) {
				setTargetBranch('main');
			} else if (availableBranches.includes('master')) {
				setTargetBranch('master');
			} else {
				setTargetBranch(availableBranches[0]);
			}
		}
	}, [isOpen, availableBranches]);

	const checkAdoCli = async () => {
		try {
			const status = await window.maestro.git.checkAdoCli();
			setAdoCliStatus(status);
		} catch {
			setAdoCliStatus({ installed: false, authenticated: false });
		}
	};

	const checkExistingPr = async () => {
		try {
			const status = await window.maestro.git.getPrStatus(worktreePath, worktreeBranch);
			setExistingPrUrl(status.exists ? status.prUrl || null : null);
		} catch {
			setExistingPrUrl(null);
		}
	};

	const autofillDescriptionFromChangelog = async () => {
		try {
			const log = await window.maestro.git.log(worktreePath, { limit: 5 });
			if (!log.entries || log.entries.length === 0) return;
			const changelog = log.entries
				.map((entry) => entry.subject?.trim())
				.filter((subject): subject is string => Boolean(subject))
				.slice(0, 5)
				.map((subject) => `- ${subject}`)
				.join('\n');
			if (!changelog) return;
			setDescription(`## Changelog\n${changelog}`);
		} catch {
			// Keep description empty if changelog autofill fails.
		}
	};

	const checkUncommittedChanges = async () => {
		try {
			const result = await window.maestro.git.status(worktreePath);
			const lines = result.stdout
				.trim()
				.split('\n')
				.filter((line: string) => line.length > 0);
			setUncommittedCount(lines.length);
			setHasUncommittedChanges(lines.length > 0);
		} catch {
			setHasUncommittedChanges(false);
			setUncommittedCount(0);
		}
	};

	const handleCreatePR = async () => {
		if (!adoCliStatus?.authenticated) return;

		setIsCreating(true);
		setError(null);

		try {
			const result = await window.maestro.git.createPR(
				worktreePath,
				targetBranch,
				title,
				description,
				workItemId
			);

			if (result.success && result.prUrl) {
				window.maestro.shell.openExternal(result.prUrl);
				onPRCreated?.({
					prId: result.prId,
					url: result.prUrl,
					title,
					description,
					sourceBranch: worktreeBranch,
					targetBranch,
					workItemId: workItemId.trim() || undefined,
				});
				onClose();
			} else {
				setError(result.error || 'Failed to create ADO PR');
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create ADO PR');
		} finally {
			setIsCreating(false);
		}
	};

	if (!isOpen) return null;

	const canCreate = adoCliStatus?.authenticated && title.trim() && !isCreating && !existingPrUrl;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			<div className="absolute inset-0 bg-black/60" onClick={onClose} />

			{/* Modal */}
			<div
				className="relative w-full max-w-md rounded-lg shadow-2xl border"
				style={{
					backgroundColor: theme.colors.bgSidebar,
					borderColor: theme.colors.border,
				}}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between px-4 py-3 border-b"
					style={{ borderColor: theme.colors.border }}
				>
					<div className="flex items-center gap-2">
						<GitPullRequest className="w-5 h-5" style={{ color: theme.colors.accent }} />
						<h2 className="font-bold" style={{ color: theme.colors.textMain }}>
							Create PR in ADO
						</h2>
					</div>
					<button onClick={onClose} className="p-1 rounded hover:bg-white/10 transition-colors">
						<X className="w-4 h-4" style={{ color: theme.colors.textDim }} />
					</button>
				</div>

				{/* Content */}
				<div className="p-4 space-y-4">
					{/* az CLI not installed */}
					{adoCliStatus !== null && !adoCliStatus.installed && (
						<div
							className="flex items-start gap-2 p-3 rounded border"
							style={{
								backgroundColor: theme.colors.warning + '10',
								borderColor: theme.colors.warning,
							}}
						>
							<AlertTriangle
								className="w-4 h-4 mt-0.5 shrink-0"
								style={{ color: theme.colors.warning }}
							/>
							<div className="text-sm">
								<p style={{ color: theme.colors.warning }}>Azure CLI not installed</p>
								<p className="mt-1" style={{ color: theme.colors.textDim }}>
									Install{' '}
									<button
										type="button"
										className="underline hover:opacity-80"
										style={{ color: theme.colors.accent }}
										onClick={() => window.maestro.shell.openExternal('https://aka.ms/azure-cli')}
									>
										Azure CLI
									</button>{' '}
									to create pull requests in Azure DevOps.
								</p>
							</div>
						</div>
					)}

					{/* az CLI not authenticated */}
					{adoCliStatus?.installed && !adoCliStatus.authenticated && (
						<div
							className="flex items-start gap-2 p-3 rounded border"
							style={{
								backgroundColor: theme.colors.warning + '10',
								borderColor: theme.colors.warning,
							}}
						>
							<AlertTriangle
								className="w-4 h-4 mt-0.5 shrink-0"
								style={{ color: theme.colors.warning }}
							/>
							<div className="text-sm">
								<p style={{ color: theme.colors.warning }}>Azure CLI not authenticated</p>
								<p className="mt-1" style={{ color: theme.colors.textDim }}>
									Run{' '}
									<code
										className="px-1 py-0.5 rounded"
										style={{ backgroundColor: theme.colors.bgActivity }}
									>
										az login
									</code>{' '}
									in your terminal to authenticate.
								</p>
							</div>
						</div>
					)}

					{/* Still checking az CLI */}
					{adoCliStatus === null && (
						<div
							className="flex items-center gap-2 text-sm"
							style={{ color: theme.colors.textDim }}
						>
							<Loader2 className="w-4 h-4 animate-spin" />
							Checking Azure CLI...
						</div>
					)}

					{/* Form (only shown when az CLI is authenticated) */}
					{adoCliStatus?.authenticated && (
						<>
							{existingPrUrl && (
								<div
									className="flex items-start gap-2 p-3 rounded border"
									style={{
										backgroundColor: theme.colors.warning + '10',
										borderColor: theme.colors.warning,
									}}
								>
									<AlertTriangle
										className="w-4 h-4 mt-0.5 shrink-0"
										style={{ color: theme.colors.warning }}
									/>
									<div className="text-sm">
										<p style={{ color: theme.colors.warning }}>
											An active ADO PR already exists for this branch.
										</p>
										<button
											type="button"
											className="mt-1 inline-flex items-center gap-1 underline hover:opacity-80"
											style={{ color: theme.colors.accent }}
											onClick={() => window.maestro.shell.openExternal(existingPrUrl)}
										>
											Open existing PR
											<ExternalLink className="w-3 h-3" />
										</button>
									</div>
								</div>
							)}

							{/* Uncommitted changes warning */}
							{hasUncommittedChanges && (
								<div
									className="flex items-start gap-2 p-3 rounded border"
									style={{
										backgroundColor: theme.colors.warning + '10',
										borderColor: theme.colors.warning,
									}}
								>
									<AlertTriangle
										className="w-4 h-4 mt-0.5 shrink-0"
										style={{ color: theme.colors.warning }}
									/>
									<div className="text-sm">
										<p style={{ color: theme.colors.warning }}>
											{uncommittedCount} uncommitted change{uncommittedCount !== 1 ? 's' : ''}
										</p>
										<p className="mt-1" style={{ color: theme.colors.textDim }}>
											Only committed changes will be included in the PR. Uncommitted changes will
											not be pushed.
										</p>
									</div>
								</div>
							)}

							{/* From branch (read-only) */}
							<div>
								<label
									className="text-xs font-medium mb-1.5 block"
									style={{ color: theme.colors.textDim }}
								>
									From Branch
								</label>
								<div
									className="px-3 py-2 rounded border text-sm"
									style={{
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
										backgroundColor: theme.colors.bgActivity,
									}}
								>
									{worktreeBranch}
								</div>
							</div>

							{/* Target branch */}
							<div>
								<label
									className="text-xs font-medium mb-1.5 block"
									style={{ color: theme.colors.textDim }}
								>
									Target Branch
								</label>
								<select
									value={targetBranch}
									onChange={(e) => setTargetBranch(e.target.value)}
									className="w-full px-3 py-2 rounded border bg-transparent outline-none text-sm cursor-pointer"
									style={{
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								>
									{availableBranches.map((branch) => (
										<option
											key={branch}
											value={branch}
											style={{ backgroundColor: theme.colors.bgSidebar }}
										>
											{branch}
										</option>
									))}
								</select>
							</div>

							{/* Title */}
							<div>
								<label
									className="text-xs font-medium mb-1.5 block"
									style={{ color: theme.colors.textDim }}
								>
									Title
								</label>
								<input
									type="text"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									placeholder="PR title..."
									className="w-full px-3 py-2 rounded border bg-transparent outline-none text-sm"
									style={{
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								/>
							</div>

							{/* Description */}
							<div>
								<label
									className="text-xs font-medium mb-1.5 block"
									style={{ color: theme.colors.textDim }}
								>
									Description <span className="opacity-50">(optional)</span>
								</label>
								<textarea
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="Add a description..."
									rows={3}
									className="w-full px-3 py-2 rounded border bg-transparent outline-none text-sm resize-none"
									style={{
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								/>
							</div>

							{/* Work item ID */}
							<div>
								<label
									className="text-xs font-medium mb-1.5 block"
									style={{ color: theme.colors.textDim }}
								>
									ADO Work Item ID <span className="opacity-50">(optional)</span>
								</label>
								<input
									type="text"
									value={workItemId}
									onChange={(e) => setWorkItemId(e.target.value.replace(/[^\d]/g, ''))}
									placeholder="12345"
									className="w-full px-3 py-2 rounded border bg-transparent outline-none text-sm"
									style={{
										borderColor: theme.colors.border,
										color: theme.colors.textMain,
									}}
								/>
								<p className="text-[10px] mt-1" style={{ color: theme.colors.textDim }}>
									If provided, this PR will be linked using `--work-items`.
								</p>
							</div>

							{/* Error message */}
							{error && (
								<div
									className="flex items-start gap-2 p-3 rounded border overflow-hidden"
									style={{
										backgroundColor: theme.colors.error + '10',
										borderColor: theme.colors.error,
									}}
								>
									<AlertTriangle
										className="w-4 h-4 mt-0.5 shrink-0"
										style={{ color: theme.colors.error }}
									/>
									<p className="text-sm break-words min-w-0" style={{ color: theme.colors.error }}>
										{renderErrorWithLinks(error, theme)}
									</p>
								</div>
							)}
						</>
					)}
				</div>

				{/* Footer */}
				<div
					className="flex items-center justify-end gap-2 px-4 py-3 border-t"
					style={{ borderColor: theme.colors.border }}
				>
					<button
						onClick={onClose}
						className="px-4 py-2 rounded text-sm hover:bg-white/10 transition-colors"
						style={{ color: theme.colors.textMain }}
					>
						Cancel
					</button>
					<button
						onClick={handleCreatePR}
						disabled={!canCreate}
						className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${
							canCreate ? 'hover:opacity-90' : 'opacity-50 cursor-not-allowed'
						}`}
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						{isCreating ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" />
								Creating...
							</>
						) : (
							<>
								<GitPullRequest className="w-4 h-4" />
								Create PR in ADO
							</>
						)}
					</button>
				</div>
			</div>
		</div>
	);
}

export default CreatePRModal;
