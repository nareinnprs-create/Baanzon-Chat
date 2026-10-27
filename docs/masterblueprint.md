# BAANZON CHAT — MASTER BLUEPRINT
## Version 2.0 — Frozen Product, UX & Implementation Specification

**Status:** BUILD BASELINE — VISUAL DIRECTION LOCKED  
**Product:** Baanzon Chat  
**Core Model:** Baanzon-Cheni-1.5  
**Platform Strategy:** Web/PWA → iOS/Android → macOS/Windows/Linux Desktop  
**Design Identity:** Baanzon Aurora Pearl — MASTER UI LOCK  
**Architecture Principle:** One unified AI experience; complexity remains behind the interface.

---

# 0. PURPOSE

This document is the authoritative product, UX, architecture, engineering, security, AI, data, and implementation baseline for Baanzon Chat.

AI coding assistants must treat this document as the source of truth unless a newer version explicitly supersedes it.

Do not silently invent architecture, APIs, database behavior, security exceptions, or product features.

Baanzon Chat is a general-purpose multimodal AI assistant and AI workspace. It is **not Codex**, and coding is only one capability inside the broader system.

---

# 1. PRODUCT DEFINITION

Baanzon Chat is designed to provide one unified AI experience capable of:

- Conversation
- Reasoning
- Search
- Deep research
- Writing
- Analysis
- Education
- Science
- Business
- Finance
- Legal research
- Design
- Marketing
- Coding
- Documents
- Data
- Image creation/editing
- Audio
- Video
- Voice
- Projects
- Memory
- Canvas
- Artifacts
- Automation
- Workflows
- Connectors
- Tool use
- Agentic execution

The user should experience Baanzon as **one capable intelligence**, not as a collection of disconnected agents.

---

# 2. CORE PRODUCT PRINCIPLES

1. User outcome over AI activity.
2. Simplicity at the surface; depth underneath.
3. Fast path for simple requests.
4. Deep execution only when justified.
5. Evidence-first and verification-first.
6. Never claim zero hallucinations.
7. Never fabricate sources, files, tool results, or completed work.
8. Generated artifacts must be validated before delivery.
9. Failed generation should automatically retry, diagnose, repair, and revalidate where possible.
10. User controls consequential actions.
11. Privacy by default.
12. Least-privilege permissions.
13. Long-running work must be resumable.
14. No unnecessary UI blocking.
15. No vendor lock-in at the application layer.
16. Shared core architecture across all clients.
17. Internationalization from Day 1.
18. Accessibility from Day 1.
19. Security is part of the architecture, not a later layer.
20. Coding is a capability, not the identity of the product.
21. The interface must feel simpler than the system underneath it.
22. Baanzon is intent-first, not control-first.
23. The user should see the next useful action, not the entire capability graph.
24. Visual calm is a feature: remove anything that does not improve comprehension or action.
25. Baanzon must have a recognizable visual language even when the logo is hidden.
26. The primary home experience is a focused invitation to work, not a feature dashboard.
27. Conversation evolves into workspace when the user's intent requires it.

---

# 3. PRODUCT EXPERIENCE

## 3.1 Primary modes

Expose simple user-facing modes:

- Chat
- Think
- Search
- Research
- Create
- Analyze
- Build
- Study
- Work

The system may automatically choose or combine modes.

Users do not need to manually select agents.

## 3.2 Adaptive interface

The UI should adapt to context.

Examples:

- PDF uploaded → document capabilities become available.
- Spreadsheet uploaded → data capabilities become available.
- Research requested → research workspace becomes available.
- Presentation requested → presentation artifact workspace becomes available.
- Voice started → voice interface takes priority.

Do not expose every possible control simultaneously.

---

# 4. BAANZON INTELLIGENCE ARCHITECTURE

```text
USER
 ↓
BAANZON CHAT
 ↓
Intent Understanding
 ↓
Context Assembly
 ↓
Task Classification
 ↓
Risk / Complexity Assessment
 ↓
Capability Selection
 ↓
Model Selection
 ↓
Agent Orchestration
 ↓
Tool Execution
 ↓
Trust / Verification
 ↓
Response / Artifact
 ↓
User
```

## 4.1 Execution strategies

### FAST
Simple informational requests.

### STANDARD
Normal reasoning and response.

### TOOL
Requires search, files, calculation, database, or external tools.

### MULTI_AGENT
Complex tasks requiring multiple specialist capabilities.

### DEEP_WORK
Long-running research, analysis, creation, or multi-step work.

### APPROVAL
Tasks requiring explicit user authorization before side effects.

---

# 5. 21 MAIN AGENT DOMAINS

Each main domain contains three specialist agents.

1. General
   - General Reasoner
   - Conversation Specialist
   - Answer Validator

2. Research
   - Web Researcher
   - Evidence Analyst
   - Research Critic

3. Writing
   - Writer
   - Editor
   - Style Specialist

4. Coding
   - Developer
   - Debugger
   - Code Reviewer

5. Analysis
   - Data Analyst
   - Quantitative Analyst
   - Insight Validator

6. Creative
   - Ideation
   - Creative Director
   - Creative Critic

7. Business
   - Strategist
   - Operations Analyst
   - Business Analyst

8. Finance
   - Financial Analyst
   - Financial Modeler
   - Risk Analyst

9. Legal
   - Legal Researcher
   - Contract Analyst
   - Compliance Analyst

10. Education
    - Teacher
    - Tutor
    - Knowledge Evaluator

11. Science
    - Scientific Researcher
    - Evidence Analyst
    - Scientific Critic

12. Engineering
    - Systems Engineer
    - Technical Designer
    - Verification Engineer

13. Design
    - UX Designer
    - UI Designer
    - Design Critic

14. Marketing
    - Marketing Strategist
    - Content Strategist
    - Growth Analyst

15. Product
    - Product Strategist
    - Product Designer
    - Product Analyst

16. Documents
    - Document Reader
    - Document Analyst
    - Document Builder

17. Media
    - Vision Agent
    - Audio Agent
    - Video Agent

18. Automation
    - Workflow Planner
    - Tool Executor
    - Workflow Validator

19. Personal
    - Memory Agent
    - Planning Agent
    - Personal Assistant

20. Security
    - Security Analyst
    - Threat Analyst
    - Security Validator

21. Orchestrator
    - Intent Router
    - Agent Coordinator
    - Final Validator

---

# 6. AGENT RULES

Every agent must have:

- Stable ID
- Human-readable name
- Description
- Capabilities
- Allowed models
- Allowed tools
- Permission policy
- Memory policy
- Safety policy
- System prompt
- Input schema
- Output schema
- Version
- Evaluator
- Timeout
- Token budget
- Tool-call budget
- Cost budget
- Observability metadata

Agents communicate through structured state, not uncontrolled conversational chains.

Agent lifecycle:

```text
PENDING
 ↓
PLANNING
 ↓
RUNNING
 ↓
WAITING_FOR_TOOL
 ↓
RUNNING
 ↓
VERIFYING
 ↓
COMPLETED
```

Failure states:

- CANCELLED
- FAILED
- TIMEOUT
- REQUIRES_APPROVAL

---

# 7. ORCHESTRATOR

The orchestrator is responsible for:

