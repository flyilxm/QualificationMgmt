import type { IndexedFile } from "@/db";

export interface TreeNode {
  key: string;
  label: string;
  children?: TreeNode[];
  isLeaf: boolean;
  file?: IndexedFile;
  /** directory path relative to work root, no trailing slash */
  dirPath?: string;
}

function ensureChild(
  map: Map<string, TreeNode>,
  parentKey: string,
  segment: string,
  dirPath: string,
): TreeNode {
  const key = `${parentKey}/${segment}`;
  let node = map.get(key);
  if (!node) {
    node = {
      key,
      label: segment,
      isLeaf: false,
      dirPath,
      children: [],
    };
    map.set(key, node);
    const parent = map.get(parentKey);
    if (parent?.children) {
      parent.children.push(node);
    }
  }
  return node;
}

/** Build nested tree from file list (relative paths use `/`). */
export function buildTreeFromFiles(files: IndexedFile[]): TreeNode[] {
  const virtualRoot: TreeNode = {
    key: "dir:",
    label: "",
    isLeaf: false,
    dirPath: "",
    children: [],
  };
  const map = new Map<string, TreeNode>();
  map.set("dir:", virtualRoot);

  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sorted) {
    const parts = file.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let parentKey = "dir:";
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      acc = acc ? `${acc}/${seg}` : seg;
      ensureChild(map, parentKey, seg, acc);
      parentKey = `${parentKey}/${seg}`;
    }

    const fileName = parts[parts.length - 1]!;
    const parent = map.get(parentKey);
    if (!parent) continue;
    if (!parent.children) parent.children = [];
    const leaf: TreeNode = {
      key: file.id,
      label: fileName,
      isLeaf: true,
      file,
    };
    parent.children.push(leaf);
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isLeaf === b.isLeaf) return a.label.localeCompare(b.label);
      return a.isLeaf ? 1 : -1;
    });
    for (const n of nodes) {
      if (n.children?.length) sortNodes(n.children);
    }
  };
  if (virtualRoot.children) sortNodes(virtualRoot.children);
  return virtualRoot.children ?? [];
}

/** 当前树数据中存在的全部节点 key（含目录 dir: 前缀与文件 id） */
export function collectTreeNodeKeys(nodes: TreeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.add(n.key);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function collectFileIdsUnderNode(node: TreeNode): string[] {
  if (node.isLeaf && node.file) return [node.file.id];
  const ids: string[] = [];
  for (const c of node.children ?? []) {
    ids.push(...collectFileIdsUnderNode(c));
  }
  return ids;
}
