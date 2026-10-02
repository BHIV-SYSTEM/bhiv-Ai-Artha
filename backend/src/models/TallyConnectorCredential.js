import mongoose from 'mongoose';
import { randomBytes } from 'crypto';

/**
 * TallyConnectorCredential — per-account connector credentials.
 *
 * One credential per workspace (owner admin or sub-admin company). The
 * connector's .env carries these instead of the shared server key, and the
 * ingest endpoint binds pushed data to credential.workspaceId — so a single
 * deployed URL can serve many accounts without any of them seeing each
 * other's Tally data.
 *
 * Deliberately NOT companyScope'd: verifyIngestAuth must look keys up
 * globally (no request scope exists yet). Isolation comes from the
 * workspaceId each credential carries.
 */
const tallyConnectorCredentialSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    apiKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    hmacSecret: { type: String, required: true },
    label: { type: String, default: 'Tally connector' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export function generateApiKey() {
  return randomBytes(32).toString('hex');
}

export function generateHmacSecret() {
  return randomBytes(32).toString('hex');
}

export default mongoose.model('TallyConnectorCredential', tallyConnectorCredentialSchema);