- Intent detection
- Complexity classification
- Risk classification
- Decomposition
- Planning
- Model selection
- Agent selection
- Tool selection
- Dependency management
- Parallel execution
- Sequential execution
- Agent communication
- Conflict resolution
- Verification
- Synthesis
- Final response construction

Independent tasks should run in parallel.

Dependent tasks must respect a dependency graph.

---

# 8. CONTEXT ENGINE

The Context Engine determines what information should enter a model context.

Sources:

- Current prompt
- Conversation history
- Relevant prior conversations
- Project instructions
- Project files
- Memory
- Knowledge bases
- Web sources
- Tool results
- Agent results
- Artifacts

Pipeline:

```text
COLLECT
 ↓
FILTER
 ↓
RANK
 ↓
DEDUPLICATE
 ↓
COMPRESS
 ↓
ASSEMBLE
 ↓
MODEL
```

Never dump all available context blindly into a model.

---

# 9. BAANZON TRUST ENGINE

Baanzon must be verification-first.

Pipeline:

```text
Claim Extraction
 ↓
Evidence Requirement
 ↓
Source Retrieval
 ↓
Source Quality Assessment
 ↓
Cross-Source Verification
 ↓
Contradiction Detection
 ↓
Claim Validation
 ↓
Confidence
```

Internal classifications:

- VERIFIED
- SUPPORTED
- INFERRED
- UNCERTAIN
- CONFLICTING
- UNSUPPORTED

The system must be able to abstain when evidence is inadequate.

Do not expose private chain-of-thought. Provide useful execution transparency instead:

- What was searched
- What sources mattered
- What tools were used
- What was verified
- What remains uncertain

---

# 10. MODEL GATEWAY

Application code must never directly depend on an external model vendor.

All inference passes through the Baanzon Model Gateway.

```typescript
interface ModelProvider {
  listModels(): Promise<Model[]>;
  generate(request: GenerateRequest): AsyncIterable<ModelEvent>;
  embed(request: EmbedRequest): Promise<number[]>;
  transcribe(request: AudioRequest): AsyncIterable<TranscriptEvent>;
  moderate(request: ModerationRequest): Promise<ModerationResult>;
}
```

Model routing considers:

- Capability
- Context length
- Quality
- Latency
- Cost
- Availability
- Task type
- User entitlement
- Safety requirements

Support:

- Baanzon-Cheni-1.5
- Future Baanzon models
- Approved external providers
- Specialized models

---

# 11. CHAT ENGINE

Support:

- New chat
- History
- Search
- Rename
- Pin
- Archive
- Delete
- Restore
- Temporary/private chat
- Branch
- Duplicate
- Share
- Export
- Edit message
- Regenerate
- Continue
- Retry
- Stop
- Copy
- Select text
- Feedback
- Report
- Suggested follow-ups
- Auto titles
- Folders
- Tags
- Templates

Messages must be structured objects rather than a single text field.

Supported message parts:

- Text
- Markdown
- Code
- Tables
- Images
- Audio
- Video
- Files
- Citations
- Sources
- Tool activity
- Agent activity
- Artifacts
- Charts
- Diagrams
- Interactive components

---

# 12. STREAMING EVENT PROTOCOL

```typescript
type BaanzonEvent =
  | { type: "message.started"; id: string }
  | { type: "message.delta"; delta: string }
  | { type: "agent.started"; runId: string; agentId: string }
  | { type: "agent.progress"; runId: string; message: string }
  | { type: "agent.completed"; runId: string }
  | { type: "tool.started"; toolRunId: string; tool: string }
  | { type: "tool.result"; toolRunId: string; result: unknown }
  | { type: "source.added"; source: Source }
  | { type: "citation.added"; citation: Citation }
  | { type: "artifact.created"; artifact: Artifact }
  | { type: "message.completed"; messageId: string }
  | { type: "error"; code: string; message: string };
```

Use SSE for AI/server-to-client streaming where appropriate.

Use WebSocket for realtime collaboration and bidirectional application events.

Use WebRTC for appropriate realtime media.

---

# 13. MULTIMODAL

## Inputs

- Text
- Image
- Camera
- Screenshot
- PDF
- DOCX
- XLSX
- PPTX
- CSV
- JSON
- TXT
- ZIP
- Audio
- Video
- URL
- Web page
- Clipboard
- Repository

## Outputs

- Text
- Images
- Audio
- Video
- Documents
- Spreadsheets
- Presentations
- Charts
- Diagrams
- Websites
- Interactive artifacts
- Structured data

---

# 14. UNIVERSAL COMPOSER

The composer is a signature Baanzon component.

Capabilities:

- Text
- Attachments
- Multiple files
- Image
- Camera
- Voice
- Search
- Tools
- URLs
- Screen capture
- Data
- Code
- Mode selection
- Model selection

Support:

- Drag and drop
- Paste images
- Paste tables
- Paste URLs
- Paste files
- Offline drafts
- Upload queue
- Cancellation

---

# 15. UNIVERSAL CREATION ENGINE

Everything Baanzon creates becomes an Artifact.

Artifact categories:

- Document
- Spreadsheet
- Presentation
- Image
- Audio
- Video
- Code
- Website
- Dataset
- Chart
- Diagram
- Interactive

Pipeline:

```text
UNDERSTAND
 ↓
CREATE
 ↓
TYPE VALIDATE
 ↓
CONTENT VALIDATE
 ↓
RENDER
 ↓
VISUAL INSPECT
 ↓
SECURITY VALIDATE
 ↓
REPAIR IF NEEDED
 ↓
RE-VALIDATE
 ↓
DELIVER
```

The system must not claim completion if the artifact has not passed appropriate validation.

---

# 16. FILE CREATION

## Documents

Support:

- DOCX
- PDF
- TXT
- Markdown
- RTF
- HTML
- EPUB
- ODT
- LaTeX

## Spreadsheets

Support:

- XLSX
- CSV
- ODS
- TSV
- JSON data

## Presentations

Support:

- PPTX
- ODP
- PDF export

## Images

Support:

- PNG
- JPEG
- WebP
- SVG where supported

## Audio

Support:

- MP3
- WAV
- M4A
- FLAC
- OGG

## Video

Support:

- MP4
- MOV
- WebM

## Code/data

Support common programming, markup, configuration, database, and structured-data formats.

---

# 17. ARTIFACT VALIDATION

## DOCX

Validate:

- Package integrity
- XML
- Relationships
- Styles
- Tables
- Images
- Fonts where applicable

## PDF

Validate:

- File integrity
- Page rendering
- Fonts
- Images
- Page count
- Missing objects

## XLSX

Validate:

- Workbook integrity
- Sheets
- Formulas
- References
- Charts
- Named ranges where applicable

## PPTX

Validate:

- Package integrity
- Slide rendering
- Relationships
- Images
- Text overflow
- Clipping
- Layout integrity

## Images

Validate:

- Encoding
- Dimensions
- Alpha
- File integrity

## Code

Validate where applicable:

- Syntax
- Type checking
- Tests
- Build
- Dependency/security checks

---

# 18. AUTO-REPAIR

```text
GENERATE
 ↓
VALIDATE
 ↓
FAIL
 ↓
DIAGNOSE
 ↓
REPAIR
 ↓
VALIDATE
 ↓
PASS
```

Use bounded retry counts and cost budgets.

Never enter infinite repair loops.

---

