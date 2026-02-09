# ChronosOps - Self-Regenerating Autonomous Incident Response Platform

> Multi-Modal Autonomous Agent for Closed-Loop Incident Response and Self-Regenerating Applications

**Target**: Gemini 3 Hackathon "Marathon Agent" Track

## Problem

Production incidents (outages, security events, SLA breaches) cause teams to lose hours coordinating logs, dashboards, timelines, and Slack threads. Humans are slow under stress and tools are fragmented.

**ChronosOps** implements two interconnected OODA Loops (Observe-Orient-Decide-Act) using Gemini's multimodal capabilities:

### Investigation OODA Loop
- Watch dashboard video feeds
- Correlate logs and metrics
- Execute Kubernetes remediations (rollback, restart, scale)
- Generate postmortems

### Development OODA Loop
- Generate applications from natural language requirements
- Build and deploy to Kubernetes automatically
- Evolve code with AI-powered modifications
- Version control with Git integration

All autonomously.

## Features

### Core Investigation Engine
- **OBSERVING**: Collects video frames, logs, metrics, K8s events
- **ORIENTING**: Correlates signals, builds incident timeline
- **DECIDING**: Generates and tests hypotheses with dynamic thinking
- **ACTING**: Executes K8s remediations with safety guards
- **VERIFYING**: Confirms fix via visual re-analysis

### Self-Regenerating Development Engine
- **ANALYZING**: Parse natural language requirements via Gemini
- **DESIGNING**: Generate architecture with components
- **CODING**: Generate TypeScript backend + React frontend
- **TESTING**: Run Vitest tests, validate code
- **BUILDING**: Docker image building with multi-stage builds
- **DEPLOYING**: K8s deployment with health checks
- **VERIFYING**: Verify deployment health and functionality

### Code Evolution (Regenerative Code)
- **Edit Locking**: Pessimistic locking with 30-min timeout and heartbeat
- **AI Evolution**: Request code changes via natural language prompts
- **Version History**: Full version tracking for all generated files
- **Git Integration**: Local git + GitHub integration for versioning
- **Auto-Revert**: Automatic rollback on deployment failure
- **Auto-Approve Mode**: Configurable autonomous approval for incident-triggered fixes

### Self-Healing Ecosystem Integration
The Development and Investigation OODA loops are fully integrated to create an autonomous self-healing system:

- **Automatic Monitoring Setup**: Deployed apps auto-register with Prometheus and VisionService
- **Server-Side Dashboard Rendering**: VisionService renders dashboards using @napi-rs/canvas + MJPEG streaming
- **Multi-App Command Center**: Unified dashboard showing all monitored applications with live metrics
- **Hybrid Anomaly Detection**: Combines Prometheus metrics (15s polling, fast/precise) with Gemini Vision (30s polling, context-rich)
- **Escalating Remediation Pipeline**:
  1. **Rollback** (~10s, very low risk) - Revert to previous version
  2. **Restart** (~30s, low risk) - Rolling restart of pods
  3. **Scale** (~1min, low risk) - Adjust replica counts
  4. **Code Fix** (~5-15min, medium risk) - Trigger AI-powered code evolution
- **Incident-Triggered Code Evolution**: When operational fixes fail, automatically triggers code evolution to fix root cause
- **End-to-End Audit Trail**: Complete visibility from anomaly detection through code fix deployment

### Gemini 3 Integration
- **Spatial-Temporal Video Analysis**: Analyze dashboard recordings with temporal context
- **1M Token Context Window**: Load complete incident context without RAG chunking
- **Dynamic Thinking Escalation**: Adjust reasoning depth based on evidence confidence
- **Tool Use / Function Calling**: Real-time K8s cluster queries during investigation
- **Response Schema Validation**: Guaranteed structured output
- **Thought Signature Continuity**: Maintain reasoning state across investigation phases
- **Code Generation**: Generate TypeScript/React applications from requirements
- **Evolution Analysis**: Analyze code changes and generate improvements

### Kubernetes Actions
- **Rollback**: Revert deployments to previous versions
- **Restart**: Rolling restart of pods
- **Scale**: Adjust replica counts
- **Code Fix**: Trigger code evolution for root cause fixes
- **Deploy**: Deploy generated applications
- **Cooldown Management**: Rate limiting to prevent action storms

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+
- Gemini API key
- Docker (for demo stack)
- Kubernetes cluster (optional, for real deployments)



