# Skill + MCP Migration Status

## Summary

`pipeline-agent` has been migrated from a prompt-constant + local-tool architecture toward a `Skill + MCP + Workflow` architecture.

Current status:

- `Skill` is now the primary prompt-definition layer.
- `MCP` is now the primary tool-exposure layer for database, calculation, and knowledge capabilities.
- `Workflow` is now responsible mainly for orchestration, routing, retries, synthesis, and streaming.
- Compatibility layers still exist, but they are thinner than before and are no longer the main execution path.

## Current Architecture

### Skill Layer

Main files:

- `src/skills/loader.py`
- `src/skills/runtime.py`
- `src/skills/types.py`
- `src/skills/definitions/*`

Current skill-backed capabilities include:

- `supervisor`
- `data-query`
- `hydraulic-calc`
- `knowledge-qa`
- `graph-reasoning`
- `planner`
- `reflexion`
- `chat-orchestrator`
- `final-synthesis`

### MCP Layer

Main files:

- `src/mcp/registry.py`
- `src/mcp/hub.py`
- `src/mcp/database_server.py`
- `src/mcp/calculation_server.py`
- `src/mcp/knowledge_server.py`
- `src/tools/mcp_langchain_adapter.py`

Current MCP servers:

- `database-mcp`
- `calculation-mcp`
- `knowledge-mcp`

Compatibility notes:

- Legacy MCP entry points such as `query_database`, `hydraulic_calculation`, and `run_sensitivity_analysis` are still available.
- MCP compatibility tools support both:
  - default `legacy` output
  - optional `response_format="contract"` structured output

### Workflow Layer

Main files:

- `src/workflows/graph.py`
- `src/workflows/nodes.py`
- `src/workflows/subgraph.py`

Current workflow behavior:

- Main ReAct workflow uses skill-backed prompts directly.
- Main workflow resolves tools through MCP first, with local compatibility fallback.
- Plan-and-execute nodes use skill-backed agent paths.
- Final synthesis in the subgraph goes through `supervisor.synthesis`.

## Migration Progress

### Step 1

Completed:

- `supervisor` prompt flow moved to direct skill usage.
- Single-step synthesis shortcut was removed.

Result:

- Final subgraph synthesis now consistently uses the supervisor skill.

### Step 2

Completed:

- Introduced shared result normalization in `src/agents/result_contracts.py`.
- Unified workflow-side result parsing through shared helpers.
- Added optional MCP contract output mode.

Result:

- Workflow and MCP now share a more consistent result envelope and parsing model.

### Step 3

Completed:

- Main workflow prompt loading no longer depends on compat prompt constants.
- `src/agents/prompts.py` was reduced to a lazy compatibility shim.
- `knowledge_server.py` now calls agents directly instead of routing through `agent_tools.py`.
- `src/tools/agent_tools.py` was reduced to a cleaner compatibility wrapper + tool metadata module.

Result:

- Compatibility layers remain, but main execution no longer relies on them.

### Step 4

Completed:

- Added `pytest` coverage for:
  - result contracts
  - prompt compatibility exports
  - MCP contract output mode
  - MCP legacy-default compatibility behavior
  - Chinese tool-search smoke checks
  - workflow and supervisor integration smoke tests

Test files:

- `tests/test_result_contracts.py`
- `tests/test_prompt_and_tool_metadata.py`
- `tests/test_mcp_contracts.py`
- `tests/test_tool_search_smoke.py`
- `tests/test_workflow_supervisor_integration.py`

Result:

- Core regression checks now exist and run in the project venv.

### Step 5

Completed:

- Added this migration status document.
- Captured the current architecture, compatibility boundary, verification path, and remaining risks.

## Compatibility Boundary

The following modules still exist primarily for compatibility:

- `src/agents/prompts.py`
- `src/tools/agent_tools.py`

Their current role is:

- preserve old imports and stable public names
- support fallback execution when MCP is unavailable
- provide metadata for tool search

They should not be treated as the long-term architecture center.

## Verification

Current lightweight regression command:

```powershell
D:\oil\pipeline-agent\.venv\Scripts\python.exe -m pytest D:\oil\pipeline-agent\tests\test_result_contracts.py D:\oil\pipeline-agent\tests\test_prompt_and_tool_metadata.py D:\oil\pipeline-agent\tests\test_mcp_contracts.py D:\oil\pipeline-agent\tests\test_tool_search_smoke.py D:\oil\pipeline-agent\tests\test_workflow_supervisor_integration.py -q
```

Expected result at the time of writing:

- `19 passed`

## Known Gaps

The migration is functional, but not fully closed out. The biggest remaining gaps are:

1. Compatibility layers still exist.
   They are smaller now, but they should eventually be reduced further once callers no longer depend on them.

2. Full end-to-end runtime validation still depends on local environment completeness.
   Some ad hoc import and runtime checks remain sensitive to local dependency setup.

## Recommended Next Work

If the project continues beyond the current migration, the recommended next tasks are:

1. Reduce remaining compatibility exports once downstream callers are confirmed migrated.
2. Add one end-to-end smoke path for:
   - query -> MCP -> workflow
   - plan-and-execute -> supervisor synthesis

## Decision Record

The project now follows this rule of thumb:

- `Skill` decides how the model should think and respond.
- `MCP` decides what capabilities and resources are exposed.
- `Workflow` decides how execution is orchestrated.

This is the intended steady-state architecture for future work.
