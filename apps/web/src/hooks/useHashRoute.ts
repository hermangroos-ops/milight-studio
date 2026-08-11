import { useCallback, useEffect, useState } from 'react';

export const ROUTES = ['lampen', 'groepen', 'scenes', 'instellingen'] as const;
export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = 'lampen';

export function parseRoute(hash: string): Route {
  const candidate = hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(candidate) ? (candidate as Route) : DEFAULT_ROUTE;
}

export interface RouteApi {
  route: Route;
  navigate: (route: Route) => void;
}

/** Minimal hash router — no dependency, no history juggling, back button just works. */
export function useHashRoute(): RouteApi {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? DEFAULT_ROUTE : parseRoute(window.location.hash),
  );

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

  return { route, navigate };
}
