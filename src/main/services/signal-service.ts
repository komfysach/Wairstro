import { EventEmitter } from 'events';

export interface SignalAnnouncement {
	agentId: string;
	message: string;
	timestamp: number;
}

export interface SignalState {
	locks: Record<string, string>;
	announcements: SignalAnnouncement[];
}

export interface LockCheckResult {
	filePath: string;
	owner: string | null;
}

const MAX_ANNOUNCEMENTS = 200;

function normalizeFilePath(filePath: string): string {
	return filePath.trim().replace(/\\/g, '/');
}

export class SignalService extends EventEmitter {
	private readonly state: SignalState = {
		locks: {},
		announcements: [],
	};

	getState(): SignalState {
		return {
			locks: { ...this.state.locks },
			announcements: [...this.state.announcements],
		};
	}

	checkLocks(filePaths: string[]): LockCheckResult[] {
		return filePaths
			.map((filePath) => normalizeFilePath(filePath))
			.filter(Boolean)
			.map((filePath) => ({
				filePath,
				owner: this.state.locks[filePath] || null,
			}));
	}

	acquireLock(agentId: string, filePath: string): boolean {
		const normalizedAgentId = agentId.trim();
		const normalizedPath = normalizeFilePath(filePath);
		if (!normalizedAgentId || !normalizedPath) return false;

		const currentOwner = this.state.locks[normalizedPath];
		if (currentOwner && currentOwner !== normalizedAgentId) {
			return false;
		}

		this.state.locks[normalizedPath] = normalizedAgentId;
		this.emitStateUpdated();
		return true;
	}

	releaseLock(agentId: string, filePath: string): boolean {
		const normalizedAgentId = agentId.trim();
		const normalizedPath = normalizeFilePath(filePath);
		if (!normalizedAgentId || !normalizedPath) return false;

		const currentOwner = this.state.locks[normalizedPath];
		if (currentOwner !== normalizedAgentId) {
			return false;
		}

		delete this.state.locks[normalizedPath];
		this.emitStateUpdated();
		return true;
	}

	broadcast(agentId: string, message: string): SignalAnnouncement | null {
		const normalizedAgentId = agentId.trim();
		const normalizedMessage = message.trim();
		if (!normalizedAgentId || !normalizedMessage) return null;

		const announcement: SignalAnnouncement = {
			agentId: normalizedAgentId,
			message: normalizedMessage,
			timestamp: Date.now(),
		};
		this.state.announcements.push(announcement);
		if (this.state.announcements.length > MAX_ANNOUNCEMENTS) {
			this.state.announcements.splice(0, this.state.announcements.length - MAX_ANNOUNCEMENTS);
		}
		this.emitStateUpdated();
		return announcement;
	}

	private emitStateUpdated(): void {
		this.emit('updated', this.getState());
	}
}

const signalService = new SignalService();

export function getSignalService(): SignalService {
	return signalService;
}
