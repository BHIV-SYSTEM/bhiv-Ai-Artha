import { useAuthStore } from '../store/authStore';

// Mirror Sidebar.jsx / App.jsx: sub_admin (client Admin) gets admin + accountant visibility.
export const effectiveRoles = (user) => {
  const raw = user?.roles || (user?.role ? [user.role] : []);
  if (raw.includes('sub_admin')) {
    return [...new Set([...raw, 'admin', 'accountant'])];
  }
  return raw;
};

export const can = (user, allowedRoles) => {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  const roles = effectiveRoles(user);
  return allowedRoles.some((role) => roles.includes(role));
};

export const useCan = () => {
  const user = useAuthStore((state) => state.user);
  return (allowedRoles) => can(user, allowedRoles);
};
