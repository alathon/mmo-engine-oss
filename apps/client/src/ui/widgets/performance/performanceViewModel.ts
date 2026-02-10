import type { Scene } from "@babylonjs/core/scene";
import type { ZoneConnectionManager } from "../../../network/zoneConnectionManager";

type Listener = () => void;

export interface PerformanceSnapshot {
  fps?: number;
  pingMs?: number;
}

const PING_SAMPLE_MS = 1000;
const PING_TIMEOUT_MS = 3000;

export class PerformanceViewModel {
  private listeners = new Set<Listener>();
  private snapshot: PerformanceSnapshot = {};
  private fps?: number;
  private pingMs?: number;
  private elapsedPingMs = 0;
  private pingInFlight = false;
  private pingInFlightMs = 0;
  private disposed = false;

  constructor(
    private scene: Scene,
    private connection: ZoneConnectionManager,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PerformanceSnapshot {
    return this.snapshot;
  }

  tick(deltaTimeMs: number): void {
    if (this.disposed) {
      return;
    }

    this.elapsedPingMs += deltaTimeMs;

    let changed = false;

    const nextFps = Math.round(this.scene.getEngine().getFps());
    if (this.fps !== nextFps) {
      this.fps = nextFps;
      changed = true;
    }

    if (this.pingInFlight) {
      this.pingInFlightMs += deltaTimeMs;
      if (this.pingInFlightMs >= PING_TIMEOUT_MS) {
        this.pingInFlight = false;
        this.pingInFlightMs = 0;
        if (this.pingMs !== undefined) {
          this.pingMs = undefined;
          changed = true;
        }
      }
    }

    if (this.elapsedPingMs >= PING_SAMPLE_MS && !this.pingInFlight) {
      this.elapsedPingMs = 0;
      const started = this.connection.ping((latencyMs) => {
        if (this.disposed) {
          return;
        }
        this.pingInFlight = false;
        this.pingInFlightMs = 0;
        const nextPing = Math.round(latencyMs);
        if (this.pingMs !== nextPing) {
          this.pingMs = nextPing;
          this.commit();
        }
      });

      if (started) {
        this.pingInFlight = true;
        this.pingInFlightMs = 0;
      } else if (this.pingMs !== undefined) {
        this.pingMs = undefined;
        changed = true;
      }
    }

    if (changed) {
      this.commit();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(): void {
    this.listeners.forEach((listener) => {
      listener();
    });
  }

  private commit(): void {
    this.snapshot = { fps: this.fps, pingMs: this.pingMs };
    this.emit();
  }
}
