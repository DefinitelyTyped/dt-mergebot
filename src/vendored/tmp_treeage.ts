// Temporary vending until treeage is shipped

export type Predicate<T> = {
  (item: T): boolean;
  description?: string;
};

type FirstParameterOf<T> = T extends (arg: infer A) => unknown ? A : never;

export type Action<T> = (item: T) => void;

export interface Node<T> {
  /**
   * Creates a new node and add a predicated link to it.
   * The path is taken if *any* predicate matches.
   * Returns the new node.
   */
  addPath(...predicates: Predicate<T>[]): Node<T>;
  /**
   * Adds a predicated link to the specified node.
   */
  addPathTo(predicate: Predicate<T>, target: Node<T>): void;


  addGroup<U extends { [name: string]: Predicate<T> }>(predicateMap: U): { group: Node<T>, map: { [K in keyof U]: Node<T> } };

  /**
   * Adds an action to occur on this node if none of its links are followed.
   */
  addTerminalAction(action: Action<T>): void;
  /**
   * Adds an action to always occur on this node if it is traversed.
   */
  addAlwaysAction(action: Action<T>): void;
  /**
   * Creates a node that is traversed to if no other links are traversed.
   */
  otherwise(): Node<T>;

  setOptions(opts: Partial<NodeOptions>): void;

  /**
   * Process this item by following any matched links and executing any actions.
   */
  process(item: T, catchHandler?: any): void;
  /**
   * Adds a description to this node.
   * Returns the same node.
   */
  describe(name: string): Node<T>;

  /**
   * Attaches a handler to be invoked if a node fails to follow a defined traversal of the graph.
   */
  catch(handler: (erroringItem: T, error: TreeageError) => void): void;

  /**
   * Returns true if this node has any paths which would be traversed for this item.
   */
  groupingPredicate(item: T): boolean;

  readonly description: string;
  readonly hitCount: number;
  readonly terminalHitCount: number;
}

export type ImplementedNode<T> = Node<T> & {
  paths: ReadonlyArray<[readonly Predicate<T>[], Node<T>]>;
  terminalActions: ReadonlyArray<Action<T>>;
  actions: ReadonlyArray<Action<T>>;
  otherwiseNode: Node<T> | undefined;
}

export type TreeageError =
  | MultiplePathsMatchedError;

export type MultiplePathsMatchedError = {
  type: "multi-path",
  predicates: ReadonlyArray<Predicate<any>>
};

export interface NodeOptions {
  pathMode: "first" | "single" | "multiple";
}

function assertNever(x: never) {
  throw new Error(`Impossible value ${x} observed`);
}

export function createGroupNode<T>() {
  const node = create<T>();

  const preds: Predicate<T>[] = [];

  function addGroupChild(predicate: Predicate<T>) {
      preds.push(predicate);
  }

  function predicate(item: T) {
      throw new Error("Not implemented");
  }

  return {
      node,
      predicate,
      addGroupChild
  };
}

