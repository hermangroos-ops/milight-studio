import type { ReactNode } from 'react';

import { useCreateLight, usePairLight } from '../api/mutations.js';
import { useBridges, useHealth, useLights } from '../api/queries.js';
import { AddLightForm } from '../components/AddLightForm.js';
import { BridgeList } from '../components/BridgeList.js';
import { HubStatus } from '../components/HubStatus.js';
import { PairingPanel } from '../components/PairingPanel.js';

export function SettingsPage(): ReactNode {
  const health = useHealth();
  const bridges = useBridges();
  const lights = useLights();
  const createLight = useCreateLight();
  const pairLight = usePairLight();

  return (
    <section aria-labelledby="settings-heading" className="stack">
      <h2 id="settings-heading">Instellingen</h2>

      <section className="card stack" aria-labelledby="add-light-heading">
        <h3 id="add-light-heading">Lamp toevoegen</h3>
        <AddLightForm
          busy={createLight.isPending}
          onSubmit={(input) => {
            createLight.mutate(input);
          }}
        />
      </section>

      <section className="card stack" aria-labelledby="pairing-heading">
        <h3 id="pairing-heading">Koppelen</h3>
        <PairingPanel
          lights={lights.data ?? []}
          busy={pairLight.isPending}
          onPair={(id, pair) => {
            pairLight.mutate({ id, pair });
          }}
        />
      </section>

      <section className="card stack" aria-labelledby="hub-heading">
        <h3 id="hub-heading">Hub</h3>
        <HubStatus health={health.data} isPending={health.isPending} error={health.error} />
      </section>

      <section className="card stack" aria-labelledby="bridges-heading">
        <h3 id="bridges-heading">Bruggen</h3>
        {bridges.isPending ? (
          <p className="status-panel">Bruggen worden opgehaald…</p>
        ) : (
          <BridgeList bridges={bridges.data ?? []} />
        )}
      </section>
    </section>
  );
}
