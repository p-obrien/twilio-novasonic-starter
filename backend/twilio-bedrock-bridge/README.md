# Twilio Nova Sonic Starter

A production-ready, real-time bridge service that connects Twilio Voice calls to AWS Bedrock Nova Sonic for AI-powered voice conversations with knowledge base integration and intelligent agents. This service enables natural, low-latency voice interactions with Amazon's state-of-the-art multimodal AI model, enhanced with cost-optimized infrastructure and automatic knowledge management.

## Features

### 🎯 Core Voice Capabilities
- **Real-time Bidirectional Streaming**: Ultra-low latency audio streaming between Twilio and AWS Bedrock Nova Sonic
- **Advanced Session Management**: Concurrent session handling with automatic cleanup and resource management
- **Intelligent Audio Processing**: Automatic format conversion, quality analysis, and adaptive buffering
- **Real-time Interruption Support**: Natural conversation flow with voice activity detection and model interruption
- **Production-Ready Security**: Webhook signature validation, WebSocket security, and rate limiting

### 🧠 AI Knowledge & Agent Integration
- **Bedrock Knowledge Bases**: Automatic document ingestion with Aurora Serverless vector storage (95% cost savings vs OpenSearch)
- **Intelligent Agents**: Configurable Bedrock Agents with custom action groups and foundation model selection
- **Auto-Ingestion**: Real-time document processing triggered by S3 uploads with smart duplicate prevention
- **Multi-Modal Support**: Text, document, and voice processing with seamless integration
- **Context-Aware Conversations**: Knowledge base retrieval integrated into voice conversations

### 💰 Cost-Optimized Infrastructure
- **Aurora Serverless v2**: PostgreSQL with pgvector for vector storage (~$13-52/month vs $700+ for OpenSearch Serverless)
- **Auto-Scaling**: Pay-per-use Lambda functions and Aurora capacity units (ACUs) that scale to zero
- **Smart Resource Management**: Automatic scaling based on demand with predictable costs
- **Efficient Storage**: S3 document storage with lifecycle policies and intelligent tiering

### 📊 Enterprise Observability
- **Comprehensive Metrics**: CloudWatch integration with custom metrics for audio quality, session performance, and system health
- **Advanced Memory Monitoring**: Real-time memory usage tracking, leak detection, and automatic cleanup
- **Unified Tracing**: OpenTelemetry and X-Ray integration with intelligent fallback for distributed tracing
- **Health Monitoring**: Multi-dimensional health checks with memory trend analysis and predictive alerts
- **Smart Sampling**: Adaptive sampling rates based on operation type and system load
- **Auto-Ingestion Monitoring**: CloudWatch logs and metrics for knowledge base ingestion jobs

### 🏗️ Production Infrastructure
- **Auto-scaling ECS**: Container-based deployment with Application Load Balancer and auto-scaling
- **High Availability**: Multi-AZ deployment with health checks and automatic failover
- **Secure by Design**: VPC isolation, SSL/TLS termination, and comprehensive security controls
- **Infrastructure as Code**: Complete OpenTofu/Terraform modules with environment-specific configurations
- **Automated Deployments**: CI/CD ready with build scripts and container registry integration

## Architecture

### 🎙️ Voice Processing Flow
```
┌─────────────┐    WebSocket     ┌─────────────────┐    Bidirectional    ┌─────────────┐
│   Twilio    │ ◄──────────────► │  Bridge Service │ ◄─────────────────► │ AWS Bedrock │
│   Voice     │   (Media Stream) │                 │   (Nova Sonic API)  │ Nova Sonic  │
└─────────────┘                  └─────────────────┘                     └─────────────┘
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │   Observability │
                                 │   CloudWatch    │
                                 │   X-Ray Tracing │
                                 └─────────────────┘
```

### 🧠 AI Knowledge & Agent Integration
```
┌─────────────┐    S3 Events     ┌─────────────────┐    Vector Search    ┌─────────────────┐
│  Documents  │ ────────────────► │  Auto-Ingestion │ ──────────────────► │ Aurora Serverless│
│  (S3)       │                  │  Lambda         │                     │ PostgreSQL+pgvector│
└─────────────┘                  └─────────────────┘                     └─────────────────┘
                                          │                                        │
                                          ▼                                        ▼
                                 ┌─────────────────┐                      ┌─────────────────┐
                                 │ Bedrock Agent   │ ◄────────────────────│ Knowledge Base  │
                                 │ Custom Actions  │                      │ Retrieval       │
                                 └─────────────────┘                      └─────────────────┘
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │  Voice Bridge   │
                                 │  Integration    │
                                 └─────────────────┘
```

