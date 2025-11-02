# Twilio Nova Sonic Starter

Enterprise-grade real-time bridge service that connects Twilio Voice calls to AWS Bedrock Nova Sonic for AI-powered voice conversations with knowledge base integration and intelligent agents.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

This repository contains a complete production-ready solution with advanced AI capabilities, cost-optimized infrastructure, and automatic knowledge management.

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
twilio-bedrock-bridge/
├── backend/twilio-bedrock-bridge/          # 🎯 Core application
│   ├── src/                               # TypeScript source code
│   ├── __tests__/                         # Comprehensive test suite
│   └── Dockerfile                         # Container configuration
├── infrastructure/                        # 🏗️ Infrastructure as Code
│   ├── modules/                          # Reusable Terraform modules
│   │   ├── bedrock-knowledge-base/       # 🧠 Aurora Serverless + auto-ingestion
│   │   ├── bedrock-agent/                # 🤖 Intelligent agents with actions
│   │   ├── ecs/                          # Container orchestration
│   │   ├── alb/                          # Load balancing + SSL
│   │   └── vpc/                          # Network infrastructure
│   ├── environments/                     # Environment-specific configs
│   │   ├── dev/                          # Development environment
│   │   ├── staging/                      # Staging environment
│   │   └── prod/                         # Production environment
│   ├── bootstrap/                        # Initial setup (S3 state backend)
└── scripts/                              # 🔧 Build and deployment tools
    ├── build-and-push.sh                # Container build automation
    └── deploy.sh                        # Deployment automation
```

## Quick Start

### Prerequisites

- [OpenTofu](https://opentofu.org/docs/intro/install/) or Terraform installed
- AWS CLI configured with appropriate permissions
- Docker installed
- Node.js 18+ and npm
- Twilio account

### 1. Clone and Setup

```bash
git clone https://github.com/paulobrien/twilio-bedrock-bridge.git
cd twilio-bedrock-bridge
```

### 2. Twilio Setup

#### Get a Twilio Phone Number
1. Log into your [Twilio Console](https://console.twilio.com/)
2. Navigate to **Phone Numbers** > **Manage** > **Buy a number**
3. Purchase a phone number with Voice capabilities
4. Note your phone number for later configuration

#### Get Twilio Credentials
1. In the Twilio Console, go to **Account** > **API keys & tokens**
2. Copy your **Account SID** and **Auth Token**
3. Optionally create a new API Key for enhanced security

#### Configure TwiML Application
1. Go to **Develop** > **TwiML** > **TwiML Apps**
2. Create a new TwiML App with these settings:
   - **App Name**: `Bedrock Bridge`
   - **Voice Request URL**: `https://your-domain.com/webhook/voice` (you'll get this after deployment)
   - **Voice Request Method**: `POST`
3. Note the **TwiML App SID**
4. Configure your phone number to use this TwiML App:
   - Go to **Phone Numbers** > **Manage** > **Active numbers**
   - Click your phone number
   - Set **A call comes in** to use your TwiML App

### 3. Deploy Infrastructure with OpenTofu

#### Bootstrap (First-time setup)
```bash
cd infrastructure/bootstrap
tofu init
tofu plan
tofu apply
```

#### Deploy Environment with AI Capabilities
```bash
cd ../environments/dev  # or staging/prod
tofu init

# The terraform.tfvars is pre-configured with optimal settings
# Key configurations included:
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

#### Get Deployment URL
After deployment, get your service URL:
```bash
tofu output service_url
```

### 4. Configure Knowledge Base (Optional)

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

### 5. Update Twilio Webhook URL
1. Get your service URL: `tofu output service_url`
2. Return to your TwiML App in the Twilio Console
3. Update the **Voice Request URL** to: `https://your-service-url/webhook/voice`
4. Save the configuration

### 6. Test the AI-Powered Voice System

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

#### Docker Development
```bash
docker build -t twilio-bedrock-bridge backend/twilio-bedrock-bridge
docker run -p 8080:8080 \
  -e TWILIO_AUTH_TOKEN=your_auth_token \
  -e AWS_REGION=us-east-1 \
  twilio-bedrock-bridge
```

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

## 📋 Roadmap

### ✅ Completed
- [x] Aurora Serverless vector storage (95% cost savings)
- [x] Automatic document ingestion with S3 triggers
- [x] Bedrock Agent integration with custom actions
- [x] Production-ready infrastructure with auto-scaling
- [x] Comprehensive monitoring and observability

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

See [`backend/twilio-bedrock-bridge/README.md`](backend/twilio-bedrock-bridge/README.md:1) for contribution guidelines, testing, and development process.

License

This project is licensed under the MIT License — see the [`LICENSE`](LICENSE:1) file for details.