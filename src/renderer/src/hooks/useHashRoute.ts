import { useCallback, useEffect, useRef, useState } from 'react';

import { withSavedDraft } from '../utils/draftLifecycle';

function readRoute(): string {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  return hash || '/dashboard';
}

export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  const acceptedRoute = useRef(route);
  const navigation = useRef<Promise<void>>(Promise.resolve());
  const navigate = useCallback((nextRoute: string): void => {
    navigation.current = navigation.current.then(() => withSavedDraft(() => {
      acceptedRoute.current = nextRoute;
      window.history.replaceState(null, '', '#' + nextRoute);
      setRoute(nextRoute);
    })).catch(() => {
      // Save failure keeps the current view and draft; the save owner displays the error.
      window.history.replaceState(null, '', '#' + acceptedRoute.current);
    });
  }, []);

  useEffect(() => {
    const syncRoute = (): void => {
      const target = readRoute();
      window.history.replaceState(null, '', '#' + acceptedRoute.current);
      navigate(target);
    };
    const unsubscribeNavigation = window.bugPocket.onNavigate(navigate);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      unsubscribeNavigation();
    };
  }, [navigate]);

  return { route, navigate };
}
