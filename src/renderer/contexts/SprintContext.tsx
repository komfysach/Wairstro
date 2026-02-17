import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SprintContextValue {
	focusedMfeId: string | null;
	setFocusedMfeId: (mfeId: string | null) => void;
}

const SprintContext = createContext<SprintContextValue | null>(null);

export function SprintProvider({ children }: { children: ReactNode }) {
	const [focusedMfeId, setFocusedMfeId] = useState<string | null>(null);

	const value = useMemo(
		() => ({
			focusedMfeId,
			setFocusedMfeId,
		}),
		[focusedMfeId]
	);

	return <SprintContext.Provider value={value}>{children}</SprintContext.Provider>;
}

export function useSprintContext(): SprintContextValue {
	const context = useContext(SprintContext);
	if (!context) {
		throw new Error('useSprintContext must be used within a SprintProvider');
	}
	return context;
}
