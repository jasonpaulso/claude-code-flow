# Multi-Agent Development Coordination Guide

## Overview

This guide outlines how to coordinate autonomous or semi-autonomous agents working collaboratively on a shared project.

## Directory Structure

```
coordination/
├── COORDINATION_GUIDE.md          # This file – main coordination reference
├── memory_bank/                   # Shared context, insights, and findings
│   ├── calibration_values.md      # Tuned parameters or heuristics
│   ├── test_failures.md           # Known issues and failed experiments
│   └── dependencies.md            # Environment setup notes
├── subtasks/                      # Decomposed work items
│   ├── task_001_component.md      # Component-specific task
│   ├── task_002_setup.md          # Setup or installation task
│   └── task_003_optimization.md   # Performance or logic improvements
└── orchestration/                 # Collaboration management
    ├── agent_assignments.md       # Active task ownership
    ├── progress_tracker.md        # Timeline and completion status
    └── integration_plan.md        # System-wide connection strategy
```

## Coordination Protocol

### 1. Task Assignment

- Check `orchestration/agent_assignments.md` before starting
- Claim your task by logging your agent ID
- Avoid overlap through transparent ownership

### 2. Knowledge Sharing

- Log all useful discoveries in `memory_bank/`
- Include failed attempts to reduce redundancy
- Share tuning parameters and workarounds promptly

### 3. Progress Updates

- Record progress in `orchestration/progress_tracker.md`
- Mark completed subtasks inside `subtasks/` files
- Note blockers or required inputs from other agents

### 4. Integration Points

- Follow `orchestration/integration_plan.md` for assembly
- Test partial integrations regularly
- Log interface contracts and assumptions

## Communication Standards

### Status Markers

- 🟢 COMPLETE – Task finished and verified
- 🟡 IN_PROGRESS – Actively being worked on
- 🔴 BLOCKED – Dependent or paused
- ⚪ TODO – Unclaimed or unstarted
- 🔵 REVIEW – Awaiting validation

### Update Format

```markdown
## [Timestamp] Agent: [Agent_ID]

**Task**: [Brief summary]  
**Status**: [Status marker]  
**Details**: [Progress, issues, discoveries]  
**Next**: [Planned follow-up action]
```

## Critical Rules

1. **No Uncoordinated Edits** – Avoid editing shared files without claiming
2. **Always Test Before Completion** – Validate outputs before status updates
3. **Log All Failures** – Negative results are part of the process
4. **Share Tunings and Fixes** – Parameters, configs, and tricks belong in memory_bank
5. **Commit in Small Units** – Make atomic, reversible changes
