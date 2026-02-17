/**
 * WelcomeContent.tsx
 *
 * Shared welcome content displayed on both the first-launch empty state
 * and the tour introduction overlay. Contains the Guru icon, welcome
 * message, and explanation of core features.
 */

import type { Theme } from '../types';

interface WelcomeContentProps {
	theme: Theme;
	/** Show the "To get started..." call-to-action message */
	showGetStarted?: boolean;
}

/**
 * WelcomeContent - Shared welcome message component
 *
 * Displays the Guru icon and introductory copy explaining:
 * - Parallel agent management
 * - Auto Run automation
 * - Non-interactive mode behavior
 * - Read-Only mode option
 */
export function WelcomeContent({ theme, showGetStarted = false }: WelcomeContentProps): JSX.Element {
	const guruBrand = {
		deepBlue: '#05172f',
		brightBlue: '#090327',
		cream: '#e0d9ff',
		sand: '#c4b9f1',
		panel: 'rgba(196, 185, 241, 0.22)',
		panelBorder: 'rgba(196, 185, 241, 0.35)',
	};

	return (
		<div className="flex flex-col items-center text-center max-w-xl">
			{/* Guru Icon */}
			{/* <img
				src="/icon.png"
				alt="Guru"
				className="w-20 h-20 mb-6 opacity-95 rounded-2xl"
				style={{
					boxShadow: '0 16px 36px -12px rgba(5, 20, 40, 0.58)',
					border: `1px solid ${guruBrand.panelBorder}`,
				}}
			/> */}

			{/* Heading */}
			<h1
				className="text-2xl font-bold mb-4"
				style={{ color: theme.colors.textMain }}
			>
				Welcome to Guru
			</h1>

			{/* Primary goals */}
			<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
				Guru is an orchestration tool designed to:
			</p>

			<div className="text-left space-y-3 mb-6">
				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							background: `linear-gradient(135deg, ${guruBrand.brightBlue} 0%, ${guruBrand.deepBlue} 100%)`,
							color: guruBrand.cream,
						}}
					>
						1
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							Manage multiple AI agents in parallel
						</strong>{' '}
						— Run several coding assistants simultaneously, each in their own
						session, switching between them effortlessly.
					</p>
				</div>

				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							background: `linear-gradient(135deg, ${guruBrand.brightBlue} 0%, ${guruBrand.deepBlue} 100%)`,
							color: guruBrand.cream,
						}}
					>
						2
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							Enable unattended automation via Auto Run
						</strong>{' '}
						— Queue up task lists in markdown documents and let your agents
						execute them while you step away.
					</p>
				</div>
				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							background: `linear-gradient(135deg, ${guruBrand.sand} 0%, ${guruBrand.brightBlue} 100%)`,
							color: guruBrand.cream,
						}}
					>
						3
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							Integrate Azure DevOps sprint execution flows
						</strong>{' '}
						— Plan, execute, and track sprint work by connecting tasks and agent runs to your ADO
						backlog and delivery workflow.
					</p>
				</div>
			</div>

			{/* How it works section */}
			<div
				className="text-sm leading-relaxed p-4 rounded-lg text-left space-y-2"
				style={{
					background: guruBrand.panel,
					border: `1px solid ${guruBrand.panelBorder}`,
					color: theme.colors.textDim,
				}}
			>
				<p>
					<strong style={{ color: theme.colors.textMain }}>How it works:</strong>{' '}
					Guru is a pass-through to your AI provider. Your MCP tools, skills,
					and permissions work exactly as they do when running the provider directly.
				</p>
				<p>
					Agents run in auto-approve mode with tool calls accepted automatically.
					Toggle Read-Only mode for guardrails.
				</p>
			</div>

			{/* Get started call-to-action (only on first-launch screen) */}
			{showGetStarted && (
				<p className="text-sm mt-6" style={{ color: theme.colors.textDim }}>
					To get started, create your first agent manually or with the help of the AI wizard.
				</p>
			)}
		</div>
	);
}
