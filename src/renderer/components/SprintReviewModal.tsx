import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Theme } from '../types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { generateTerminalProseStyles } from '../utils/markdownConfig';
import { MarkdownRenderer } from './MarkdownRenderer';

interface SprintReviewModalProps {
	theme: Theme;
	isOpen: boolean;
	isGenerating: boolean;
	markdown: string;
	error: string | null;
	warnings: string[];
	generatedAt: number | null;
	onClose: () => void;
	onGenerate: () => void;
}

function formatGeneratedAt(value: number | null): string {
	if (!value) return '';
	return new Date(value).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

export function SprintReviewModal({
	theme,
	isOpen,
	isGenerating,
	markdown,
	error,
	warnings,
	generatedAt,
	onClose,
	onGenerate,
}: SprintReviewModalProps) {
	const [copied, setCopied] = useState(false);
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();
	const onCloseRef = useRef(onClose);
	const proseStyles = useMemo(() => generateTerminalProseStyles(theme, '.sprint-review-content'), [theme]);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	const handleEscape = useCallback(() => {
		onCloseRef.current();
	}, []);

	useEffect(() => {
		if (!isOpen) return;

		layerIdRef.current = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.SPRINT_REVIEW || 847,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Sprint Review',
			onEscape: handleEscape,
		});

		return () => {
			if (layerIdRef.current) {
				unregisterLayer(layerIdRef.current);
			}
		};
	}, [isOpen, registerLayer, unregisterLayer, handleEscape]);

	useEffect(() => {
		if (layerIdRef.current) {
			updateLayerHandler(layerIdRef.current, handleEscape);
		}
	}, [updateLayerHandler, handleEscape]);

	const copyMarkdown = useCallback(async () => {
		if (!markdown) return;
		await navigator.clipboard.writeText(markdown);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [markdown]);

	if (!isOpen) return null;

	return createPortal(
		<div
			className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999] animate-in fade-in duration-200"
			onClick={onClose}
		>
			<div
				className="w-[min(1100px,92vw)] h-[min(780px,88vh)] rounded-xl border shadow-2xl flex flex-col"
				style={{
					backgroundColor: theme.colors.bgMain,
					borderColor: theme.colors.border,
				}}
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="sprint-review-title"
			>
				<div
					className="px-5 py-3 border-b flex items-center justify-between gap-3"
					style={{ borderColor: theme.colors.border }}
				>
					<div>
						<h2 id="sprint-review-title" className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
							Sprint Review
						</h2>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{generatedAt ? `Generated ${formatGeneratedAt(generatedAt)}` : 'Generate a markdown changelog from active MFE worktrees and ADO sprint state.'}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={onGenerate}
							disabled={isGenerating}
							className="px-3 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						>
							{isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
							{isGenerating ? 'Generating...' : 'Regenerate'}
						</button>
						<button
							onClick={copyMarkdown}
							disabled={!markdown || isGenerating}
							className="px-3 py-1.5 rounded text-xs font-semibold border flex items-center gap-1.5 disabled:opacity-60"
							style={{
								borderColor: copied ? theme.colors.accent : theme.colors.border,
								color: copied ? theme.colors.accent : theme.colors.textMain,
							}}
						>
							{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
							{copied ? 'Copied' : 'Copy to Clipboard'}
						</button>
						<button
							type="button"
							onClick={onClose}
							className="p-1.5 rounded hover:bg-white/10"
							style={{ color: theme.colors.textDim }}
							aria-label="Close sprint review modal"
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				</div>

				{warnings.length > 0 && (
					<div
						className="mx-5 mt-3 p-3 rounded border text-xs"
						style={{
							borderColor: `${theme.colors.warning}50`,
							backgroundColor: `${theme.colors.warning}14`,
							color: theme.colors.warning,
						}}
					>
						<div className="font-semibold mb-1">Warnings</div>
						<div className="space-y-1">
							{warnings.map((warning, index) => (
								<div key={`${warning}-${index}`}>- {warning}</div>
							))}
						</div>
					</div>
				)}

				<div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
					{isGenerating ? (
						<div className="h-full flex flex-col items-center justify-center gap-3" style={{ color: theme.colors.textDim }}>
							<Loader2 className="w-8 h-8 animate-spin" />
							<div className="text-sm">Building sprint review from worktree diffs and ADO sprint items...</div>
						</div>
					) : error ? (
						<div
							className="p-4 rounded border text-sm flex items-start gap-2"
							style={{
								borderColor: `${theme.colors.error}55`,
								backgroundColor: `${theme.colors.error}12`,
								color: theme.colors.error,
							}}
						>
							<AlertTriangle className="w-4 h-4 mt-0.5" />
							<div>{error}</div>
						</div>
					) : markdown ? (
						<div className="sprint-review-content">
							<style>{proseStyles}</style>
							<MarkdownRenderer
								content={markdown}
								theme={theme}
								onCopy={(text) => navigator.clipboard.writeText(text)}
							/>
						</div>
					) : (
						<div className="h-full flex items-center justify-center text-sm" style={{ color: theme.colors.textDim }}>
							No sprint review generated yet.
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body
	);
}
