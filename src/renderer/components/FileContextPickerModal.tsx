import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DirectoryEntry, Theme } from '../types';

interface FileContextPickerModalProps {
	theme: Theme;
	isOpen: boolean;
	monorepoRoot: string;
	title?: string;
	initialSelectedPaths: string[];
	onClose: () => void;
	onSave: (selectedPaths: string[]) => void;
}

const IGNORED_DIR_NAMES = new Set(['.git', 'node_modules']);

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function toRelativePath(rootPath: string, absolutePath: string): string {
	const normalizedRoot = normalizePath(rootPath);
	const normalizedAbsolute = normalizePath(absolutePath);
	if (normalizedAbsolute === normalizedRoot) return '.';
	if (!normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return normalizedAbsolute;
	return normalizedAbsolute.slice(normalizedRoot.length + 1);
}

export function FileContextPickerModal({
	theme,
	isOpen,
	monorepoRoot,
	title = 'Attach Context Files',
	initialSelectedPaths,
	onClose,
	onSave,
}: FileContextPickerModalProps) {
	const rootPath = useMemo(() => normalizePath(monorepoRoot.trim()), [monorepoRoot]);
	const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, DirectoryEntry[]>>({});
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
	const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
	const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
	const [loadError, setLoadError] = useState<string | null>(null);

	const loadDirectory = useCallback(async (directoryPath: string) => {
		if (!directoryPath) return;
		if (entriesByDirectory[directoryPath] || loadingPaths[directoryPath]) return;
		setLoadingPaths((prev) => ({ ...prev, [directoryPath]: true }));
		try {
			const entries = await window.maestro.fs.readDir(directoryPath);
			const filtered = entries
				.filter((entry) => !IGNORED_DIR_NAMES.has(entry.name))
				.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});
			setEntriesByDirectory((prev) => ({ ...prev, [directoryPath]: filtered }));
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : 'Failed to read directory tree.');
		} finally {
			setLoadingPaths((prev) => ({ ...prev, [directoryPath]: false }));
		}
	}, [entriesByDirectory, loadingPaths]);

	useEffect(() => {
		if (!isOpen) return;
		setLoadError(null);
		setSelectedPaths(
			Object.fromEntries(
				initialSelectedPaths
					.map((value) => String(value || '').trim().replace(/\\/g, '/'))
					.filter(Boolean)
					.map((value) => [value, true])
			)
		);
		setExpandedPaths((prev) => ({ ...prev, [rootPath]: true }));
		void loadDirectory(rootPath);
	}, [initialSelectedPaths, isOpen, loadDirectory, rootPath]);

	const toggleSelection = (relativePath: string, checked: boolean) => {
		setSelectedPaths((prev) => {
			const next = { ...prev };
			if (checked) {
				next[relativePath] = true;
			} else {
				delete next[relativePath];
			}
			return next;
		});
	};

	const toggleExpanded = (absolutePath: string) => {
		setExpandedPaths((prev) => {
			const expanded = !prev[absolutePath];
			return { ...prev, [absolutePath]: expanded };
		});
		void loadDirectory(absolutePath);
	};

	const selectedCount = Object.keys(selectedPaths).length;

	const renderDirectory = (absolutePath: string, depth: number) => {
		const entries = entriesByDirectory[absolutePath] || [];
		const isLoading = Boolean(loadingPaths[absolutePath]);
		if (isLoading && entries.length === 0) {
			return (
				<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
					Loading...
				</div>
			);
		}
		if (entries.length === 0) {
			return (
				<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
					No files.
				</div>
			);
		}

		return entries.map((entry) => {
			const entryPath = normalizePath(entry.path);
			const relativePath = toRelativePath(rootPath, entryPath);
			const expanded = Boolean(expandedPaths[entryPath]);
			const isDirectory = entry.isDirectory;
			return (
				<div key={entryPath} style={{ marginLeft: depth * 14 }}>
					<div className="flex items-center gap-1 py-0.5">
						{isDirectory ? (
							<button
								type="button"
								onClick={() => toggleExpanded(entryPath)}
								className="p-0.5 rounded"
								style={{ color: theme.colors.textDim }}
							>
								{expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
							</button>
						) : (
							<span className="inline-block w-5" />
						)}
						<input
							type="checkbox"
							checked={Boolean(selectedPaths[relativePath])}
							onChange={(event) => toggleSelection(relativePath, event.target.checked)}
						/>
						<span className="text-[11px]" style={{ color: theme.colors.textMain }}>
							{entry.name}
							{isDirectory ? '/' : ''}
						</span>
					</div>
					{isDirectory && expanded && (
						<div>{renderDirectory(entryPath, depth + 1)}</div>
					)}
				</div>
			);
		});
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
		>
			<div
				className="w-full max-w-3xl rounded border p-3 max-h-[78vh] flex flex-col"
				style={{ backgroundColor: theme.colors.bgMain, borderColor: theme.colors.border }}
			>
				<div className="flex items-center justify-between gap-2 mb-2">
					<div>
						<div className="text-sm font-semibold" style={{ color: theme.colors.textMain }}>
							{title}
						</div>
						<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
							{rootPath}
						</div>
					</div>
					<div className="text-[11px]" style={{ color: theme.colors.textDim }}>
						Selected: {selectedCount}
					</div>
				</div>
				{loadError && (
					<div className="mb-2 text-[11px]" style={{ color: theme.colors.error }}>
						{loadError}
					</div>
				)}
				<div
					className="flex-1 min-h-[18rem] overflow-auto rounded border p-2"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}
				>
					{rootPath ? renderDirectory(rootPath, 0) : null}
				</div>
				<div className="mt-3 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1.5 rounded text-xs font-semibold border"
						style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() =>
							onSave(
								Object.keys(selectedPaths)
									.filter((key) => selectedPaths[key])
									.sort((a, b) => a.localeCompare(b))
							)
						}
						className="px-3 py-1.5 rounded text-xs font-semibold border"
						style={{ borderColor: theme.colors.accent, color: theme.colors.accent }}
					>
						Save Context
					</button>
				</div>
			</div>
		</div>
	);
}

export default FileContextPickerModal;
