import { execGit } from '../../utils/remote-git';
import * as fs from 'fs/promises';
import path from 'path';
import type { SshRemoteConfig } from '../../../shared/types';
import type { AgentDetector } from '../../agents';
import { groomContext } from '../../utils/context-groomer';
import { VisualRendererService } from '../VisualRendererService';
import {
	AgentBase,
	type AgentBaseConfig,
	type ExitReport,
	type ExitRiskLevel,
} from './agent-base';

const MAX_RETIRES = 3;
const DEFAULT_VISUAL_TARGET = '/';
const FIGMA_REFERENCE_RELATIVE_PATH = '.wairstro/snapshots/figma_reference.png';
const CRITIC_MODEL = process.env.GURU_VISUAL_CRITIC_MODEL || 'gemini-2.5-pro';
const VISION_PROMPT = `You are an expert Frontend UI Critic. I am providing you with two images:
Image 1 (Left/First): The target Figma design.
Image 2 (Right/Second): The current coded implementation.

Your Task:
Perform a strict visual regression analysis. Look for discrepancies in:

Margins, Padding, and Flex/Grid alignment.

Typography (Font weight, size, line-height).

Colors, borders, and shadows.

If they match perfectly, output: VISUAL_MATCH: TRUE.
If there are differences, output VISUAL_MATCH: FALSE followed by a bulleted list of the exact CSS/Tailwind changes required to fix the implementation.`;

interface WorkerAgentConfig extends AgentBaseConfig {
	taskId: string;
	taskTitle: string;
	packageCwd: string;
	sshRemote: SshRemoteConfig | null;
	templateCwd: string;
	mfeBaseUrl?: string;
	visualRendererService: VisualRendererService;
	agentDetector: AgentDetector;
	assignedAgentType: string;
	sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
	sessionCustomPath?: string;
	sessionCustomArgs?: string;
	sessionCustomEnvVars?: Record<string, string>;
	riskLevel?: ExitRiskLevel;
	verificationSteps?: string;
}

export class WorkerAgent extends AgentBase {
	private readonly taskId: string;
	private readonly taskTitle: string;
	private readonly packageCwd: string;
	private readonly sshRemote: SshRemoteConfig | null;
	private readonly templateCwd: string;
	private readonly mfeBaseUrl: string;
	private readonly visualRendererService: VisualRendererService;
	private readonly agentDetector: AgentDetector;
	private readonly assignedAgentType: string;
	private readonly sessionSshRemoteConfig?: {
		enabled: boolean;
		remoteId: string | null;
		workingDirOverride?: string;
	};
	private readonly sessionCustomPath?: string;
	private readonly sessionCustomArgs?: string;
	private readonly sessionCustomEnvVars?: Record<string, string>;
	private readonly riskLevel: ExitRiskLevel;
	private verificationStepsText: string;
	private isTerminated = false;
	private reportPath: string | null = null;

	constructor(config: WorkerAgentConfig) {
		super(config);
		this.taskId = config.taskId;
		this.taskTitle = config.taskTitle;
		this.packageCwd = config.packageCwd;
		this.sshRemote = config.sshRemote;
		this.templateCwd = config.templateCwd;
		this.mfeBaseUrl = config.mfeBaseUrl || process.env.E2E_BASE_URL || 'http://localhost:3000';
		this.visualRendererService = config.visualRendererService;
		this.agentDetector = config.agentDetector;
		this.assignedAgentType = config.assignedAgentType;
		this.sessionSshRemoteConfig = config.sessionSshRemoteConfig;
		this.sessionCustomPath = config.sessionCustomPath;
		this.sessionCustomArgs = config.sessionCustomArgs;
		this.sessionCustomEnvVars = config.sessionCustomEnvVars;
		this.riskLevel = config.riskLevel ?? 'Medium';
		this.verificationStepsText = config.verificationSteps ?? 'No verification steps were reported.';
	}

