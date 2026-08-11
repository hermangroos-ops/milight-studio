import {
  DEVICE_ID_PATTERN,
  REMOTE_TYPE_PROFILE_LIST,
  REMOTE_TYPE_PROFILES,
  REMOTE_TYPES,
  isRemoteType,
  normaliseDeviceId,
  type CreateLightInput,
  type RemoteType,
  type RemoteTypeProfile,
} from '@milight-studio/shared';
import { useId, useState, type ReactNode } from 'react';

import { TextField } from './TextField.js';
import { Toggle } from './Toggle.js';

import './AddLightForm.css';

export interface AddLightFormValues {
  name: string;
  room: string;
  deviceId: string;
  remoteType: RemoteType;
  groupId: string;
  exposeToVoice: boolean;
}

export type AddLightErrors = Partial<Record<keyof AddLightFormValues, string>>;

export const EMPTY_LIGHT_FORM: AddLightFormValues = {
  name: '',
  room: '',
  deviceId: '',
  remoteType: 'rgb_cct',
  groupId: '1',
  exposeToVoice: true,
};

/** Defensive lookup: the value comes from a `<select>`, so treat it as untrusted. */
function profileFor(remoteType: RemoteType): RemoteTypeProfile {
  return isRemoteType(remoteType)
    ? REMOTE_TYPE_PROFILES[remoteType]
    : REMOTE_TYPE_PROFILES[EMPTY_LIGHT_FORM.remoteType];
}

/** Pure validation so the rules can be unit tested without rendering. */
export function validateLightForm(values: AddLightFormValues): AddLightErrors {
  const errors: AddLightErrors = {};

  if (values.name.trim() === '') errors.name = 'Geef de lamp een naam.';
  else if (values.name.trim().length > 64) errors.name = 'De naam mag maximaal 64 tekens lang zijn.';

  if (values.room.trim().length > 64) errors.room = 'De kamer mag maximaal 64 tekens lang zijn.';

  if (!(REMOTE_TYPES as readonly string[]).includes(values.remoteType)) {
    errors.remoteType = 'Kies een geldig afstandsbedieningstype.';
  }

  if (!DEVICE_ID_PATTERN.test(values.deviceId.trim())) {
    errors.deviceId = 'Het apparaat-id moet er zo uitzien: 0x1F2A (1 tot 4 hexadecimale tekens).';
  }

  const maxGroupId = profileFor(values.remoteType).maxGroupId;
  const groupId = Number(values.groupId);
  if (values.groupId.trim() === '' || !Number.isInteger(groupId)) {
    errors.groupId = 'Vul een geheel groepsnummer in.';
  } else if (groupId < 0 || groupId > maxGroupId) {
    errors.groupId = `Groep moet tussen 0 en ${maxGroupId} liggen voor dit type.`;
  }

  return errors;
}

export function toCreateInput(values: AddLightFormValues): CreateLightInput {
  return {
    name: values.name.trim(),
    room: values.room.trim() === '' ? null : values.room.trim(),
    deviceId: normaliseDeviceId(values.deviceId.trim()),
    remoteType: values.remoteType,
    groupId: Number(values.groupId),
    exposeToVoice: values.exposeToVoice,
  };
}

export interface AddLightFormProps {
  initialValues?: AddLightFormValues;
  submitLabel?: string;
  busy?: boolean;
  onSubmit: (input: CreateLightInput) => void;
}

export function AddLightForm({
  initialValues = EMPTY_LIGHT_FORM,
  submitLabel = 'Lamp toevoegen',
  busy = false,
  onSubmit,
}: AddLightFormProps): ReactNode {
  const ids = useId();
  const [values, setValues] = useState<AddLightFormValues>(initialValues);
  const [errors, setErrors] = useState<AddLightErrors>({});
  const profile = profileFor(values.remoteType);

  const update = <K extends keyof AddLightFormValues>(key: K, value: AddLightFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (): void => {
    const found = validateLightForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(toCreateInput(values));
  };

  const groupHint =
    profile.maxGroupId === 0
      ? 'Dit type heeft maar \u00e9\u00e9n zone: gebruik 0.'
      : `Toegestaan: 0 tot en met ${profile.maxGroupId}.${
          profile.supportsBroadcast ? ' 0 stuurt alle zones tegelijk aan.' : ''
        }`;

  return (
    <form
      className="add-light-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      noValidate
    >
      <TextField
        id={`${ids}-name`}
        label="Naam"
        value={values.name}
        {...(errors.name === undefined ? {} : { error: errors.name })}
        onChange={(value) => {
          update('name', value);
        }}
      />

      <TextField
        id={`${ids}-room`}
        label="Kamer (optioneel)"
        value={values.room}
        {...(errors.room === undefined ? {} : { error: errors.room })}
        onChange={(value) => {
          update('room', value);
        }}
      />

      <div className="field">
        <label className="field__label" htmlFor={`${ids}-remoteType`}>
          Type afstandsbediening
        </label>
        <select
          id={`${ids}-remoteType`}
          value={values.remoteType}
          aria-describedby={`${ids}-remoteType-hint`}
          onChange={(event) => {
            update('remoteType', event.target.value as RemoteType);
          }}
        >
          {REMOTE_TYPE_PROFILE_LIST.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {`${candidate.label} \u2014 ${candidate.hint}`}
            </option>
          ))}
        </select>
        <p className="field__hint" id={`${ids}-remoteType-hint`}>
          {profile.hint}
        </p>
      </div>

      <TextField
        id={`${ids}-deviceId`}
        label="Apparaat-id"
        value={values.deviceId}
        placeholder="0x1F2A"
        hint="Het radio-adres van de afstandsbediening, bijvoorbeeld 0x1F2A."
        {...(errors.deviceId === undefined ? {} : { error: errors.deviceId })}
        onChange={(value) => {
          update('deviceId', value);
        }}
      />

      <TextField
        id={`${ids}-groupId`}
        label="Groep (zone)"
        type="number"
        min={0}
        max={profile.maxGroupId}
        value={values.groupId}
        hint={groupHint}
        {...(errors.groupId === undefined ? {} : { error: errors.groupId })}
        onChange={(value) => {
          update('groupId', value);
        }}
      />

      <div className="field">
        <Toggle
          checked={values.exposeToVoice}
          label="Zichtbaar voor spraakbesturing"
          onChange={(checked) => {
            update('exposeToVoice', checked);
          }}
        />
      </div>

      <button type="submit" className="button button--primary" disabled={busy}>
        {submitLabel}
      </button>
    </form>
  );
}
