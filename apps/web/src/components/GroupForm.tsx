import type { CreateGroupInput, Group, LightWithState } from '@milight-studio/shared';
import { useId, useState, type ReactNode } from 'react';

import { Toggle } from './Toggle.js';

import './GroupForm.css';

export interface GroupFormProps {
  lights: readonly LightWithState[];
  initial?: Group;
  busy?: boolean;
  onSubmit: (input: CreateGroupInput) => void;
}

export function GroupForm({ lights, initial, busy = false, onSubmit }: GroupFormProps): ReactNode {
  const ids = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [room, setRoom] = useState(initial?.room ?? '');
  const [lightIds, setLightIds] = useState<string[]>(initial ? [...initial.lightIds] : []);
  const [exposeToVoice, setExposeToVoice] = useState(initial?.exposeToVoice ?? true);
  const [error, setError] = useState<string | null>(null);

  const toggleMember = (id: string, checked: boolean): void => {
    setLightIds((current) => (checked ? [...current, id] : current.filter((member) => member !== id)));
  };

  const handleSubmit = (): void => {
    if (name.trim() === '') {
      setError('Geef de groep een naam.');
      return;
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      room: room.trim() === '' ? null : room.trim(),
      lightIds,
      exposeToVoice,
    });
  };

  return (
    <form
      className="group-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      noValidate
    >
      <div className="field">
        <label className="field__label" htmlFor={`${ids}-name`}>
          Naam
        </label>
        <input
          id={`${ids}-name`}
          type="text"
          value={name}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${ids}-error`}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {error === null ? null : (
          <p className="field__error" id={`${ids}-error`} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${ids}-room`}>
          Kamer (optioneel)
        </label>
        <input
          id={`${ids}-room`}
          type="text"
          value={room}
          onChange={(event) => {
            setRoom(event.target.value);
          }}
        />
      </div>

      <fieldset className="group-form__members">
        <legend className="field__label">Lampen in deze groep</legend>
        {lights.length === 0 ? (
          <p className="field__hint">Er zijn nog geen lampen om toe te voegen.</p>
        ) : (
          lights.map((light) => (
            <label key={light.id} className="group-form__member">
              <input
                type="checkbox"
                checked={lightIds.includes(light.id)}
                onChange={(event) => {
                  toggleMember(light.id, event.target.checked);
                }}
              />
              <span>
                {light.name}
                <span className="group-form__member-room">{light.room ?? 'Geen kamer'}</span>
              </span>
            </label>
          ))
        )}
      </fieldset>

      <div className="field">
        <Toggle checked={exposeToVoice} label="Zichtbaar voor spraakbesturing" onChange={setExposeToVoice} />
      </div>

      <button type="submit" className="button button--primary" disabled={busy}>
        {initial ? 'Groep opslaan' : 'Groep aanmaken'}
      </button>
    </form>
  );
}
