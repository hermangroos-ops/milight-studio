import type { ServerEvent } from '@milight-studio/shared';

export type EventListener = (event: ServerEvent) => void;

/**
 * A deliberately tiny pub/sub. Every state change funnels through here so the WebSocket
 * endpoint, the Hue bridge and the Matter bridge all observe exactly the same stream.
 */
export class EventBus {
  readonly #listeners = new Set<EventListener>();
  #onError: (error: unknown) => void;

  constructor(onError: (error: unknown) => void = () => undefined) {
    this.#onError = onError;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** A failing listener must never take down the caller that produced the event. */
  emit(event: ServerEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.#onError(error);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