### 🏗️ Infrastructure Architecture
```
┌─────────────┐    HTTPS/WSS     ┌─────────────────┐    Private Network    ┌─────────────┐
│  Internet   │ ◄──────────────► │  Application    │ ◄───────────────────► │     ECS     │
│   (Twilio)  │                  │  Load Balancer  │                       │   Service   │
└─────────────┘                  └─────────────────┘                       └─────────────┘
                                          │                                        │
                                          ▼                                        ▼
                                 ┌─────────────────┐                      ┌─────────────┐
                                 │    Route53      │                      │   Private   │
                                 │   SSL/TLS       │                      │   Subnets   │
                                 └─────────────────┘                      └─────────────┘
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │ Aurora Serverless│
                                 │ Knowledge Base   │
                                 │ Auto-Ingestion  │
                                 └─────────────────┘
```

### 💰 Cost Comparison
| Component | Traditional | This Solution | Savings |
|-----------|-------------|---------------|---------|
| Vector Storage | OpenSearch Serverless (~$700/month) | Aurora Serverless (~$13-52/month) | **95%** |
| Compute | Always-on instances | Auto-scaling ECS + Lambda | **60-80%** |
| Storage | Premium tiers | S3 with lifecycle policies | **40-60%** |

## 📁 Repository Structure

```
twilio-nova-sonic-starter/
├── backend/twilio-bedrock-bridge/          # 🎯 Core application
│   ├── src/                               # TypeScript source code
│   │   ├── audio/                         # Audio processing, buffering, and quality analysis
│   │   ├── config/                        # Configuration management and validation
│   │   ├── errors/                        # Domain-specific error classes
│   │   ├── events/                        # Event system and async processing
│   │   ├── handlers/                      # HTTP webhook and WebSocket handlers
│   │   ├── observability/                 # Monitoring, metrics, and tracing
│   │   ├── security/                      # Security controls and validation
│   │   ├── session/                       # Session lifecycle management
│   │   ├── streaming/                     # Stream processing and format conversion
│   │   ├── types/                         # TypeScript type definitions
│   │   ├── utils/                         # Utilities (logging, correlation, constants)
│   │   ├── client.ts                      # Main Bedrock Nova Sonic client
│   │   └── server.ts                      # Express server with observability
│   ├── __tests__/                         # Comprehensive test suite (95%+ coverage)
│   └── Dockerfile                         # Container configuration
├── infrastructure/                        # 🏗️ Infrastructure as Code
│   ├── modules/                          # Reusable OpenTofu/Terraform modules
│   │   ├── bedrock-knowledge-base/       # 🧠 Aurora Serverless + auto-ingestion
│   │   ├── bedrock-agent/                # 🤖 Intelligent agents with actions
│   │   ├── ecs/                          # Container orchestration
│   │   ├── alb/                          # Load balancing + SSL
│   │   ├── vpc/                          # Network infrastructure
│   │   ├── ecr/                          # Container registry
│   │   ├── route53/                      # DNS management
│   │   └── cloudwatch-alarms/            # Monitoring and alerting
│   ├── environments/                     # Environment-specific configs
│   │   ├── dev/                          # Development environment
│   │   ├── staging/                      # Staging environment
│   │   └── prod/                         # Production environment
│   └── bootstrap/                        # Initial setup (S3 state backend)
└── scripts/                              # 🔧 Build and deployment tools
    ├── build-and-push.sh                # Container build automation
    └── deploy.sh                        # Deployment automation
```

## Prerequisites

### Required
- **Node.js** >= 22.0.0
- **AWS Account** with Bedrock Nova Sonic access (Only us-east-1 region supported as of Oct 2025)
- **Twilio Account** with Voice capabilities and Media Streams enabled
- **OpenTofu** >= 1.0 (primary infrastructure tool) or **Terraform** >= 1.0

### AWS Permissions Required
- Bedrock model access (specifically `amazon.nova-sonic-v1:0`)
- CloudWatch metrics and logs
- ECS, ALB, VPC, Route53 (for infrastructure deployment)
- ECR (for container registry)

### Development Tools
- **Docker** (for containerized deployment)
- **AWS CLI** (configured with appropriate credentials)
- **Git** (for version control)

### OpenTofu vs Terraform

This project uses **OpenTofu** as the primary infrastructure tool, which is a fork of Terraform that maintains full compatibility with Terraform configurations. OpenTofu offers:

- **Open Source**: Truly open-source with community governance
- **Terraform Compatibility**: Drop-in replacement for Terraform
- **Enhanced Features**: Additional functionality and improvements
- **No Licensing Concerns**: MPL 2.0 license without commercial restrictions

