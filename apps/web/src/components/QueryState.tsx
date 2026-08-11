import type { ReactNode } from 'react';

import { describeError } from '../api/mutations.js';

export interface QueryStateProps {
  isPending: boolean;
  error: unknown;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}

/** Consistent loading / error / empty presentation for every list screen. */
export function QueryState({
  isPending,
  error,
  isEmpty = false,
  emptyMessage = 'Nog niets om te tonen.',
  children,
}: QueryStateProps): ReactNode {
  if (isPending) {
    return (
      <p className="empty-state" role="status">
        Bezig met laden…
      </p>
    );
  }
  if (error !== null && error !== undefined) {
    return (
      <p className="empty-state" role="alert">
        {describeError(error)}
      </p>
    );
  }
  if (isEmpty) {
    return <p className="empty-state">{emptyMessage}</p>;
  }
  return children;
}
