import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  ChevronDown,
  User,
  Settings,
  LogOut,
  HelpCircle,
  Shield,
  Calculator,
  Eye,
  CheckCheck,
  Database,
  FileText,
  BarChart3,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useCan } from '../../utils/permissions';
import { notificationService } from '../../services/index';
import { ThemeDropdown } from '../common/ThemeToggle';
import { Modal } from '../common';
import clsx from 'clsx';
import { formatDistanceToNow } from 'date-fns';

// Quick "how ARTHA flows" overview shown to first-time users (auto) and
// on demand from the ? button in the top bar.
const ONBOARDING_STEPS = [
  {
    icon: Database,
    title: '1. Bring your data in',
    body: 'Tally Connect pulls ledgers from Tally automatically. Smart Upload reads invoices/receipts from PDFs and images. Data Ingestion imports Tally/Zoho/Busy files.',
    path: '/ingestion',
    cta: 'Open Data Ingestion',
  },
  {
    icon: FileText,
    title: '2. Invoice & expense',
    body: 'Create an invoice or expense — sending/approving it posts a balanced journal entry automatically, with GST calculated line by line.',
    path: '/invoices',
    cta: 'Go to Invoices',
  },
  {
    icon: Shield,
    title: '3. Ledger stays tamper-proof',
    body: 'Every posting joins an HMAC hash chain. Ledger Integrity verifies the whole chain entry by entry whenever you want proof.',
    path: '/ledger-integrity',
    cta: 'Check integrity',
  },
  {
    icon: Calculator,
    title: '4. GST & TDS compliance',
    body: 'GSTR-1/GSTR-3B packets and TDS tracking (deduct → deposit → file) are generated from the same ledger — no re-entry.',
    path: '/gst',
    cta: 'Open GST',
  },
  {
    icon: BarChart3,
    title: '5. Money flow',
    body: 'Bank statements auto-reconcile against invoices, expenses and the ledger; unmatched transactions raise review alerts.',
    path: '/statements',
    cta: 'Open Statements',
  },
  {
    icon: Bell,
    title: '6. Decide with reports & signals',
    body: 'Dashboard KPIs, P&L / Balance Sheet / Cash Flow and compliance Signals (cash-flow dips, overdue invoices) tell you what needs attention.',
    path: '/dashboard',
    cta: 'Back to Dashboard',
  },
];

const roleConfig = {
  admin: { label: 'Super Admin', color: 'bg-destructive/10 text-destructive', icon: Shield },
  sub_admin: { label: 'Admin', color: 'bg-amber-100 text-amber-700', icon: Shield },
  accountant: { label: 'Accountant', color: 'bg-primary/10 text-primary', icon: Calculator },
  viewer: { label: 'Viewer', color: 'bg-muted text-muted-foreground', icon: Eye },
  user: { label: 'User', color: 'bg-muted text-muted-foreground', icon: User },
};

const typeColors = {
  info: 'text-blue-500',
  success: 'text-green-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  location: 'text-purple-500',
  payment: 'text-emerald-500',
  overdue: 'text-orange-500',
  system: 'text-gray-500',
};

