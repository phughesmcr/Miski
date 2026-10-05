/** Browser demo simulation modes. */
export type DemoMode = "orbit" | "storm" | "lattice";

/** Metrics sent with each simulation snapshot. */
export type SnapshotMetrics = {
  active: number;
  available: number;
  drones: number;
  sparks: number;
  entered: number;
  exited: number;
  spawned: number;
  destroyed: number;
  tickMs: number;
  heapMb: number;
  rendered: number;
  renderLimit: number;
  droneTarget: number;
  capacity: number;
};

/** The server-to-browser snapshot contract. Entity columns are base64 Float32 values. */
export type DemoSnapshot = {
  frame: number;
  mode: DemoMode;
  running: boolean;
  width: number;
  height: number;
  pulse: [number, number, number];
  metrics: SnapshotMetrics;
  stride: number;
  entitiesB64: string;
};

/** Commands sent by the browser's controls. */
export type DemoCommand =
  | { action: "mode"; mode: DemoMode }
  | { action: "intensity" | "drones" | "rendered"; value: number }
  | { action: "toggle" | "reset" }
  | { action: "burst"; x: number; y: number; hue: number };
