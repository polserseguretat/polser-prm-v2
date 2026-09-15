import { Navigate, useLocation } from 'react-router-dom';
import { isAdminAuthenticated } from '../../lib/adminSession';

export default function RequireSuperuser({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  if (!isAdminAuthenticated()) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
