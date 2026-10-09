import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, 
  FileText, 
  Receipt, 
  Building2, 
  Landmark, 
  BookOpen,
  BarChart3,
  PieChart,
  TrendingUp,
  Scale,
  Users,
  FileSpreadsheet,
  Calculator,
  Settings,
  ChevronDown,
  X,
  CreditCard,
  Zap,
  Radio,
  Database,
  Workflow,
  Bell,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../hooks/useTheme.jsx';

const menuItems = [
  {
    title: 'Financial Intelligence',
    icon: LayoutDashboard,
    path: '/dashboard',
  },
  {
    title: 'Data Ingestion',
    icon: Database,
    roles: ['admin', 'accountant'],
    excludeRoles: ['admin'],
    path: '/ingestion',
  },
  {
    title: 'Tally Connect',
    icon: Workflow,
    excludeRoles: ['admin'],
    path: '/tally',
  },
  {
    title: 'Invoices',
    icon: FileText,
    path: '/invoices',
    // Super admin owns the platform, not day-to-day bookkeeping.
    excludeRoles: ['admin'],
  },
  {
    title: 'Expenses',
    icon: Receipt,
    path: '/expenses',
    excludeRoles: ['admin'],
    children: [
      { title: 'All Expenses', path: '/expenses' },
      { title: 'Approval Queue', path: '/expenses/approval', roles: ['admin', 'accountant'] },
    ],
  },
  {
    title: 'Accounting',
    icon: Landmark,
    roles: ['admin', 'accountant'],
    excludeRoles: ['admin'],
    children: [
      { title: 'Chart of Accounts', path: '/accounts' },
      { title: 'Journal Entries', path: '/journal-entries' },
      { title: 'Ledger Integrity', path: '/ledger-integrity' },
    ],
  },
  {
    title: 'Reports',
    icon: BarChart3,
    excludeRoles: ['admin'],
    children: [
      { title: 'Profit & Loss', path: '/reports/profit-loss', icon: TrendingUp },
      { title: 'Balance Sheet', path: '/reports/balance-sheet', icon: Scale },
      { title: 'Cash Flow', path: '/reports/cash-flow', icon: PieChart },
      { title: 'Trial Balance', path: '/reports/trial-balance', icon: BookOpen },
      { title: 'Aged Receivables', path: '/reports/aged-receivables', icon: Users },
    ],
  },
  {
    title: 'GST',
    icon: FileSpreadsheet,
    excludeRoles: ['admin'],
    path: '/gst',
  },
  {
    title: 'TDS',
    icon: Calculator,
    excludeRoles: ['admin'],
    path: '/tds',
  },
  {
    title: 'Signals',
    icon: Radio,
    excludeRoles: ['admin'],
    path: '/signals',
    roles: ['admin', 'accountant'],
  },
  {
    title: 'Notifications',
    icon: Bell,
    path: '/notifications',
  },
  {
    title: 'Statements',
    icon: CreditCard,
    excludeRoles: ['admin'],
    path: '/statements',
    children: [
      { title: 'All Statements', path: '/statements' },
      { title: 'Upload Statement', path: '/statements/upload' },
    ],
  },
  {
    title: 'Settings',
    icon: Settings,
    roles: ['admin'],
    children: [
      { title: 'Company', path: '/settings/company', excludeRoles: ['admin'] },
      { title: 'Users', path: '/settings/users' },
    ],
  },
];

