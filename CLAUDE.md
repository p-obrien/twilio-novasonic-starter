# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a production-ready real-time bridge service connecting Twilio Voice calls to AWS Bedrock Nova Sonic for AI-powered voice conversations. The system handles bidirectional audio streaming with ultra-low latency (<200ms), supporting concurrent voice sessions with advanced features like knowledge base integration and intelligent agents.

**Key Technologies**: Node.js 22+, TypeScript, AWS Bedrock Runtime, Twilio Media Streams, RxJS, OpenTofu/Terraform

## Common Development Commands

### Backend Application (`backend/twilio-bedrock-bridge`)

```bash
# Build TypeScript to JavaScript
npm run build

# Start production server (requires build first)
npm start

# Development mode with debug logging (no X-Ray, verbose logs)
npm run start:dev

# Watch mode for development (auto-rebuild on file changes)
npm run dev

# Run full test suite
npm test

# Run tests with coverage report (threshold: 90% lines, 85% branches)
npm run test:coverage

# Run tests in watch mode for development
npm run test:watch

# Clean build artifacts
npm run clean

# Run specific test file
npm test -- WebhookHandler

# Run only integration tests
npm test -- --testPathPattern=integration

# Run only unit tests
npm test -- --testPathPattern=unit
```

### Infrastructure (`infrastructure/`)

```bash
# Bootstrap infrastructure (first-time setup for state backend)
cd infrastructure/bootstrap
tofu init
tofu apply

# Deploy to development environment
cd infrastructure/environments/dev
tofu init
tofu plan   # Review changes
tofu apply

# Deploy to production
cd infrastructure/environments/prod
tofu init
tofu plan
tofu apply

# Get service URL after deployment
tofu output service_url

# Get knowledge base bucket name
tofu output -raw knowledge_base_s3_documents_bucket_name

# Destroy infrastructure (careful!)
tofu destroy
```

### Docker Development

```bash
# Build container image
docker build -t twilio-bedrock-bridge backend/twilio-bedrock-bridge

# Run container locally
docker run -p 8080:8080 \
  -e TWILIO_AUTH_TOKEN=your_token \
  -e AWS_REGION=us-east-1 \
  twilio-bedrock-bridge

# Build and push to ECR (production deployment)
./scripts/build-and-push.sh
```

## High-Level Architecture

### Core System Design

The service implements a **bidirectional streaming event-driven architecture** that bridges Twilio WebSocket Media Streams with AWS Bedrock Nova Sonic's bidirectional streaming API.

**Critical Flow**: `Twilio Webhook → WebSocket Connection → Session Creation → Audio Processing → Bedrock Stream → Response Processing → Audio Output`

### Key Architectural Patterns

1. **Event-Driven Processing**: RxJS observables manage asynchronous event flows between Twilio and Bedrock
2. **Adapter Pattern**: Audio format conversion between Twilio's μ-law (8kHz) and Bedrock's PCM16LE (16kHz)
3. **Session-Based State Management**: Each call maintains isolated session state with dedicated Bedrock stream
4. **Resource Pool Pattern**: Buffer pooling for efficient memory management during high-frequency audio processing
5. **Correlation Context Tracking**: AsyncLocalStorage threads correlation IDs across async boundaries for distributed tracing
6. **Agent-Based Orchestration**: Bedrock Agents autonomously handle KB retrieval and multi-step reasoning

### Agent-Based Knowledge Base Architecture

**IMPORTANT**: The system uses **autonomous agent-based KB access** instead of manual KB queries.

**Architecture Overview**:
```
User Query → AgentCoreClient.invokeAgent() → Bedrock Agent
                                                ↓
                                    [Agent autonomously retrieves from KB]
                                                ↓
                                    Integrated response with KB data + reasoning
```

