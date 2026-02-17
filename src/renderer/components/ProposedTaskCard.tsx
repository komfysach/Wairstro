import { Check, Sparkles, X } from 'lucide-react';
import type { Theme } from '../types';
import type { MfeProposal } from '../services/mfe';

interface ProposedTaskCardProps {
	theme: Theme;
	proposal: MfeProposal;
	onApprove: () => void;
	onReject: () => void;
	isRejecting?: boolean;
}

export function ProposedTaskCard({
	theme,
	proposal,
	onApprove,
	onReject,
	isRejecting = false,
}: ProposedTaskCardProps) {
	return (
		<div
			className={`group rounded px-2 py-2 space-y-2 transition-all duration-200 ${isRejecting ? 'opacity-0 translate-x-3 max-h-0 overflow-hidden py-0' : 'opacity-100 translate-x-0 max-h-96'}`}
			style={{
				border: '2px dashed #7A85FF',
				backgroundImage:
					'repeating-linear-gradient(135deg, rgba(122,133,255,0.12) 0px, rgba(122,133,255,0.12) 8px, rgba(122,133,255,0.04) 8px, rgba(122,133,255,0.04) 16px)',
			}}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="text-[11px] font-semibold truncate" style={{ color: theme.colors.textMain }}>
						{proposal.title}
					</div>
					<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
						{proposal.type} • {proposal.priority}
					</div>
				</div>
				<span
					className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1"
					style={{ backgroundColor: 'rgba(122,133,255,0.24)', color: '#5564FF' }}
				>
					<Sparkles className="w-3 h-3" />
				</span>
			</div>

			<div className="text-[10px]" style={{ color: theme.colors.textMain }}>
				<p className="truncate">{proposal.description.split('/').pop() || proposal.description}</p>
			</div>

			<div className="text-[10px] truncate" style={{ color: theme.colors.textDim }} title={proposal.location}>
				Location: {proposal.location.split('/').pop() || proposal.location}
			</div>

			<div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
				<button
					type="button"
					onClick={onApprove}
					className="px-2 py-1 rounded text-[10px] font-semibold border inline-flex items-center gap-1"
					style={{ borderColor: '#31C48D', color: '#31C48D', backgroundColor: 'rgba(49,196,141,0.08)' }}
				>
					<Check className="w-3 h-3" />
					Approve
				</button>
				<button
					type="button"
					onClick={onReject}
					className="px-2 py-1 rounded text-[10px] font-semibold border inline-flex items-center gap-1"
					style={{ borderColor: theme.colors.error, color: theme.colors.error }}
				>
					<X className="w-3 h-3" />
					Reject
				</button>
			</div>
		</div>
	);
}

export default ProposedTaskCard;
