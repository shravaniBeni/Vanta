import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** No-op navigation tracker for self-hosted Vanta (no telemetry). */
export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    // Could integrate analytics here if desired
  }, [location]);

  return null;
}
