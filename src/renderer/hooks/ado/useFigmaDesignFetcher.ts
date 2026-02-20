import { useEffect, useMemo, useState } from 'react';
import { mcpService } from '../../services/mcp';

const FIGMA_URL_REGEX = /^https:\/\/(www\.)?figma\.com\/(design|file|proto)\/[A-Za-z0-9]+\/[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?$/i;
const VERIFICATION_DEBOUNCE_MS = 350;

export interface FigmaVerificationState {
	status: 'idle' | 'invalid' | 'validating' | 'verified' | 'error';
	message?: string;
	nodeName?: string;
	nodeId?: string;
}

export function isValidFigmaUrl(value: string): boolean {
	return FIGMA_URL_REGEX.test(value.trim());
}

export function extractFigmaNodeId(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		const rawNodeId = url.searchParams.get('node-id');
		if (!rawNodeId) return null;
		const decodedNodeId = decodeURIComponent(rawNodeId).trim();
		if (!decodedNodeId) return null;
		return decodedNodeId.replace(/-/g, ':');
	} catch {
		return null;
	}
}

export function useFigmaDesignFetcher(figmaUrl: string): FigmaVerificationState {
	const [state, setState] = useState<FigmaVerificationState>({ status: 'idle' });
	const trimmedUrl = figmaUrl.trim();
	const nodeId = useMemo(() => extractFigmaNodeId(trimmedUrl), [trimmedUrl]);
	const urlValid = useMemo(() => (trimmedUrl ? isValidFigmaUrl(trimmedUrl) : true), [trimmedUrl]);

	useEffect(() => {
		if (!trimmedUrl) {
			setState({ status: 'idle' });
			return;
		}

		if (!urlValid || !nodeId) {
			setState({
				status: 'invalid',
				message: 'Invalid Figma URL. Include a valid figma.com link with node-id.',
			});
			return;
		}

		let cancelled = false;
		setState({ status: 'validating', nodeId });

		const timeoutId = window.setTimeout(() => {
			mcpService
				.verifyFigmaNode(trimmedUrl)
				.then((result) => {
					if (cancelled) return;
					setState({
						status: 'verified',
						nodeId,
						nodeName: result.nodeName,
						message: `Verified Link: ${result.nodeName}`,
					});
				})
				.catch((error) => {
					if (cancelled) return;
					setState({
						status: 'error',
						nodeId,
						message:
							error instanceof Error
								? error.message
								: 'Failed to verify link via figma_get_node.',
					});
				});
		}, VERIFICATION_DEBOUNCE_MS);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [trimmedUrl, nodeId, urlValid]);

	return state;
}
