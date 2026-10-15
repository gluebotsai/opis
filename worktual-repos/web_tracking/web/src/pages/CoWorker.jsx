import { Navigate, useLocation } from 'react-router-dom';

/** Legacy /co-worker URL — redirect without forcing split open. */
export default function CoWorker() {
  const location = useLocation();
  const from = location.state?.from;
  if (typeof from === 'string' && from.startsWith('/')) {
    return <Navigate to={from} replace />;
  }
  return <Navigate to="/" replace />;
}
