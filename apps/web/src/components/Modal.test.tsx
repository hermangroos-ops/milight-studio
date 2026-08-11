import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from './Modal.js';

function Fixture({ onClose }: { onClose: () => void }): React.ReactNode {
  return (
    <Modal open title="Groep bewerken" onClose={onClose} footer={<button type="button">Verwijderen</button>}>
      <button type="button">Eerste</button>
      <button type="button">Tweede</button>
    </Modal>
  );
}

describe('Modal', () => {
  it('is a labelled modal dialog', () => {
    render(<Fixture onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Groep bewerken');
  });

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} title="Dicht" onClose={vi.fn()}>
        <p>Inhoud</p>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves focus to the first focusable element', () => {
    render(<Fixture onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Sluiten' })).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the close button is used', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Sluiten' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Fixture onClose={vi.fn()} />);

    const close = screen.getByRole('button', { name: 'Sluiten' });
    const last = screen.getByRole('button', { name: 'Verwijderen' });

    await user.tab();
    expect(screen.getByRole('button', { name: 'Eerste' })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(last).toHaveFocus();

    // Wrapping forwards from the last element returns to the first.
    await user.tab();
    expect(close).toHaveFocus();

    // And backwards from the first element jumps to the last.
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('restores focus to the trigger when it closes', async () => {
    const user = userEvent.setup();

    function Host(): React.ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Openen
          </button>
          <Modal
            open={open}
            title="Test"
            onClose={() => {
              setOpen(false);
            }}
          >
            <button type="button">Binnen</button>
          </Modal>
        </>
      );
    }

    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Openen' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps focus inside even when the dialog has no focusable children', async () => {
    const user = userEvent.setup();
    render(
      <Modal open title="Leeg" onClose={vi.fn()}>
        <p>Niets te focussen</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    dialog.focus();
    await user.tab();

    expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true);
  });
});
