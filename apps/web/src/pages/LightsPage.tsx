import type { LightWithState } from '@milight-studio/shared';
import { useState, type ReactNode } from 'react';

import { useLightCommand, useDeleteLight, useUpdateLight } from '../api/mutations.js';
import { useLights } from '../api/queries.js';
import { AddLightForm, EMPTY_LIGHT_FORM, type AddLightFormValues } from '../components/AddLightForm.js';
import { LightCard } from '../components/LightCard.js';
import { Modal } from '../components/Modal.js';
import { QueryState } from '../components/QueryState.js';

function toFormValues(light: LightWithState): AddLightFormValues {
  return {
    ...EMPTY_LIGHT_FORM,
    name: light.name,
    room: light.room ?? '',
    deviceId: light.deviceId,
    remoteType: light.remoteType,
    groupId: String(light.groupId),
    exposeToVoice: light.exposeToVoice,
  };
}

export function LightsPage(): ReactNode {
  const lights = useLights();
  const command = useLightCommand();
  const updateLight = useUpdateLight();
  const deleteLight = useDeleteLight();
  const [editing, setEditing] = useState<LightWithState | null>(null);

  return (
    <section aria-labelledby="lights-heading" className="stack">
      <h2 id="lights-heading">Lampen</h2>

      <QueryState
        isPending={lights.isPending}
        error={lights.error}
        isEmpty={(lights.data?.length ?? 0) === 0}
        emptyMessage="Nog geen lampen. Voeg er een toe bij Instellingen."
      >
        {(lights.data ?? []).map((light) => (
          <LightCard
            key={light.id}
            light={light}
            busy={command.isPending}
            onEdit={setEditing}
            onCommand={(next) => {
              command.mutate({ lightId: light.id, command: next });
            }}
          />
        ))}
      </QueryState>

      <Modal
        open={editing !== null}
        title={editing ? `${editing.name} bewerken` : 'Lamp bewerken'}
        onClose={() => {
          setEditing(null);
        }}
        footer={
          editing ? (
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                deleteLight.mutate(editing.id);
                setEditing(null);
              }}
            >
              Lamp verwijderen
            </button>
          ) : null
        }
      >
        {editing ? (
          <AddLightForm
            initialValues={toFormValues(editing)}
            submitLabel="Wijzigingen opslaan"
            busy={updateLight.isPending}
            onSubmit={(input) => {
              updateLight.mutate({ id: editing.id, input });
              setEditing(null);
            }}
          />
        ) : null}
      </Modal>
    </section>
  );
}