All `.tf` files work with both OpenTofu (`tofu` command) and Terraform (`terraform` command).

### Current Project Status

**Version**: 0.1.0 (Initial Release)
**Test Coverage**: 95%+ across all critical components
**Infrastructure**: Production-ready with Aurora Serverless v2 integration
**AI Capabilities**: Bedrock Knowledge Base and Agent integration complete
**Deployment**: Automated with OpenTofu/Terraform modules

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TWILIO_AUTH_TOKEN` | Yes | - | Twilio authentication token for webhook validation |
| `AWS_REGION` | No | `us-east-1` | AWS region for Bedrock and other services |
| `AWS_PROFILE_NAME` | No | - | AWS profile name for local development |
| `PORT` | No | `8080` | Server port for HTTP and WebSocket connections |
| `LOG_LEVEL` | No | `INFO` | Logging level: `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE` |
| `ENABLE_XRAY` | No | `true` | Enable AWS X-Ray distributed tracing |
| `ENABLE_DEBUG_LOGGING` | No | `false` | Enable detailed application flow logging |
| `ENABLE_NOVA_DEBUG_LOGGING` | No | `false` | Enable AI model interaction logging |

#### Memory Monitoring Configuration
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEMORY_MONITORING_ENABLED` | No | `true` | Enable memory usage monitoring and leak detection |
| `MEMORY_CHECK_INTERVAL_MS` | No | `30000` | Memory check interval in milliseconds (30 seconds) |
| `MEMORY_HISTORY_SIZE` | No | `100` | Number of memory samples to keep for trend analysis |
| `MEMORY_GC_THRESHOLD` | No | `0.8` | Trigger GC when heap usage exceeds this ratio (80%) |
| `MEMORY_ALERT_THRESHOLD` | No | `0.9` | Alert when memory usage exceeds this ratio (90%) |
| `MEMORY_LEAK_DETECTION` | No | `true` | Enable memory leak detection algorithms |
| `MEMORY_LEAK_SAMPLES` | No | `10` | Number of samples to analyze for leak detection |
| `MEMORY_AUTO_CLEANUP` | No | `true` | Enable automatic cleanup on critical memory usage |

### Setting Environment Variables

Environment variables can be set in several ways:

#### For Local Development
```bash
# Export variables in your shell
export TWILIO_AUTH_TOKEN="your-twilio-auth-token"
export AWS_REGION="us-east-1"
export LOG_LEVEL="DEBUG"

# Or create a local script (not tracked in git)
echo 'export TWILIO_AUTH_TOKEN="your-token"' > .env.local
echo 'export AWS_REGION="us-east-1"' >> .env.local
source .env.local
```

#### For Production Deployment
Environment variables are managed through the OpenTofu/Terraform infrastructure configuration in `infrastructure/environments/[env]/terraform.tfvars` and deployed via ECS task definitions.

### Advanced Configuration

The service uses a centralized configuration system in `src/config/AppConfig.ts` with support for:
- **Audio Processing**: Buffer sizes, quality thresholds, format conversion settings
- **Session Management**: Timeout values, cleanup intervals, concurrent session limits
- **Observability**: Metrics collection intervals, trace sampling rates, log formatting
- **Security**: Rate limiting, WebSocket security policies, CORS settings

## Infrastructure Deployment

The service includes production-ready infrastructure managed through **OpenTofu** (with Terraform compatibility) using modular, reusable components.

### Quick Start Infrastructure

#### Using OpenTofu (Recommended)

1. **Install OpenTofu**
```bash
# macOS with Homebrew
brew install opentofu

# Or download from https://opentofu.org/docs/intro/install/
```

2. **Bootstrap State Management**
```bash
cd infrastructure/bootstrap
tofu init
tofu apply
```

3. **Deploy Application Infrastructure**
```bash
cd infrastructure/environments/dev
tofu init
tofu apply
```

#### Using Terraform (Alternative)

```bash
cd infrastructure/bootstrap
terraform init
terraform apply

cd infrastructure/environments/dev
terraform init
terraform apply
```

### Infrastructure Configuration

Configure your deployment in `infrastructure/environments/[env]/terraform.tfvars` (works with both OpenTofu and Terraform):

#### Network Configuration
```hcl
vpc_name         = "twilio-bridge-vpc"
region          = "us-east-1"
vpc_cidr_block  = "10.0.0.0/16"
azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
```

