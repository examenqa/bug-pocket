import { useEffect, useState } from 'react';

function readRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/dashboard';
}

export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  const navigate = (nextRoute: string): void => {
    if (readRoute() === nextRoute) {
      setRoute(nextRoute);
      return;
    }
    window.location.hash = nextRoute;
  };

  useEffect(() => {
    const syncRoute = (): void => setRoute(readRoute());
    const unsubscribeNavigation = window.bugPocket.onNavigate((nextRoute) => navigate(nextRoute));
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      unsubscribeNavigation();
    };
  }, []);

  return { route, navigate };
}
