import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProposedTaskCard } from '../../../renderer/components/ProposedTaskCard';
import type { Theme } from '../../../renderer/types';
import type { MfeProposal } from '../../../renderer/services/mfe';

vi.mock('lucide-react', () => ({
	Check: () => <svg data-testid="check-icon" />,
	Sparkles: () => <svg data-testid="sparkles-icon" />,
	X: () => <svg data-testid="x-icon" />,
}));

const theme: Theme = {
	id: 'dark',
	name: 'Dark',
	mode: 'dark',
	colors: {
		bgMain: '#111',
		bgSidebar: '#111',
		bgActivity: '#111',
		bgTerminal: '#111',
		textMain: '#fff',
		textDim: '#999',
		accent: '#7A85FF',
		accentForeground: '#fff',
		error: '#ff4d4f',
		border: '#333',
		success: '#22c55e',
		warning: '#f59e0b',
		terminalCursor: '#fff',
	},
};

const createProposal = (description: string): MfeProposal => ({
	title: 'Test proposal',
	type: 'Testing',
	description,
	location: 'src/path/file.ts',
	priority: 'Medium',
});

describe('ProposedTaskCard', () => {
	it('renders only the last segment when description is a path', () => {
		render(
			<ProposedTaskCard
				theme={theme}
				proposal={createProposal('src/components/ProposedTaskCard.tsx')}
				onApprove={vi.fn()}
				onReject={vi.fn()}
			/>
		);

		expect(screen.getByText('ProposedTaskCard.tsx')).toBeInTheDocument();
		expect(screen.queryByText('src/components/ProposedTaskCard.tsx')).not.toBeInTheDocument();
	});

	it('keeps plain descriptions unchanged', () => {
		render(
			<ProposedTaskCard
				theme={theme}
				proposal={createProposal('Add tests for routing flow')}
				onApprove={vi.fn()}
				onReject={vi.fn()}
			/>
		);

		expect(screen.getByText('Add tests for routing flow')).toBeInTheDocument();
	});
});
