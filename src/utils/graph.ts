/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

export class Graph<T> {
  /** @private */
  #directed: boolean;

  /** @private */
  #edges: Map<T, Set<T>>;

  /** @private */
  #result: T[];

  /** @private */
  #stack: T[];

  /** @private */
  #visited: Map<T, boolean>;

  /**
   * Create a new Graph<T>
   * @param directed is graph directed? Defaults to `true`.
   */
  constructor(directed = true) {
    this.#directed = directed;
    this.#edges = new Map();
    this.#result = [];
    this.#stack = [];
    this.#visited = new Map();
  }

  addEdge(start: T, end: T, directed = this.#directed): Graph<T> {
    if (start === end) return this;
    if (!this.#edges.has(start)) this.#edges.set(start, new Set());
    if (!this.#edges.has(end)) this.#edges.set(end, new Set());
    this.#edges.get(start)?.add(end);
    if (directed) this.#edges.get(end)?.add(start);
    return this;
  }

  removeEdge(start: T, end: T, directed = this.#directed): Graph<T> {
    if (start === end) return this;
    let edge = this.#edges.get(start);
    if (edge) {
      edge.delete(end);
      if (!edge.size) this.#edges.delete(start);
    }
    if (directed) {
      edge = this.#edges.get(end);
      if (edge) {
        edge.delete(start);
        if (!edge.size) this.#edges.delete(end);
      }
    }
    return this;
  }

  /** @private */
  #purgeSearch(): void {
    this.#result.length = 0;
    this.#stack.length = 1;
    this.#visited.clear();
  }

  /**
   * Search the graph. Defaults to DFS.
   * @param vertex
   * @param dfs dfs = true (default); bfs = false;
   * @param iterative search iteratively (true; default), or recursively
   * @returns
   */
  search(vertex: T, dfs = true, iterative = true): T[] {
    if (!vertex) return [];
    this.#purgeSearch();
    this.#stack[0] = vertex;
    while (this.#stack.length) {
      const current = dfs ? this.#stack.pop() : this.#stack.shift();
      if (current && !this.#visited.has(current)) {
        this.#visited.set(current, true);
        this.#result.push(current);
        const edges = this.#edges.get(current);
        if (edges?.size) {
          if (iterative) {
            this.#stack.push(...edges);
          } else {
            edges.forEach((edge) => {
              this.#stack.push(...this.search(edge, dfs, true));
            });
          }
        }
      }
    }
    return [...this.#result];
  }

  toString(): string {
    let result = "";
    this.#edges.forEach((edge, vertex) => {
      result += `(${String(vertex)} => ${[...edge.values()].join(", ")})\n`;
    });
    return result;
  }
}
