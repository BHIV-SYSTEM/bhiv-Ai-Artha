import os
import sys
from fastapi import FastAPI
from pydantic import BaseModel, Field

# Add Setu-Aman-main to path for imports
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(__file__)), "Setu-Aman-main", "Setu-Aman-main"))

from security.middleware import ErrorBoundaryMiddleware
from evaluation_engine.rule_engine import DeterministicStateMachine
from task_selector.review_orchestrator import PravahReplayLedger
from integrations.local_llm_client import MitraClient

from connectors.bright_connection.tally import TallyConnector
from runtime.masterdb import MasterDB
from runtime.insightflow import InsightFlow
from runtime.replay import ReplayEngine
from runtime.pipeline import ConnectorPipeline

app = FastAPI(title="ARTHA Production API")
app.add_middleware(ErrorBoundaryMiddleware)

state_machine = DeterministicStateMachine()
ledger = PravahReplayLedger()
mitra = MitraClient()

class SyncRequest(BaseModel):
    tenant_id: str = Field(..., description="Tenant ID")
    query: str = Field(..., description="User query for Mitra")

@app.post("/api/v1/bright-connection/sync")
async def execute_bright_connection_demo(req: SyncRequest):
    await state_machine.transition("START_SYNC", {"tenant_id": req.tenant_id})
    
    # 1. Setup Tally Connector
    connector = TallyConnector(tenant_id=req.tenant_id, config={"enabled": True})
    
    # 2. Setup Pipeline
    master_db = MasterDB()
    insight_flow = InsightFlow()
    replay_engine = ReplayEngine()
    pipeline = ConnectorPipeline(master_db, insight_flow, replay_engine)
    
    # 3. Execute Sync (Tally -> ARTHA)
    await state_machine.transition("FETCHING_TALLY", {"tenant_id": req.tenant_id})
    result = await pipeline.run(connector, entity_types=["ledger", "invoice"])
    
    # Extract contextual data that was synced
    all_records = []
    for etype_dict in master_db._store.get(req.tenant_id, {}).values():
        all_records.extend(etype_dict.values())
        
    synced_ledgers = [r.canonical_data for r in all_records if r.entity_type.value == "ledger"]
    account_context = synced_ledgers[0] if synced_ledgers else {}
    
    # 4. Admin/Dealer Notification
    await ledger.append_event("ADMIN_NOTIFICATION", {
        "message": f"Dealer arrived. Data synced for {account_context.get('ledger_name', 'Unknown')}",
        "tenant_id": req.tenant_id,
        "records_ingested": result.records_ingested
    })
    
    # 5. Field-agent arrival flow (ARTHA record created)
    await ledger.append_event("FIELD_AGENT_ARRIVAL", {
        "status": "arrived",
        "tenant_id": req.tenant_id
    })
    
    # 6. Mitra Query
    await state_machine.transition("MITRA_QUERY", {"query": req.query})
    mitra_response = mitra.query_context(account_context, req.query)
    
    await state_machine.transition("COMPLETED", {"tenant_id": req.tenant_id})
    
    return {
        "status": "success",
        "trace_id": result.trace_id,
        "tally_sync_result": result.to_dict(),
        "artha_record": account_context,
        "admin_notification": ledger.get_ledger(),
        "mitra_response": mitra_response,
        "state_hashes": state_machine.state_hashes
    }