### Enable Kubernetes in Docker Desktop
1. Open Docker Desktop -> Click the Whale icon in system tray
2. Go to Settings ( ⚙️ Gear icon located on top navigation)
3. Click Kubernetes in the left sidebar
4. Check "Enable Kubernetes"
5. Click "Apply"
6. Click "Install" to install the cluster (docker-desktop, kubeadm)

Wait for 3-5 minutes for cluster to start, then create the following namespaces:
```
kubectl create namespace demo
kubectl create namespace development
```

### Installation

```bash
# Clone the repository
git clone https://github.com/broadcomms/chronosops-dev.git
cd chronosops-dev

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Add your Gemini API key to .env
echo "GEMINI_API_KEY=your_key_here" >> .env

# Start Prometheus for metrics (optional, for in-cluster monitoring on port 30090)
cd demo
docker compose up -d
cd .. 

# Create Data default directory
mkdir data

# Build all packages
pnpm build

# Start development servers
pnpm dev
```

### Web UI
Access the UI: http://localhost:5174/




### API Server

The API runs on port 3000, Web UI on port 5173.

```bash
# Health check
curl http://localhost:3000/health

# Services status
curl http://localhost:3000/services/status

# Create an incident
curl -X POST http://localhost:3000/api/v1/incidents \
  -H "Content-Type: application/json" \
  -d '{"title":"High CPU Usage","severity":"high","namespace":"demo"}'

# Start investigation
curl -X POST http://localhost:3000/api/v1/incidents/{id}/investigate

# Create a development cycle
curl -X POST http://localhost:3000/api/v1/development \
  -H "Content-Type: application/json" \
  -d '{"requirement":"Create a REST API for task management","serviceType":"backend"}'

# Start development
curl -X POST http://localhost:3000/api/v1/development/{id}/start
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ChronosOps Self-Healing Architecture                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   Web UI    │◄──►│  API Server │◄──►│   Gemini    │                 │
│  │  :5173      │    │   :3000     │    │    API      │                 │
│  └─────────────┘    └──────┬──────┘    └─────────────┘                 │
│        ▲                   │                                            │
│        │ MJPEG     ┌───────┴───────────────────────┐                   │
│        │ Stream    ▼                               ▼                   │
│  ┌─────┴───────┐  ┌─────────────┐           ┌─────────────┐            │
│  │VisionService│  │  WebSocket  │           │ Kubernetes  │            │
│  │(Dashboard   │  │    /ws      │           │   Cluster   │            │
│  │ Rendering)  │  └─────────────┘           └─────────────┘            │
│  └──────┬──────┘                                   ▲                   │
│         │                                          │ Deploy             │
│         │◄────────────────────┐                    │                   │
│  ┌──────▼──────┐              │              ┌─────┴──────┐            │
│  │ Prometheus  │◄─────────────┼──────────────│ Generated  │            │
│  │   :30090    │              │              │   Apps     │            │
│  └──────┬──────┘              │              │ (/metrics) │            │
│         │                     │              └────────────┘            │
│  ┌──────▼──────────────────┐  │                    ▲                   │
│  │ HybridAnomalyDetector   │  │                    │                   │
│  │ (Prometheus 15s +       │  │                    │ Code Fix          │
│  │  Gemini Vision 30s)     │  │                    │                   │
│  └──────────┬──────────────┘  │                    │                   │
│             │                 │                    │                   │
│  SELF-HEALING LOOP:           │                    │                   │
│  ┌──────────▼───────────────┐ │                    │                   │
│  │  Anomaly → Incident →    │ │                    │                   │
│  │  Escalate (rollback →    ├─┼────────────────────┘                   │
│  │  restart → scale →       │ │                                        │
│  │  code evolution)         │ │                                        │
│  └──────────────────────────┘ │                                        │
│                               │                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
packages/
├── core/        # OODA state machines, orchestrators, code generation, build pipeline
│   ├── detection/     # HybridAnomalyDetector, PrometheusClient, DetectionStateManager
│   ├── monitoring/    # MonitoringConfigService (auto-registration)
│   └── vision/        # VisionService wrapper
├── gemini/      # Gemini API client, prompts, schemas, tools
├── video/       # FFmpeg frame extraction
├── vision/      # Server-side dashboard rendering + streaming
│   ├── chart/         # Line charts, gauges, status indicators (@napi-rs/canvas)
│   ├── compositor/    # Frame composition, AI annotations
│   ├── stream/        # MJPEG streaming, frame buffer
│   └── recording/     # Video recording for evidence
├── kubernetes/  # K8s client (rollback, restart, scale, deploy)
├── database/    # SQLite + Drizzle ORM (incidents, development, evolutions)
├── git/         # Git integration (local + GitHub)
├── grafana/     # Grafana dashboard templates (optional/legacy)
├── shared/      # Logger, errors, types, config
apps/
├── api/         # Fastify REST API + WebSocket + Vision routes (port 3000)
└── web/         # React + Vite + Tailwind UI (port 5173)
demo/
├── demo-app/        # NexusCart demo with toggleable bugs
└── prometheus/      # Prometheus configuration (auto-generated by MonitoringConfigService)
```

