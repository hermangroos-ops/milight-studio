import type { Group } from '@milight-studio/shared';
import { useState, type ReactNode } from 'react';

import type { CommandFailure } from '../api/endpoints.js';
import { useCreateGroup, useDeleteGroup, useGroupCommand, useUpdateGroup } from '../api/mutations.js';
import { useGroups, useLights } from '../api/queries.js';
import { GroupCard } from '../components/GroupCard.js';
import { GroupForm } from '../components/GroupForm.js';
import { Modal } from '../components/Modal.js';
import { QueryState } from '../components/QueryState.js';

type Editor = { mode: 'create' } | { mode: 'edit'; group: Group } | null;

export function GroupsPage(): ReactNode {
  const groups = useGroups();
  const lights = useLights();
  const command = useGroupCommand();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const [editor, setEditor] = useState<Editor>(null);
  const [failures, setFailures] = useState<Record<string, CommandFailure[]>>({});

  const allLights = lights.data ?? [];

  return (
    <section aria-labelledby="groups-heading" className="stack">
      <div className="page-header">
        <h2 id="groups-heading">Groepen</h2>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => {
            setEditor({ mode: 'create' });
          }}
        >
          Nieuwe groep
        </button>
      </div>

      <QueryState
        isPending={groups.isPending}
        error={groups.error}
        isEmpty={(groups.data?.length ?? 0) === 0}
        emptyMessage="Nog geen groepen aangemaakt."
      >
        {(groups.data ?? []).map((group) => {
          const members = allLights.filter((light) => group.lightIds.includes(light.id));
          return (
            <GroupCard
              key={group.id}
              group={group}
              members={members}
              failures={failures[group.id] ?? []}
              busy={command.isPending}
              onEdit={(target) => {
                setEditor({ mode: 'edit', group: target });
              }}
              onDelete={(target) => {
                deleteGroup.mutate(target.id);
              }}
              onCommand={(next) => {
                command.mutate(
                  { groupId: group.id, lightIds: group.lightIds, command: next },
                  {
                    onSuccess: (result) => {
                      setFailures((current) => ({ ...current, [group.id]: result.failed }));
                    },
                  },
                );
              }}
            />
          );
        })}
      </QueryState>

      <Modal
        open={editor !== null}
        title={editor?.mode === 'edit' ? `${editor.group.name} bewerken` : 'Nieuwe groep'}
        onClose={() => {
          setEditor(null);
        }}
      >
        {editor === null ? null : (
          <GroupForm
            lights={allLights}
            {...(editor.mode === 'edit' ? { initial: editor.group } : {})}
            busy={createGroup.isPending || updateGroup.isPending}
            onSubmit={(input) => {
              if (editor.mode === 'edit') updateGroup.mutate({ id: editor.group.id, input });
              else createGroup.mutate(input);
              setEditor(null);
            }}
          />
        )}
      </Modal>
    </section>
  );
}