# 19. ARTIFACT VERSIONING

Every meaningful modification creates a version.

```text
Artifact
 ├── v1
 ├── v2
 ├── v3
 └── Final
```

Support:

- Version history
- Restore
- Compare
- Duplicate
- Export
- Share

Do not destructively overwrite user work by default.

---

# 20. DOCUMENT INTELLIGENCE

Support:

- PDF
- DOCX
- PPTX
- XLSX
- CSV
- OCR
- Tables
- Images
- Layout understanding

Operations:

- Summarize
- Ask questions
- Compare
- Extract
- Rewrite
- Translate
- Classify
- Generate

---

# 21. BAANZON SEARCH

Support:

- Web
- News
- Images
- Video
- Academic sources where available

Capabilities:

- Query rewriting
- Multi-query search
- Source ranking
- Domain filters
- Date filters
- Source-type filters
- Official-source preference
- Source extraction
- Citation mapping
- Validation
- Search history

---

# 22. DEEP RESEARCH

Pipeline:

```text
REQUEST
 ↓
PLAN
 ↓
SEARCH
 ↓
READ
 ↓
EXTRACT
 ↓
COMPARE
 ↓
VERIFY
 ↓
SYNTHESIZE
 ↓
REPORT
```

Support:

- Editable plans
- Source restrictions
- Domain restrictions
- Date restrictions
- Connected data
- Progress
- Pause
- Resume
- Redirect
- Cancel
- Citation validation
- Research workspace
- Export

---

# 23. MEMORY

Memory layers:

```text
SHORT-TERM
Current conversation

PROJECT
Project-specific memory

LONG-TERM
Useful user preferences/facts

KNOWLEDGE
External/project knowledge

TEMPORARY
Task-specific context
```

Support:

- Extraction
- Relevance scoring
- Deduplication
- Confidence
- Source
- Expiration
- Search
- Edit
- Delete
- Disable
- Permissions
- Temporary memory

Never blindly save every conversation detail.

---

# 24. KNOWLEDGE / RAG

Pipeline:

```text
File / URL / Source
 ↓
Parser
 ↓
Normalizer
 ↓
Chunker
 ↓
Metadata
 ↓
Embedding
 ↓
PostgreSQL + pgvector
```

Retrieval:

```text
Query
 ↓
Query Rewrite
 ↓
Keyword Search + Vector Search + Metadata Search
 ↓
Rerank
 ↓
Context Assembly
 ↓
Model
```

---

# 25. PROJECTS

A Project contains:

- Conversations
- Files
- Instructions
- Memory
- Agents
- Sources
- Research
- Canvas
- Artifacts
- Tasks
- Automations
- Members
- Activity

Support:

- Create
- Rename
- Duplicate
- Archive
- Share
- Permissions
- Search
- Export
- Project instructions
- Project memory

Projects should feel like living workspaces, not folders.

---

# 26. BAANZON WORK

Flagship complex-work experience:

```text
UNDERSTAND
 ↓
PLAN
 ↓
EXECUTE
 ├── Research
 ├── Analysis
 ├── Creation
 ├── Tools
 └── Agents
 ↓
VERIFY
 ↓
REFINE
 ↓
DELIVER
```

Outputs can include:

- Answers
- Reports
- Documents
- Spreadsheets
- Presentations
- Websites
- Images
- Datasets
- Workflows
- Research packages

Long-running Work must persist across sessions and devices.

---

# 27. CANVAS

Support:

- Writing
- Coding
- Research
- Design
- Data
- Diagrams
- Websites

Capabilities:

- Split view
- Selection-based AI actions
- Inline editing
- Comments
- Versions
- Collaboration
- Zoom
- Navigation
- Export
- Share

---

# 28. DATA LAB

Support:

- CSV
- XLSX
- JSON
- SQL
- TSV

Capabilities:

- Cleaning
- Transformation
- Statistics
- Calculations
- Python-backed analysis
- Query generation
- Visualization
- Charts
- Dashboards
- Forecasting
- Anomaly detection
- Correlation
- Scenario analysis
- Export

Use a sandbox for code execution.

---

# 29. CODING CAPABILITY

Coding remains one capability inside Baanzon.

Capabilities may include:

- Code generation
- Explanation
- Debugging
- Repository understanding
- File editing
- Multifile edits
- Testing
- Refactoring
- Code review
- Dependency analysis
- Documentation
- Terminal execution
- Git integration
- Build/run
- Preview
- Security checks

Do **not** create a separate Codex-style product identity.

---

# 30. VOICE

Support:

- STT
- TTS
- Realtime conversation
- Streaming
- Voice activity detection
- Interruptions
- Resume
- Multiple voices
- Multilingual voice
- Translation
- Voice + image/screen context
- Hands-free use

Voice mode uses the Baanzon Aurora Orb visual identity.

---

# 31. VISION

Support:

- Image understanding
- OCR
- Screenshots
- Charts
- Diagrams
- UI understanding
- Document vision
- Image comparison
- Visual Q&A

---

# 32. VIDEO

Support:

- Upload
- Transcription
- Scene detection
- Keyframes
- Object/context understanding
- Audio analysis
- Subtitle analysis
- Summarization
- Shot analysis
- Video Q&A

---

# 33. AUTOMATION

Support:

- One-time
- Scheduled
- Recurring
- Conditional
- Event-triggered
- Webhook-triggered

Every automation has:

- Version
- Permissions
- Retry policy
- Timeout
- History
- Cancellation
- Failure handling
- Audit trail

---

# 34. WORKFLOW BUILDER

```text
TRIGGER
 ↓
INPUT
 ↓
AGENT
 ↓
TOOL
 ↓
CONDITION
 ↓
AGENT
 ↓
APPROVAL
 ↓
ARTIFACT
 ↓
NOTIFICATION
```

Provide a visual builder later; the underlying workflow engine must exist independently.

---

# 35. TOOLS

Initial tool registry:

- Web search
- Browser
- Calculator
- Code execution
- File read
- File write
- Document parser
- Image analysis
- Audio analysis
- Video analysis
- Database
- Email
- Calendar
- Cloud storage
- GitHub/Git providers
- Connector
- Custom API

Each tool requires:

- ID
- Name
- Description
- Input schema
- Output schema
- Permissions
- Risk level
- Timeout
- Version

---

# 36. CONNECTORS

Potential integrations:

- Google Drive
- Gmail
- Google Calendar
- Microsoft 365
- Outlook
- OneDrive
- SharePoint
- Slack
- GitHub
- GitLab
- Notion
- Dropbox
- Linear
- Jira
- Salesforce
- HubSpot
- Databases
- Custom APIs

Connector architecture must support:

- OAuth
- OIDC where applicable
- Secure token vault
- Scope controls
- Read/write permissions
- Sync
- Search
- Disconnect
- Audit
- Reauthorization

---

# 37. BROWSER / COMPUTER CAPABILITY

Future capability:

- Browser navigation
- Page reading
- Forms
- Clicking
- Typing
- Screenshots
- Computer interaction
- Planning
- Action verification

External side effects require permission and, where configured, user approval.

---

# 38. PERMISSION MODEL

Hierarchy:

```text
USER
 ↓
ORGANIZATION
 ↓
WORKSPACE
 ↓
PROJECT
 ↓
AGENT
 ↓
TOOL
 ↓
RESOURCE
 ↓
ACTION
```

