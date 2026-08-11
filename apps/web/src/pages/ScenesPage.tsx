import { useState, type ReactNode } from 'react';

import { useActivateScene, useCreateScene, useDeleteScene } from '../api/mutations.js';
import { useGroups, useLights, useScenes } from '../api/queries.js';
import { Modal } from '../components/Modal.js';
import { QueryState } from '../components/QueryState.js';
import { SceneCard } from '../components/SceneCard.js';
import { SceneForm } from '../components/SceneForm.js';

export function ScenesPage(): ReactNode {
  const scenes = useScenes();
  const lights = useLights();
  const groups = useGroups();
  const createScene = useCreateScene();
  const deleteScene = useDeleteScene();
  const activateScene = useActivateScene();
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby="scenes-heading" className="stack">
      <div className="page-header">
        <h2 id="scenes-heading">Scènes</h2>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => {
            setCreating(true);
          }}
        >
          Nieuwe scène
        </button>
      </div>

      <p className="page-intro">
        Een scène legt de huidige stand van de gekozen lampen en groepen vast. Zet je licht eerst goed en sla
        het daarna op.
      </p>

      <QueryState
        isPending={scenes.isPending}
        error={scenes.error}
        isEmpty={(scenes.data?.length ?? 0) === 0}
        emptyMessage="Nog geen scènes opgeslagen."
      >
        {(scenes.data ?? []).map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            busy={activateScene.isPending}
            onActivate={(target) => {
              activateScene.mutate(target.id);
            }}
            onDelete={(target) => {
              deleteScene.mutate(target.id);
            }}
          />
        ))}
      </QueryState>

      <Modal
        open={creating}
        title="Nieuwe scène"
        onClose={() => {
          setCreating(false);
        }}
      >
        <SceneForm
          lights={lights.data ?? []}
          groups={groups.data ?? []}
          busy={createScene.isPending}
          onSubmit={(input) => {
            createScene.mutate(input);
            setCreating(false);
          }}
        />
      </Modal>
    </section>
  );
}
