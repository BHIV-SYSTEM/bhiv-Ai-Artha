import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MapPin, Phone, IndianRupee, Building2, Filter } from 'lucide-react';
import { PageHeader, Card, Button, Table, Badge, Input, Select, Loading, EmptyState } from '../../components/common';
import api from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const DealerList = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [regions, setRegions] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [dealerRes, regionRes, statsRes] = await Promise.all([
        api.get('/dealers', { params: { limit: 100 } }),
        api.get('/dealers/regions'),
        api.get('/dealers/stats'),
      ]);
      setDealers(dealerRes.data.dealers || []);
      setRegions(regionRes.data.data || []);
      setStats(statsRes.data.data);
    } catch (err) {
      console.error('Failed to fetch dealers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncTally = async () => {
    try {
      await api.post('/dealers/sync-tally');
      fetchData();
    } catch (err) {
      console.error('Sync failed:', err);
    }
  };

  const filtered = dealers.filter((d) => {
    const matchSearch = !searchQuery ||
      d.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.city?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchRegion = !regionFilter || d.region === regionFilter;
    return matchSearch && matchRegion;
  });

  if (loading) return <Loading.Page />;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Bright Connection Dealers"
        description="Manage dealer network, track outstanding balances, and field visits"
        action={
          <div className="flex gap-2">
            {can(['admin']) && (
              <Button variant="secondary" onClick={handleSyncTally}>Sync from Tally</Button>
            )}
            {can(['admin', 'accountant']) && (
              <Button onClick={() => navigate('/dealers/new')} icon={Plus}>Add Dealer</Button>
            )}
          </div>
        }
      />

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Dealers</p>
                <p className="text-2xl font-bold">{stats.summary?.totalDealers || 0}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg flex items-center justify-center">
                <IndianRupee className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Outstanding</p>
                <p className="text-2xl font-bold">{formatCurrency(stats.summary?.totalOutstanding || 0)}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                <IndianRupee className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Overdue Amount</p>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(stats.summary?.totalOverdue || 0)}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Regions</p>
                <p className="text-2xl font-bold">{stats.byRegion?.length || 0}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Input placeholder="Search dealers by name or city..." icon={Search} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <div className="w-full md:w-48">
            <Select
              placeholder="All Regions"
              options={regions.map((r) => ({ value: r, label: r }))}
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No dealers found"
            description="Add dealers or sync from Tally to populate the dealer network."
            actionLabel={can(['admin', 'accountant']) ? 'Add Dealer' : undefined}
            onAction={can(['admin', 'accountant']) ? () => navigate('/dealers/new') : undefined}
          />
        </Card>
      ) : (
        <Card padding={false}>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Dealer</Table.Head>
                <Table.Head>City</Table.Head>
                <Table.Head>Region</Table.Head>
                <Table.Head>Contact</Table.Head>
                <Table.Head>Outstanding</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Last Visit</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filtered.map((dealer) => (
                <Table.Row
                  key={dealer._id}
                  onClick={() => navigate(`/dealers/${dealer._id}`)}
                  className="cursor-pointer"
                >
                  <Table.Cell>
                    <div>
                      <p className="font-medium text-blue-600">{dealer.name}</p>
                      <p className="text-xs text-muted-foreground">{dealer.dealerCode}</p>
                    </div>
                  </Table.Cell>
                  <Table.Cell>{dealer.city || '-'}</Table.Cell>
                  <Table.Cell>{dealer.region || '-'}</Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1 text-sm">
                      {dealer.phone && <Phone className="w-3 h-3" />}
                      {dealer.phone || '-'}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="font-semibold">{formatCurrency(dealer.outstandingBalance)}</Table.Cell>
                  <Table.Cell>
                    {dealer.overdueAmount > 0 ? (
                      <Badge variant="danger">Overdue</Badge>
                    ) : (
                      <Badge variant="success">Current</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-sm text-muted-foreground">
                    {dealer.lastVisitDate ? formatDate(dealer.lastVisitDate) : 'Never'}
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

export default DealerList;