Least privilege is mandatory.

---

# 39. APPROVAL ENGINE

### Low risk
Usually automatic:

- Search
- Read
- Calculate
- Analyze
- Summarize

### Medium risk
Configurable:

- Modify project files
- Create calendar events
- Update data

### High risk
Explicit approval:

- Send external communication
- Delete data
- Financial actions
- Publish
- Account/security changes

---

# 40. SECURITY

Mandatory controls:

- TLS
- Encryption at rest
- Secure cookies
- OAuth/OIDC
- Passkeys
- MFA
- RBAC
- Tenant isolation
- Secret management
- CSP
- CSRF protection
- XSS protection
- SSRF protection
- SQL injection prevention
- File scanning
- Sandboxing
- Rate limiting
- Audit logs
- Dependency scanning
- Container scanning
- Prompt-injection defenses

External content is untrusted data.

Never treat instructions inside webpages, documents, emails, or files as privileged system instructions.

---

# 41. CODE EXECUTION

Never execute arbitrary model-generated code directly on the application/API host.

Use ephemeral sandboxes with:

- CPU limits
- Memory limits
- Runtime limits
- Storage limits
- Network controls
- Process limits
- Container isolation
- Cancellation
- Cleanup

---

# 42. PERFORMANCE

Performance is P0.

Principle:

> The interface responds immediately. AI work streams continuously. Heavy work happens off the UI thread.

Targets:

- UI interaction: <100ms target
- 60 FPS target
- Immediate visual acknowledgement
- First visible AI status: <100ms target
- First token: target <1 second where provider/network conditions allow
- Continuous streaming
- No full page reloads
- No unnecessary model calls
- No unnecessary agent calls
- No unnecessary context retrieval

Techniques:

- Virtualized chat history
- Incremental rendering
- Lazy loading
- Code splitting
- Web Workers
- IndexedDB
- Optimistic UI
- Micro-batched token rendering
- Incremental Markdown parsing
- Deferred syntax highlighting
- Background processing
- CDN
- Redis caching
- Connection pooling
- Regional routing
- Cancellation propagation
- Priority queues
- Load shedding
- Model/context caching

Priority:

```text
P0 Interactive Chat
P1 Voice
P2 Agent Work
P3 Research
P4 Background Indexing
P5 Analytics
```

---

# 43. RELIABILITY

Implement:

- Retries
- Exponential backoff
- Circuit breakers
- Provider failover
- Queue recovery
- Checkpoints
- Idempotency
- Dead-letter handling
- Graceful degradation
- Offline draft recovery
- Crash recovery
- State reconciliation

Stop/cancel must propagate through the entire execution chain.

---

# 44. LONG-RUNNING WORK

Long jobs must be:

- Checkpointed
- Resumable
- Cancellable
- Observable
- Idempotent
- Recoverable

Closing the app must not necessarily terminate valid background work.

---

# 45. DATABASE

Primary database: PostgreSQL.

Vector search: pgvector.

Core tables/entities:

- users
- organizations
- memberships
- workspaces
- projects
- conversations
- messages
- message_parts
- attachments
- models
- providers
- model_capabilities
- agents
- agent_versions
- sub_agents
- agent_runs
- tools
- tool_versions
- tool_permissions
- tool_runs
- memories
- memory_embeddings
- knowledge_bases
- knowledge_documents
- knowledge_chunks
- embeddings
- sources
- citations
- artifacts
- artifact_versions
- workflows
- workflow_runs
- tasks
- scheduled_tasks
- notifications
- devices
- sessions
- subscriptions
- usage_records
- audit_logs
- feedback

All schema changes use migrations.

Never silently alter production schema.

---

# 46. STORAGE

Use PostgreSQL for metadata.

Use S3-compatible object storage for file bytes.

Large uploads:

```text
Client
 ↓
Signed URL
 ↓
Object Storage
 ↓
Processing Worker
 ↓
Metadata / Knowledge
```

Support:

- Chunked upload
- Resumable upload
- Upload progress
- File validation
- Malware/security scanning

---

# 47. QUEUES / WORKERS

Heavy tasks run outside the interactive API process.

Workers include:

- Document worker
- Embedding worker
- Research worker
- Data worker
- Media worker
- Automation worker

Use Redis initially for caching and queues; evolve infrastructure when scale requires.

---

# 48. REALTIME

Use:

- SSE for AI response streaming
- WebSocket for collaboration and realtime state
- WebRTC for suitable realtime voice/media

Realtime state must reconcile safely after reconnect.

---

# 49. OFFLINE

Offline support should preserve:

- Drafts
- Recent conversations
- UI preferences
- Project metadata
- Cached artifacts
- Pending uploads

Use:

```text
LOCAL STATE
 ↓
SYNC QUEUE
 ↓
SERVER
 ↓
CONFLICT RESOLUTION
 ↓
LOCAL STATE
```

---

# 50. GLOBAL SEARCH

Search across:

- Chats
- Projects
- Files
- Artifacts
- Research
- Sources
- Memories
- Tasks
- Automations
- Agents

Use hybrid keyword + semantic + metadata search.

---

# 51. NOTIFICATIONS

Channels:

- In-app
- Mobile push
- Desktop
- Email

Events:

- Research completed
- Agent completed
- Approval required
- Automation completed
- Automation failed
- Project activity
- Mention
- Important result

Provide granular notification controls.

---

# 52. ACTIVITY CENTER

One central activity surface:

```text
Active
● Researching
● Creating presentation
● Processing files

Completed
✓ Report created
✓ Analysis completed

Attention
⚠ Approval required
⚠ Automation failed
```

Only display truthful execution status.

---

# 53. GLOBAL COMMAND PALETTE

Use Cmd/Ctrl+K.

Actions:

- New chat
- Search
- Open project
- Open file
- Create artifact
- Start research
- Start voice
- Run agent
- Change model
- Settings
- Theme
- Automations
- Connectors

---

# 54. SHARING

Support:

- Private
- Specific people
- Organization
- Anyone with link
- Public
- Expiration
- View-only
- Copy permission
- Download permission
- Revoke

---

# 55. IMPORT / EXPORT

Export:

- Chats
- Projects
- Files
- Memory
- Artifacts
- Research
- Account data

Future import:

- ChatGPT exports
- Claude exports
- Markdown
- DOCX
- PDF
- JSON
- TXT
- CSV

---

# 56. BILLING / ENTITLEMENTS

Separate:

```text
USER
 ↓
PLAN
 ↓
ENTITLEMENTS
 ↓
USAGE
 ↓
LIMITS
 ↓
BILLING
```

Track:

- Model usage
- Tokens
- Storage
- Voice
- Media
- Search
- Agent compute
- Workflow execution

Do not hard-code plan limits across application modules.

---

# 57. MULTI-TENANCY

Architecture:

```text
Platform
 ↓
Organization
 ↓
Workspace
 ↓
Project
 ↓
Conversation
```

Personal users can have a private organization/workspace behind the scenes.

---

# 58. ADMIN PLATFORM

Internal admin console:

- Users
- Organizations
- Models
- Providers
- Agents
- Tools
- Usage
- Billing
- Security
- Abuse
- Logs
- Evaluations
- Feature flags
- System health

---

# 59. OBSERVABILITY

