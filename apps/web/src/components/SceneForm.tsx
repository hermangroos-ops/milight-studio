import type { CreateSceneInput, Group, LightWithState } from '@milight-studio/shared';
import { useId, useState, type ReactNode } from 'react';

import { captureSceneSteps } from '../state/scene-capture.js';

import { Toggle } from './Toggle.js';

import './SceneForm.css';

export interface SceneFormProps {
  lights: readonly LightWithState[];
  groups: readonly Group[];
  busy?: boolean;
  onSubmit: (input: CreateSceneInput) => void;
}

function toggle(list: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...list, id] : list.filter((item) => item !== id);
}

/** Creates a scene from the *current* state of everything the user selects. */
export function SceneForm({ lights, groups, busy = false, onSubmit }: SceneFormProps): ReactNode {
  const ids = useId();
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [lightIds, setLightIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [exposeToVoice, setExposeToVoice] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (): void => {
    if (name.trim() === '') {
      setError('Geef de scène een naam.');
      return;
    }
    const steps = captureSceneSteps({
      lights,
      selectedLightIds: lightIds,
      groups,
      selectedGroupIds: groupIds,
    });
    if (steps.length === 0) {
      setError('Kies minstens één lamp of groep om vast te leggen.');
      return;
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      room: room.trim() === '' ? null : room.trim(),
      steps,
      exposeToVoice,
    });
  };

  return (
    <form
      className="scene-form"
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

      <fieldset className="scene-form__set">
        <legend className="field__label">Lampen vastleggen</legend>
        {lights.length === 0 ? <p className="field__hint">Nog geen lampen.</p> : null}
        {lights.map((light) => (
          <label key={light.id} className="scene-form__item">
            <input
              type="checkbox"
              checked={lightIds.includes(light.id)}
              onChange={(event) => {
                setLightIds((current) => toggle(current, light.id, event.target.checked));
              }}
            />
            <span>{light.name}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="scene-form__set">
        <legend className="field__label">Groepen vastleggen</legend>
        {groups.length === 0 ? <p className="field__hint">Nog geen groepen.</p> : null}
        {groups.map((group) => (
          <label key={group.id} className="scene-form__item">
            <input
              type="checkbox"
              checked={groupIds.includes(group.id)}
              onChange={(event) => {
                setGroupIds((current) => toggle(current, group.id, event.target.checked));
              }}
            />
            <span>{group.name}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <Toggle checked={exposeToVoice} label="Zichtbaar voor spraakbesturing" onChange={setExposeToVoice} />
      </div>

      {error === null ? null : (
        <p className="field__error" id={`${ids}-error`} role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="button button--primary" disabled={busy}>
        Scène opslaan
      </button>
    </form>
  );
}
