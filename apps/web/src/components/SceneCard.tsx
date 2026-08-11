import type { Scene } from '@milight-studio/shared';
import type { ReactNode } from 'react';

import { Badge } from './Badge.js';

import './SceneCard.css';

export interface SceneCardProps {
  scene: Scene;
  busy?: boolean;
  onActivate: (scene: Scene) => void;
  onDelete: (scene: Scene) => void;
}

export function SceneCard({ scene, busy = false, onActivate, onDelete }: SceneCardProps): ReactNode {
  const lightSteps = scene.steps.filter((step) => step.targetType === 'light').length;
  const groupSteps = scene.steps.length - lightSteps;

  return (
    <article className="scene-card card" aria-label={scene.name}>
      <div className="scene-card__body">
        <h3 className="scene-card__name">{scene.name}</h3>
        <p className="scene-card__meta">
          {scene.room ?? 'Geen kamer'} · {lightSteps} lampen · {groupSteps} groepen
        </p>
        {scene.exposeToVoice ? <Badge tone="neutral">Spraak</Badge> : null}
      </div>
      <div className="scene-card__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => {
            onActivate(scene);
          }}
        >
          {`Activeer ${scene.name}`}
        </button>
        <button
          type="button"
          className="button button--small button--danger"
          onClick={() => {
            onDelete(scene);
          }}
        >
          {`Verwijder ${scene.name}`}
        </button>
      </div>
    </article>
  );
}
