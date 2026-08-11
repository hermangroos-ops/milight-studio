import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import './Toast.css';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  text: string;
}

export interface ToastApi {
  show: (text: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

const noop: ToastApi = { show: () => undefined, dismiss: () => undefined };

const ToastContext = createContext<ToastApi>(noop);

/** Safe outside a provider so individual components stay testable in isolation. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const TONE_LABEL: Record<ToastTone, string> = {
  info: 'Melding',
  success: 'Gelukt',
  error: 'Fout',
};

export const TOAST_TIMEOUT_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const show = useCallback(
    (text: string, tone: ToastTone = 'info') => {
      const id = nextId.current;
      nextId.current += 1;
      setMessages((current) => [...current, { id, tone, text }]);
      setTimeout(() => {
        dismiss(id);
      }, TOAST_TIMEOUT_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion messages={messages} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function ToastRegion({
  messages,
  onDismiss,
}: {
  messages: readonly ToastMessage[];
  onDismiss: (id: number) => void;
}): ReactNode {
  return (
    <div className="toast-region" role="region" aria-label="Meldingen">
      <div aria-live="polite" aria-atomic="false" className="toast-region__live">
        {messages.map((message) => (
          <output key={message.id} className={`toast toast--${message.tone}`}>
            <span className="toast__tone">{TONE_LABEL[message.tone]}</span>
            <span className="toast__text">{message.text}</span>
            <button
              type="button"
              className="toast__close"
              onClick={() => {
                onDismiss(message.id);
              }}
              aria-label={`Melding sluiten: ${message.text}`}
            >
              ×
            </button>
          </output>
        ))}
      </div>
    </div>
  );
}