#### Application Configuration
```hcl
ecs_cluster_name = "twilio-bridge-cluster"
domain_name     = "voice-ai.yourdomain.com"
hosted_zone_id  = "Z1234567890ABC"

# Twilio Configuration
twilio_auth_token = "your-twilio-auth-token"

# Observability
log_level                    = "info"
enable_debug_logging         = false
enable_nova_debug_logging    = false
cloudwatch_log_retention_days = 30

# Resource Tagging
common_tags = {
  Environment = "production"
  Project     = "twilio-bedrock-bridge"
  Owner       = "your-team"
}
```

### Infrastructure Modules

The infrastructure is organized into reusable modules:

- **VPC Module**: Network setup with public/private subnets, NAT gateways, security groups
- **ECS Module**: Container orchestration with auto-scaling, health checks, and service discovery
- **ALB Module**: Application Load Balancer with SSL termination and WebSocket support
- **Route53 Module**: DNS management with health checks and failover
- **CloudWatch Alarms**: Comprehensive monitoring and alerting
- **ECR Module**: Container registry with lifecycle policies

### Deployment Pipeline

The included build script automates the deployment process:

```bash
# Build and push container image
./scripts/build-and-push.sh

# Deploy infrastructure updates with OpenTofu (recommended)
cd infrastructure/environments/production
tofu plan
tofu apply

# Or with Terraform
cd infrastructure/environments/production
terraform plan
terraform apply
```

## Quick Start

### Prerequisites