Use OpenTelemetry.

Every major operation receives a trace ID.

Trace:

```text
Request
 ├── Model
 ├── Agent
 ├── Retrieval
 ├── Tool
 ├── Database
 ├── Queue
 └── Output
```

Measure:

- TTFT
- Total latency
- Tokens/sec
- Model latency
- Retrieval latency
- Tool latency
- Queue latency
- Failure rate
- Cancellation rate
- Cost
- Quality metrics

---

# 60. AI EVALUATION

Create a dedicated Baanzon evaluation framework.

Evaluate:

### Models
- Reasoning
- Factuality
- Coding
- Mathematics
- Multimodal quality

### Agents
- Routing
- Completion
- Tool selection
- Output quality

### Trust
- Citation accuracy
- Unsupported claims
- Contradictions
- Evidence quality

### UX
- Latency
- Rendering
- Failure recovery
- Mobile performance

Every model, agent, prompt, or orchestration change must run regression evaluations.

---

# 61. CONTINUOUS QUALITY LOOP

```text
PRODUCTION REQUEST
 ↓
EXECUTION
 ↓
RESULT
 ↓
EVALUATION
 ↓
QUALITY SIGNAL
 ↓
DATASET
 ↓
REGRESSION TEST
 ↓
IMPROVEMENT
```

---

# 62. DESIGN IDENTITY — BAANZON AURORA PEARL

The visual identity should be:

- Fresh
- Premium
- Elegant
- Calm
- Intelligent
- Distinctive
- Timeless

Avoid generic AI neon styling.

## Signature palette

### Deep Ocean
`#063C45`

### Baanzon Teal
`#087F83`

### Luminous Aqua
`#35D6C7`

### Pearl
`#F4F7F3`

### Mist
`#E8F3F0`

### Soft Orchid
`#9B8AFB`

### Champagne
`#D8C29D`

The primary Baanzon identity is **Deep Ocean + Teal + Aqua**.

Orchid and Champagne are restrained accents.

---

# 63. LOCKED VISUAL MASTER — BAANZON HOME EXPERIENCE

**Status: LOCKED.** The approved Baanzon home-screen visual generated on 2026-09-08 is the master visual reference for the product experience. It is a design direction and composition reference, not a requirement to reproduce every decorative pixel literally.

Reference concept: **Baanzon Aurora Pearl — Intelligent Terrace**.

The visual establishes the following non-negotiable principles:

### 63.1 First impression

Baanzon must feel like a serious global consumer technology product: premium, calm, spacious, intelligent and confident. It must not resemble a generic AI SaaS dashboard, developer console, or a reskinned open-source chat application.

### 63.2 Home hierarchy

The home screen is intentionally minimal and centered around one primary action:

```text
Baanzon

What are you working on?

Tell Baanzon what you need.

┌─────────────────────────────────────────────┐
│ Ask Baanzon anything…                      │
│                                             │
│ +   Baanzon / Model   Tools       Voice  ↑ │
└─────────────────────────────────────────────┘

Write      Research      Create      Analyze
```

Do not turn the home screen into a feature marketplace or dashboard.

### 63.3 Navigation restraint

Primary navigation should remain compact:

- Home
- Chats
- Projects
- Library
- Explore

Secondary and advanced capabilities must appear contextually, through search, command palette, project context, composer tools, sheets, panels, or settings.

### 63.4 Signature composer

The Universal Composer is the visual and functional center of Baanzon. It must feel premium, spacious and immediately actionable.

Required states:

- Idle
- Focused
- File attached
- Image attached
- Voice
- Search
- Tool enabled
- Long-running task
- Error/retry
- Offline draft

The composer must adapt to intent without exposing unnecessary controls.

### 63.5 Contextual power

Complexity appears only when useful. Examples:

- Research request → research controls/workspace appear.
- File upload → file-aware actions appear.
- Presentation request → artifact workspace appears.
- Coding request → coding tools appear.
- Voice request → voice surface takes priority.

The user should never need to understand Baanzon's internal agent architecture to accomplish a task.

### 63.6 Conversation-to-workspace transformation

This is a core Baanzon interaction pattern:

```text
INTENT
  ↓
CONVERSATION
  ↓
UNDERSTANDING
  ↓
WORKSPACE EMERGES WHEN NEEDED
  ↓
WORK / ARTIFACT / RESEARCH / PROJECT
```

Example: a request such as “help me launch my startup” may begin as conversation and progressively become a project workspace containing strategy, research, files, tasks and artifacts.

Do not force the user to manually configure these surfaces before Baanzon knows they are useful.

### 63.7 Visual density

Default visual density must be low. Avoid:

- excessive cards
- dashboard grids
- constant gradients
- oversized borders
- decorative feature tiles
- persistent technical controls
- competing primary actions

Use whitespace, typography, hierarchy and contextual surfaces instead.

### 63.8 Content-first responses

Assistant responses must read like high-quality editorial content, not giant chat bubbles. The answer is the interface.

### 63.9 Baanzon Intelligence Pulse

Create a signature Baanzon mark/state language that communicates genuine system activity without exposing private chain-of-thought:

- Idle
- Thinking
- Searching
- Reading
- Creating
- Voice
- Completed
- Needs attention

Motion must be subtle and truthful.

### 63.10 Environment

The approved visual may use atmospheric imagery or spatial depth as a Baanzon brand layer, but imagery must never reduce readability, accessibility or performance. Background imagery is optional/contextual, not mandatory on every screen.

### 63.11 What this lock replaces

This visual lock supersedes the earlier card-heavy “multi-screen SaaS showcase” direction. Marketing visuals may show multiple devices, but the actual product UI must be designed from the single-interface master direction first.

### 63.12 Visual acceptance test

Ask:

> If the Baanzon logo disappeared, would the interface still feel unmistakably Baanzon?

If no, redesign the visual language rather than adding the logo more prominently.

---

# 63. LIGHT THEME — PEARL

```text
Background:       #F7FAF8
Surface:          #FFFFFF
Surface Soft:     #EFF6F3
Border:           #DDE9E5
Primary Text:     #102A2D
Secondary Text:   #52686A
Muted Text:       #6E7F80
Primary:          #087F83
Accent:           #35D6C7
```

The light interface should feel like premium paper and soft daylight.

---

# 64. DARK THEME — DEEP OCEAN

```text
Background:       #061316
Surface:          #0A1C20
Surface Elevated: #10272B
Border:           #1D3A3D
Primary Text:     #F3F8F6
Secondary Text:   #A9C0BD
Muted Text:       #6E8987
Primary:          #13A6A0
Accent:           #46E2D2
Orchid:           #A998FF
Champagne:        #D8C29D
```

Do not use pure black.

---

# 65. SIGNATURE AURORA

Use selectively:

```text
Deep Ocean → Teal → Aqua → Soft Orchid
```

This gradient is reserved for:

- Brand moments
- AI activity
- Voice
- Selected states
- Onboarding
- Special artifacts
- Completion states

Do not make every component gradient.

---

# 66. TYPOGRAPHY

Primary:

- Inter

Fallback:

- System UI stack

Code:

- JetBrains Mono

Provide appropriate Unicode fallbacks for supported writing systems.

---

# 67. TYPE SCALE

