import type { Category } from "@/types/database";

export type CategoryNode = Category & {
  children: CategoryNode[];
  depth: number;
}

/** Convierte la lista plana en un árbol ordenado por nombre. */
export function buildTree(categories: Category[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  categories.forEach((c) => map.set(c.id, { ...c, children: [], depth: 0 }));
  const roots: CategoryNode[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (nodes: CategoryNode[], depth: number) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, "es"));
    nodes.forEach((n) => {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    });
  };
  sortRec(roots, 0);
  return roots;
}

/** Aplana el árbol en orden de profundidad (útil para <select>). */
export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  const walk = (n: CategoryNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/** Ids de la categoría y todos sus ancestros (de raíz a hoja). */
export function getAncestorIds(categories: Category[], id: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const chain: string[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

/** Ids de la categoría y todos sus descendientes. */
export function getDescendantIds(categories: Category[], id: string): string[] {
  const out = [id];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    categories.filter((c) => c.parent_id === cur).forEach((c) => {
      out.push(c.id);
      stack.push(c.id);
    });
  }
  return out;
}

/** "Ropa > Camisas > Manga larga" */
export function categoryPath(categories: Category[], id: string | null): string {
  if (!id) return "Sin categoría";
  const byId = new Map(categories.map((c) => [c.id, c]));
  return getAncestorIds(categories, id)
    .map((i) => byId.get(i)?.name ?? "?")
    .join(" > ");
}
