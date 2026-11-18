import { SpecError } from "@/errors.ts";

/** A node to order; its insertion sequence breaks ties between nodes that are ready together. */
export type OrderNode = {
  readonly name: string;
  readonly seq: number;
};

/**
 * Order nodes so every node runs after its predecessors (Kahn's algorithm). Among ready nodes the lowest `seq` runs
 * first, so the result is deterministic and keeps insertion order where no constraint applies.
 *
 * Cold path: runs only when a schedule changes.
 * @param nodes The nodes, in insertion order
 * @param predecessors For each node index, the indices of nodes that must run before it
 * @param label Used in the cycle error, e.g. `phase "update"`
 * @returns The node indices in run order
 * @throws {SpecError} If the constraints form a cycle; the message names the cycle path
 */
export function orderNodes(
  nodes: readonly OrderNode[],
  predecessors: readonly (readonly number[])[],
  label: string,
): number[] {
  const count = nodes.length;
  const indegree = new Array<number>(count).fill(0);
  const successors: number[][] = [];
  for (let i = 0; i < count; i++) successors.push([]);
  for (let i = 0; i < count; i++) {
    for (const before of predecessors[i]!) {
      successors[before]!.push(i);
      indegree[i]!++;
    }
  }

  const order: number[] = [];
  const done = new Array<boolean>(count).fill(false);
  while (order.length < count) {
    let next = -1;
    for (let i = 0; i < count; i++) {
      if (done[i] || indegree[i] !== 0) continue;
      if (next === -1 || nodes[i]!.seq < nodes[next]!.seq) next = i;
    }
    if (next === -1) {
      throw new SpecError(`Schedule ${label} has an ordering cycle: ${describeCycle(nodes, predecessors, done)}`);
    }
    done[next] = true;
    order.push(next);
    for (const successor of successors[next]!) indegree[successor]!--;
  }
  return order;
}

/**
 * Find one cycle among the unordered nodes. Each of them has an unordered predecessor, so walking predecessors from
 * the earliest-inserted one must revisit a node; the revisited stretch, reversed, is a cycle in run order.
 */
function describeCycle(
  nodes: readonly OrderNode[],
  predecessors: readonly (readonly number[])[],
  done: readonly boolean[],
): string {
  let start = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (!done[i] && (start === -1 || nodes[i]!.seq < nodes[start]!.seq)) start = i;
  }
  const path: number[] = [];
  const position = new Map<number, number>();
  let current = start;
  while (!position.has(current)) {
    position.set(current, path.length);
    path.push(current);
    current = predecessors[current]!.find((i) => !done[i])!;
  }
  const cycle = path.slice(position.get(current)!).reverse();
  // Start the reported cycle at its earliest-inserted node.
  let first = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (nodes[cycle[i]!]!.seq < nodes[cycle[first]!]!.seq) first = i;
  }
  const rotated = [...cycle.slice(first), ...cycle.slice(0, first)];
  return [...rotated, rotated[0]!].map((i) => nodes[i]!.name).join(" -> ");
}
