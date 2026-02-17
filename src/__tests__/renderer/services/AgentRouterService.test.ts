import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRouterService } from '../../../renderer/services/AgentRouterService';

const mockGit = {
	getRepoRoot: vi.fn(),
	worktreeSetup: vi.fn(),
	worktreeCheckout: vi.fn(),
};

const mockAgents = {
	get: vi.fn(),
};

const mockProcess = {
	spawn: vi.fn(),
};

const baseSession = {
	id: 'sess-1',
	toolType: 'codex',
	cwd: '/Users/dev/repo',
	customPath: '/custom/codex',
	customArgs: ['--foo'],
	customEnvVars: { TEST_ENV: '1' },
	customModel: 'o4-mini',
	customContextWindow: 128000,
	sessionSshRemoteConfig: { enabled: true, remoteId: 'ssh-01' },
	sshRemoteId: 'ssh-01',
};

describe('AgentRouterService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(window as any).maestro = {
			...(window as any).maestro,
			git: mockGit,
			agents: mockAgents,
			process: mockProcess,
		};
	});

	it('routes work items into a package worktree', async () => {
		mockGit.getRepoRoot.mockResolvedValue({ success: true, root: '/Users/dev/repo' });
		mockGit.worktreeSetup.mockResolvedValue({ success: true, branchMismatch: false });

		const service = new AgentRouterService();
		const plan = await service.routeWorkItemToMfe({
			templateSession: baseSession as any,
			packageName: 'checkout-app',
			packagePath: '/Users/dev/repo/packages/checkout-app',
			workItem: {
				id: 42,
				title: 'Fix payment flow validation',
				description: '',
				acceptanceCriteria: 'Validation passes for card and wallet',
				state: 'Active',
				tags: [],
				url: '',
			},
		});

		expect(plan.worktreeBranch).toContain('ado/checkout-app/wi-42-fix-payment-flow-validation');
		expect(plan.packageRelativePath).toBe('packages/checkout-app');
		expect(plan.packageCwd).toContain('/packages/checkout-app');
		expect(plan.initialPrompt).toContain('Work Item ID: 42');
		expect(mockGit.worktreeSetup).toHaveBeenCalledTimes(1);
	});

	it('checks out branch when setup reports mismatch', async () => {
		mockGit.getRepoRoot.mockResolvedValue({ success: true, root: '/Users/dev/repo' });
		mockGit.worktreeSetup.mockResolvedValue({ success: true, branchMismatch: true });
		mockGit.worktreeCheckout.mockResolvedValue({ success: true });

		const service = new AgentRouterService();
		await service.routeWorkItemToMfe({
			templateSession: baseSession as any,
			packageName: 'checkout-app',
			packagePath: '/Users/dev/repo/packages/checkout-app',
			workItem: {
				id: 1,
				title: 'Follow-up',
				description: '',
				acceptanceCriteria: '',
				state: 'Active',
				tags: [],
				url: '',
			},
		});

		expect(mockGit.worktreeCheckout).toHaveBeenCalledTimes(1);
	});

	it('throws when package path is outside repository root', async () => {
		mockGit.getRepoRoot.mockResolvedValue({ success: true, root: '/Users/dev/repo' });

		const service = new AgentRouterService();
		await expect(
			service.routeWorkItemToMfe({
				templateSession: baseSession as any,
				packageName: 'checkout-app',
				packagePath: '/Users/dev/other/packages/checkout-app',
				workItem: {
					id: 9,
					title: 'Bad path',
					description: '',
					acceptanceCriteria: '',
					state: 'Active',
					tags: [],
					url: '',
				},
			})
		).rejects.toThrow('Package path is outside repository root');
	});

	it('spawns routed agent with resolved command and session overrides', async () => {
		mockAgents.get.mockResolvedValue({
			available: true,
			command: 'codex',
			path: '/opt/codex/bin/codex',
			args: ['--json'],
		});
		mockProcess.spawn.mockResolvedValue(undefined);

		const service = new AgentRouterService();
		await service.spawnRoutedAgent({
			session: baseSession as any,
			tabId: 'tab-2',
			prompt: 'Implement task',
		});

		expect(mockProcess.spawn).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: 'sess-1-ai-tab-2',
				command: '/opt/codex/bin/codex',
				args: ['--json'],
				prompt: 'Implement task',
				sessionCustomModel: 'o4-mini',
			})
		);
	});

	it('throws when assigned agent is unavailable', async () => {
		mockAgents.get.mockResolvedValue({ available: false });

		const service = new AgentRouterService();
		await expect(
			service.spawnRoutedAgent({
				session: baseSession as any,
				tabId: 'tab-2',
				prompt: 'Implement task',
			})
		).rejects.toThrow('Assigned agent is unavailable');
	});
});
