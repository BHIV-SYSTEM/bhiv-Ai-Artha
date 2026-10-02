import logger from '../config/logger.js';
import adapter from '../tallyIntegration/tallyAdapter.service.js';
import TallySyncRun from '../models/TallySyncRun.js';

/**
 * tallySyncScheduler.service — automatic Tally → ARTHA sync.
 *
 * Goal: newly added Tally data (parties, invoices, receipts, payments) flows
 * into ARTHA without any manual step. A background interval calls the same
 * read-only connector used by the manual endpoint, with an incremental window
 * for vouchers (from the last successful run) and a full current-state refresh
 * for parties + outstanding. Runs only when TALLY_ENABLED=true and
 * TALLY_SYNC_ENABLED !== 'false'. Read-only: only Export Data envelopes.
 *
 * Env knobs:
 *   TALLY_SYNC_ENABLED         (default true)
 *   TALLY_SYNC_INTERVAL_MINUTES (default 15)
 *   TALLY_SYNC_DEFAULT_FROM_DAYS (default 30 — backfill window on first run)
 */

function envNum(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toDateString(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Pure window computation — exported for tests. */
export function computeWindow(lastSyncAt, defaultFromDays) {
  const now = new Date();
  const from = lastSyncAt
    ? toDateString(lastSyncAt)
    : toDateString(new Date(now.getTime() - defaultFromDays * 86400000));
  return {
    fromDate: from,
    toDate: toDateString(now),
    incremental: Boolean(lastSyncAt),
  };
}

/** Detect gateway-unreachable failures (cloud boxes have no local Tally). */
export function isUnreachable(result) {
  if (!result) return false;
  const msg = result.error || '';
  if (/ECONNREFUSED|Cannot reach Tally gateway|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/i.test(msg)) return true;
  return (result.errors || []).some(
    (e) =>
      e.code === 'UNREACHABLE' ||
      /ECONNREFUSED|Cannot reach Tally gateway|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH/i.test(e.message || ''),
  );
}

const UNREACHABLE_PAUSE_AFTER = 3;

class TallySyncScheduler {
  constructor() {
    this.timer = null;
    this.initialTimer = null;
    this.running = false;
    this.lastRun = null;
    this.consecutiveUnreachable = 0;
    this.pausedReason = null;
  }

  isEnabled() {
    return (
      process.env.TALLY_ENABLED === 'true' &&
      process.env.TALLY_SYNC_ENABLED !== 'false'
    );
  }

  intervalMs() {
    return envNum(process.env.TALLY_SYNC_INTERVAL_MINUTES, 15) * 60000;
  }

  defaultFromDays() {
    return envNum(process.env.TALLY_SYNC_DEFAULT_FROM_DAYS, 30);
  }

  async lastCompletedSyncAt(company) {
    try {
      const filter = { status: { $in: ['completed', 'partial'] } };
      if (company) filter.company = { $regex: `^${company}$`, $options: 'i' };
      const run = await TallySyncRun.findOne(filter)
        .sort({ startedAt: -1 })
        .select('startedAt completedAt')
        .lean();
      if (!run) return null;
      return run.completedAt || run.startedAt;
    } catch (err) {
      logger.warn(`[TALLY_SYNC] failed to read last run: ${err.message}`);
      return null;
    }
  }

  /**
   * Track consecutive gateway-unreachable failures. After
   * UNREACHABLE_PAUSE_AFTER in a row the interval is paused so cloud
   * deployments stop flooding TallySyncRun (and the Tally Connect status
   * page) with identical failures every cycle. A successful run — including
   * a manual "Sync Now" — re-arms the scheduler automatically.
   */
  noteOutcome(result) {
    if (result && result.status === 'failed' && isUnreachable(result)) {
      this.consecutiveUnreachable += 1;
      if (this.consecutiveUnreachable >= UNREACHABLE_PAUSE_AFTER && this.timer) {
        this.stop();
        this.pausedReason = `Tally gateway unreachable from server (last: ${result.errors?.[0]?.message || result.error})`;
        logger.warn(
          `[TALLY_SYNC] scheduler paused after ${this.consecutiveUnreachable} unreachable runs — ` +
            `Tally gateway ${process.env.TALLY_HOST || '127.0.0.1'}:${process.env.TALLY_PORT || 9000} is not reachable from this server. ` +
            'Cloud deployments receive data via the local connector agent (POST /api/v1/tally-connect/ingest). ' +
            'A manual "Sync Now" or server restart resumes the scheduler.',
        );
      }
    } else {
      const wasPaused = Boolean(this.pausedReason) || this.consecutiveUnreachable > 0;
      this.consecutiveUnreachable = 0;
      this.pausedReason = null;
      if (wasPaused && !this.timer && this.isEnabled()) {
        this.start();
      }
    }
  }

  async runOnce({ company } = {}) {
    if (this.running) {
      return { skipped: true, reason: 'sync already running' };
    }
    this.running = true;
    try {
      const window = computeWindow(await this.lastCompletedSyncAt(company), this.defaultFromDays());
      const result = await adapter.runSync({ company, fromDate: window.fromDate, toDate: window.toDate });
      this.lastRun = {
        at: new Date(),
        status: result.status,
        entityStats: result.entityStats,
        mduCount: result.mduCount,
        window,
      };
      logger.info(
        `[TALLY_SYNC] run ${result.status} incremental=${window.incremental} ` +
          `window=${window.fromDate}..${window.toDate} mdu=${result.mduCount}`
      );
      this.noteOutcome(result);
      return result;
    } catch (err) {
      logger.warn(`[TALLY_SYNC] run failed: ${err.message}`);
      this.lastRun = { at: new Date(), status: 'failed', error: err.message };
      const result = { status: 'failed', error: err.message };
      this.noteOutcome(result);
      return result;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return this.timer;
    if (!this.isEnabled()) {
      logger.info('[TALLY_SYNC] scheduler disabled (TALLY_ENABLED or TALLY_SYNC_ENABLED).');
      return null;
    }
    const ms = this.intervalMs();
    this.timer = setInterval(() => {
      this.runOnce().catch(() => {});
    }, ms);
    if (this.timer.unref) this.timer.unref();
    logger.info(`[TALLY_SYNC] scheduler started: every ${Math.round(ms / 60000)}min`);
    this.initialTimer = setTimeout(() => {
      this.runOnce().catch(() => {});
    }, 5000);
    return this.timer;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  status() {
    const intervalMs = this.intervalMs();
    return {
      enabled: this.isEnabled(),
      intervalMinutes: Math.round(intervalMs / 60000),
      running: this.running,
      paused: Boolean(this.pausedReason),
      pausedReason: this.pausedReason || undefined,
      lastRun: this.lastRun,
      nextSyncAt:
        this.timer && this.lastRun
          ? new Date(this.lastRun.at.getTime() + intervalMs)
          : undefined,
    };
  }
}

export default new TallySyncScheduler();