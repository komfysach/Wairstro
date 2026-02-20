import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adoService, type KanbanLane } from './ado';

export type KanbanAgentEvent =
	| {
			type: 'agent:started';
			ticketId: number;
			sessionId?: string;
			processSessionId?: string;
	  }
	| {
			type: 'agent:pr_created';
			ticketId: number;
			prUrl?: string;
			prId?: number;
	  }
	| {
			type: 'agent:pr_merged';
			ticketId: number;
	  }
	| {
			type: 'pr:created';
			ticketId: number;
			prUrl?: string;
			prId?: number;
	  }
	| {
			type: 'pr:completed';
			ticketId: number;
	  }
	| {
			type: 'agent:error';
			ticketId?: number;
			sessionId?: string;
			processSessionId?: string;
			errorMessage?: string;
	  };

type LiveStatus = 'building' | 'testing';

interface KanbanControllerState {
	liveStatusByTicket: Record<number, LiveStatus>;
	errorByTicket: Record<number, string>;
	prUrlByTicket: Record<number, string>;
	prIdByTicket: Record<number, number>;
}

interface UseKanbanControllerOptions {
	boardName?: string;
	onBoardMutation?: () => Promise<void> | void;
}

const EVENT_NAME = 'kanban:lifecycle';
const PR_CREATED_EVENT_NAME = 'pr:created';
const PR_COMPLETED_EVENT_NAME = 'pr:completed';
const TEST_KEYWORDS = ['test', 'jest', 'vitest', 'cypress', 'playwright', 'qa'];

function eventTargetLane(event: KanbanAgentEvent): KanbanLane | null {
	if (event.type === 'agent:started') return 'Active';
	if (event.type === 'agent:pr_created' || event.type === 'pr:created') return 'Review';
	if (event.type === 'pr:completed') return 'Closed';
	if (event.type === 'agent:pr_merged') return 'Resolved';
	return null;
}

