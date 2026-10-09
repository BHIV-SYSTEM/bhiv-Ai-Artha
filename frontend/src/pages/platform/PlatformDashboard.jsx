import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  ShieldCheck,
  UserCog,
  Users,
  FileText,
  Receipt,
  Activity,
  RefreshCw,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Server,
  HeartPulse,
  TrendingUp,
  Database,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  Button,
  Table,
  Badge,
  Loading,
  EmptyState,
} from '../../components/common';
import api from '../../services/api';
import { formatDate, formatNumber, getRelativeTime } from '../../utils/formatters';

const KPI_CARDS = [
  { key: 'companies', label: 'Companies', icon: Building2, tint: 'text-primary' },
  { key: 'admins', label: 'Admins', icon: ShieldCheck, tint: 'text-warning' },
  { key: 'accountants', label: 'Accountants', icon: UserCog, tint: 'text-info' },
  { key: 'viewers', label: 'Viewers', icon: Users, tint: 'text-muted-foreground' },
  { key: 'invoices', label: 'Invoices', icon: FileText, tint: 'text-success' },
  { key: 'expenses', label: 'Expenses', icon: Receipt, tint: 'text-destructive' },
];

const PRODUCT_LABELS = {
  bookkeeping: 'Bookkeeping',
  bank_statements: 'Bank Statements',
  data_ingestion: 'Data Ingestion',
  tally: 'Tally',
  gst: 'GST',
  tds: 'TDS',
};

const ProductBadges = ({ products }) => {
  if (!products || products.length === 0) {
    return <span className="text-xs text-muted-foreground">No data yet</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {products.map((p) => (
        <Badge key={p} variant="info" size="sm">{PRODUCT_LABELS[p] || p}</Badge>
      ))}
    </span>
  );
};

const SEVERITY_VARIANT = {
  info: 'default',
  warning: 'warning',
  critical: 'danger',
};

const roleLabel = (role) => {
  if (role === 'sub_admin') return 'Company Admin';
  if (role === 'admin') return 'Admin';
  if (!role) return '—';
  return role.charAt(0).toUpperCase() + role.slice(1);
};

const formatUptime = (seconds) => {
  if (typeof seconds !== 'number') return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
};

const statusTone = (status) =>
  status === 'healthy' || status === 'active' ? 'success' : status === 'disabled' ? 'default' : 'danger';

const PlatformDashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/multi-company/platform-stats');
      setStats(response.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not load platform stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const totals = stats?.totals;
  const companies = stats?.companies || [];
  const accounts = stats?.accounts || [];
  const events = stats?.recentEvents || [];
  const leaderboard = stats?.adminLeaderboard || [];
  const attention = stats?.attention;
  const health = stats?.health;
  const attentionCount = attention
    ? attention.failedSyncs.length +
      attention.neverSignedIn.length +
      attention.dormantTenants.length +
      attention.failedDocuments.length
    : 0;

  return (
    <div>
      <PageHeader
        title="Platform Overview"
        description="Tenants, accounts, activity and system health"
        action={
          <div className="flex items-center gap-3">
            <Button variant="outline" icon={Plus} onClick={() => navigate('/settings/users')}>
              New tenant
            </Button>
            <Button variant="outline" icon={RefreshCw} onClick={fetchStats} disabled={loading}>
              Refresh
            </Button>
          </div>
        }
      />

      {loading && !stats && <Loading />}

      {error && (
        <Card className="border-destructive/40">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-destructive font-medium">
              Could not load platform stats
            </p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" icon={RefreshCw} onClick={fetchStats}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && stats && (
        <div className="space-y-6">
          {health && (
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  <HeartPulse className="w-4 h-4 text-muted-foreground" />
                  System
                </span>
                <Badge variant={statusTone(health.status)} size="sm">
                  {health.status || 'unknown'}
                </Badge>
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Server className="w-4 h-4" />
                  DB
                  <Badge variant={statusTone(health.components?.database?.status)} size="sm">
                    {health.components?.database?.status || 'unknown'}
                  </Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  Redis
                  <Badge variant={statusTone(health.components?.redis?.status)} size="sm">
                    {health.components?.redis?.status || 'unknown'}
                  </Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  Uptime {formatUptime(health.uptime)}
                </span>
                <span className="text-sm text-muted-foreground">
                  v{health.version} · {health.environment}
                </span>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {KPI_CARDS.map(({ key, label, icon: Icon, tint }) => (
              <Card key={key} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-5 h-5 ${tint}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{label}</p>
                    <p className="text-xl font-bold text-foreground">
                      {formatNumber(totals?.[key] ?? 0)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Needs attention</h2>
                {attention && (
                  <Badge variant={attentionCount > 0 ? 'warning' : 'success'} size="sm">
                    {attentionCount > 0 ? `${attentionCount} item${attentionCount === 1 ? '' : 's'}` : 'All clear'}
                  </Badge>
                )}
              </div>
              {!attention || attentionCount === 0 ? (
                <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                  No failed syncs, dormant tenants or unsigned-in admins.
                </div>
              ) : (
                <div className="space-y-5">
                  {attention.failedSyncs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                        Failed Tally syncs (7d)
                      </p>
                      <ul className="space-y-2">
                        {attention.failedSyncs.slice(0, 5).map((s) => (
                          <li key={s._id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-foreground truncate">{s.companyName}</span>
                            <span className="flex items-center gap-2 flex-shrink-0">
                              {s.error && (
                                <span className="text-xs text-muted-foreground max-w-[14rem] truncate">
                                  {s.error}
                                </span>
                              )}
                              <Badge variant={s.status === 'failed' ? 'danger' : 'warning'} size="sm">
                                {s.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {getRelativeTime(s.startedAt)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {attention.neverSignedIn.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                        Admins who never signed in
                      </p>
                      <ul className="space-y-1">
                        {attention.neverSignedIn.map((a) => (
                          <li key={a.email} className="text-sm text-foreground">
                            {a.email}
                            <span className="text-muted-foreground"> · {a.companyName}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {attention.dormantTenants.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                        Dormant tenants (30d+)
                      </p>
                      <ul className="space-y-1">
                        {attention.dormantTenants.map((t) => (
                          <li key={t.name} className="text-sm text-foreground">
                            {t.name}
                            <span className="text-muted-foreground">
                              {' '}
                              ·{' '}
                              {t.daysSinceActivity === null
                                ? 'no activity yet'
                                : `${t.daysSinceActivity}d without activity`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {attention.failedDocuments.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                        Failed documents
                      </p>
                      <ul className="space-y-1">
                        {attention.failedDocuments.slice(0, 5).map((d, i) => (
                          <li key={`${d.filename}-${i}`} className="text-sm text-foreground truncate">
                            {d.filename}
                            <span className="text-muted-foreground">
                              {' '}
                              · {d.companyName} · {getRelativeTime(d.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Platform activity</h2>
                <Badge variant="default" size="sm">
                  last {events.length}
                </Badge>
              </div>
              {events.length === 0 ? (
                <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
                  <Activity className="w-5 h-5" />
                  No audit events recorded yet.
                </div>
              ) : (
                <ul className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {events.map((e) => (
                    <li key={e._id} className="flex items-start gap-3">
                      <Badge variant={SEVERITY_VARIANT[e.severity] || 'default'} size="sm">
                        {e.severity}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground truncate">
                          {e.description || e.eventType}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {e.actor?.email || 'system'} · {e.companyName} ·{' '}
                          {getRelativeTime(e.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card padding={false}>
            <div className="flex items-center justify-between px-6 pt-6 pb-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Admin leaderboard</h2>
                <p className="text-sm text-muted-foreground">
                  Ranked by activity in the last 30 days — sub-accounts and tenant data per admin
                </p>
              </div>
              <Badge variant="default" size="sm">30d</Badge>
            </div>
            {leaderboard.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No company admins yet"
                description="Create a tenant admin from User Management to see their activity here."
                actionLabel="Go to User Management"
                onAction={() => navigate('/settings/users')}
              />
            ) : (
              <div className="overflow-x-auto pb-6">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head className="w-10">#</Table.Head>
                      <Table.Head>Admin</Table.Head>
                      <Table.Head>Tenant</Table.Head>
                      <Table.Head className="text-right">Sub-accounts</Table.Head>
                      <Table.Head className="text-right">Actions (30d)</Table.Head>
                      <Table.Head className="text-right">Tenant records</Table.Head>
                      <Table.Head>Products in use</Table.Head>
                      <Table.Head>Last active</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {leaderboard.map((a, idx) => (
                      <Table.Row key={a._id}>
                        <Table.Cell>
                          <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold ${
                            idx === 0 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
                          }`}>
                            {idx + 1}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="font-medium text-foreground">{a.name || a.email}</div>
                          <div className="text-xs text-muted-foreground">{a.email}</div>
                        </Table.Cell>
                        <Table.Cell className="text-sm text-foreground">{a.companyName}</Table.Cell>
                        <Table.Cell className="text-right">
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                            <Users className="w-3.5 h-3.5 text-muted-foreground" />
                            {a.subAccounts}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <span className={`text-sm font-semibold ${a.actions30d > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {formatNumber(a.actions30d)}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                            <Database className="w-3.5 h-3.5 text-muted-foreground" />
                            {formatNumber(a.tenantRecords)}
                          </span>
                        </Table.Cell>
                        <Table.Cell><ProductBadges products={a.products} /></Table.Cell>
                        <Table.Cell className="text-sm text-muted-foreground">
                          {a.lastActionAt
                            ? getRelativeTime(a.lastActionAt)
                            : a.lastLogin
                              ? `login ${getRelativeTime(a.lastLogin)}`
                              : 'Never'}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Card>

          <Card padding={false}>
            <div className="flex items-center justify-between px-6 pt-6 pb-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Tenants</h2>
                <p className="text-sm text-muted-foreground">
                  {companies.length} compan{companies.length === 1 ? 'y' : 'ies'} on the platform
                </p>
              </div>
            </div>

            {companies.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No companies yet"
                description="Create your first company and its admin account from User Management."
                actionLabel="Go to User Management"
                onAction={() => navigate('/settings/users')}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Company</Table.Head>
                      <Table.Head>Admin</Table.Head>
                      <Table.Head>Users</Table.Head>
                      <Table.Head className="text-right">Invoices</Table.Head>
                      <Table.Head className="text-right">Expenses</Table.Head>
                      <Table.Head>Data volume</Table.Head>
                      <Table.Head>Products</Table.Head>
                      <Table.Head>Last Activity</Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {companies.map((c) => (
                      <Table.Row key={c._id}>
                        <Table.Cell>
                          <div className="font-medium text-foreground">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.gstin ? `GSTIN ${c.gstin}` : `Created ${formatDate(c.createdAt)}`}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          {c.admin ? (
                            <div>
                              <div className="text-sm text-foreground">{c.admin.email}</div>
                              <div className="text-xs text-muted-foreground">
                                {c.admin.lastLogin
                                  ? `Last login ${getRelativeTime(c.admin.lastLogin)}`
                                  : 'Never signed in'}
                              </div>
                            </div>
                          ) : (
                            <Badge variant="danger" size="sm">No admin</Badge>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="text-sm text-foreground">
                            {c.users.admin} admin · {c.users.accountant} acct · {c.users.viewer} viewer
                          </div>
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          {formatNumber(c.invoices)}
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          {formatNumber(c.expenses)}
                        </Table.Cell>
                        <Table.Cell>
                          {c.volume ? (
                            <div className="text-xs text-muted-foreground leading-relaxed">
                              <div className="text-sm font-semibold text-foreground">
                                {formatNumber(c.volume.totalRecords)} records
                              </div>
                              <div>Inv ₹{formatNumber(c.volume.invoiceValue)} · Exp ₹{formatNumber(c.volume.expenseValue)}</div>
                              {(c.volume.statements > 0 || c.volume.ingestDocs > 0 || c.volume.tallyRuns > 0) && (
                                <div>
                                  {c.volume.statements > 0 && `${c.volume.statements} stmts `}
                                  {c.volume.ingestDocs > 0 && `${c.volume.ingestDocs} docs `}
                                  {c.volume.tallyRuns > 0 && `${c.volume.tallyRuns} tally`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-foreground">{formatNumber(c.invoices + c.expenses)} records</span>
                          )}
                        </Table.Cell>
                        <Table.Cell><ProductBadges products={c.products} /></Table.Cell>
                        <Table.Cell>
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Activity className="w-3.5 h-3.5" />
                            {c.lastActivityAt ? getRelativeTime(c.lastActivityAt) : 'No activity'}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge variant={c.status === 'active' ? 'success' : 'warning'} size="sm">
                            {c.status}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Card>

          <Card padding={false}>
            <div className="px-6 pt-6 pb-3">
              <h2 className="text-lg font-semibold text-foreground">All accounts</h2>
              <p className="text-sm text-muted-foreground">
                {accounts.length} user account{accounts.length === 1 ? '' : 's'} across the platform
              </p>
            </div>
            {accounts.length === 0 ? (
              <EmptyState icon={Users} title="No accounts" description="No users found." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Account</Table.Head>
                      <Table.Head>Role</Table.Head>
                      <Table.Head>Workspace</Table.Head>
                      <Table.Head>Last Login</Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {accounts.map((a) => (
                      <Table.Row key={a._id}>
                        <Table.Cell>
                          <div className="font-medium text-foreground">{a.name || a.email}</div>
                          <div className="text-xs text-muted-foreground">{a.email}</div>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge variant={a.role === 'sub_admin' ? 'purple' : 'default'} size="sm">
                            {roleLabel(a.role)}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell className="text-sm text-foreground">
                          {a.companyName}
                        </Table.Cell>
                        <Table.Cell className="text-sm text-muted-foreground">
                          {a.lastLogin ? getRelativeTime(a.lastLogin) : 'Never'}
                        </Table.Cell>
                        <Table.Cell>
                          <Badge variant={a.isActive ? 'success' : 'danger'} size="sm">
                            {a.isActive ? 'Active' : 'Disabled'}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </Card>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Generated at {new Date(stats.generatedAt).toLocaleString('en-IN')}
            </span>
            {attentionCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                {attentionCount} item{attentionCount === 1 ? '' : 's'} need attention
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PlatformDashboard;