const Navbar = ({ onToggleSidebar, onMobileMenuClick }) => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const can = useCan();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  // First-time users get the overview automatically, once per browser.
  // The ? button in the top bar reopens it at any time.
  useEffect(() => {
    if (!user) return;
    try {
      if (localStorage.getItem('artha_onboarding_seen') !== '1') {
        setShowHelp(true);
        localStorage.setItem('artha_onboarding_seen', '1');
      }
    } catch {
      /* localStorage unavailable — just skip the auto-open */
    }
  }, [user]);

  const openHelpStep = (path) => {
    setShowHelp(false);
    navigate(path);
  };

  const displayName = user?.name || user?.email?.split('@')[0] || 'User';
  const displayRole = user?.role || user?.roles?.[0] || 'user';
  const displayInitial = displayName.charAt(0).toUpperCase();

  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        notificationService.getAll({ limit: 10, unreadOnly: false }),
        notificationService.getUnreadCount(),
      ]);
      setNotifications(Array.isArray(notifRes.data?.notifications) ? notifRes.data.notifications : Array.isArray(notifRes.data?.data) ? notifRes.data.data : []);
      setUnreadCount(countRes.data?.data?.count || countRes.data?.count || 0);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 60000);
      return () => clearInterval(interval);
    }
  }, [fetchNotifications, user]);

  const handleMarkRead = async (id) => {
    try {
      await notificationService.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.isRead) {
      await handleMarkRead(notif._id);
    }
    if (notif.link) {
      setShowNotifications(false);
      navigate(notif.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  };

  const handleLogout = () => {
    logout();
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  return (
    <header className="sticky top-0 z-30 h-18 backdrop-blur-2xl border-b transition-all duration-300 bg-background/75 border-border/40">
      <div className="flex items-center justify-between h-full px-4">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMobileMenuClick}
            className="lg:hidden p-2.5 hover:bg-muted rounded-xl transition-all duration-300"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
          <button
            onClick={onToggleSidebar}
            className="hidden lg:block p-2.5 hover:bg-muted rounded-xl transition-all duration-300"
          >
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>

          <div className="hidden md:flex items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search invoices, expenses..."
                className="w-80 pl-10 pr-4 py-2.5 bg-muted text-foreground placeholder:text-muted-foreground border-0 rounded-xl text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:bg-background"
              />
            </div>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <ThemeDropdown />

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2.5 hover:bg-muted rounded-xl transition-all duration-300"
            >
              <Bell className="w-5 h-5 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-destructive text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowNotifications(false)}
                />
                <div className="absolute right-0 mt-2 w-96 bg-card rounded-xl shadow-xl border border-border/50 z-20 animate-fade-in">
                  <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                    <h3 className="font-semibold text-foreground font-display">Notifications</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                      >
                        <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map((notif) => (
                        <div
                          key={notif._id || notif.id}
                          onClick={() => handleNotificationClick(notif)}
                          className={clsx(
                            'px-4 py-3 hover:bg-muted cursor-pointer border-b border-border/30 last:border-0 transition-colors duration-200',
                            !notif.isRead && 'bg-primary/5'
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {!notif.isRead && (
                              <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground font-medium truncate">{notif.title}</p>
                              {notif.body && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <span className={clsx('text-[10px] font-medium uppercase', typeColors[notif.type] || 'text-gray-500')}>
                                  {notif.type || 'info'}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(notif.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="px-4 py-3 border-t border-border/50">
                    <button
                      onClick={() => {
                        setShowNotifications(false);
                        navigate('/notifications');
                      }}
                      className="text-sm text-primary hover:text-primary/80 font-medium transition-colors duration-200"
                    >
                      View all notifications
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setShowHelp(true)}
            title="How ARTHA works"
            aria-label="How ARTHA works"
            className="p-2.5 hover:bg-muted rounded-xl transition-all duration-300"
          >
            <HelpCircle className="w-5 h-5 text-muted-foreground" />
          </button>

          <Modal
            isOpen={showHelp}
            onClose={() => setShowHelp(false)}
            title="How ARTHA works"
            description="The 60-second flow — from raw data to decisions."
            size="lg"
          >
            <div className="p-6 grid sm:grid-cols-2 gap-4">
              {ONBOARDING_STEPS.map((step) => (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => openHelpStep(step.path)}
                  className="text-left rounded-xl border border-border/40 bg-muted/30 hover:bg-muted p-4 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <step.icon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">
                      {step.title}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.body}
                  </p>
                  <span className="inline-block mt-2 text-xs font-medium text-primary">
                    {step.cta} →
                  </span>
                </button>
              ))}
            </div>
            <div className="px-6 pb-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Got it
              </button>
            </div>
          </Modal>

          {/* User menu */}
          <div className="relative ml-2">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 p-1.5 hover:bg-muted rounded-xl transition-all duration-300"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-sm font-medium text-primary-foreground">
                  {displayInitial}
                </span>
              </div>
              <div className="hidden md:block text-left max-w-[200px]">
                <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                {user?.email && (
                  <p className="text-xs text-muted-foreground truncate" title={user.email}>{user.email}</p>
                )}
                <span className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                  roleConfig[displayRole]?.color || 'bg-muted text-muted-foreground'
                )}>
                  {(() => {
                    const RoleIcon = roleConfig[displayRole]?.icon;
                    return RoleIcon ? <RoleIcon className="w-3 h-3" /> : null;
                  })()}
                  {roleConfig[displayRole]?.label || displayRole}
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground hidden md:block" />
            </button>

            {showUserMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowUserMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-56 bg-card rounded-xl shadow-xl border border-border/50 z-20 animate-fade-in">
                  <div className="px-4 py-3 border-b border-border/50">
                    <p className="text-sm font-medium text-foreground">{displayName}</p>
                    <p className="text-xs text-muted-foreground mb-1">{user?.email}</p>
                    <span className={clsx(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                      roleConfig[displayRole]?.color || 'bg-muted text-muted-foreground'
                    )}>
                      {(() => {
                        const RoleIcon = roleConfig[displayRole]?.icon;
                        return RoleIcon ? <RoleIcon className="w-3 h-3" /> : null;
                      })()}
                      {roleConfig[displayRole]?.label || displayRole}
                    </span>
                  </div>
                  {can(['admin']) && (
                    <div className="py-2">
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          navigate('/settings/company');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted rounded-lg mx-1 transition-colors duration-200"
                      >
                        <Settings className="w-4 h-4" />
                        Settings
                      </button>
                    </div>
                  )}
                  <div className="border-t border-border/50 py-2">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 rounded-lg mx-1 transition-colors duration-200"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
