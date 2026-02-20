export type TaskProfile = 'UI' | 'Logic';
export type RoutedAgentType = 'gemini-cli' | 'codex';

const UI_TAG = 'ui';
const LOGIC_TAG = 'logic';

function normalizeTag(tag: string): string {
	return String(tag || '').trim().toLowerCase();
}

export function hasUiTag(tags: string[]): boolean {
	return tags.some((tag) => normalizeTag(tag) === UI_TAG);
}

export function hasLogicTag(tags: string[]): boolean {
	return tags.some((tag) => normalizeTag(tag) === LOGIC_TAG);
}

export function resolveTaskProfile(tags: string[]): TaskProfile {
	const hasUi = hasUiTag(tags);
	const hasLogic = hasLogicTag(tags);
	if (hasUi && !hasLogic) return 'UI';
	return 'Logic';
}

export function getTaskProfileIcon(profile: TaskProfile): string {
	return profile === 'UI' ? '🎨' : '⚙️';
}

export function mergeProfileTag(tags: string[], profile: TaskProfile): string[] {
	const base = tags.filter((tag) => {
		const normalized = normalizeTag(tag);
		return normalized !== UI_TAG && normalized !== LOGIC_TAG;
	});
	return [...base, profile];
}

export function routeAgentForTags(tags: string[]): RoutedAgentType {
	const hasUi = hasUiTag(tags);
	const hasLogic = hasLogicTag(tags);
	if (hasUi && !hasLogic) return 'gemini-cli';
	return 'codex';
}
