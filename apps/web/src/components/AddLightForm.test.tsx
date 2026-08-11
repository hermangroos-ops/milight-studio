import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddLightForm, EMPTY_LIGHT_FORM, toCreateInput, validateLightForm } from './AddLightForm.js';

async function fill(label: RegExp, value: string): Promise<void> {
  const user = userEvent.setup();
  const field = screen.getByLabelText(label);
  await user.clear(field);
  if (value !== '') await user.type(field, value);
}

describe('validateLightForm', () => {
  it('accepts a well-formed light', () => {
    expect(
      validateLightForm({ ...EMPTY_LIGHT_FORM, name: 'Bank', deviceId: '0x1F2A', groupId: '3' }),
    ).toEqual({});
  });

  it('rejects a missing name and an over-long name or room', () => {
    expect(validateLightForm({ ...EMPTY_LIGHT_FORM, name: '  ' }).name).toBeDefined();
    expect(validateLightForm({ ...EMPTY_LIGHT_FORM, name: 'a'.repeat(65) }).name).toBeDefined();
    expect(validateLightForm({ ...EMPTY_LIGHT_FORM, room: 'a'.repeat(65) }).room).toBeDefined();
  });

  it('rejects a device id that is not 0x-prefixed hex', () => {
    for (const deviceId of ['1F2A', '0xZZZZ', '0x12345', '', '0x']) {
      expect(validateLightForm({ ...EMPTY_LIGHT_FORM, name: 'Bank', deviceId }).deviceId).toBeDefined();
    }
    expect(
      validateLightForm({ ...EMPTY_LIGHT_FORM, name: 'Bank', deviceId: '0x1' }).deviceId,
    ).toBeUndefined();
  });

  it('constrains the group id to the range of the chosen remote type', () => {
    const base = { ...EMPTY_LIGHT_FORM, name: 'Bank', deviceId: '0x1f2a' };

    expect(validateLightForm({ ...base, remoteType: 'rgb_cct', groupId: '5' }).groupId).toContain('0 en 4');
    expect(validateLightForm({ ...base, remoteType: 'fut089', groupId: '5' }).groupId).toBeUndefined();
    expect(validateLightForm({ ...base, remoteType: 'rgb', groupId: '1' }).groupId).toContain('0 en 0');
    expect(validateLightForm({ ...base, groupId: '-1' }).groupId).toBeDefined();
    expect(validateLightForm({ ...base, groupId: '' }).groupId).toBe('Vul een geheel groepsnummer in.');
    expect(validateLightForm({ ...base, groupId: '1.5' }).groupId).toBe('Vul een geheel groepsnummer in.');
  });

  it('rejects an unknown remote type', () => {
    const values = { ...EMPTY_LIGHT_FORM, name: 'Bank', deviceId: '0x1f2a' };
    expect(validateLightForm({ ...values, remoteType: 'nonsense' as never }).remoteType).toBeDefined();
  });
});

describe('toCreateInput', () => {
  it('trims and normalises before submitting', () => {
    expect(
      toCreateInput({
        ...EMPTY_LIGHT_FORM,
        name: '  Bank ',
        room: ' Zolder ',
        deviceId: '0X1f',
        groupId: '2',
      }),
    ).toEqual({
      name: 'Bank',
      room: 'Zolder',
      deviceId: '0x001f',
      remoteType: 'rgb_cct',
      groupId: 2,
      exposeToVoice: true,
    });
  });

  it('turns an empty room into null', () => {
    expect(toCreateInput({ ...EMPTY_LIGHT_FORM, name: 'Bank', deviceId: '0x1', room: '  ' }).room).toBeNull();
  });
});

describe('AddLightForm', () => {
  it('shows visible messages for a bad device id and an out-of-range group', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddLightForm onSubmit={onSubmit} />);

    await fill(/^naam$/i, 'Bank');
    await fill(/apparaat-id/i, 'oeps');
    await fill(/groep \(zone\)/i, '7');
    await user.click(screen.getByRole('button', { name: 'Lamp toevoegen' }));

    expect(onSubmit).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
    expect(alerts).toEqual(
      expect.arrayContaining([expect.stringContaining('0x1F2A'), expect.stringContaining('tussen 0 en 4')]),
    );
    expect(screen.getByLabelText(/apparaat-id/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/apparaat-id/i)).toHaveAccessibleDescription(
      expect.stringContaining('hexadecimale'),
    );
  });

  it('reports a missing name', async () => {
    const user = userEvent.setup();
    render(<AddLightForm onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Lamp toevoegen' }));

    expect(screen.getByText('Geef de lamp een naam.')).toBeInTheDocument();
  });

  it('submits a normalised light once every field is valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddLightForm onSubmit={onSubmit} />);

    await fill(/^naam$/i, 'Bank');
    await fill(/^kamer/i, 'Woonkamer');
    await fill(/apparaat-id/i, '0x1f2a');
    await user.selectOptions(screen.getByLabelText(/type afstandsbediening/i), 'fut089');
    await fill(/groep \(zone\)/i, '7');
    await user.click(screen.getByRole('switch', { name: /spraakbesturing/i }));
    await user.click(screen.getByRole('button', { name: 'Lamp toevoegen' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Bank',
      room: 'Woonkamer',
      deviceId: '0x1f2a',
      remoteType: 'fut089',
      groupId: 7,
      exposeToVoice: false,
    });
  });

  it('shows the hint of the selected remote type and the allowed group range', async () => {
    const user = userEvent.setup();
    render(<AddLightForm onSubmit={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/type afstandsbediening/i), 'rgb');

    expect(screen.getByText(/maar één zone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/groep \(zone\)/i)).toHaveAttribute('max', '0');
  });

  it('can be pre-filled for editing', () => {
    render(
      <AddLightForm
        initialValues={{
          name: 'Bank',
          room: '',
          deviceId: '0x0001',
          remoteType: 'cct',
          groupId: '2',
          exposeToVoice: false,
        }}
        submitLabel="Wijzigingen opslaan"
        busy
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/^naam$/i)).toHaveValue('Bank');
    expect(screen.getByRole('button', { name: 'Wijzigingen opslaan' })).toBeDisabled();
  });
});
