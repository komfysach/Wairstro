/**
 * graphDataBuilder - Builds React Flow compatible graph data from markdown documents.
 *
 * Scans a directory for markdown files, parses their links and stats, and builds
 * a node/edge graph representing document relationships.
 *
 * Used by the DocumentGraphView component to visualize document connections.
 */

import { Node, Edge } from 'reactflow';
import { parseMarkdownLinks, ExternalLink } from '../../utils/markdownLinkParser';
import { computeDocumentStats, DocumentStats } from '../../utils/documentStats';

/**
 * Options for building the graph data
 */
export interface BuildOptions {
  /** Whether to include external link nodes in the graph */
  includeExternalLinks: boolean;
  /** Root directory path to scan for markdown files */
  rootPath: string;
}

/**
 * Data payload for document nodes
 */
export interface DocumentNodeData extends DocumentStats {
  /** Node type identifier for React Flow custom node rendering */
  nodeType: 'document';
}

/**
 * Data payload for external link nodes
 */
export interface ExternalLinkNodeData {
  /** Node type identifier for React Flow custom node rendering */
  nodeType: 'external';
  /** Domain name (www. stripped) */
  domain: string;
  /** Number of links to this domain */
  linkCount: number;
  /** All full URLs pointing to this domain */
  urls: string[];
}

/**
 * Combined node data type for React Flow
 */
export type GraphNodeData = DocumentNodeData | ExternalLinkNodeData;

/**
 * Result of building graph data
 */
export interface GraphData {
  /** React Flow nodes representing documents and optionally external domains */
  nodes: Node<GraphNodeData>[];
  /** React Flow edges representing links between documents */
  edges: Edge[];
}

/**
 * Internal parsed file data with content and links
 */
interface ParsedFile {
  /** Relative path from root (normalized) */
  relativePath: string;
  /** Full file path */
  fullPath: string;
  /** Raw file content */
  content: string;
  /** File size in bytes */
  fileSize: number;
  /** Parsed links from the file */
  internalLinks: string[];
  /** External links with domains */
  externalLinks: ExternalLink[];
  /** Computed document stats */
  stats: DocumentStats;
}

/**
 * Recursively scan a directory for all markdown files
 * @param rootPath - Root directory to scan
 * @returns Array of file paths relative to root
 */
async function scanMarkdownFiles(rootPath: string): Promise<string[]> {
  const markdownFiles: string[] = [];

  async function scanDir(currentPath: string, relativePath: string): Promise<void> {
    try {
      const entries = await window.maestro.fs.readDir(currentPath);

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;

        // Skip common non-content directories
        if (entry.isDirectory && ['node_modules', 'dist', 'build', '.git'].includes(entry.name)) {
          continue;
        }

        const fullPath = entry.path;
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          await scanDir(fullPath, entryRelativePath);
        } else if (entry.name.toLowerCase().endsWith('.md')) {
          markdownFiles.push(entryRelativePath);
        }
      }
    } catch (error) {
      // Log error but continue scanning other directories
      console.warn(`Failed to scan directory ${currentPath}:`, error);
    }
  }

  await scanDir(rootPath, '');
  return markdownFiles;
}

/**
 * Parse a single markdown file and extract its data
 * @param rootPath - Root directory path
 * @param relativePath - Path relative to root
 * @returns Parsed file data or null if reading fails
 */
async function parseFile(rootPath: string, relativePath: string): Promise<ParsedFile | null> {
  const fullPath = `${rootPath}/${relativePath}`;

  try {
    // Read file content
    const content = await window.maestro.fs.readFile(fullPath);
    if (content === null || content === undefined) {
      return null;
    }

    // Get file stats
    const stat = await window.maestro.fs.stat(fullPath);
    const fileSize = stat?.size ?? 0;

    // Parse links from content
    const { internalLinks, externalLinks } = parseMarkdownLinks(content, relativePath);

    // Compute document statistics
    const stats = computeDocumentStats(content, relativePath, fileSize);

    return {
      relativePath,
      fullPath,
      content,
      fileSize,
      internalLinks,
      externalLinks,
      stats,
    };
  } catch (error) {
    console.warn(`Failed to parse file ${fullPath}:`, error);
    return null;
  }
}

/**
 * Build graph data from a directory of markdown files
 *
 * @param options - Build configuration options
 * @returns GraphData with nodes and edges for React Flow
 */
export async function buildGraphData(options: BuildOptions): Promise<GraphData> {
  const { rootPath, includeExternalLinks } = options;

  // Step 1: Scan for all markdown files
  const markdownPaths = await scanMarkdownFiles(rootPath);

  // Step 2: Parse all files
  const parsedFiles: ParsedFile[] = [];
  for (const relativePath of markdownPaths) {
    const parsed = await parseFile(rootPath, relativePath);
    if (parsed) {
      parsedFiles.push(parsed);
    }
  }

  // Create a set of known file paths for validating internal links
  const knownPaths = new Set(parsedFiles.map((f) => f.relativePath));

  // Step 3: Build document nodes
  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge[] = [];

  // Track external domains for deduplication
  const externalDomains = new Map<string, { count: number; urls: string[] }>();

  for (let i = 0; i < parsedFiles.length; i++) {
    const file = parsedFiles[i];
    const nodeId = `doc-${file.relativePath}`;

    // Create document node
    nodes.push({
      id: nodeId,
      type: 'documentNode',
      position: { x: 0, y: 0 }, // Position will be set by layout algorithm
      data: {
        nodeType: 'document',
        ...file.stats,
      },
    });

    // Create edges for internal links
    for (const internalLink of file.internalLinks) {
      // Only create edge if target file exists
      if (knownPaths.has(internalLink)) {
        const targetNodeId = `doc-${internalLink}`;
        edges.push({
          id: `edge-${nodeId}-${targetNodeId}`,
          source: nodeId,
          target: targetNodeId,
          type: 'default',
        });
      }
    }

    // Collect external links if enabled
    if (includeExternalLinks) {
      for (const externalLink of file.externalLinks) {
        const existing = externalDomains.get(externalLink.domain);
        if (existing) {
          existing.count++;
          if (!existing.urls.includes(externalLink.url)) {
            existing.urls.push(externalLink.url);
          }
        } else {
          externalDomains.set(externalLink.domain, {
            count: 1,
            urls: [externalLink.url],
          });
        }

        // Create edge from document to external domain
        const externalNodeId = `ext-${externalLink.domain}`;
        edges.push({
          id: `edge-${nodeId}-${externalNodeId}`,
          source: nodeId,
          target: externalNodeId,
          type: 'external',
        });
      }
    }
  }

  // Step 4: Create external domain nodes if enabled
  if (includeExternalLinks) {
    for (const [domain, data] of externalDomains) {
      nodes.push({
        id: `ext-${domain}`,
        type: 'externalLinkNode',
        position: { x: 0, y: 0 }, // Position will be set by layout algorithm
        data: {
          nodeType: 'external',
          domain,
          linkCount: data.count,
          urls: data.urls,
        },
      });
    }
  }

  return { nodes, edges };
}

/**
 * Get document node data from a node
 * Type guard for document nodes
 */
export function isDocumentNode(
  data: GraphNodeData
): data is DocumentNodeData {
  return data.nodeType === 'document';
}

/**
 * Get external link node data from a node
 * Type guard for external link nodes
 */
export function isExternalLinkNode(
  data: GraphNodeData
): data is ExternalLinkNodeData {
  return data.nodeType === 'external';
}

export default buildGraphData;