function isTestingTool(toolName?: string): boolean {
	if (!toolName) return false;
	const normalized = toolName.toLowerCase();
	return TEST_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function emitKanbanLifecycleEvent(event: KanbanAgentEvent): void {
	window.dispatchEvent(new CustomEvent<KanbanAgentEvent>(EVENT_NAME, { detail: event }));
}

export function emitPrCreatedEvent(event: {
	ticketId: number;
	prUrl?: string;
	prId?: number;
}): void {
	window.dispatchEvent(new CustomEvent(PR_CREATED_EVENT_NAME, { detail: event }));
}

export function emitPrCompletedEvent(event: { ticketId: number }): void {
	window.dispatchEvent(new CustomEvent(PR_COMPLETED_EVENT_NAME, { detail: event }));
}

export function useKanbanController(options: UseKanbanControllerOptions) {
	const { boardName, onBoardMutation } = options;
	const sessionTicketMapRef = useRef<Record<string, number>>({});
	const processTicketMapRef = useRef<Record<string, number>>({});
	const [state, setState] = useState<KanbanControllerState>({
		liveStatusByTicket: {},
		errorByTicket: {},
		prUrlByTicket: {},
		prIdByTicket: {},
	});

	const handleEvent = useCallback(
		async (event: KanbanAgentEvent) => {
			if (event.type === 'agent:started') {
				if (event.sessionId) sessionTicketMapRef.current[event.sessionId] = event.ticketId;
				if (event.processSessionId) processTicketMapRef.current[event.processSessionId] = event.ticketId;
				setState((prev) => ({
					...prev,
					liveStatusByTicket: { ...prev.liveStatusByTicket, [event.ticketId]: 'building' },
					errorByTicket: Object.fromEntries(
						Object.entries(prev.errorByTicket).filter(([key]) => Number(key) !== event.ticketId)
					),
				}));
			}

			if (
				(event.type === 'agent:pr_created' || event.type === 'pr:created') &&
				(event.prUrl || typeof event.prId === 'number')
			) {
				setState((prev) => ({
					...prev,
					prUrlByTicket: event.prUrl
						? { ...prev.prUrlByTicket, [event.ticketId]: event.prUrl }
						: prev.prUrlByTicket,
					prIdByTicket:
						typeof event.prId === 'number'
							? { ...prev.prIdByTicket, [event.ticketId]: event.prId }
							: prev.prIdByTicket,
					errorByTicket: Object.fromEntries(
						Object.entries(prev.errorByTicket).filter(([key]) => Number(key) !== event.ticketId)
					),
				}));
			}

			if (event.type === 'agent:error') {
				const mappedTicket =
					event.ticketId ||
					(event.sessionId ? sessionTicketMapRef.current[event.sessionId] : undefined) ||
					(event.processSessionId ? processTicketMapRef.current[event.processSessionId] : undefined);
				if (!mappedTicket) return;
				setState((prev) => ({
					...prev,
					errorByTicket: {
						...prev.errorByTicket,
						[mappedTicket]: event.errorMessage || 'Agent execution error',
					},
				}));
				return;
			}

			const lane = eventTargetLane(event);
			if (!lane) return;
			await adoService.moveItemToColumn(event.ticketId, lane, boardName);
			if (onBoardMutation) {
				await onBoardMutation();
			}
		},
		[boardName, onBoardMutation]
	);

	useEffect(() => {
		const onLifecycle = (rawEvent: Event) => {
			const customEvent = rawEvent as CustomEvent<KanbanAgentEvent>;
			if (!customEvent.detail) return;
			void handleEvent(customEvent.detail).catch(() => {
				// Non-blocking; board refresh handles eventual consistency.
			});
		};
		const onPrCreated = (rawEvent: Event) => {
			const customEvent = rawEvent as CustomEvent<{ ticketId?: number; prUrl?: string; prId?: number }>;
			if (!customEvent.detail?.ticketId) return;
			void handleEvent({
				type: 'pr:created',
				ticketId: customEvent.detail.ticketId,
				prUrl: customEvent.detail.prUrl,
				prId: customEvent.detail.prId,
			}).catch(() => {
				// Non-blocking; board refresh handles eventual consistency.
			});
		};
		const onPrCompleted = (rawEvent: Event) => {
			const customEvent = rawEvent as CustomEvent<{ ticketId?: number }>;
			if (!customEvent.detail?.ticketId) return;
			void handleEvent({
				type: 'pr:completed',
				ticketId: customEvent.detail.ticketId,
			}).catch(() => {
				// Non-blocking; board refresh handles eventual consistency.
			});
		};
		window.addEventListener(EVENT_NAME, onLifecycle as EventListener);
		window.addEventListener(PR_CREATED_EVENT_NAME, onPrCreated as EventListener);
		window.addEventListener(PR_COMPLETED_EVENT_NAME, onPrCompleted as EventListener);
		return () => {
			window.removeEventListener(EVENT_NAME, onLifecycle as EventListener);
			window.removeEventListener(PR_CREATED_EVENT_NAME, onPrCreated as EventListener);
			window.removeEventListener(PR_COMPLETED_EVENT_NAME, onPrCompleted as EventListener);
		};
	}, [handleEvent]);

	useEffect(() => {
		const unsubscribeError = window.maestro.process.onAgentError((sessionId, error) => {
			void handleEvent({
				type: 'agent:error',
				sessionId,
				processSessionId: sessionId,
				errorMessage: error.message,
			});
		});
		const unsubscribeTool = window.maestro.process.onToolExecution((sessionId, toolEvent) => {
			const ticketId =
				processTicketMapRef.current[sessionId] || sessionTicketMapRef.current[sessionId];
			if (!ticketId) return;
			const isTesting = isTestingTool(toolEvent.toolName);
			setState((prev) => ({
				...prev,
				liveStatusByTicket: {
					...prev.liveStatusByTicket,
					[ticketId]: isTesting ? 'testing' : prev.liveStatusByTicket[ticketId] || 'building',
				},
			}));
		});
		return () => {
			unsubscribeError();
			unsubscribeTool();
		};
	}, [handleEvent]);

	return useMemo(
		() => ({
			emitEvent: emitKanbanLifecycleEvent,
			liveStatusByTicket: state.liveStatusByTicket,
			errorByTicket: state.errorByTicket,
			prUrlByTicket: state.prUrlByTicket,
			prIdByTicket: state.prIdByTicket,
		}),
		[state]
	);
}
