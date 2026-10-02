import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, User, MapPin, Target, Phone, Filter } from 'lucide-react';
import { PageHeader, Card, Button, Table, Badge, Input, Select, Loading, EmptyState, ProgressBar } from '../../components/common';
import api from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const SalesAgentList = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await api.get('/sales-agents', { params: { limit: 100 } });
      setAgents(res.data.agents || []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  };

  const isOnline = (agent) => {
    if (!agent.lastKnownLocation?.timestamp) return false;
    return (Date.now() - new Date(agent.lastKnownLocation.timestamp).getTime()) < 30 * 60 * 1000;
  };

  const filtered = agents.filter((a) => {
    const matchSearch = !searchQuery ||
      a.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.region?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchRole = !roleFilter || a.role === roleFilter;
    return matchSearch && matchRole;
  });

  if (loading) return <Loading.Page />;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Sales Agents"
        description="Manage Bright Connection field sales team and performance"
        action={
          <div className="flex gap-2">
            {can(['admin']) && (
              <Button onClick={() => navigate('/agents/new')} icon={Plus}>Add Agent</Button>
            )}
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Agents</p>
              <p className="text-2xl font-bold">{agents.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <MapPin className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-green-600">
                {agents.filter((a) => a.isActive).length}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Target</p>
              <p className="text-2xl font-bold">{formatCurrency(agents.reduce((s, a) => s + (a.targetAmount || 0), 0))}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Achieved</p>
              <p className="text-2xl font-bold">{formatCurrency(agents.reduce((s, a) => s + (a.targetAchieved || 0), 0))}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Input placeholder="Search agents..." icon={Search} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <div className="w-full md:w-48">
            <Select
              placeholder="All Roles"
              options={[
                { value: 'sales-executive', label: 'Sales Executive' },
                { value: 'sales-manager', label: 'Sales Manager' },
                { value: 'field-agent', label: 'Field Agent' },
                { value: 'distributor', label: 'Distributor' },
              ]}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={User}
            title="No sales agents"
            description="Add agents to start tracking field performance."
            actionLabel={can(['admin']) ? 'Add Agent' : undefined}
            onAction={can(['admin']) ? () => navigate('/agents/new') : undefined}
          />
        </Card>
      ) : (
        <Card padding={false}>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Agent</Table.Head>
                <Table.Head>Role</Table.Head>
                <Table.Head>Region</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Visits</Table.Head>
                <Table.Head>Target</Table.Head>
                <Table.Head>Progress</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filtered.map((agent) => (
                <Table.Row
                  key={agent._id}
                  onClick={() => navigate(`/agents/${agent._id}`)}
                  className="cursor-pointer"
                >
                  <Table.Cell>
                    <div>
                      <p className="font-medium text-blue-600">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.agentCode}</p>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant="info" className="capitalize">{agent.role?.replace('-', ' ')}</Badge>
                  </Table.Cell>
                  <Table.Cell>{agent.region || '-'}</Table.Cell>
                  <Table.Cell>
                    <Badge variant={isOnline(agent) ? 'success' : agent.isActive ? 'default' : 'danger'}>
                      {isOnline(agent) ? 'Online' : agent.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{agent.totalVisits || 0}</Table.Cell>
                  <Table.Cell>{formatCurrency(agent.targetAmount || 0)}</Table.Cell>
                  <Table.Cell>
                    <div className="w-24">
                      <ProgressBar value={agent.targetProgress || 0} />
                      <span className="text-xs text-muted-foreground">{agent.targetProgress || 0}%</span>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      )}
    </div>
  );
};

export default SalesAgentList;
