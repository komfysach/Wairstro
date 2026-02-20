import { useEffect, useRef, useState } from 'react';
import { Figma, Play, Loader2, GitPullRequest } from 'lucide-react';
import type { Theme } from '../types';
import type { AdoBoardItem } from '../services/ado';
import { resolveTaskProfile } from '../../shared/task-routing';
import { useFigmaDesignFetcher } from '../hooks/ado/useFigmaDesignFetcher';
import { mcpService } from '../services/mcp';

interface KanbanCardProps {
	theme: Theme;
	item: AdoBoardItem;
	lane: AdoBoardItem['lane'];
	taskProfileIcon: string;
	liveStatus?: 'building' | 'testing';
	cardError?: string;
	prUrl?: string;
	designContextUrl: string;
	designContextImageUrl?: string;
	designContextImagePath?: string;
	onDesignContextChange: (
		ticketId: number,
		url: string,
		verifiedNodeName?: string,
		image?: { imagePath?: string; imageUrl?: string }
	) => void;
	onAttachContext?: (item: AdoBoardItem) => void;
	attachedContextCount?: number;
	onRunTicket: (item: AdoBoardItem) => void;
	isExecuting?: boolean;
	onQuickPr?: (item: AdoBoardItem) => void;
	isQuickPring?: boolean;
	prId?: number;
	onMergeAndComplete?: (item: AdoBoardItem, prId?: number) => void;
	isMergeCompleting?: boolean;
	previewState?: {
		status: 'idle' | 'starting' | 'running' | 'error';
		url?: string;
		error?: string;
	};
	onStartPreview?: (item: AdoBoardItem) => void;
}