```text
Display: 48–64px
H1:      32–40px
H2:      24–32px
H3:      20–24px
Body:    15–17px
Small:   13–14px
Caption: 11–12px
Code:    13–15px
```

---

# 68. SPACING

Use a 4px base:

```text
4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80 / 96
```

---

# 69. RADIUS

```text
XS:    6px
SM:    8px
MD:    12px
LG:    16px
XL:    20px
Pill:  999px
```

Avoid excessive rounded-card styling.

---

# 70. DESIGN TOKENS

Never hard-code visual values in individual components.

Semantic tokens include:

- background
- surface
- surface-elevated
- foreground
- foreground-muted
- border
- primary
- primary-foreground
- success
- warning
- danger
- focus
- shadow
- radius
- spacing
- motion

---

# 71. MAIN DESKTOP UI — LOCKED EXPERIENCE MODEL

The default desktop experience must follow the Baanzon Home Master direction rather than a dashboard layout.

```text
┌─────────────────────────────────────────────────────────────┐
│ Baanzon                                  Search   Profile   │
├──────────────┬──────────────────────────────────────────────┤
│ New Chat     │                                              │
│ Home         │             What are you working on?          │
│ Chats        │                                              │
│ Projects     │          Tell Baanzon what you need.          │
│ Library      │                                              │
│ Explore      │      ┌──────────────────────────────────┐    │
│              │      │ Ask Baanzon anything…            │    │
│ Recent       │      │ +   Model   Tools   Voice     ↑  │    │
│ …            │      └──────────────────────────────────┘    │
│ …            │                                              │
│              │          Write  Research  Create  Analyze    │
│ Settings     │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

Rules:

- Sidebar is compact and quiet.
- The main workspace owns visual attention.
- The composer is the primary interaction surface.
- Right-side panels are contextual and hidden until useful.
- Agents, automations, technical tools and advanced configuration are not persistent primary navigation items.
- Chat responses use content-first editorial layout.
- Projects, research, canvas, data and artifacts can progressively occupy the main workspace when the task requires them.

---

# 72. MOBILE UI

Mobile must be a purpose-designed experience, not a shrunken desktop.

Bottom navigation should prioritize:

- Home
- Chats
- Projects / Work
- Explore
- Library

Profile and settings remain secondary surfaces.

Use sheets for advanced controls.

---

# 73. AI RESPONSE DESIGN

Avoid giant message bubbles.

Use clean content hierarchy:

```text
BAANZON

Answer...

Sources · 4
Verified

[Artifact]
```

Content is the focus.

---

# 74. AI ACTIVITY

Show genuine activity:

```text
Researching
 ├─ Searching sources
 ├─ Reading documents
 ├─ Comparing evidence
 └─ Verifying findings
```

Do not fake reasoning activity.

---

# 75. TRUST UI

Examples:

- Verified
- Sources · 8
- Evidence available
- Conflicting evidence
- Uncertain

Trust information should be accessible without overwhelming the normal answer.

---

# 76. VOICE UI

Use a distinctive Aurora Orb.

The orb responds subtly to:

- Listening
- Speaking
- Baanzon response
- Interruptions
- Audio state

Avoid unnecessary visual noise.

---

# 77. MOTION

Target:

- Fast UI interactions: 100–180ms
- Standard transitions: 180–280ms
- Complex workspace transitions: 280–450ms

Respect reduced-motion preferences.

---

# 78. ACCESSIBILITY

Target WCAG 2.2 AA.

Support:

- Keyboard navigation
- Screen readers
- Focus management
- Semantic HTML
- Accessible dialogs
- Accessible tables
- Accessible charts
- Font scaling
- High contrast
- Reduced motion
- Voice control

---

# 79. INTERNATIONALIZATION

Architecture must support at least:

English, Tamil, Malay, Hindi, Mandarin Chinese, Arabic, Spanish, French, German, Japanese, Korean, Portuguese, Bengali, Urdu, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Vietnamese, Thai, Indonesian, Turkish, Italian, Dutch, Polish, Ukrainian, Russian, Persian/Farsi, Nepali, Sinhala, Assamese, Odia, Burmese, Khmer, Lao, Filipino/Tagalog, Swahili, Hebrew, Greek, Czech, Romanian, Hungarian, Swedish, Danish, Norwegian, Finnish, Slovak, Bulgarian, Serbian, Croatian, Slovenian, Lithuanian, Latvian, and Estonian.

The architecture must allow additional languages without application rewrites.

---

# 80. MULTILINGUAL INTELLIGENCE

Language support is not limited to UI translation.

Support:

- Multilingual chat
- Cross-language reasoning
- Translation
- Multilingual documents
- OCR
- Voice
- Video transcription
- Subtitles
- Search
- RAG
- Memory
- Artifacts
- Mixed-language conversations
- Transliteration
- Regional variants

Examples include:

- Tanglish
- Manglish
- Hinglish
- Arabizi
- Code-switching

Do not automatically translate everything into English internally.

---

# 81. RTL

Design-system-level RTL support is mandatory for:

- Arabic
- Urdu
- Persian
- Hebrew
- Future RTL languages

---

# 82. RESPONSIVE BREAKPOINTS

```text
Mobile:      <640px
Tablet:      640–1024px
Desktop:     1024–1440px
Large:       1440–1920px
Ultra-wide:  >1920px
```

---

# 83. PLATFORM STRATEGY

## Phase 1
PWA/Web.

This is the gold-standard reference UX.

## Phase 2
iOS + Android using Expo/React Native.

## Phase 3
Desktop using Tauri 2 + Rust:

- Windows
- macOS Apple Silicon
- macOS Intel
- Linux

Do not make mobile a simple WebView.

Do not make desktop merely a wrapped browser experience.

---

# 84. RECOMMENDED TECH STACK

## Frontend

- Next.js 16
- React
- TypeScript
- Tailwind CSS
- Radix/shadcn-style primitives
- Zustand
- TanStack Query
- Zod
- React Hook Form
- Tiptap
- Monaco
- Apache ECharts

## Backend

- Node.js
- TypeScript
- Modular monolith initially

## AI workers

- Python

## Data

- PostgreSQL 18
- pgvector
- Redis
- S3-compatible object storage

## Native

- Tauri 2
- Rust

## Mobile

- Expo
- React Native
- TypeScript
- New Architecture

## Infrastructure

- Docker
- Terraform
- GitHub Actions
- OpenTelemetry

## Testing

- Vitest
- Playwright
- React Native testing
- Pytest
- AI evaluation suite

## Monorepo

- pnpm
- Turborepo

---

# 85. ARCHITECTURE STYLE

Start with:

**Modular monolith + workers**

Do not begin with dozens of microservices.

Split services only when required by:

- Scale
- Ownership
- Deployment isolation
- Security isolation
- Reliability
- Performance

---

# 86. MONOREPO

```text
baanzon/
├── apps/
│   ├── web/
│   ├── desktop/
│   ├── mobile/
│   └── admin/
├── services/
│   ├── api/
│   ├── orchestrator/
│   ├── inference/
│   ├── retrieval/
│   ├── documents/
│   ├── media/
│   ├── voice/
│   ├── agents/
│   ├── workflows/
│   ├── notifications/
│   └── billing/
├── packages/
│   ├── ui/
│   ├── design-system/
│   ├── auth/
│   ├── chat/
│   ├── models/
│   ├── agents/
│   ├── tools/
│   ├── memory/
│   ├── files/
│   ├── artifacts/
│   ├── search/
│   ├── realtime/
│   ├── telemetry/
│   ├── permissions/
│   ├── schemas/
│   └── config/
├── workers/
│   ├── document-worker/
│   ├── embedding-worker/
│   ├── research-worker/
│   ├── data-worker/
│   ├── media-worker/
│   └── automation-worker/
├── native/
│   └── rust/
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   ├── kubernetes/
│   └── monitoring/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── agents/
│   ├── security/
│   ├── database/
│   └── product/
└── scripts/
```

---

# 87. WEB ROUTES

```text
/
 /login
 /signup
 /chat
 /chat/[conversationId]
 /projects
 /projects/[projectId]
 /projects/[projectId]/chat
 /projects/[projectId]/files
 /projects/[projectId]/artifacts
 /projects/[projectId]/research
 /agents
 /agents/[agentId]
 /agents/create
 /research
 /canvas
 /files
 /artifacts
 /automations
 /tasks
 /settings
 /settings/account
 /settings/privacy
 /settings/memory
 /settings/models
 /settings/agents
 /settings/connectors
 /settings/security