const Sidebar = ({ isOpen, mobileOpen, onMobileClose }) => {
  const location = useLocation();
  const { user } = useAuthStore();
  const { isUniverseMode, isDarkMode } = useTheme();
  const [expandedMenus, setExpandedMenus] = useState(['Accounting', 'Reports']);

  const toggleMenu = (title) => {
    setExpandedMenus((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const isParentActive = (children) => children?.some((child) => location.pathname === child.path);

  // Raw role check: a tenant sub_admin expands to 'admin' elsewhere and must
  // never be mistaken for the single platform super admin.
  const isSuperAdmin = user?.role === 'admin' && !user?.companyId;

  const hasAccess = (item) => {
    const rawRoles = user?.roles || (user?.role ? [user.role] : []);
    // excludeRoles is matched against RAW roles on purpose: a sub_admin
    // expands to 'admin' for visibility, but must not be treated as the
    // super admin here.
    if (item.excludeRoles && rawRoles.some((r) => item.excludeRoles.includes(r))) {
      return false;
    }
    let userRoles = rawRoles;
    // Sub-admin (client company admin) gets admin + accountant visibility.
    if (userRoles.includes('sub_admin')) {
      userRoles = [...new Set([...userRoles, 'admin', 'accountant'])];
    }
    if (!item.roles || item.roles.length === 0) return true;
    return item.roles.some((r) => userRoles.includes(r));
  };
  
  const filteredMenuItems = menuItems.filter(hasAccess).map(item => {
    // Super admin sees the platform view, not tenant bookkeeping.
    const relabeled =
      isSuperAdmin && item.path === '/dashboard'
        ? { ...item, title: 'Platform' }
        : item;
    if (relabeled.children) {
      return { ...relabeled, children: relabeled.children.filter(hasAccess) };
    }
    return relabeled;
  });

  const getActiveClasses = (active) => {
    if (!active) {
      return 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground';
    }
    if (isUniverseMode) {
      return 'bg-gradient-to-r from-primary to-secondary text-primary-foreground shadow-lg shadow-primary/25 nav-active-glow';
    }
    if (isDarkMode) {
      return 'bg-gradient-to-r from-primary to-primary/85 text-primary-foreground shadow-md shadow-primary/20';
    }
    return 'bg-gradient-to-r from-primary to-primary/90 text-primary-foreground shadow-md shadow-primary/20';
  };

  const sidebarClasses = clsx(
    'bg-sidebar-background border-r border-sidebar-border transition-all duration-300',
    (isDarkMode || isUniverseMode) && 'sidebar-enhanced'
  );

  const renderNav = (isMobile = false) => (
    <nav className="p-4 space-y-1 overflow-y-auto h-[calc(100vh-4.5rem)]">
      {filteredMenuItems.map((item) => (
        <div key={item.title}>
          {item.children ? (
            <>
              <button
                onClick={() => toggleMenu(item.title)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  isParentActive(item.children)
                    ? 'bg-sidebar-primary/10 text-sidebar-primary'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                )}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {(isOpen || isMobile) && (
                  <>
                    <span className="flex-1 text-left">{item.title}</span>
                    <ChevronDown
                      className={clsx(
                        'w-4 h-4 transition-transform duration-200',
                        expandedMenus.includes(item.title) && 'rotate-180'
                      )}
                    />
                  </>
                )}
              </button>
              {(isOpen || isMobile) && expandedMenus.includes(item.title) && (
                <div className="ml-4 mt-1 space-y-1">
                  {item.children.map((child) => (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      onClick={isMobile ? onMobileClose : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-200',
                          getActiveClasses(isActive)
                        )
                      }
                    >
                      {child.icon && <child.icon className="w-4 h-4" />}
                      <span>{child.title}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </>
          ) : (
            <NavLink
              to={item.path}
              onClick={isMobile ? onMobileClose : undefined}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                  getActiveClasses(isActive)
                )
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {(isOpen || isMobile) && <span>{item.title}</span>}
            </NavLink>
          )}
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={clsx(
          'fixed top-0 left-0 z-50 h-screen hidden lg:block',
          sidebarClasses,
          isOpen ? 'w-64' : 'w-20'
        )}
      >
        {/* Logo */}
        <div className="h-18 flex items-center px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
              isUniverseMode
                ? 'bg-gradient-to-br from-primary via-secondary to-accent shadow-lg shadow-primary/30'
                : 'bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/20'
            )}>
              <Building2 className="w-6 h-6 text-primary-foreground" />
            </div>
            {isOpen && (
              <span className={clsx(
                'text-xl font-bold font-display transition-opacity duration-200',
                isUniverseMode ? 'bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent' : 'text-sidebar-foreground'
              )}>
                ARTHA
              </span>
            )}
          </div>
        </div>

        {renderNav(false)}
      </aside>

      {/* Mobile Sidebar */}
      <aside
        className={clsx(
          'fixed top-0 left-0 z-50 h-screen w-64 lg:hidden',
          sidebarClasses,
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-18 flex items-center justify-between px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              isUniverseMode
                ? 'bg-gradient-to-br from-primary via-secondary to-accent shadow-lg shadow-primary/30'
                : 'bg-gradient-to-br from-primary to-primary/80 shadow-lg shadow-primary/20'
            )}>
              <Building2 className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className={clsx(
              'text-xl font-bold font-display',
              isUniverseMode ? 'bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent' : 'text-sidebar-foreground'
            )}>
              ARTHA
            </span>
          </div>
          <button onClick={onMobileClose} className="p-2 hover:bg-sidebar-accent rounded-xl transition-colors duration-200">
            <X className="w-5 h-5 text-sidebar-foreground/70" />
          </button>
        </div>

        {renderNav(true)}
      </aside>
    </>
  );
};

export default Sidebar;