function stripHtml(input: string): string {
	return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function LiveStatusBadge({
	status,
}: {
	status: 'building' | 'testing' | undefined;
}) {
	if (!status) return null;
	if (status === 'testing') {
		return <span className="text-[10px] font-semibold">🔵 Testing</span>;
	}
	return <span className="text-[10px] font-semibold">🟢 Building</span>;
}

export function KanbanCard({
	theme,
	item,
	lane,
	taskProfileIcon,
	liveStatus,
	cardError,
	prUrl,
	designContextUrl,
	designContextImageUrl,
	designContextImagePath,
	onDesignContextChange,
	onAttachContext,
	attachedContextCount = 0,
	onRunTicket,
	isExecuting = false,
	onQuickPr,
	isQuickPring = false,
	prId,
	onMergeAndComplete,
	isMergeCompleting = false,
	previewState,
	onStartPreview,
}: KanbanCardProps) {
	const preview = stripHtml(item.description || item.acceptanceCriteria).slice(0, 140) || 'No description';
	const taskProfile = item.taskProfile || resolveTaskProfile(item.tags || []);
	const verification = useFigmaDesignFetcher(designContextUrl);
	const lastVerifiedRef = useRef<string | null>(null);
	const lastExportSignatureRef = useRef<string | null>(null);
	const [isExportingImage, setIsExportingImage] = useState(false);
	const [imageExportError, setImageExportError] = useState<string | null>(null);
	const [resolvedImageSrc, setResolvedImageSrc] = useState<string | null>(null);

	useEffect(() => {
		if (verification.status !== 'verified' || !verification.nodeName) return;
		const signature = `${designContextUrl.trim()}::${verification.nodeName}`;
		if (lastVerifiedRef.current === signature) return;
		lastVerifiedRef.current = signature;
		onDesignContextChange(item.id, designContextUrl, verification.nodeName);
	}, [verification.status, verification.nodeName, designContextUrl, item.id, onDesignContextChange]);

	useEffect(() => {
		if (verification.status !== 'verified' || !verification.nodeId) return;
		const trimmedUrl = designContextUrl.trim();
		if (!trimmedUrl) return;
		const signature = `${trimmedUrl}::${verification.nodeId}`;
		if (lastExportSignatureRef.current === signature) return;
		lastExportSignatureRef.current = signature;
		setIsExportingImage(true);
		setImageExportError(null);
		mcpService
			.exportFigmaImage(trimmedUrl)
			.then((result) => {
				onDesignContextChange(item.id, designContextUrl, verification.nodeName, {
					imagePath: result.imagePath,
					imageUrl: result.imageUrl,
				});
			})
			.catch((error) => {
				setImageExportError(error instanceof Error ? error.message : 'Failed to export Figma image.');
			})
			.finally(() => {
				setIsExportingImage(false);
			});
	}, [verification.status, verification.nodeId, verification.nodeName, designContextUrl, item.id, onDesignContextChange]);

	useEffect(() => {
		const inlineDataUrl = designContextImageUrl?.trim();
		if (inlineDataUrl && inlineDataUrl.startsWith('data:')) {
			setResolvedImageSrc(inlineDataUrl);
			return;
		}

		const imagePath = designContextImagePath?.trim();
		if (!imagePath) {
			setResolvedImageSrc(inlineDataUrl || null);
			return;
		}

		let cancelled = false;
		window.maestro.fs
			.readFile(imagePath)
			.then((result) => {
				if (cancelled) return;
				setResolvedImageSrc(typeof result === 'string' && result.startsWith('data:') ? result : inlineDataUrl || null);
			})
			.catch(() => {
				if (cancelled) return;
				setResolvedImageSrc(inlineDataUrl || null);
			});
		return () => {
			cancelled = true;
		};
	}, [designContextImagePath, designContextImageUrl]);

	return (
		<div
			draggable
			onDragStart={(event) => {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('application/x-maestro-kanban-item-id', String(item.id));
			}}
			className="rounded border p-2 cursor-grab active:cursor-grabbing"
			style={{
				borderColor: cardError ? theme.colors.error : theme.colors.border,
				backgroundColor: theme.colors.bgMain,
			}}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 text-xs font-semibold leading-4 break-words" style={{ color: theme.colors.textMain }}>
					#{item.id} {item.title}
				</div>
				<div className="flex items-center justify-end gap-1 flex-shrink-0 flex-wrap max-w-[8rem]">
					<span
						className="inline-flex h-5 w-5 items-center justify-center rounded border text-[11px]"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						title={`Task Profile: ${taskProfile}`}
					>
						{taskProfileIcon}
					</span>
					{/* {hasDesignContext && (
						<Figma className="w-3.5 h-3.5 mt-0.5" style={{ color: theme.colors.accent }} />
					)} */}
					<button
						type="button"
						onClick={() => onAttachContext?.(item)}
						disabled={!onAttachContext}
						className="px-1.5 py-0.5 rounded border text-[10px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						title={`Attach file context for #${item.id}`}
					>
						📎 {attachedContextCount > 0 ? attachedContextCount : 'Attach'}
					</button>
					<button
						type="button"
						onClick={() => onRunTicket(item)}
						disabled={isExecuting}
						className="px-1.5 py-0.5 rounded border text-[10px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
						style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
						title={isExecuting ? 'Running ticket orchestration...' : `Run ticket #${item.id}`}
					>
						{isExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
						{/* {isExecuting ? 'Running' : 'Run'} */}
					</button>
					<button
						type="button"
						onClick={() => onQuickPr?.(item)}
						disabled={isQuickPring || !onQuickPr}
						className="px-1.5 py-0.5 rounded border text-[10px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						title={isQuickPring ? 'Creating quick PR...' : `Create quick PR for #${item.id}`}
					>
						{isQuickPring ? (
							<Loader2 className="w-3 h-3 animate-spin" />
						) : (
							<GitPullRequest className="w-3 h-3" />
						)}
						{/* {isQuickPring ? 'PR...' : 'Quick PR'} */}
					</button>
				</div>
			</div>
			<div className="mt-1 text-[10px]" style={{ color: theme.colors.textDim }}>
				{item.boardColumn || item.state}
			</div>
			<div className="mt-1 text-[11px] leading-4" style={{ color: theme.colors.textDim }}>
				{preview}
			</div>

			<div className="mt-2 space-y-1">
				<label className="block text-[10px] uppercase font-semibold" style={{ color: theme.colors.textDim }}>
					Design Context
				</label>
				<input
					type="text"
					value={designContextUrl}
					onChange={(event) => onDesignContextChange(item.id, event.target.value)}
					onDragStart={(event) => event.stopPropagation()}
					placeholder="https://www.figma.com/design/...?...node-id="
					className="w-full rounded border px-1.5 py-1 text-[10px] bg-transparent outline-none"
					style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
				/>
				{verification.status === 'validating' && (
					<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
						Verifying Figma link...
					</div>
				)}
				{verification.status === 'verified' && (
					<div className="text-[10px] flex items-center gap-1" style={{ color: theme.colors.success }}>
						<Figma className="w-3 h-3" />
						Verified Link: {verification.nodeName}
					</div>
				)}
				{verification.status === 'invalid' && (
					<div className="text-[10px]" style={{ color: theme.colors.warning }}>
						{verification.message}
					</div>
				)}
				{verification.status === 'error' && (
					<div className="text-[10px]" style={{ color: theme.colors.error }}>
						{verification.message}
					</div>
				)}
				{isExportingImage && (
					<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
						Exporting reference image...
					</div>
				)}
				{imageExportError && (
					<div className="text-[10px]" style={{ color: theme.colors.error }}>
						{imageExportError}
					</div>
				)}
				{resolvedImageSrc && (
					<div className="rounded border p-1" style={{ borderColor: theme.colors.border }}>
						<img
							src={resolvedImageSrc}
							alt="Figma design reference"
							className="w-full h-24 object-cover rounded"
							onDragStart={(event) => event.stopPropagation()}
						/>
					</div>
				)}
			</div>

			{lane === 'Active' && (
				<div className="mt-2 flex items-center justify-between">
					<LiveStatusBadge status={liveStatus} />
					<div className="flex items-center gap-2">
						{previewState?.status === 'running' && previewState.url ? (
							<a
								href="#"
								onClick={(event) => {
									event.preventDefault();
									window.maestro.shell.openExternal(previewState.url!);
								}}
								className="text-[10px] font-semibold underline"
								style={{ color: theme.colors.success }}
								title={`Open preview app (${previewState.url})`}
							>
								Open App
							</a>
						) : (
							<button
								type="button"
								onClick={() => onStartPreview?.(item)}
								disabled={
									previewState?.status === 'starting' ||
									!onStartPreview
								}
								className="px-1.5 py-0.5 rounded border text-[10px] font-semibold disabled:opacity-60"
								style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
								title={
									previewState?.status === 'starting'
										? 'Starting preview server...'
										: previewState?.error || 'Start worktree preview server'
								}
							>
								{previewState?.status === 'starting' ? <Loader2 className="w-3 h-3 animate-spin" /> : '👁️'}
							</button>
						)}
						{cardError && <span className="text-[10px] font-semibold">🔴 Error</span>}
					</div>
				</div>
			)}
			{lane === 'Review' && (
				<div className="mt-2 flex items-center justify-between gap-2">
					{prUrl ? (
						<a
							href="#"
							onClick={(event) => {
								event.preventDefault();
								window.maestro.shell.openExternal(prUrl);
							}}
							className="text-[10px] underline"
							style={{ color: theme.colors.accent }}
						>
							Open PR
						</a>
					) : (
						<span className="text-[10px]" style={{ color: theme.colors.textDim }}>
							PR link unavailable
						</span>
					)}
					<button
						type="button"
						onClick={() => onMergeAndComplete?.(item, prId)}
						disabled={isMergeCompleting || !onMergeAndComplete}
						className="px-1.5 py-0.5 rounded border text-[10px] font-semibold inline-flex items-center gap-1 disabled:opacity-60"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						title={isMergeCompleting ? 'Completing PR and cleaning up worktree...' : 'Merge PR and close ticket'}
					>
						{isMergeCompleting ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
						Merge & Complete
					</button>
				</div>
			)}
		</div>
	);
}

export default KanbanCard;