```

---

# 88. FRONTEND COMPONENT ARCHITECTURE

```text
AppShell
├── Sidebar
│   ├── NewChat
│   ├── Search
│   ├── ConversationList
│   ├── Projects
│   ├── Agents
│   ├── Files
│   ├── Artifacts
│   └── Settings
├── MainWorkspace
│   ├── ChatHeader
│   ├── Conversation
│   │   ├── UserMessage
│   │   └── AssistantMessage
│   │       ├── Text
│   │       ├── Citations
│   │       ├── ToolActivity
│   │       ├── AgentActivity
│   │       ├── Artifacts
│   │       └── Sources
│   └── Composer
└── DynamicWorkspace
    ├── Canvas
    ├── Research
    ├── Code
    ├── Data
    └── Artifact
```

---

# 89. DESIGN SYSTEM PACKAGE

Create reusable primitives:

- Button
- Input
- Textarea
- Select
- Dropdown
- Dialog
- Sheet
- Tooltip
- Tabs
- Popover
- Toast
- Badge
- Card
- Avatar
- Table
- CodeBlock
- Citation
- SourceCard
- ArtifactCard
- AgentActivity
- TrustIndicator
- Composer
- Message
- Workspace
- CommandPalette

All clients should share design tokens and component contracts where practical.

---

# 90. API FOUNDATION

Version APIs:

```text
/api/v1/auth
/api/v1/chat
/api/v1/conversations
/api/v1/messages
/api/v1/models
/api/v1/agents
/api/v1/runs
/api/v1/files
/api/v1/projects
/api/v1/research
/api/v1/artifacts
/api/v1/workflows
/api/v1/automations
/api/v1/connectors
/api/v1/memory
/api/v1/search
/api/v1/voice
```

Use OpenAPI as the API contract.

---

# 91. VERSIONING

Version:

- Models
- Agents
- Agent prompts
- Tools
- APIs
- Database schemas
- Artifacts
- Projects
- Documents
- Workflows

Provide rollback where practical.

---

# 92. FEATURE FLAGS

Major features must be remotely controllable.

Support:

- User-level rollout
- Organization-level rollout
- Cohorts
- Canary rollout
- Kill switch

---

# 93. RELEASE STRATEGY

```text
Development
 ↓
Internal
 ↓
Alpha
 ↓
Beta
 ↓
Production
```

Use:

- Feature flags
- Canary deployment
- Staged rollout
- Migration checks
- Rollback

---

# 94. TESTING PYRAMID

```text
Unit
 ↓
Integration
 ↓
API
 ↓
Component
 ↓
E2E
 ↓
AI Evaluation
 ↓
Load / Stress
 ↓
Security
```

Critical user journeys require automated E2E tests.

---

# 95. BACKUP / DISASTER RECOVERY

Implement:

- Automated database backups
- Object-storage backups
- Replication where required
- Restore testing
- Deleted-item recovery
- Version recovery
- Disaster recovery procedures

Define:

- RPO
- RTO

before production scale.

---

# 96. GRACEFUL DEGRADATION

Examples:

Primary model unavailable:
→ fallback model.

Search unavailable:
→ normal model response with transparency.

Image generation unavailable:
→ preserve task and prompt.

Connector unavailable:
→ continue with available context.

Worker failure:
→ checkpoint and resume.

---

# 97. AI COST GOVERNOR

Every significant task receives:

- Token budget
- Time budget
- Tool-call budget
- Agent budget
- Monetary budget

When exceeded:

```text
PAUSE
 ↓
EXPLAIN
 ↓
