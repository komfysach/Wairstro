import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Bot, X, ArrowDown, Ticket, Loader2 } from 'lucide-react';
import type { Theme } from '../types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import type {
	OrchestratorState,
	SprintExecutionPlan,
	SprintExecutionResult,
} from '../../shared/orchestrator-types';

interface SprintCommandCenterModalProps {
	theme: Theme;
	isOpen: boolean;
	state: OrchestratorState;
	plan: SprintExecutionPlan | null;
	execution: SprintExecutionResult | null;
	error: string | null;
	onClose: () => void;
}

function stateLabel(state: OrchestratorState): string {
	if (state === 'planning') return 'Planning';
	if (state === 'delegating') return 'Delegating';
	if (state === 'ready') return 'Ready';
	return 'Error';
}

function stateColor(theme: Theme, state: OrchestratorState): string {
	if (state === 'planning') return theme.colors.warning;
	if (state === 'delegating') return theme.colors.accent;
	if (state === 'ready') return '#22c55e';
	return theme.colors.error;
}

export function SprintCommandCenterModal({
	theme,
	isOpen,
	state,
	plan,
	execution,
	error,
	onClose,
}: SprintCommandCenterModalProps) {
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();
	const onCloseRef = useRef(onClose);

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
			priority: MODAL_PRIORITIES.MFE_DASHBOARD + 1,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Sprint Command Center',
			onEscape: handleEscape,
		});
		return () => {
			if (layerIdRef.current) unregisterLayer(layerIdRef.current);
		};
	}, [handleEscape, isOpen, registerLayer, unregisterLayer]);

	useEffect(() => {
		if (layerIdRef.current) {
			updateLayerHandler(layerIdRef.current, handleEscape);
		}
	}, [handleEscape, updateLayerHandler]);

	const workers = useMemo(() => execution?.workers || [], [execution]);
	const totalTickets = useMemo(
		() => workers.reduce((count, worker) => count + worker.tasks.length, 0),
		[workers]
	);

	if (!isOpen) return null;

	return createPortal(
		<div className="fixed inset-0 z-[9999] modal-overlay flex items-center justify-center" onClick={onClose}>
			<div
				className="w-[min(1180px,95vw)] h-[min(760px,88vh)] rounded-xl border flex flex-col overflow-hidden"
				style={{ backgroundColor: theme.colors.bgMain, borderColor: theme.colors.border }}
				onClick={(event) => event.stopPropagation()}
			>
				<div
					className="px-4 py-3 border-b flex items-center justify-between"
					style={{ borderColor: theme.colors.border }}
				>
					<div className="flex items-center gap-3">
						<Brain className="w-5 h-5" style={{ color: theme.colors.accent }} />
						<div>
							<div className="font-bold text-sm" style={{ color: theme.colors.textMain }}>
								Sprint Command Center
							</div>
							<div className="text-xs" style={{ color: theme.colors.textDim }}>
								Manager Agent orchestration for ADO sprint items
							</div>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<div
							className="text-xs px-2 py-1 rounded border"
							style={{
								borderColor: `${stateColor(theme, state)}55`,
								color: stateColor(theme, state),
							}}
						>
							Orchestrator: {stateLabel(state)}
						</div>
						<button
							type="button"
							onClick={onClose}
							className="p-1.5 rounded"
							style={{ color: theme.colors.textDim }}
							aria-label="Close sprint command center"
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				</div>

				<div className="flex-1 overflow-auto p-4 space-y-4">
					{error ? (
						<div
							className="text-sm rounded border px-3 py-2"
							style={{
								borderColor: `${theme.colors.error}55`,
								backgroundColor: `${theme.colors.error}10`,
								color: theme.colors.error,
							}}
						>
							{error}
						</div>
					) : null}

					<div className="rounded-lg border p-4" style={{ borderColor: theme.colors.border }}>
						<div className="flex items-center gap-2 mb-2">
							<Brain className="w-4 h-4" style={{ color: theme.colors.accent }} />
							<div className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
								ManagerAgent
							</div>
							<div className="text-xs" style={{ color: theme.colors.textDim }}>
								{plan?.manager.agentType || 'claude-code'}
							</div>
						</div>
						<div className="text-xs" style={{ color: theme.colors.textDim }}>
							{plan?.manager.systemPrompt || 'Preparing sprint execution plan...'}
						</div>
						<div className="mt-3 flex items-center gap-2 text-xs" style={{ color: theme.colors.textDim }}>
							<Ticket className="w-3.5 h-3.5" />
							<span>{totalTickets} tickets routed</span>
						</div>
					</div>

					<div className="flex justify-center">
						{state === 'planning' || state === 'delegating' ? (
							<Loader2 className="w-4 h-4 animate-spin" style={{ color: theme.colors.accent }} />
						) : (
							<ArrowDown className="w-4 h-4" style={{ color: theme.colors.textDim }} />
						)}
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
						{workers.map((worker) => (
							<div
								key={`${worker.packagePath}-${worker.workerName}`}
								className="rounded-lg border p-3 space-y-2"
								style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
							>
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2 min-w-0">
										<Bot className="w-4 h-4 shrink-0" style={{ color: theme.colors.accent }} />
										<div className="min-w-0">
											<div className="text-xs font-semibold truncate" style={{ color: theme.colors.textMain }}>
												{worker.workerName}
											</div>
											<div className="text-[10px] truncate" style={{ color: theme.colors.textDim }}>
												{worker.packageName}
											</div>
										</div>
									</div>
									<div
										className="text-[10px] px-2 py-0.5 rounded border"
										style={{
											borderColor: worker.status === 'busy' ? `${theme.colors.warning}55` : '#22c55e55',
											color: worker.status === 'busy' ? theme.colors.warning : '#22c55e',
										}}
									>
										{worker.status === 'busy' ? 'Busy' : 'Idle'}
									</div>
								</div>
								<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
									{worker.action === 'reuse' ? 'Reused existing worker' : 'Created worker from AgentFactory'}
								</div>
								<div className="space-y-1">
									{worker.tasks.map((task) => (
										<div
											key={`${worker.packagePath}-${task.id}`}
											className="text-[10px] rounded px-2 py-1 border"
											style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
										>
											#{task.id} {task.title}
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>,
		document.body
	);
}
