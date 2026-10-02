import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Workspace (multi-tenant) scoping.
 *
 * Every authenticated request runs inside an AsyncLocalStorage scope:
 *   { workspace, userId, role, crossCompany }
 *
 * `workspace` is the isolation key stamped onto business documents in their
 * `companyId` field:
 *   - users assigned to a client company -> Company._id (shared with that
 *     company's sub-admin / accountant / viewer)
 *   - users without a company           -> their own User._id (personal,
 *     empty workspace - "starts from zero")
 *
 * Models opt in via `schema.plugin(companyScope)`. When a scope is active:
 *   - find/update/delete/count/distinct queries are forced to the workspace
 *   - aggregation pipelines get a leading $match on the workspace
 *   - new documents (save/insertMany/upsert) get stamped automatically
 *
 * When NO scope is active (seed scripts, background jobs, migrations) queries
 * run unscoped and documents are stamped only if the caller sets the field.
 *
 * `crossCompany` is an escape hatch used only by explicit super-admin
 * endpoints (multi-company consolidation) via allowCrossCompany().
 */

export const scopeStorage = new AsyncLocalStorage();

export function getScope() {
  return scopeStorage.getStore() || null;
}

export function runWithScope(scope, fn) {
  return scopeStorage.run(scope, fn);
}

/** Mark the current request as allowed to read across workspaces (super admin). */
export function allowCrossCompany() {
  const store = scopeStorage.getStore();
  if (store) store.crossCompany = true;
}

const QUERY_METHODS = [
  'find',
  'findOne',
  'count',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndRemove',
];

function activeStore() {
  const store = scopeStorage.getStore();
  if (!store || store.crossCompany || !store.workspace) return null;
  return store;
}

export default function companyScopePlugin(schema, options = {}) {
  const field = options.field || 'companyId';

  for (const method of QUERY_METHODS) {
    schema.pre(method, function forceWorkspaceFilter() {
      const store = activeStore();
      if (!store) return;
      const filter = this.getFilter() || {};
      if (filter[field] !== undefined) {
        delete filter[field];
      }
      this.where({ [field]: store.workspace });
    });
  }

  schema.pre('aggregate', function forceWorkspacePipeline() {
    const store = activeStore();
    if (!store) return;
    const pipeline = this.pipeline();
    if (
      pipeline.length > 0 &&
      pipeline[0].$match &&
      pipeline[0].$match[field] !== undefined &&
      String(pipeline[0].$match[field]) === String(store.workspace)
    ) {
      return;
    }
    pipeline.unshift({ $match: { [field]: store.workspace } });
  });

  schema.pre('save', function stampWorkspace() {
    const store = activeStore();
    if (store && !this[field]) {
      this[field] = store.workspace;
    }
  });

  schema.pre('insertMany', function stampWorkspaces(next, docs) {
    const store = activeStore();
    if (store && Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc && !doc[field]) doc[field] = store.workspace;
      }
    }
    next();
  });
}