export function create<T>(nodeOptions?: NodeOptions): Node<T> {
  let options: NodeOptions = {
      pathMode: "single",
      ...nodeOptions
  };
  const paths: [readonly Predicate<T>[], Node<T>][] = [];
  const terminalActions: Action<T>[] = [];
  const actions: Action<T>[] = [];
  let catchHandler: undefined | FirstParameterOf<Node<T>["catch"]> = undefined;
  let description = "(unnamed)";
  let otherwiseNode: Node<T> | undefined = undefined;

  let hitCount = 0;
  let terminalHitCount = 0;

  function describe(name: string) {
      description = name;
      return impl;
  }

  function process(item: T, parentCatcher: typeof catchHandler = undefined): void {
      hitCount++;

      let alreadyMatched = false;
      const matchedPaths: typeof paths = [];
      const matchedPreds: Predicate<T>[] = [];
      for (const path of paths) {
          for (const pred of path[0]) {
              if (pred(item)) {
                  matchedPreds.push(pred);
                  matchedPaths.push(path);
                  break;
              }
          }
      }

      if (matchedPaths.length > 0) {
          switch (options.pathMode) {
              case "first":
                  matchedPaths[0][1].process(item, catchHandler || parentCatcher);
                  break;
              case "multiple":
                  for (const p of matchedPaths) {
                      p[1].process(item, catchHandler || parentCatcher);
                  }
                  break;
              case "single":
                  if (matchedPaths.length !== 1) {
                      const err: TreeageError = {
                          type: "multi-path",
                          predicates: matchedPreds
                      };
                      const catchFunc = catchHandler || parentCatcher;
                      if (catchFunc) {
                          catchFunc(item, err);
                      } else {
                          throw err;
                      }
                  } else {
                      matchedPaths[0][1].process(item, catchHandler || parentCatcher);
                  }
                  break;
              default:
                  assertNever(options.pathMode);
                  break;
          }
      } else {
          if (otherwiseNode) {
              otherwiseNode.process(item, catchHandler || parentCatcher);
          } else {
              terminalHitCount++;
              for (const term of terminalActions) {
                  term(item);
              }
          }
      }

      for (const always of actions) {
          always(item);
      }
  }

  function addGroup<U extends { [name: string]: Predicate<T> }>(predicateMap: U) {
      const map: { [K in keyof U]: Node<T> } = Object.create(null);
      const group = create<T>(nodeOptions);
      for (const k of Object.keys(predicateMap) as Array<keyof U>) {
          map[k] = group.addPath(predicateMap[k]);
          addPathTo(predicateMap[k], group);
      }
      return { group, map };
  }

  function addPath(...predicates: [Predicate<T>, ...Predicate<T>[]]): Node<T> {
      const target = create<T>(nodeOptions);
      if (predicates[0].description) {
          target.describe(predicates[0].description);
      }

      paths.push([predicates, target]);
      return target;
  }

  function addPathTo(predicate: Predicate<T>, target: Node<T>) {
      paths.push([[predicate], target]);
  }

  function addTerminalAction(action: Action<T>) {
      terminalActions.push(action);
  }

  function addAlwaysAction(action: Action<T>) {
      actions.push(action);
  }

  function otherwise() {
      if (otherwiseNode) throw new Error("Cannot call 'otherwise' twice on this node");
      return otherwiseNode = create<T>(nodeOptions);
  }

  function setOptions(opts: Partial<NodeOptions>) {
      nodeOptions = { ...nodeOptions, ...opts } as NodeOptions;
  }

  function catchImpl(handler: (item: T, error: TreeageError) => void) {
      catchHandler = handler;
  }

  function groupingPredicate(item: T) {
      return paths.some(p => p[0].some(p => p(item)));
  }
  Object.defineProperties(groupingPredicate, {
      description: {
          get() {
              return paths.map(p => p[0][0].description || "??").join(" or ");
          }
      }
  });

  const impl: ImplementedNode<T> = {
      addPath,
      addPathTo,
      addTerminalAction,
      addAlwaysAction,
      addGroup,
      otherwise,
      setOptions,
      describe,
      paths,
      actions,
      terminalActions,
      process,
      groupingPredicate,
      catch: catchImpl,

      get description() {
          return description;
      },
      get otherwiseNode() {
          return otherwiseNode;
      },
      get hitCount() {
          return hitCount;
      },
      get terminalHitCount() {
          return terminalHitCount;
      }
  };
  return impl;
}

export function or<T>(...preds: Predicate<T>[]): Predicate<T> {
  function result(item: T) {
      return preds.some(p => p(item));
  }
  result.description = preds.map(p => p.description).join(" or ");
  return result;
}

export function visualizeNodeTree(root: Node<any>, includeLineLabels = false): string {
  const seenNodes: Node<any>[] = [];

  const lines: string[] = [];
  lines.push(`digraph treeage {`);
  lines.push(`    graph [splines = ortho];`);
  lines.push(`    node [shape = record];`);
  recordNode(root as ImplementedNode<any>);
  lines.push(`}`);
  return lines.join("\r\n");

  function recordNode(node: ImplementedNode<any>): string {
      const existing = seenNodes.indexOf(node);
      if (existing >= 0) {
          return `node_${existing}`;
      }

      const nodeName = `node_${seenNodes.push(node) - 1}`;
      lines.push(`    ${nodeName} [label="${node.description} (${node.hitCount})"];`)
      for (const path of node.paths) {
          const target = path[1] as ImplementedNode<any>;
          const targetName = recordNode(target);
          const pred = path[0] as any;
          if (includeLineLabels) {
              lines.push(`    ${nodeName} -> ${targetName} [label="${pred.description || ""}"];`);
          } else {
              lines.push(`    ${nodeName} -> ${targetName};`);
          }
      }
      if (node.otherwiseNode) {
          const targetName = recordNode(node.otherwiseNode as ImplementedNode<any>);
          if (includeLineLabels) {
              lines.push(`    ${nodeName} -> ${targetName} [label="else"];`);
          } else {
              lines.push(`    ${nodeName} -> ${targetName};`);
          }
      }

      return nodeName;
  }
}

function getAllParentedNodes(root: Node<unknown>) {
  const results: [Node<unknown>, string][] = [];
  recur(root as ImplementedNode<unknown>, "")
  return results;

  function recur(node: ImplementedNode<unknown>, prefix: string) {
      results.push([node, prefix + node.description])
      for (const p of node.paths) {
          recur(p[1] as ImplementedNode<unknown>, prefix + node.description + ".");
      }
  }
}
