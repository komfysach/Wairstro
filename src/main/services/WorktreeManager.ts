import path from 'path';
import { execFileNoThrow } from '../utils/execFile';

function normalizeBranchName(branchName: string): string {
	return branchName.replace(/^refs\/heads\//, '').trim();
}

async function resolveMainRepoRoot(worktreePath: string): Promise<string> {
	const commonDirResult = await execFileNoThrow(
		'git',
		['rev-parse', '--path-format=absolute', '--git-common-dir'],
		worktreePath
	);
	if (commonDirResult.exitCode !== 0) {
		throw new Error(commonDirResult.stderr || 'Failed to resolve git common directory for worktree.');
	}
	const commonDir = commonDirResult.stdout.trim();
	if (!commonDir) {
		throw new Error('Git common directory output was empty.');
	}
	return commonDir.endsWith('.git') ? path.dirname(commonDir) : commonDir;
}

export class WorktreeManager {
	async createWorktree(repoPath: string, branchName: string, worktreePath: string): Promise<{
		repoRoot: string;
		worktreePath: string;
		branchName: string;
	}> {
		const normalizedBranch = normalizeBranchName(branchName);
		if (!normalizedBranch) {
			throw new Error('Branch name is required for worktree creation.');
		}
		if (!worktreePath.trim()) {
			throw new Error('Worktree path is required.');
		}
		const repoRoot = await resolveMainRepoRoot(repoPath);
		const allowedWorktreeRoot = path.resolve(repoRoot, '.guru', 'worktrees');
		const resolvedWorktreePath = path.resolve(worktreePath);
		if (
			resolvedWorktreePath !== allowedWorktreeRoot &&
			!resolvedWorktreePath.startsWith(`${allowedWorktreeRoot}${path.sep}`)
		) {
			throw new Error(
				`Worktree path must be inside ${allowedWorktreeRoot} to keep monorepo root visibility.`
			);
		}

		const branchExistsResult = await execFileNoThrow(
			'git',
			['rev-parse', '--verify', normalizedBranch],
			repoRoot
		);
		const setupArgs =
			branchExistsResult.exitCode === 0
				? ['worktree', 'add', resolvedWorktreePath, normalizedBranch]
				: ['worktree', 'add', '-b', normalizedBranch, resolvedWorktreePath];
		const setupResult = await execFileNoThrow('git', setupArgs, repoRoot);
		if (setupResult.exitCode !== 0) {
			const existingCheck = await execFileNoThrow(
				'git',
				['rev-parse', '--is-inside-work-tree'],
				resolvedWorktreePath
			);
			if (existingCheck.exitCode !== 0) {
				throw new Error(setupResult.stderr || setupResult.stdout || 'Failed to create worktree.');
			}
		}

		return {
			repoRoot,
			worktreePath: resolvedWorktreePath,
			branchName: normalizedBranch,
		};
	}

	async cleanupWorktree(branchName: string, worktreePath: string): Promise<void> {
		const normalizedBranch = normalizeBranchName(branchName);
		if (!normalizedBranch) {
			throw new Error('Branch name is required for worktree cleanup.');
		}
		if (!worktreePath.trim()) {
			throw new Error('Worktree path is required for cleanup.');
		}

		const repoRoot = await resolveMainRepoRoot(worktreePath);
		const removeResult = await execFileNoThrow(
			'git',
			['worktree', 'remove', worktreePath, '--force'],
			repoRoot
		);
		if (
			removeResult.exitCode !== 0 &&
			!removeResult.stderr.toLowerCase().includes('does not exist') &&
			!removeResult.stderr.toLowerCase().includes('not a working tree')
		) {
			throw new Error(removeResult.stderr || removeResult.stdout || 'Failed to remove worktree.');
		}

		const deleteBranchResult = await execFileNoThrow(
			'git',
			['branch', '-D', normalizedBranch],
			repoRoot
		);
		if (
			deleteBranchResult.exitCode !== 0 &&
			!deleteBranchResult.stderr.toLowerCase().includes('not found') &&
			!deleteBranchResult.stderr.toLowerCase().includes("not a valid branch name")
		) {
			throw new Error(
				deleteBranchResult.stderr || deleteBranchResult.stdout || `Failed to delete branch ${normalizedBranch}.`
			);
		}
	}
}
