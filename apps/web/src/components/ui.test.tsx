import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Badge } from './Badge.js';
import { QueryState } from './QueryState.js';
import { ToastProvider, ToastRegion, TOAST_TIMEOUT_MS, useToast } from './Toast.js';
import { Toggle } from './Toggle.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('Badge', () => {
  it('renders its tone and optional title', () => {
    render(
      <Badge tone="danger" title="Uitleg">
        Onbereikbaar
      </Badge>,
    );

    const badge = screen.getByText('Onbereikbaar');
    expect(badge).toHaveClass('badge--danger');
    expect(badge).toHaveAttribute('title', 'Uitleg');
    expect(badge).not.toHaveAttribute('data-missing');
  });

  it('defaults to the neutral tone', () => {
    render(<Badge>Spraak</Badge>);
    expect(screen.getByText('Spraak')).toHaveClass('badge--neutral');
  });
});

describe('Toggle', () => {
  it('is a labelled switch that reports changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Bank aan of uit" />);

    await user.click(screen.getByRole('switch', { name: 'Bank aan of uit' }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('can hide its label visually and be disabled', () => {
    render(<Toggle checked onChange={vi.fn()} label="Verborgen" hideLabel disabled />);

    const toggle = screen.getByRole('switch', { name: 'Verborgen' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Verborgen')).toHaveClass('visually-hidden');
  });
});

describe('Toast', () => {
  function Trigger(): React.ReactNode {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() => {
          toast.show('Opgeslagen', 'success');
        }}
      >
        Toon
      </button>
    );
  }

  it('announces messages in a live region and dismisses them', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Toon' }));

    expect(screen.getByText('Opgeslagen')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Meldingen' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Melding sluiten/ }));
    expect(screen.queryByText('Opgeslagen')).not.toBeInTheDocument();
  });

  it('auto-dismisses after the timeout', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Toon' }).click();
      await Promise.resolve();
    });
    expect(screen.getByText('Opgeslagen')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS + 10);
    });

    expect(screen.queryByText('Opgeslagen')).not.toBeInTheDocument();
  });

  it('renders each tone', () => {
    render(
      <ToastRegion
        messages={[
          { id: 1, tone: 'info', text: 'Info' },
          { id: 2, tone: 'error', text: 'Fout' },
        ]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Melding')).toBeInTheDocument();
    expect(screen.getAllByText('Fout')).toHaveLength(2);
    expect(screen.getByText('Info')).toBeInTheDocument();
  });

  it('is a no-op outside a provider', async () => {
    const user = userEvent.setup();
    render(<Trigger />);

    await user.click(screen.getByRole('button', { name: 'Toon' }));

    expect(screen.queryByText('Opgeslagen')).not.toBeInTheDocument();
  });
});

describe('QueryState', () => {
  it('shows loading, error, empty and content in turn', () => {
    const view = render(
      <QueryState isPending error={null}>
        <p>Inhoud</p>
      </QueryState>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Bezig met laden');

    view.rerender(
      <QueryState isPending={false} error={new Error('stuk')}>
        <p>Inhoud</p>
      </QueryState>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('stuk');

    view.rerender(
      <QueryState isPending={false} error={null} isEmpty emptyMessage="Niets hier">
        <p>Inhoud</p>
      </QueryState>,
    );
    expect(screen.getByText('Niets hier')).toBeInTheDocument();

    view.rerender(
      <QueryState isPending={false} error={null}>
        <p>Inhoud</p>
      </QueryState>,
    );
    expect(screen.getByText('Inhoud')).toBeInTheDocument();
  });

  it('uses a default empty message', () => {
    render(
      <QueryState isPending={false} error={undefined} isEmpty>
        <p>Inhoud</p>
      </QueryState>,
    );
    expect(screen.getByText('Nog niets om te tonen.')).toBeInTheDocument();
  });
});
