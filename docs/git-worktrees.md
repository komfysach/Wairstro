---
title: Git Worktrees
description: Run AI agents in parallel on isolated branches with Git worktree sub-agents.
icon: git-branch
---

Git worktrees enable true parallel development by letting you run multiple AI agents on separate branches simultaneously. Each worktree operates in its own isolated directory, so there's no risk of conflicts between parallel work streams.

Maestro's git integration includes built-in diff viewing and commit log browsing:

![Git logs](./screenshots/git-logs.png)
![Git diff](./screenshots/git-diff.png)

## Creating a Worktree Sub-Agent

1. In the agent list (left sidebar), hover over an agent in a git repository
2. Click the **git branch indicator** (shows current branch name)
3. In the overlay menu, click **"Create Worktree Sub-Agent"**
4. Configure the worktree:
   - **Worktree Directory** — Base folder where worktrees are created
   - **Branch Name** — Name for the new branch (becomes the subdirectory name)
   - **Create PR on Completion** — Auto-open a pull request when done
   - **Target Branch** — Base branch for the PR (defaults to main/master)

## How Worktree Agents Work

- **Nested Display** — Worktree sub-agents appear indented under their parent agent in the left sidebar
- **Branch Icon** — A git branch icon indicates worktree agents
- **Collapse/Expand** — Click the chevron on a parent agent to show/hide its worktree children
- **Independent Operation** — Each worktree agent has its own working directory, conversation history, and state

## Creating Pull Requests

When you're done with work in a worktree:

1. **Right-click** the worktree agent → **Create Pull Request**, or
2. Press **Cmd+K** with the worktree active → search "Create Pull Request"

The PR modal shows:
- Source branch (your worktree branch)
- Target branch (configurable)
- Auto-generated title and description based on your work

**Requirements:** GitHub CLI (`gh`) must be installed and authenticated. Maestro will detect if it's missing and show installation instructions.

## Use Cases

| Scenario | How Worktrees Help |
|----------|-------------------|
| **Background Auto Run** | Run Auto Run in a worktree while working interactively in the main repo |
| **Feature Branches** | Spin up a sub-agent for each feature branch |
| **Code Review** | Create a worktree to review and iterate on a PR without switching branches |
| **Parallel Experiments** | Try different approaches simultaneously without git stash/pop |

## Tips

- **Name branches descriptively** — The branch name becomes the worktree directory name
- **Use a dedicated worktree folder** — Keep all worktrees in one place (e.g., `~/worktrees/`)
- **Clean up when done** — Delete worktree agents after merging PRs to avoid clutter
