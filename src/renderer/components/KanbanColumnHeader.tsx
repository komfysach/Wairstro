import type { Theme } from '../types';
import type { KanbanLane } from '../services/ado';
import type { TaskProfile } from '../../shared/task-routing';
import { getTaskProfileIcon } from '../../shared/task-routing';

interface KanbanColumnHeaderProps {
	theme: Theme;
	lane: KanbanLane;
	isFirstColumn: boolean;
	itemCount: number;
	taskProfile: TaskProfile;
	onTaskProfileChange: (profile: TaskProfile) => void;
	onOpenQuickAdd: () => void;
}

export function KanbanColumnHeader({
	theme,
	lane,
	isFirstColumn,
	itemCount,
	taskProfile,
	onTaskProfileChange,
	onOpenQuickAdd,
}: KanbanColumnHeaderProps) {
	return (
		<div className="px-2.5 py-2 border-b space-y-2" style={{ borderColor: theme.colors.border }}>
			<div className="flex items-start justify-between gap-2">
				<div>
					<div className="text-xs font-bold" style={{ color: theme.colors.textMain }}>
						{lane}
					</div>
					<div className="text-[10px]" style={{ color: theme.colors.textDim }}>
						{itemCount} item{itemCount === 1 ? '' : 's'}
					</div>
				</div>
				{isFirstColumn && (
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => onTaskProfileChange('UI')}
							className="h-6 w-6 rounded border text-xs"
							style={{
								borderColor: taskProfile === 'UI' ? theme.colors.accent : theme.colors.border,
								color: taskProfile === 'UI' ? theme.colors.accent : theme.colors.textDim,
							}}
							title="Task Profile: UI"
						>
							{getTaskProfileIcon('UI')}
						</button>
						<button
							type="button"
							onClick={() => onTaskProfileChange('Logic')}
							className="h-6 w-6 rounded border text-xs"
							style={{
								borderColor: taskProfile === 'Logic' ? theme.colors.accent : theme.colors.border,
								color: taskProfile === 'Logic' ? theme.colors.accent : theme.colors.textDim,
							}}
							title="Task Profile: Logic"
						>
							{getTaskProfileIcon('Logic')}
						</button>
						<button
							type="button"
							onClick={onOpenQuickAdd}
							className="h-6 w-6 rounded border text-xs font-bold"
							style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
							title={`Quick Add (${taskProfile})`}
						>
							➕
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