### OODA State Machines

**Investigation Loop:**
```
IDLE → OBSERVING → ORIENTING → DECIDING → ACTING → VERIFYING → DONE
                                                              ↓
                                                           FAILED
```

**Development Loop:**
```
IDLE → ANALYZING → DESIGNING → CODING → TESTING → BUILDING → DEPLOYING → VERIFYING → COMPLETED
                                                                                    ↓
                                                                                 FAILED
```


## Gemini Models

| Model | Use Case |
|-------|----------|
| `gemini-3-flash-preview` | Primary model for most operations |
| `gemini-3-pro-preview` | Complex reasoning with extended thinking |
| `gemini-3-pro-image-preview` | Gemini image model for architecture diagram |

### Thinking Budget Levels

| Level | Tokens | Use Case |
|-------|--------|----------|
| LOW | 1,024 | Quick decisions with high confidence |
| MEDIUM | 8,192 | Balanced analysis (default) |
| HIGH | 24,576 | Deep reasoning for complex issues |

## Development

### Commands

```bash
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm test:watch     # Watch mode tests
pnpm lint           # Lint all packages
pnpm typecheck      # Type-check all packages
pnpm clean          # Remove node_modules & dist everywhere
pnpm dev                              # Start API + web concurrently
pnpm --filter=@chronosops/api dev     # Run specific package
```

### Running Tests

```bash
pnpm test                  # All tests
pnpm test:unit             # Unit tests only
pnpm test:e2e              # E2E tests (Playwright)
pnpm test:coverage         # With coverage report
```

## API Reference

### Investigation Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/incidents` | List incidents |
| POST | `/api/v1/incidents` | Create incident |
| GET | `/api/v1/incidents/:id` | Get incident |
| POST | `/api/v1/incidents/:id/investigate` | Start investigation |
| GET | `/api/v1/incidents/:id/investigation` | Check status |
| GET | `/api/v1/incidents/:id/evidence` | Get evidence |
| GET | `/api/v1/incidents/:id/hypotheses` | Get hypotheses |
| GET | `/api/v1/incidents/:id/actions` | Get actions |
| GET | `/api/v1/incidents/:id/timeline` | Get timeline |
| GET | `/api/v1/incidents/:id/postmortem` | Get postmortem |
| POST | `/api/v1/incidents/:id/resolve` | Resolve incident |
| DELETE | `/api/v1/incidents/:id` | Delete incident |

### Development Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/development` | List development cycles |
| POST | `/api/v1/development` | Create development cycle |
| GET | `/api/v1/development/:id` | Get cycle details |
| POST | `/api/v1/development/:id/start` | Start development |
| POST | `/api/v1/development/:id/cancel` | Cancel cycle |
| GET | `/api/v1/development/:id/files` | Get generated files |
| DELETE | `/api/v1/development/:id` | Delete cycle |

### Edit Lock Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/development/:id/lock` | Check lock status |
| POST | `/api/v1/development/:id/lock` | Acquire lock |
| POST | `/api/v1/development/:id/lock/:lockId/heartbeat` | Extend lock |
| DELETE | `/api/v1/development/:id/lock/:lockId` | Release lock |

