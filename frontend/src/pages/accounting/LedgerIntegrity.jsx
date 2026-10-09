import { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  Link,
  Clock,
  Hash,
  FileWarning,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Loading,
} from '../../components/common';
import api from '../../services/api';
import { formatDate } from '../../utils/formatters';

const shortHash = (hash) =>
  hash && hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : (hash || '—');

const LedgerIntegrity = () => {
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [lastVerified, setLastVerified] = useState(null);
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    fetchIntegrityStatus();
  }, []);

  const fetchIntegrityStatus = async () => {
    try {
      const [verifyResponse, entriesResponse] = await Promise.all([
        api.get('/ledger/verify'),
        api.get('/ledger/entries?limit=20'),
      ]);

      setVerificationResult(verifyResponse.data.data || null);
      const entriesData = entriesResponse.data.data;
      setEntries(Array.isArray(entriesData) ? entriesData : (entriesData?.entries || []));
      setFetchError(null);
      setLastVerified(new Date().toISOString());
    } catch (error) {
      console.error('Failed to fetch integrity status:', error);
      setVerificationResult(null);
      setEntries([]);
      setFetchError(error.response?.data?.message || 'Unable to reach the verification service');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const response = await api.get('/ledger/verify');
      setVerificationResult(response.data.data || null);
      setFetchError(null);
      setLastVerified(new Date().toISOString());

      if (response.data.data?.isValid) {
        toast.success('Ledger integrity verified successfully!');
      } else {
        toast.error('Ledger integrity check failed!');
      }
    } catch (error) {
      setFetchError(error.response?.data?.message || 'Failed to verify ledger');
      toast.error('Failed to verify ledger');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return <Loading.Page />;
  }

  const verified = verificationResult !== null;
  const isHealthy = verificationResult?.isValid === true;
  const issueCount = verificationResult?.errors?.length || 0;
  const totalEntries = verificationResult?.totalEntries ?? null;
  const chainIssues = verificationResult?.errors || [];

  const statusCard = !verified ? (
    <Card className="p-6 md:col-span-2">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-muted">
          <Shield className="w-8 h-8 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Verification Unavailable</h2>
          <p className="text-muted-foreground">{fetchError || 'Run a verification to check the hash chain'}</p>
        </div>
      </div>
    </Card>
  ) : (
    <Card className="p-6 md:col-span-2">
      <div className="flex items-center gap-4">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
          isHealthy ? 'bg-green-100' : 'bg-red-100'
        }`}>
          {isHealthy ? (
            <ShieldCheck className="w-8 h-8 text-green-600" />
          ) : (
            <ShieldAlert className="w-8 h-8 text-red-600" />
          )}
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {isHealthy ? 'Ledger Verified' : 'Integrity Issue Detected'}
          </h2>
          <p className="text-muted-foreground">
            {verificationResult?.message ||
              (isHealthy
                ? 'All entries are cryptographically verified'
                : 'Hash chain verification failed')}
          </p>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Ledger Integrity"
        description="Verify the cryptographic integrity of your ledger using HMAC-SHA256 hash chain"
        action={
          <Button onClick={handleVerify} loading={verifying} icon={RefreshCw}>
            Verify Ledger
          </Button>
        }
      />

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {statusCard}

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Hash className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Chain Length</p>
              <p className="text-2xl font-bold text-foreground">
                {totalEntries !== null ? totalEntries : '—'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              !verified
                ? 'bg-muted'
                : issueCount === 0
                  ? 'bg-green-100'
                  : 'bg-red-100'
            }`}>
              {!verified ? (
                <Shield className="w-6 h-6 text-muted-foreground" />
              ) : issueCount === 0 ? (
                <ShieldCheck className="w-6 h-6 text-green-600" />
              ) : (
                <FileWarning className="w-6 h-6 text-red-600" />
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Chain Issues</p>
              <p className="text-2xl font-bold text-foreground">
                {verified ? issueCount : '—'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Real verification errors */}
      {verified && chainIssues.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h2 className="text-lg font-semibold text-red-700">
              {chainIssues.length} integrity issue(s) detected
            </h2>
          </div>
          <div className="space-y-2">
            {chainIssues.map((issue, idx) => (
              <div key={idx} className="p-3 bg-white rounded-lg border border-red-200 text-sm">
                <span className="font-semibold text-foreground">#{issue.position}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-red-700">{issue.issue}</span>
                {issue.journalId && (
                  <span className="ml-2 text-muted-foreground font-mono text-xs">
                    journal {String(issue.journalId).slice(-8)}
                  </span>
                )}
                {issue.expectedPrevHash && (
                  <div className="mt-1 text-xs text-muted-foreground font-mono">
                    expected prev {shortHash(issue.expectedPrevHash)} · actual {shortHash(issue.actualPrevHash)}
                  </div>
                )}
                {issue.expectedHash && (
                  <div className="mt-1 text-xs text-muted-foreground font-mono">
                    computed {shortHash(issue.expectedHash)} · stored {shortHash(issue.actualHash)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* How it Works */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">How Hash-Chain Verification Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="font-bold text-blue-600">1</span>
            </div>
            <div>
              <h3 className="font-medium text-foreground">Entry Creation</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Each journal entry is hashed using HMAC-SHA256 with a secret key, creating a unique fingerprint.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="font-bold text-blue-600">2</span>
            </div>
            <div>
              <h3 className="font-medium text-foreground">Chain Linking</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Each entry includes the hash of the previous entry, creating an unbreakable chain.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="font-bold text-blue-600">3</span>
            </div>
            <div>
              <h3 className="font-medium text-foreground">Tamper Detection</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Any modification to an entry breaks the chain, immediately revealing tampering attempts.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Entry Chain Visualization */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-1">Recent Journal Entries</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Entry status and stored hashes; chain-level validity comes from the verification result above.
        </p>
        <div className="space-y-4">
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">No journal entries yet.</p>
          )}
          {entries.map((entry, index) => {
            const status = String(entry.status || '').toUpperCase();
            const isPosted = status === 'POSTED';
            const isVoided = status === 'VOIDED';
            return (
              <div key={entry._id} className="relative">
                {index > 0 && (
                  <div className="absolute left-6 -top-4 w-0.5 h-4 bg-border" />
                )}

                <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${
                  isVoided
                    ? 'border-red-200 bg-red-50'
                    : isPosted
                      ? 'border-green-200 bg-green-50'
                      : 'border-amber-200 bg-amber-50'
                }`}>
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    isVoided ? 'bg-red-100' : isPosted ? 'bg-green-100' : 'bg-amber-100'
                  }`}>
                    <Hash className={`w-6 h-6 ${
                      isVoided ? 'text-red-600' : isPosted ? 'text-green-600' : 'text-amber-600'
                    }`} />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{entry.entryNumber}</span>
                      <Badge variant={isVoided ? 'danger' : isPosted ? 'success' : 'warning'}>
                        {status || 'DRAFT'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{entry.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(entry.date)}</p>
                  </div>

                  <div className="text-right hidden md:block">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Hash:</span>
                      <code className="font-mono bg-muted px-2 py-0.5 rounded">
                        {shortHash(entry.hash)}
                      </code>
                    </div>
                    {entry.prevHash && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <Link className="w-3 h-3" />
                        <span>Links to:</span>
                        <code className="font-mono">
                          {entry.prevHash === 'genesis' || entry.prevHash === '0'
                            ? 'Genesis Block'
                            : shortHash(entry.prevHash)}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Last Verification */}
      <Card className="bg-muted">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Last verified: {lastVerified
              ? formatDate(lastVerified, 'datetime')
              : 'Not yet verified in this session'}
          </span>
        </div>
      </Card>
    </div>
  );
};

export default LedgerIntegrity;