- [OpenTofu](https://opentofu.org/docs/intro/install/) or Terraform installed
- AWS CLI configured with appropriate permissions
- Docker installed
- Node.js 22+ and npm
- Twilio account with Voice capabilities

### 1. Clone and Setup

```bash
git clone https://github.com/paulobrien/twilio-bedrock-bridge.git
cd twilio-bedrock-bridge
```

### 2. Deploy Infrastructure with AI Capabilities

#### Bootstrap (First-time setup)
```bash
cd infrastructure/bootstrap
tofu init
tofu plan
tofu apply
```

#### Deploy Environment with Knowledge Base
```bash
cd ../environments/dev  # or staging/prod
tofu init

# The terraform.tfvars is pre-configured with optimal settings:
# - Aurora Serverless v2 for 95% cost savings
# - Auto-ingestion enabled for real-time knowledge updates
# - Bedrock Agent with Nova Sonic integration
# - Production-ready security and monitoring

tofu plan  # Review the infrastructure plan
tofu apply # Deploy Aurora Serverless + AI capabilities
```

#### What Gets Deployed
✅ **Cost-Optimized AI Infrastructure**
- Aurora Serverless v2 PostgreSQL with pgvector (~$13-52/month)
- Auto-ingestion Lambda for real-time document processing
- Bedrock Knowledge Base with S3 document storage
- Bedrock Agent with configurable foundation models

✅ **Production Infrastructure**
- ECS cluster with auto-scaling (1-10 instances)
- Application Load Balancer with SSL termination
- VPC with public/private subnets across multiple AZs
- CloudWatch monitoring and X-Ray tracing

✅ **Security & Compliance**
- VPC isolation with private subnets
- IAM roles with least-privilege access
- Encryption at rest and in transit
- Webhook signature validation

### 3. Configure Knowledge Base (Optional)

Upload documents to enable AI knowledge integration:

```bash
# Get the S3 bucket name from deployment outputs
DOCS_BUCKET=$(tofu output -raw knowledge_base_s3_documents_bucket_name)

# Upload documents (triggers automatic ingestion)
aws s3 cp company-handbook.pdf s3://$DOCS_BUCKET/documents/
aws s3 sync ./documents/ s3://$DOCS_BUCKET/documents/

# Monitor auto-ingestion progress
aws logs tail /aws/lambda/$(tofu output -raw knowledge_base_name)-auto-ingestion --follow
```

### 4. Test the AI-Powered Voice System

Call your Twilio phone number to experience:
- 🎙️ **Real-time voice conversations** with Nova Sonic
- 🧠 **Knowledge-aware responses** from uploaded documents
- 🤖 **Intelligent agent actions** and custom capabilities
- 📊 **Production monitoring** and observability

### Local Development

For local development and testing:

```bash
cd backend/twilio-bedrock-bridge
npm install
npm test
npm run build
npm start
```

### Development Commands

```bash
# Build the project
npm run build

# Start production server
npm start

# Development with auto-rebuild
npm run dev

# Run comprehensive test suite
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Clean build artifacts
npm run clean
```

### Docker Development

```bash
# Build container image
docker build -t twilio-bedrock-bridge .

# Run container locally
docker run -p 8080:8080 \
  -e TWILIO_AUTH_TOKEN=your_token \
  -e AWS_REGION=us-east-1 \
  twilio-bedrock-bridge
```

### Production Deployment

```bash
# Build and push to ECR
./scripts/build-and-push.sh

# Deploy infrastructure with OpenTofu
cd infrastructure/environments/production
tofu apply

# Monitor deployment
aws ecs describe-services --cluster your-cluster --services twilio-bridge
```

## API Reference

### HTTP Endpoints

#### Webhook Endpoints
- **`POST /webhook`** - Twilio webhook endpoint with signature validation
  - Handles call events, media stream setup, and call lifecycle
  - Validates Twilio signatures for security
  - Returns TwiML responses for call control

#### Health Check Endpoints
- **`GET /health/readiness`** - Kubernetes readiness probe
- **`GET /health/liveness`** - Kubernetes liveness probe
- Basic `/health` endpoint has been removed

### WebSocket Endpoints

#### Media Streaming
- **`WS /media`** - Twilio Media Streams WebSocket endpoint
  - Handles real-time audio streaming from Twilio
  - Manages bidirectional communication with Bedrock Nova Sonic
  - Supports voice activity detection and interruption handling
  - Implements connection security and rate limiting

### Integration Examples

#### Twilio Voice Configuration
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://your-domain.com/media" />
    </Connect>
</Response>
```

#### Webhook Configuration
Set your Twilio webhook URL to: `https://your-domain.com/webhook`

## 🚀 Advanced Features

### Knowledge Base Management
```bash
# Upload documents (auto-ingestion enabled)
aws s3 cp document.pdf s3://your-kb-bucket/documents/

# Monitor ingestion status
aws bedrock-agent list-ingestion-jobs --knowledge-base-id $KB_ID

# Test knowledge retrieval
aws bedrock-agent retrieve --knowledge-base-id $KB_ID --retrieval-query "your question"
```

### Agent Configuration
- **Foundation Models**: Configure Claude 3 Sonnet, Haiku, or Nova Sonic
- **Custom Actions**: Add Lambda-powered agent capabilities
- **Knowledge Integration**: Automatic knowledge base association
- **Environment Aliases**: Separate dev/staging/prod agent versions

### Cost Monitoring
```bash
# Monitor Aurora Serverless capacity
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name ServerlessDatabaseCapacity \
  --dimensions Name=DBClusterIdentifier,Value=$CLUSTER_ID

# Track Lambda auto-ingestion costs
aws ce get-cost-and-usage --time-period Start=2024-01-01,End=2024-01-31
```

### Real-time Conversation Management

The service supports advanced conversation features:

- **Voice Activity Detection**: Automatic detection of user speech
- **Model Interruption**: Users can interrupt the AI mid-response
- **Adaptive Buffering**: Intelligent audio buffering based on network conditions
- **Quality Analysis**: Real-time audio quality monitoring and optimization
- **Knowledge-Aware Responses**: Context from uploaded documents integrated into conversations

### Session Management

- **Concurrent Sessions**: Support for multiple simultaneous voice calls
- **Automatic Cleanup**: Sessions are automatically cleaned up after inactivity
- **Resource Management**: Memory and connection pooling for optimal performance
- **Graceful Shutdown**: Proper cleanup of resources during service shutdown

### Observability & Monitoring

#### Metrics Collection
- **Audio Quality Metrics**: Latency, jitter, packet loss, audio clarity
- **Session Metrics**: Duration, success rate, error rates, concurrent sessions
- **System Metrics**: Memory usage, CPU utilization, connection counts
- **Business Metrics**: Call volume, conversation quality, user satisfaction

#### Distributed Tracing
- **End-to-end Tracing**: Full request tracing from Twilio webhook to Bedrock response
- **Smart Sampling**: Intelligent trace sampling to balance observability and performance
- **Correlation IDs**: Request correlation across all service components
- **Performance Insights**: Detailed timing analysis for optimization

### Error Handling & Resilience

#### Domain-Specific Error Types
- **`SessionError`** - Session lifecycle and management errors
- **`StreamingError`** - Audio streaming and processing errors
- **`AudioProcessingError`** - Audio format conversion and quality errors
- **`BedrockServiceError`** - AWS Bedrock API and model errors
- **`TwilioValidationError`** - Webhook signature and request validation errors
- **`WebSocketSecurityError`** - Connection security and rate limiting errors

#### Resilience Patterns
- **Circuit Breaker**: Automatic failure detection and recovery
- **Retry Logic**: Exponential backoff for transient failures
- **Graceful Degradation**: Fallback behaviors for service degradation
- **Resource Limits**: Memory and connection limits to prevent resource exhaustion

### Security Features

- **Webhook Signature Validation**: Cryptographic validation of Twilio requests
- **WebSocket Security**: Connection validation, rate limiting, and abuse prevention
- **VPC Isolation**: Network-level security with private subnets
- **SSL/TLS Termination**: End-to-end encryption for all communications
- **IAM Integration**: Fine-grained AWS permissions and role-based access

## Testing

The project includes a comprehensive test suite with 95%+ code coverage across all critical components.

### Test Categories

#### Unit Tests
- **Core Components**: WebSocket handlers, webhook processing, session management
- **Audio Processing**: Format conversion, quality analysis, buffering strategies
- **Client Integration**: Bedrock Nova Sonic client, streaming protocols
- **Observability**: Metrics collection, tracing, health monitoring
- **Security**: Webhook validation, WebSocket security, rate limiting

#### Integration Tests
- **End-to-End Flows**: Complete webhook-to-WebSocket-to-Bedrock workflows
- **Error Scenarios**: Network failures, service degradation, resource exhaustion
- **Performance Tests**: High-load scenarios, memory usage, response times

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (development)
npm run test:watch

# Run specific test suites
npm test -- --testNamePattern="WebhookHandler"
npm test -- --testNamePattern="audio"

# Run integration tests only
npm test -- --testPathPattern="integration"
```

### Test Utilities

The test suite includes comprehensive utilities:
- **Mock Factories**: Pre-configured mocks for AWS services, Twilio, WebSockets
- **Audio Test Data**: Generated test audio with various characteristics
- **Performance Helpers**: Memory usage tracking, execution time measurement
- **Custom Matchers**: Domain-specific assertions for UUIDs, CallSids, audio formats

### Coverage Reports

Coverage reports are generated in multiple formats:
- **HTML Report**: `coverage/lcov-report/index.html`
- **JSON Report**: `coverage/coverage-final.json`
- **LCOV Format**: `coverage/lcov.info`

### Continuous Integration

Tests are designed for CI/CD environments:
- **No External Dependencies**: All AWS and Twilio services are mocked
- **Deterministic Execution**: Consistent results across environments
- **Fast Execution**: Complete test suite runs in under 2 minutes
- **Clear Reporting**: Detailed failure information and debugging context

## Performance & Scalability

### Performance Characteristics

- **Audio Latency**: < 200ms end-to-end (Twilio → Bedrock → Twilio)
- **Concurrent Sessions**: Supports 100+ simultaneous voice calls per instance
- **Memory Efficiency**: Optimized audio buffering with automatic cleanup
- **CPU Usage**: Efficient audio processing with minimal computational overhead

### Scaling Considerations

- **Horizontal Scaling**: ECS auto-scaling based on CPU and memory metrics
- **Connection Pooling**: Optimized HTTP/2 connections to AWS Bedrock
- **Resource Management**: Automatic session cleanup and memory management
- **Load Balancing**: Application Load Balancer with WebSocket support

## Monitoring & Troubleshooting

### Key Metrics to Monitor

- **Audio Quality**: Latency, jitter, packet loss rates
- **Session Health**: Active sessions, success rates, error rates
- **System Resources**: Memory usage, CPU utilization, connection counts
- **API Performance**: Bedrock API response times, error rates

### Common Issues & Solutions

#### High Latency
- Check network connectivity to AWS Bedrock
- Monitor audio buffer sizes and processing delays
- Verify ECS task resource allocation

#### Session Failures
- Validate Twilio webhook signatures
- Check AWS Bedrock model availability
- Monitor WebSocket connection stability

#### Memory Issues
- Review session cleanup intervals
- Check for audio buffer memory leaks
- Monitor concurrent session limits

### Debugging Tools

```bash
# View application logs
aws logs tail /aws/ecs/twilio-bridge --follow

# Check ECS service health
aws ecs describe-services --cluster your-cluster --services twilio-bridge

# Monitor CloudWatch metrics
aws cloudwatch get-metric-statistics --namespace "TwilioBridge" --metric-name "ActiveSessions"
```

## Memory Monitoring & Management

The service includes advanced memory monitoring capabilities with automatic leak detection and cleanup.

### Memory Monitoring Features

- **Real-time Monitoring**: Continuous memory usage tracking with configurable intervals
- **Leak Detection**: Intelligent algorithms to detect memory leaks and upward trends
- **Automatic Cleanup**: Automatic garbage collection when memory thresholds are exceeded
- **Trend Analysis**: Historical memory usage analysis with pattern recognition
- **Health Assessment**: Multi-dimensional memory health evaluation with recommendations

### Memory Health Status

The memory monitor provides three health levels:

#### Healthy 🟢
- Memory usage within normal parameters
- Stable or decreasing memory trends
- No leak indicators detected

#### Warning 🟡
- Memory usage approaching thresholds
- Increasing memory trends detected
- High external memory usage
- Automatic cleanup may be triggered

#### Critical 🔴
- Memory usage exceeds critical thresholds
- Memory leak suspected
- Immediate cleanup actions required
- Service restart may be recommended

### Memory Monitoring Configuration

Configure memory monitoring through environment variables:

```bash
# Enable/disable memory monitoring
export MEMORY_MONITORING_ENABLED=true

# Check memory every 30 seconds
export MEMORY_CHECK_INTERVAL_MS=30000

# Keep 100 samples for trend analysis (50 minutes of history)
export MEMORY_HISTORY_SIZE=100

# Trigger GC at 80% of warning threshold
export MEMORY_GC_THRESHOLD=0.8

# Alert at 90% of critical threshold
export MEMORY_ALERT_THRESHOLD=0.9

# Enable leak detection algorithms
export MEMORY_LEAK_DETECTION=true

# Use 10 samples for leak detection
export MEMORY_LEAK_SAMPLES=10

# Enable automatic cleanup on critical usage
export MEMORY_AUTO_CLEANUP=true
```

### Programmatic Usage

```typescript
import { memoryMonitor, initializeObservability } from './observability';

// Initialize observability system with memory monitoring
await initializeObservability({
  enableMemoryMonitoring: true,
  memoryMonitoringInterval: 30000
});

// Get current memory health
const health = memoryMonitor.getMemoryHealth();
console.log('Memory status:', health.status);
console.log('Heap used:', Math.round(health.usage.heapUsed / 1024 / 1024), 'MB');
console.log('Trend:', health.trend);
console.log('Leak suspected:', health.leakSuspected);

// Get memory statistics
const stats = memoryMonitor.getMemoryStats();
console.log('Peak heap usage:', Math.round(stats.peak.heapUsed / 1024 / 1024), 'MB');
console.log('Average heap usage:', Math.round(stats.average.heapUsed / 1024 / 1024), 'MB');

// Force garbage collection if needed
const gcResult = memoryMonitor.forceGarbageCollection();
console.log('GC result:', gcResult);
```

### Memory Event Handling

The memory monitor emits events for different memory conditions:

```typescript
// Listen for memory warnings
memoryMonitor.on('memory_warning', (health) => {
  console.log('⚠️ Memory Warning:', {
    heapUsedMB: Math.round(health.usage.heapUsed / 1024 / 1024),
    warnings: health.warnings,
    recommendations: health.recommendations
  });
  
  // Take preventive action:
  // - Clear caches
  // - Defer non-critical operations
  // - Reduce buffer sizes
});

// Listen for critical memory events
memoryMonitor.on('memory_critical', (health) => {
  console.log('🚨 Critical Memory Usage:', {
    heapUsedMB: Math.round(health.usage.heapUsed / 1024 / 1024),
    leakSuspected: health.leakSuspected,
    warnings: health.warnings
  });
  
  // Take immediate action:
  // - Force garbage collection
  // - Close idle connections
  // - Clear all caches
  // - Consider service restart
});

// Listen for garbage collection events
memoryMonitor.on('gc_completed', (data) => {
  const freedMB = Math.round(data.heapFreed / 1024 / 1024);
  console.log('🗑️ GC completed, freed:', freedMB, 'MB');
});
```

### Production Memory Management

For production deployments, configure memory monitoring for your environment:

```bash
# Production memory monitoring settings
export MEMORY_MONITORING_ENABLED=true
export MEMORY_CHECK_INTERVAL_MS=30000      # Check every 30 seconds
export MEMORY_HISTORY_SIZE=100             # 50 minutes of history
export MEMORY_GC_THRESHOLD=0.8             # GC at 80% of warning
export MEMORY_ALERT_THRESHOLD=0.9          # Alert at 90% of critical
export MEMORY_LEAK_DETECTION=true          # Enable leak detection
export MEMORY_AUTO_CLEANUP=true            # Enable auto cleanup

# Start Node.js with garbage collection exposed
node --expose-gc dist/server.js
```

### Memory Monitoring in Health Checks

Memory monitoring is integrated into the health check system:

```bash
# Check memory health via API
curl https://your-domain.com/health

# Response includes memory information:
{
  "status": "healthy",
  "metrics": {
    "memoryUsage": {
      "heapUsed": 67108864,
      "heapTotal": 134217728,
      "rss": 201326592,
      "external": 10485760,
      "arrayBuffers": 5242880
    },
    "memoryHealth": {
      "status": "healthy",
      "trend": "stable",
      "leakSuspected": false,
      "warnings": [],
      "recommendations": []
    }
  },
  "checks": {
    "memory": {
      "status": "pass",
      "message": "Memory healthy: Heap 64MB, Trend: stable"
    }
  }
}
```

### Memory Troubleshooting

#### High Memory Usage
1. **Check memory health**: `GET /health` endpoint
2. **Review memory trends**: Look for consistent increases
3. **Analyze warnings**: Check health.warnings for specific issues
4. **Force cleanup**: Use `forceMemoryCleanup()` function

#### Memory Leaks
1. **Enable leak detection**: Set `MEMORY_LEAK_DETECTION=true`
2. **Monitor trends**: Watch for `leakSuspected: true`
3. **Analyze patterns**: Review memory history for consistent growth
4. **Take action**: Follow health.recommendations

#### Memory Optimization
```typescript
// Example: Implement custom cleanup logic
memoryMonitor.on('memory_warning', (health) => {
  // Clear application caches
  clearApplicationCaches();
  
  // Close idle WebSocket connections
  closeIdleConnections();
  
  // Reduce audio buffer sizes
  reduceAudioBufferSizes();
  
  // Log cleanup actions
  logger.info('Memory cleanup performed', {
    component: 'memory_management',
    action: 'preventive_cleanup',
    heapBefore: health.usage.heapUsed
  });
});
```

## 📋 Roadmap

### ✅ Completed
- [x] Aurora Serverless vector storage (95% cost savings)
- [x] Automatic document ingestion with S3 triggers
- [x] Bedrock Agent integration with custom actions
- [x] Production-ready infrastructure with auto-scaling
- [x] Comprehensive monitoring and observability
- [x] 95%+ test coverage across all components
- [x] Advanced memory monitoring with leak detection
- [x] WebSocket security and rate limiting

### 🔄 In Progress
- [ ] Make Nova Sonic Speak First (High Priority)
- [ ] Enhanced conversation memory with knowledge context
- [ ] Multi-language support with automatic detection

### 🎯 Planned
- [ ] Advanced voice activity detection improvements
- [ ] Conversation analytics and insights dashboard
- [ ] Custom voice profiles and personalization
- [ ] Conference call support with multiple participants
- [ ] Real-time conversation transcription and analysis
- [ ] Integration with additional Bedrock foundation models
- [ ] Advanced agent orchestration and workflow automation

## Contributing

We welcome contributions! Please follow these guidelines:

### Development Process

1. **Fork the Repository**: Create your own fork for development
2. **Create Feature Branch**: `git checkout -b feature/your-feature-name`
3. **Follow Code Standards**: Use existing TypeScript patterns and ESLint configuration
4. **Add Tests**: Include unit tests for new functionality (maintain 95%+ coverage)
5. **Update Documentation**: Update README and inline documentation as needed
6. **Submit Pull Request**: Include detailed description of changes

### Code Standards

- **TypeScript**: Use strict typing, avoid `any` types
- **Error Handling**: Use domain-specific error types and proper error propagation
- **Logging**: Include structured logging with correlation IDs
- **Testing**: Write comprehensive unit and integration tests
- **Documentation**: Include JSDoc comments for public APIs

### Commit Guidelines

- Use conventional commit format: `feat:`, `fix:`, `docs:`, `test:`, etc.
- Include issue references where applicable
- Keep commits focused and atomic

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## Support

### Documentation
- **API Documentation**: Generated from TypeScript definitions
- **Infrastructure Docs**: See `infrastructure/` directory
- **Test Documentation**: See `src/__tests__/README.md`

### Getting Help
- **Issues**: Report bugs and feature requests via GitHub Issues
- **Discussions**: Use GitHub Discussions for questions and community support
- **Security**: Report security issues privately via email

### Acknowledgments

- **AWS Bedrock Team**: For the Nova Sonic multimodal AI model
- **Twilio**: For the Media Streams API and WebSocket infrastructure
- **OpenTelemetry Community**: For distributed tracing capabilities
- **TypeScript Community**: For excellent tooling and type definitions

---

**Built for real-time AI voice interactions with enterprise-grade infrastructure and cost optimization**

*Part of the [Twilio Nova Sonic Starter](https://github.com/paulobrien/twilio-bedrock-bridge) - Complete AI voice solution with knowledge bases and intelligent agents*