### Evolution Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/development/:id/evolutions` | List evolutions |
| POST | `/api/v1/development/:id/evolutions` | Request evolution |
| POST | `/api/v1/development/:id/evolutions/:evoId/analyze` | Analyze |
| POST | `/api/v1/development/:id/evolutions/:evoId/generate` | Generate changes |
| POST | `/api/v1/development/:id/evolutions/:evoId/approve` | Approve |
| POST | `/api/v1/development/:id/evolutions/:evoId/apply` | Apply changes |
| POST | `/api/v1/development/:id/evolutions/:evoId/revert` | Revert |

### WebSocket Events

Connect to `/ws` for real-time updates:

- `phase:changed` - OODA phase transitions
- `evidence_collected` - New evidence added
- `hypothesis_generated` - Hypothesis created
- `action_executed` - K8s action completed
- `verification_completed` - Fix verification result
- `development:phase_changed` - Development phase transitions
- `development:deleted` - Development cycle deleted

## Frontend Pages

| Page | Description |
|------|-------------|
| Command Center | Main dashboard with live feed, AI activity, system health |
| Investigation View | Full incident investigation with video, timeline, AI reasoning |
| Incident List | List and filter incidents by status/severity |
| Postmortem | View auto-generated incident postmortems |
| History | Historical incident records |
| Development Dashboard | Overview of development cycles |
| Development Detail | Cycle view with Monaco editor, build logs, deployment |
| Intelligence Platform | Pattern learning, reconstruction details |
| Setup | Configure Kubernetes namespaces, monitored apps |

## Step-by-Step Setup

### Step 1: Prerequisites

```bash
# Verify Node.js 20+
node -v

# Install pnpm if not present
npm install -g pnpm

# Verify kubectl (for K8s features)
kubectl version --client
```

### Step 2: Install Dependencies

```bash
# Clone and install
git clone https://github.com/broadcomms/chronosops-dev.git
cd chronosops-dev
pnpm install

# Configure environment
cp .env.example .env
# Add your GEMINI_API_KEY to .env
```

### Step 3: Start Prometheus (for metrics)

```bash
cd demo
docker compose up -d
```

This starts **Prometheus** at http://localhost:30090

### Step 4: Start ChronosOps

```bash
# In project root
pnpm dev
```

This starts:
- **API Server** at http://localhost:3000 (includes VisionService MJPEG streaming)
- **Web UI** at http://localhost:5173

### Step 5: Start Kubernetes Cluster (for real deployments)

```bash
# Using Minikube
minikube start

# Apply ChronosOps namespace
kubectl apply -f k8s/namespace.yaml

# Apply monitoring namespace (for Prometheus in-cluster)
kubectl apply -f k8s/monitoring/
```

### Step 6: Verify All Services

```bash
# API health
curl http://localhost:3000/api/v1/health

# Prometheus (local)
curl http://localhost:30090/-/healthy

# Vision stream (MJPEG)
curl -I http://localhost:3000/api/v1/vision/stream

# K8s connection
kubectl get namespaces
```

### Step 7: Access Web UI

Open http://localhost:5173 and:
1. Navigate to **Setup** to configure Kubernetes context and namespaces
2. Navigate to **Development Dashboard** to create your first application
3. Use **Command Center** to monitor deployed applications

## Database Schema

### Investigation Tables
- `incidents` - Incident records with OODA state tracking
- `evidence` - Multi-source evidence (video_frame, log, metric, k8s_event)
- `hypotheses` - Generated hypotheses with confidence scores
- `actions` - Executed remediation actions
- `thought_states` - Gemini thinking signatures
- `postmortems` - Auto-generated incident postmortems
- `timeline_events` - OODA phase timeline

### Development Tables
- `development_cycles` - Development cycle tracking with phases
- `generated_files` - Generated code files with validation status
- `service_registry` - Multi-service architecture registry

### Regenerative Code Tables
- `file_versions` - Version history for all generated files
- `edit_locks` - Pessimistic locking with heartbeat tracking
- `code_evolutions` - AI evolution requests with status tracking
- `git_repositories` - Per-cycle git repo metadata

### Configuration Tables
- `configs` - System configuration (kubernetes, dashboard, safety)
- `monitored_apps` - Applications being monitored

### Intelligence Tables
- `learned_patterns` - Patterns learned from resolved incidents
- `reconstructed_incidents` - Reconstructed past incidents

## License

MIT

---

Built for the Gemini 3 Hackathon "Marathon Agent" Track