	async captureLocalUi(routeOrComponent: string): Promise<{
		snapshotPath: string;
		url: string;
		selector: string;
	}> {
		const parsed = this.visualRendererService.parseCaptureTarget(this.mfeBaseUrl, routeOrComponent);
		const snapshotPath = await this.visualRendererService.takeScreenshot({
			url: parsed.url,
			selector: parsed.selector,
			workspaceCwd: this.packageCwd,
		});
		return {
			snapshotPath,
			url: parsed.url,
			selector: parsed.selector,
		};
	}

	async verifyUi(routeOrComponent?: string): Promise<{
		verified: boolean;
		attempts: number;
		feedback?: string;
	}> {
		const figmaReferencePath = path.resolve(process.cwd(), FIGMA_REFERENCE_RELATIVE_PATH);
		try {
			await fs.access(figmaReferencePath);
		} catch {
			this.verificationStepsText =
				'Visual QA skipped: .wairstro/snapshots/figma_reference.png was not found.';
			return {
				verified: false,
				attempts: 0,
				feedback: 'Missing figma_reference.png.',
			};
		}

		const target = routeOrComponent?.trim() || DEFAULT_VISUAL_TARGET;
		let lastFeedback = '';
		for (let attempt = 1; attempt <= MAX_RETIRES; attempt += 1) {
			const capture = await this.captureLocalUi(target);
			const critic = await this.runVisualCritic(figmaReferencePath, capture.snapshotPath);
			if (critic.matched) {
				this.verificationStepsText = `Visual QA passed after ${attempt} attempt(s).`;
				return { verified: true, attempts: attempt };
			}

			lastFeedback = critic.feedback;
			if (attempt < MAX_RETIRES) {
				await this.applyVisualCorrections(target, critic.feedback);
			}
		}

		this.verificationStepsText =
			`Visual QA failed after ${MAX_RETIRES} attempts.` +
			(lastFeedback ? ` Remaining feedback: ${lastFeedback}` : '');
		return { verified: false, attempts: MAX_RETIRES, feedback: lastFeedback };
	}

	private async applyVisualCorrections(target: string, feedback: string): Promise<void> {
		const correctionPrompt = [
			'You must fix visual mismatches discovered by the UI critic.',
			`Target route/component: ${target}`,
			'Apply the exact CSS/Tailwind changes requested below and edit the relevant .tsx/.css files now:',
			feedback,
			'Make the code edits directly and finish when done.',
		].join('\n\n');

		await groomContext(
			{
				projectRoot: this.packageCwd,
				agentType: this.assignedAgentType,
				prompt: correctionPrompt,
				readOnlyMode: false,
				sessionSshRemoteConfig: this.sessionSshRemoteConfig,
				sessionCustomPath: this.sessionCustomPath,
				sessionCustomArgs: this.sessionCustomArgs,
				sessionCustomEnvVars: this.sessionCustomEnvVars,
			},
			this.processManager,
			this.agentDetector
		);
	}

