import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Group, Light, LightState, Scene } from '@milight-studio/shared';

export const DATABASE_VERSION = 1;

export interface DatabaseShape {
  version: number;
  lights: Light[];
  groups: Group[];
  scenes: Scene[];
  /** Shadow state per light id. MiLight bulbs never report back, so we remember. */
  states: Record<string, LightState>;
}

export function emptyDatabase(): DatabaseShape {
  return { version: DATABASE_VERSION, lights: [], groups: [], scenes: [], states: {} };
}

export interface Persistence {
  load(): Promise<DatabaseShape | null>;
  save(data: DatabaseShape): Promise<void>;
}

/** In-memory persistence, used by tests and by `--ephemeral` runs. */
export class MemoryPersistence implements Persistence {
  #data: DatabaseShape | null;
  saveCount = 0;

  constructor(initial: DatabaseShape | null = null) {
    this.#data = initial;
  }

  load(): Promise<DatabaseShape | null> {
    return Promise.resolve(this.#data === null ? null : structuredClone(this.#data));
  }

  save(data: DatabaseShape): Promise<void> {
    this.#data = structuredClone(data);
    this.saveCount += 1;
    return Promise.resolve();
  }
}

/**
 * Atomic file persistence: write to a temp file, fsync-by-rename over the real one.
 * A power cut mid-write therefore leaves either the old or the new file, never a
 * truncated one — which matters on a Raspberry Pi running off an SD card.
 */
export class FilePersistence implements Persistence {
  readonly #file: string;

  constructor(directory: string, filename = 'milight-studio.json') {
    this.#file = join(directory, filename);
  }

  get file(): string {
    return this.#file;
  }

  async load(): Promise<DatabaseShape | null> {
    try {
      const raw = await readFile(this.#file, 'utf8');
      return JSON.parse(raw) as DatabaseShape;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(data: DatabaseShape): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await rename(temp, this.#file);
  }
}

export interface StoreOptions {
  /** Coalesce rapid mutations into a single write. */
  debounceMs?: number;
  onError?: (error: unknown) => void;
  setTimeoutImpl?: typeof setTimeout;
}

/**
 * The single source of truth for persisted state.
 *
 * Reads are synchronous against an in-memory copy; writes are debounced and flushed
 * through the injected `Persistence`. `flush()` makes pending writes observable, which
 * tests and graceful shutdown both rely on.
 */
export class Store {
  readonly #persistence: Persistence;
  readonly #debounceMs: number;
  readonly #onError: (error: unknown) => void;
  #data: DatabaseShape = emptyDatabase();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> = Promise.resolve();
  #dirty = false;

  constructor(persistence: Persistence, options: StoreOptions = {}) {
    this.#persistence = persistence;
    this.#debounceMs = options.debounceMs ?? 250;
    this.#onError = options.onError ?? (() => undefined);
  }

  async load(): Promise<void> {
    const loaded = await this.#persistence.load();
    this.#data = loaded === null ? emptyDatabase() : migrate(loaded);
  }

  get data(): Readonly<DatabaseShape> {
    return this.#data;
  }

  /** Mutate the database and schedule a persist. */
  mutate<T>(mutator: (data: DatabaseShape) => T): T {
    const result = mutator(this.#data);
    this.#schedule();
    return result;
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#write();
    }, this.#debounceMs);
    // Never keep the process alive purely to flush a debounce timer.
    this.#timer.unref();
  }

  #write(): Promise<void> {
    if (!this.#dirty) return this.#inFlight;
    this.#dirty = false;
    const snapshot = structuredClone(this.#data);
    this.#inFlight = this.#inFlight
      .then(() => this.#persistence.save(snapshot))
      .catch((error: unknown) => {
        this.#onError(error);
      });
    return this.#inFlight;
  }

  /** Write any pending changes immediately and wait for them to land. */
  async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#write();
    await this.#inFlight;
  }
}

/**
 * Bring an on-disk document up to the current shape.
 *
 * The input is whatever JSON happened to be on disk — possibly hand-edited, possibly
 * written by an older version — so every field is treated as untrusted.
 */
export function migrate(data: unknown): DatabaseShape {
  const source = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const states = source.states;

  return {
    version: DATABASE_VERSION,
    lights: Array.isArray(source.lights) ? (source.lights as Light[]) : [],
    groups: Array.isArray(source.groups) ? (source.groups as Group[]) : [],
    scenes: Array.isArray(source.scenes) ? (source.scenes as Scene[]) : [],
    states:
      typeof states === 'object' && states !== null && !Array.isArray(states)
        ? (states as Record<string, LightState>)
        : {},
  };
}
