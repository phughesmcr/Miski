/** Browser demo simulation modes. */
export type DemoMode = "orbit" | "storm" | "lattice" | "flock";

/** Sent once when a browser connects. */
export type DemoHello = {
  type: "hello";
  width: number;
  height: number;
  capacity: number;
  minDrones: number;
  maxDrones: number;
  droneStep: number;
  /** Bytes before the first entity record in a binary frame. */
  headerBytes: number;
  /** Bytes per entity record in a binary frame. */
  entityBytes: number;
  /** World units are multiplied by this before being stored as Uint16. */
  positionScale: number;
  snapshotHz: number;
};

/** Metrics sent with each status message (about 4 Hz). */
export type SnapshotMetrics = {
  active: number;
  available: number;
  drones: number;
  sparks: number;
  charged: number;
  /** Drones that entered the charged query per second (`queryEntered`). */
  ignitedPerSec: number;
  /** Drones that exited the charged query per second (`queryExited`). */
  spentPerSec: number;
  spawned: number;
  destroyed: number;
  tickMs: number;
  heapMb: number;
  frameKb: number;
  forecastMs: number;
  forecastSteps: number;
  /** Mean distance between forecast and actual positions, or null if input disturbed the forecast. */
  forecastDrift: number | null;
  droneTarget: number;
  capacity: number;
};

/** Simulation state and metrics, sent as a JSON text message. */
export type DemoStatus = {
  type: "status";
  mode: DemoMode;
  running: boolean;
  intensity: number;
  contagion: number;
  forecast: boolean;
  metrics: SnapshotMetrics;
};

/** JSON text messages from the server. Entity frames are binary; see `visual.example.ts` for the layout. */
export type DemoServerMessage = DemoHello | DemoStatus;

/** Commands sent by the browser's controls. */
export type DemoCommand =
  | { action: "mode"; mode: DemoMode }
  | { action: "intensity" | "contagion" | "drones"; value: number }
  | { action: "forecast"; enabled: boolean }
  | { action: "toggle" | "reset" }
  | { action: "burst"; x: number; y: number; hue: number }
  | { action: "attract"; x: number; y: number; strength: number };
