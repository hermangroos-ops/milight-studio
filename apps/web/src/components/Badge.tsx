import type { ReactNode } from 'react';

import './Badge.css';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Rendered as an icon-free dot plus text; the text is always readable. */
  title?: string;
}

export function Badge({ tone = 'neutral', children, title }: BadgeProps): ReactNode {
  return (
    <span className={`badge badge--${tone}`} {...(title === undefined ? {} : { title })}>
      {children}
    </span>
  );
}