	private async runVisualCritic(
		figmaReferencePath: string,
		currentRenderPath: string
	): Promise<{ matched: boolean; feedback: string }> {
		type ImageCapableProcessManager = {
			spawn: (config: {
				sessionId: string;
				toolType: string;
				cwd: string;
				command: string;
				args: string[];
				prompt?: string;
				images?: string[];
				imageArgs?: (imagePath: string) => string[];
				promptArgs?: (prompt: string) => string[];
				noPromptSeparator?: boolean;
				requiresPty?: boolean;
			}) => { pid: number; success?: boolean } | null;
			on: (event: string, handler: (...args: unknown[]) => void) => void;
			off: (event: string, handler: (...args: unknown[]) => void) => void;
		};
		const processManager = this.processManager as unknown as ImageCapableProcessManager;

		const gemini = await this.agentDetector.getAgent('gemini-cli');
		if (!gemini || !gemini.available) {
			throw new Error('Gemini CLI is unavailable for visual QA.');
		}

		const [figmaImage, currentImage] = await Promise.all([
			fs.readFile(figmaReferencePath),
			fs.readFile(currentRenderPath),
		]);

		const criticSessionId = `${this.agentInstanceId}-visual-critic-${Date.now()}`;
		const criticOutput = await new Promise<string>((resolve, reject) => {
			let output = '';
			let settled = false;

			const finalize = (fn: () => void) => {
				if (settled) return;
				settled = true;
				processManager.off('data', onData);
				processManager.off('stderr', onStderr);
				processManager.off('exit', onExit);
				fn();
			};

			const onData = (...args: unknown[]) => {
				const [sessionId, data] = args as [string, string];
				if (sessionId !== criticSessionId) return;
				output += data;
			};
			const onStderr = (...args: unknown[]) => {
				const [sessionId, data] = args as [string, string];
				if (sessionId !== criticSessionId) return;
				output += data;
			};
			const onExit = (...args: unknown[]) => {
				const [sessionId, code] = args as [string, number];
				if (sessionId !== criticSessionId) return;
				if (code === 0) {
					finalize(() => resolve(output.trim()));
					return;
				}
				finalize(() => reject(new Error(`Gemini visual critic exited with code ${code}.`)));
			};

			processManager.on('data', onData);
			processManager.on('stderr', onStderr);
			processManager.on('exit', onExit);

			const spawnResult = processManager.spawn({
				sessionId: criticSessionId,
				toolType: 'gemini-cli',
				cwd: this.packageCwd,
				command: gemini.path || gemini.command,
				args: [...(gemini.args || []), '--model', CRITIC_MODEL],
				prompt: VISION_PROMPT,
				promptArgs: gemini.promptArgs,
				noPromptSeparator: gemini.noPromptSeparator,
				images: [
					`data:image/png;base64,${figmaImage.toString('base64')}`,
					`data:image/png;base64,${currentImage.toString('base64')}`,
				],
				imageArgs: gemini.imageArgs,
				requiresPty: false,
			});
			if (!spawnResult) {
				finalize(() => reject(new Error('Failed to start Gemini visual critic process.')));
			}
		});

		if (criticOutput.toUpperCase().includes('VISUAL_MATCH: TRUE')) {
			return { matched: true, feedback: '' };
		}
		return {
			matched: false,
			feedback: criticOutput || 'VISUAL_MATCH: FALSE',
		};
	}

	private async collectFilesTouched(): Promise<string[]> {
		const diffResult = await execGit(
			['diff', '--name-only'],
			this.packageCwd,
			this.sshRemote,
			this.templateCwd
		);
		if (diffResult.exitCode !== 0) {
			return [];
		}
		return diffResult.stdout
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	}

	private async buildExitReport(): Promise<ExitReport> {
		const filesTouched = await this.collectFilesTouched();
		const inferredRisk =
			this.riskLevel === 'Medium' ? this.inferRiskLevel(filesTouched) : this.riskLevel;
		return {
			taskId: this.taskId,
			filesTouched,
			summary: `Completed task ${this.taskId}: ${this.taskTitle}`,
			riskLevel: inferredRisk,
			verificationSteps: this.verificationStepsText,
		};
	}

	private inferRiskLevel(filesTouched: string[]): ExitRiskLevel {
		if (filesTouched.length >= 12) return 'High';
		if (
			filesTouched.some((file) =>
				/(auth|security|credential|secret|token|payment|permission|policy)/i.test(file)
			)
		) {
			return 'High';
		}
		if (filesTouched.length <= 2) return 'Low';
		return 'Medium';
	}

	async terminate(): Promise<{ reportPath: string }> {
		if (this.isTerminated) {
			return { reportPath: this.reportPath || '' };
		}
		this.isTerminated = true;

		const report = await this.buildExitReport();
		const reportPath = await this.generateExitReport(report);
		this.reportPath = reportPath;

		// Force-close worker shell/process if still alive.
		this.processManager.kill(this.agentInstanceId);
		// Emit explicit worker termination event with report location.
		const emitter = this.processManager as {
			emit?: (event: string, ...args: unknown[]) => void;
		};
		emitter.emit?.('agent:terminated', this.agentInstanceId, reportPath);

		return { reportPath };
	}

	get terminated(): boolean {
		return this.isTerminated;
	}

	markTerminated(): void {
		this.isTerminated = true;
	}
}