SIMPLIFY / REQUEST APPROVAL
```

Never allow accidental runaway agent execution.

---

# 98. PERSONALIZATION

Support:

- Custom instructions
- Response length
- Tone
- Language
- Model preference
- Agent preference
- Voice preference
- Memory settings
- Theme
- Accessibility preferences

---

# 99. RESPONSE FORMAT INTELLIGENCE

Baanzon should choose the most useful output format.

Examples:

Question → Answer

Comparison → Table

Data → Chart

Process → Steps

Research → Report

Code → Code block

Decision → Recommendation matrix

Complex task → Artifact

Multiple findings → Structured summary

---

# 100. UNIVERSAL CONTINUITY

A user should be able to:

- Start on web
- Continue on mobile
- Continue on desktop

The same work state should remain available across devices subject to permissions.

---

# 101. UNIVERSAL CLIPBOARD

Handle:

- Pasted text
- Screenshots
- Tables
- URLs
- Images
- Files

The system should understand pasted content automatically.

---

# 102. DRAG AND DROP

Support movement between:

- Chat
- Projects
- Files
- Canvas
- Artifacts
- Research
- Composer

---

# 103. UNDO / REDO

Where practical:

- Artifact edits
- Canvas edits
- File operations
- AI edits
- Project changes
- Workflow editing

Never destroy user work unnecessarily.

---

# 104. COMPARE MODE

Support comparison of:

- Answers
- Models
- Documents
- Artifact versions
- Images
- Research findings
- Source evidence

---

# 105. BRAND PERSONALITY

Baanzon should feel:

- Confident
- Concise
- Intelligent
- Human
- Calm
- Helpful

Avoid exaggerated AI enthusiasm.

The AI should communicate uncertainty clearly without sounding evasive.

---

# 106. AI TRANSPARENCY

For complex tasks provide:

- Execution summary
- Sources
- Tools used
- Artifacts created
- Verification performed
- Uncertainties
- Completion status

Do not expose private chain-of-thought.

---

# 107. REPOSITORY CONTROL FILES

Create at repository root:

- `AGENTS.md`
- `CLAUDE.md`
- `CODEX.md`
- `README.md`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
- `SECURITY.md`

`CODEX.md` here is an **AI coding-assistant instruction file only**. It does not mean Baanzon Chat is a Codex product.

All instruction files should reference the authoritative architecture.

---

# 108. AI CODING ASSISTANT RULES

1. Read architecture before coding.
2. Never invent backend APIs.
3. Never expose secrets.
4. Never bypass security controls.
5. Never disable type checking to pass tests.
6. Write tests for new functionality.
7. Preserve stable interfaces.
8. Prefer shared packages.
9. Keep modules focused.
10. Avoid unnecessary dependencies.
11. Run lint/typecheck/tests before completion.
12. Update documentation when architecture changes.
13. Never claim completion without testing.
14. Never silently change database schema.
15. Use migrations for schema changes.
16. Preserve accessibility.
17. Preserve performance budgets.
18. Do not introduce Codex-style product positioning.
19. Do not expose internal agent complexity unnecessarily.
20. Do not fabricate implementation status.

---

# 109. DEFINITION OF DONE

A feature is not complete until:

- Requirements implemented
- Types pass
- Lint passes
- Unit tests pass
- Integration tests pass where applicable
- E2E tests pass where applicable
- Accessibility checked
- Security implications reviewed
- Performance considered
- Error states handled
- Loading states handled
- Empty states handled
- Offline/reconnect behavior considered
- Telemetry added where appropriate
- Documentation updated
- Migration created if needed
- AI evaluation added for AI behavior
- No known critical regression

---

# 110. PHASED IMPLEMENTATION

## Phase 0 — Foundation

- Monorepo
- CI/CD
- TypeScript
- Python worker setup
- Design tokens
- Design system
- Database
- Authentication
- API foundation
- Model Gateway
- Event system
- Observability
- Security foundation

## Phase 1 — Core Chat

- Chat UI
- Conversations
- Streaming
- Universal Composer
- Model selection
- History
- Search
- Files
- Basic multimodal

## Phase 2 — Intelligence

- Intent router
- Orchestrator
- Agent registry
- Main agents
- Specialist agents
- Context Engine
- Trust Engine
- Model routing

## Phase 3 — Knowledge

- Memory
- RAG
- Knowledge bases
- Document processing
- Search
- Citations

## Phase 4 — Work

- Projects
- Research
- Canvas
- Artifacts
- Data Lab
- Work engine

## Phase 5 — Creation

- Universal Creation Engine
- Document generation
- Spreadsheet generation
- Presentation generation
- Image generation/editing
- Validation
- Rendering
- Auto-repair

## Phase 6 — Realtime

- Voice
- Audio
- Video
- Realtime collaboration
- Notifications
- Activity Center

## Phase 7 — Action

- Tools
- Connectors
- Automation
- Workflows
- Browser/computer capabilities

## Phase 8 — Platform

- Billing
- Admin
- Enterprise
- Developer API
- Marketplace later

## Phase 9 — Clients

- PWA production
- iOS
- Android
- Windows
- macOS Intel
- macOS Apple Silicon
- Linux

---

# 111. MVP PRIORITY

P0:

- Authentication
- Chat
- Streaming
- Model Gateway
- Universal Composer
- Files
- Core multimodal
- Search
- Basic agents
- Orchestrator
- Trust
- Projects
- Artifacts
- Universal Creation
- Validation
- Performance
- Security

P1:

- Deep Research
- Memory
- RAG
- Voice
- Canvas
- Data Lab
- Automation
- Connectors

P2:

- Browser/computer
- Collaboration expansion
- Developer API
- Marketplace
- Enterprise expansion

---

# 112. WHAT NOT TO BUILD

Do not turn Baanzon into:

- A Codex clone
- A coding-only assistant
- A collection of visible agents
- A generic chatbot wrapper
- A UI clone of ChatGPT
- A UI clone of Claude
- A microservice maze
- An uncontrolled autonomous system
- A feature-heavy interface with poor performance
- A dashboard-first home screen
- A card-grid-heavy visual system
- A clone of the approved Baanzon visual from another product

---

# 113. PRODUCT NORTH STAR

Baanzon should allow a user to say:

> “Research this company, analyze these files, compare competitors, create the financial model, make the presentation, and give me your recommendation.”

And Baanzon should be able to:

1. Understand the request.
2. Plan the work.
3. Retrieve relevant information.
4. Delegate internally.
5. Analyze files.
6. Use appropriate tools.
7. Verify important claims.
8. Create artifacts.
9. Validate those artifacts.
10. Repair failures where possible.
11. Present the result clearly.
12. Allow the user to inspect and control the work.

The user should not have to manually coordinate the underlying intelligence.

---

# 114. FINAL ARCHITECTURE

```text
                         BAANZON CHAT
                              │
              ┌───────────────┴────────────────┐
              │                                │
         EXPERIENCE                       INTELLIGENCE
              │                                │
      ┌───────┼────────┐             ┌─────────┼─────────┐
      │       │        │             │         │         │
    Chat    Voice   Multimodal     Models   Agents    Trust
      │       │        │             │         │         │
      └───────┴────────┘             └─────────┼─────────┘
                                               │
                                         ORCHESTRATOR
                                               │
                     ┌─────────────────────────┼────────────────────┐
                     │                         │                    │
                  Context                   Memory              Knowledge
                     │                         │                    │
                     └─────────────────────────┼────────────────────┘
                                               │
                                         TOOL LAYER
                                               │
                  ┌──────────┬──────────┬──────┼──────┬──────────┐
                  │          │          │      │      │          │
                Search     Files      Code   Data   Browser   Connectors
                  │          │          │      │      │          │
                  └──────────┴──────────┴──────┼──────┴──────────┘
                                               │
                                          WORK ENGINE
                                               │
                  ┌──────────┬──────────┬─────┼─────┬──────────┐
                  │          │          │           │          │
               Research   Projects   Canvas     Artifacts  Workflows
                  │          │          │           │          │
                  └──────────┴──────────┴───────────┴──────────┘
                                               │
                                        PLATFORM CORE
                                               │
              ┌────────┬────────┬────────┬─────┼─────┬────────┐
              │        │        │        │           │        │
            Auth    Security  Privacy  Billing   Admin   Analytics
```

---

# 115. FINAL PRINCIPLE

> **Baanzon Chat must optimize for the user's outcome, not the AI's activity.**

The interface must follow the locked visual philosophy:

> **Quiet surface. Powerful intelligence. Contextual complexity.**

The user does not care that multiple agents ran.

They care that:

- The answer is useful.
- The research is credible.
- The sources are traceable.
- The file opens.
- The presentation looks excellent.
- The spreadsheet calculates correctly.
- The image is usable.
- The task finishes.
- Nothing gets lost.
- Their data remains protected.

## FINAL PRODUCT STATEMENT

**Baanzon Chat is a unified, premium, multilingual, multimodal AI workspace that understands requests, reasons across context, uses models and specialist intelligence, researches, creates, verifies, and acts—while keeping complexity behind a fast, elegant interface.**

**Baanzon Chat is not Codex. Coding is simply one capability within Baanzon.**

**Build the outcome. Verify the result. Protect the user. Keep the experience effortless.**


---

# 116. VERSION 2.0 LOCK RECORD

**Locked:** 2026-09-08

**Locked item:** Baanzon Aurora Pearl master UI direction and home experience.

**Reference:** Approved Baanzon home UI visual generated on 2026-09-08.

**Decision:** The single-interface Baanzon home experience is now the authoritative visual direction for implementation. The earlier multi-device/dashboard showcase is not the implementation reference.

**Design north star:**

> **Make Baanzon feel inevitable: simple to enter, beautiful to use, powerful when needed, and unmistakably its own product.**

Any future visual change must explicitly supersede this lock in a newer blueprint version.
