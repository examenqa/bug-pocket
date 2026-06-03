import { useCallback, useEffect, useState } from 'react';

function readRoute(): string {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  return hash || '/dashboard';
}

export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  const navigate = useCallback((nextRoute: string): void => {
    if (readRoute() === nextRoute) {
      setRoute(nextRoute);
      return;
    }
    window.location.hash = nextRoute;
  }, []);

  useEffect(() => {
    const syncRoute = (): void => setRoute(readRoute());
    const unsubscribeNavigation = window.bugPocket.onNavigate((nextRoute) => navigate(nextRoute));
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      unsubscribeNavigation();
    };
  }, [navigate]);

  return { route, navigate };
}