**Key Components**:
- **Infrastructure**: Agent configured with KB associations ([infrastructure/modules/bedrock-agent/main.tf](infrastructure/modules/bedrock-agent/main.tf#L161-L171))
- **IAM Permissions**: Agent has `bedrock:Retrieve` access ([infrastructure/modules/bedrock-agent/main.tf](infrastructure/modules/bedrock-agent/main.tf#L54-L71))
- **Application**: `AgentCoreClient` ([src/agent/AgentCoreClient.ts](backend/twilio-bedrock-bridge/src/agent/AgentCoreClient.ts)) invokes agent via `InvokeAgent` API

**Benefits of Agent-Based Approach**:
1. **Autonomous Retrieval**: Agent decides when to query KB based on context
2. **Integrated Reasoning**: KB data combined with agent reasoning in responses
3. **Simplified Code**: No manual KB query management needed
4. **Better Context**: Agent maintains conversation context across KB queries
5. **Multi-Step Tasks**: Agent can perform complex multi-step operations with KB access

**Deprecated Approach** (DO NOT USE):
- ❌ `KnowledgeBaseClient` - Direct KB queries (bypasses agent reasoning)
- ❌ `KnowledgeBaseService` - Manual KB query management (adds complexity)
- ❌ Manual `bedrock:Retrieve` calls - Duplicates agent functionality

**Correct Approach** (USE THIS):
```typescript
// Good: Agent handles KB access autonomously
const agentClient = new AgentCoreClient();
const result = await agentClient.invokeAgent(
  agentId,
  agentAliasId,
  userQuery,
  sessionId
);
// Agent automatically retrieves KB info if needed and integrates it into response
```

### Audio Processing Pipeline (Critical Path)

**Inbound** (Twilio → Bedrock):
```
Twilio μ-law @ 8kHz (160 bytes/20ms frame)
  → Base64 decode
  → μ-law to linear PCM conversion
  → Upsampling 8kHz → 16kHz
  → PCM16LE @ 16kHz
  → Immediate transmission to Bedrock (no buffering for low latency)
```

**Outbound** (Bedrock → Twilio):
```
Bedrock PCM16LE @ 16kHz
  → Downsampling 16kHz → 8kHz
  → Linear PCM to μ-law conversion
  → AudioBuffer ring buffer (timing control)
  → Base64 encode
  → Twilio media frames @ 20ms intervals
```

**Design Decision**: Asymmetric buffering - inbound has zero buffering (minimize latency), outbound uses controlled ring buffer (prevent faster-than-realtime Bedrock generation from overwhelming Twilio).

### Session Lifecycle Management

Sessions are managed through multiple layers (`UnifiedSessionManager`, `StreamSession`, `NovaSonicBidirectionalStreamClient`) with complex state coordination:

**Session Creation Flow**:
1. Twilio webhook validates signature, extracts CallSid, registers active session
2. WebSocket connection established, validated against registered CallSid
3. 'start' message received → `createStreamSession()` creates RxJS observables and event queues
4. `initiateSession()` starts Bedrock bidirectional stream
5. Initial events queued in precise order: `sessionStart` → `promptStart` → `systemPrompt` → `audioContentStart`

**Session Termination** (multiple paths):
- Explicit: Twilio 'stop' event or WebSocket close
- Timeout: 5-minute idle timeout (cleanup runs every 60s)
- Force: Memory pressure or error conditions

**Critical**: Event sequencing to Bedrock is strict. Breaking the order causes validation errors.

### Security Architecture (Defense in Depth)

**Layer 1 - Webhook Validation** (`WebhookHandler`):
- HMAC-SHA1 signature verification using `TWILIO_AUTH_TOKEN`
- CallSid extraction and registration in active session registry

**Layer 2 - WebSocket Security** (`WebSocketSecurity`):
- Rate limiting: 10 connections/minute per IP
- CallSid validation on 'start' message (must match registered webhook)
- CallSid format validation (starts with 'CA', length 34)
- Session timeout enforcement

Never bypass either layer - both are required for production security.

### Observability System

**Distributed Tracing**:
- OpenTelemetry integration with AWS X-Ray fallback
- Smart sampling: adaptive rates to avoid tracing every audio frame (would be ~50/second)
- Correlation IDs propagated via AsyncLocalStorage across WebSocket callbacks
- End-to-end request tracing from webhook → WebSocket → Bedrock → response

**Metrics Collection**:
- Audio quality: latency, jitter, packet loss
- Session health: active sessions, success rates, error rates
- System resources: memory usage trends, leak detection
- Business metrics: call volume, conversation quality

**Memory Monitoring**:
- Real-time memory usage tracking with configurable intervals (default 30s)
- Intelligent leak detection with trend analysis
- Automatic garbage collection at 80% threshold
- Health status: healthy/warning/critical with recommendations

## Important Code Locations

### Entry Points
- `backend/twilio-bedrock-bridge/src/server.ts` - Main server, Express setup, graceful shutdown
- `backend/twilio-bedrock-bridge/src/client.ts` - Bedrock Nova Sonic client (55KB, bidirectional stream management)

### Request Handling
- `src/handlers/WebhookHandler.ts` - Twilio webhook validation and TwiML generation
- `src/handlers/WebsocketHandler.ts` - Main WebSocket message routing (400+ lines, handles start/media/stop)

### Agent & Knowledge Base (RECOMMENDED)
- `src/agent/AgentCoreClient.ts` - Bedrock Agent client with autonomous KB access
- `src/agent/index.ts` - Agent module exports

### Audio Processing (Performance-Critical)
- `src/audio/AudioProcessor.ts` - Format conversion (μ-law ↔ PCM16LE, resampling)
- `src/audio/AudioBufferManager.ts` - Singleton managing per-session buffers
- `src/audio/AudioBuffer.ts` - Ring buffer with controlled 20ms frame transmission
- `src/audio/BufferPool.ts` - Object pool to avoid GC pressure from frequent Buffer allocation

### Session & State Management
- `src/session/UnifiedSessionManager.ts` - High-level session API
- `src/session/StreamSession.ts` - Individual session wrapper with Bedrock stream lifecycle
- `src/streaming/StreamProcessor.ts` - Bedrock stream event processing

### Event System
- `src/events/EventDispatcher.ts` - Event normalization and multi-path dispatch (RxJS + handlers)
- Event flow: Bedrock response → normalize → publish to Subject → dispatch to type-specific handlers

### Security & Validation
- `src/security/WebSocketSecurity.ts` - Rate limiting, CallSid validation, session tracking
- `src/security/TwilioSignatureValidator.ts` - HMAC-SHA1 webhook signature verification

### Observability
- `src/observability/safeTracing.ts` - Graceful OpenTelemetry wrapper with fallback
- `src/observability/memoryPressureMonitor.ts` - Memory leak detection and auto-cleanup
- `src/observability/SessionMetrics.ts` - Per-session tracking
- `src/utils/correlationId.ts` - AsyncLocalStorage for correlation context

### Configuration
- `src/config/ConfigurationManager.ts` - Modern config with validation
- `src/config/AppConfig.ts` - Legacy config wrapper (prefer ConfigurationManager)

### Error Handling
- `src/errors/` - Domain-specific error types (SessionError, StreamingError, AudioProcessingError, BedrockServiceError, TwilioValidationError, WebSocketSecurityError)

## Critical Development Guidelines

### Audio Processing Performance

Audio arrives at 50 frames/second (20ms intervals). Any processing delay accumulates and causes noticeable latency.

**Rules**:
1. Never add synchronous processing in the media event handler
2. Use BufferPool for any temporary audio buffers to avoid GC
3. Maintain the asymmetric buffering pattern (no inbound buffering)
4. Test memory usage under sustained load (100+ concurrent sessions)

### Event Sequencing to Bedrock

Bedrock requires events in exact order during session setup:
```typescript
1. sessionStart
2. promptStart
3. systemPrompt (contains the system message)
4. audioContentStart (begins audio stream)
// ... user audio chunks ...
8. audioContentEnd (end user turn)
9. promptEnd (end prompt)
// ... model responds ...
11. sessionEnd (close session)
```

Breaking this order causes validation errors. See `WebsocketHandler.ts:handleStartEvent()` for reference implementation.

### Session State Consistency

SessionData contains RxJS Subjects and event queues that must be synchronized:
- `queue` + `queueSignal`: Events waiting to be sent to Bedrock
- `responseSubject`: Broadcasts Bedrock responses
- `closeSignal`: Triggers stream termination
- State flags: `isPromptStartSent`, `isAudioContentStartSent` prevent duplicate events

Never modify SessionData outside of synchronized methods in `NovaSonicBidirectionalStreamClient`.

### Correlation Context Threading

Every async operation must explicitly set correlation context:

```typescript
// WRONG - context lost in callback
ws.on('message', (data) => {
  processMessage(data); // No correlation context!
});

// CORRECT
ws.on('message', (data) => {
  CorrelationIdManager.runWithContext(context, async () => {
    processMessage(data); // Context available
  });
});
```

Without this, distributed tracing breaks and logs lose correlation.

### Testing Requirements

- Maintain 90%+ coverage (current threshold in jest.config.js)
- Unit tests in `src/__tests__/unit/`
- Integration tests in `src/__tests__/integration/`
- Use test utilities: `src/__tests__/utils/` (mock factories, custom matchers)
- All tests must pass before commit (fast execution: <2 minutes for full suite)

Run tests before committing:
```bash
npm run test:coverage
```

### Infrastructure Changes

The repository uses **OpenTofu** (Terraform fork) as the primary IaC tool, but configurations work with both.

**Modular Architecture**:
- `infrastructure/modules/` - Reusable modules (VPC, ECS, ALB, ECR, Route53, CloudWatch, Bedrock KB, Bedrock Agent)
- `infrastructure/environments/` - Environment-specific configs (dev/staging/prod)
- `infrastructure/bootstrap/` - S3 backend for state management (run once)

**Always**:
1. Run `tofu plan` before `tofu apply`
2. Test infrastructure changes in dev environment first
3. Review outputs after apply (service_url, knowledge_base_s3_documents_bucket_name, etc.)
4. Update environment variables in `terraform.tfvars` for each environment

### Memory Management

The service runs Node.js with `--expose-gc` in production for manual GC control.

**Memory Monitoring**:
- Check `/health` endpoint for memory status
- Configure thresholds via env vars: `MEMORY_GC_THRESHOLD=0.8`, `MEMORY_ALERT_THRESHOLD=0.9`
- Enable leak detection: `MEMORY_LEAK_DETECTION=true`
- Monitor trends in production via CloudWatch metrics

**Common Memory Issues**:
- Audio buffer accumulation: Check `AudioBufferManager` for orphaned sessions
- Session cleanup delays: Verify 5-minute timeout and 60s cleanup interval
- Event handler leaks: Ensure WebSocket event listeners are removed on session end

### Environment Variables

**Required**:
- `TWILIO_AUTH_TOKEN` - For webhook signature validation (security critical)

**Optional but Important**:
- `AWS_REGION` - Default: `us-east-1` (only region supporting Nova Sonic as of Oct 2025)
- `PORT` - Default: `8080`
- `LOG_LEVEL` - Default: `INFO` (use `DEBUG` for development)
- `ENABLE_XRAY` - Default: `true` (set `false` for local dev to avoid X-Ray daemon requirement)
- `ENABLE_DEBUG_LOGGING` - Default: `false` (detailed application flow)
- `ENABLE_NOVA_DEBUG_LOGGING` - Default: `false` (AI model interaction logging)

See README.md for complete environment variable reference.

## Known Limitations and Roadmap

**Current Limitations**:
- Nova Sonic doesn't speak first (caller must speak to start conversation) - HIGH PRIORITY FIX
- Single region support (us-east-1 only due to Bedrock Nova Sonic availability)
- No conference call support (one-to-one conversations only)

**In Progress**:
- Making Nova Sonic speak first on call connect
- Enhanced conversation memory with knowledge context
- Multi-language support with automatic detection

See README.md roadmap section for planned features.

## Debugging Production Issues

### High Latency
```bash
# Check audio buffer sizes in logs
grep "buffer" /aws/ecs/twilio-bridge

# Monitor Bedrock API latency
aws cloudwatch get-metric-statistics \
  --namespace "TwilioBridge" \
  --metric-name "BedrockLatency"

# Verify network to Bedrock
# Check VPC routing if deployed in private subnets
```

### Session Failures
```bash
# View recent errors
aws logs tail /aws/ecs/twilio-bridge --follow --filter-pattern "ERROR"

# Check webhook validation failures
grep "signature validation failed" logs

# Verify CallSid registration
grep "registerActiveSession" logs
```

### Memory Issues
```bash
# Check current memory health
curl https://your-domain.com/health

# View memory trends
aws cloudwatch get-metric-statistics \
  --namespace "TwilioBridge" \
  --metric-name "MemoryUsage"

# Force garbage collection (if --expose-gc enabled)
# Trigger via memory monitor: memoryMonitor.forceGarbageCollection()
```

### WebSocket Connection Issues
```bash
# Check WebSocket security logs
grep "WebSocketSecurity" logs

# Verify rate limiting
grep "rate limit exceeded" logs

# Check CallSid validation
grep "invalid CallSid" logs
```

## AWS Bedrock Specific Notes

**Nova Sonic Model ID**: `amazon.nova-sonic-v1:0`

**Region Availability**: Only `us-east-1` as of October 2025

**Audio Format Requirements**:
- Bedrock expects: PCM16LE, 16kHz, mono, 16-bit samples
- Twilio provides: μ-law, 8kHz, mono, 8-bit samples
- Never send Twilio audio directly to Bedrock without conversion

**Bidirectional Stream API**:
- Uses `InvokeModelWithBidirectionalStream` operation
- Requires async iterable input generator
- Yields events asynchronously on response stream
- Connection stays open for entire conversation (not request/response)

**Event Types from Bedrock**:
- `audioOutput` - PCM16LE audio chunks from model
- `contentStart` - Model begins generating content
- `contentEnd` - Model finished current turn
- `sessionEnd` - Session closed by model or timeout

## Additional Resources

- **Repository**: https://github.com/paulobrien/twilio-bedrock-bridge
- **Main README**: `README.md` - Complete setup, deployment, and usage guide
- **Backend README**: `backend/twilio-bedrock-bridge/README.md` - Detailed technical documentation
- **Twilio Media Streams**: https://www.twilio.com/docs/voice/media-streams
- **AWS Bedrock Runtime API**: https://docs.aws.amazon.com/bedrock/latest/userguide/
