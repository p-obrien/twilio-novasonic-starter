variable "public_subnets" {
  description = "Public subnet names to use"
  type        = list(string)
}

variable "private_subnets" {
  description = "Private subnet names to use"
  type        = list(string)
}

variable "azs" {
  description = "Availability Zones to use"
  type        = list(string)
}

variable "region" {
  description = "Region to deploy into"
  type        = string
}

variable "vpc_name" {
  description = "What to call the VPC"
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of ECS Cluster"
  type        = string
  default     = "amazon-nova-dev-cluster"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "amazon-nova-starter"
}

variable "common_tags" {
  description = "Common tags to be applied to all resources"
  type        = map(string)
  default     = {}
}

# ECR Variables
variable "ecr_repository_name" {
  description = "Name of the ECR repository"
  type        = string
  default     = "twilio-novasonic-starter"
}

variable "ecr_image_tag_mutability" {
  description = "The tag mutability setting for the repository. Must be one of: MUTABLE or IMMUTABLE"
  type        = string
  default     = "MUTABLE"
}

variable "ecr_scan_on_push" {
  description = "Indicates whether images are scanned after being pushed to the repository"
  type        = bool
  default     = true
}

variable "ecr_encryption_type" {
  description = "The encryption type to use for the repository. Valid values are AES256 or KMS"
  type        = string
  default     = "AES256"
}


variable "ecr_force_delete" {
  description = "If true, will delete the repository even if it contains images. Use with caution."
  type        = bool
  default     = true
}

# SSL Certificate Variables
variable "domain_name" {
  description = "Domain name for the SSL certificate (required)"
  type        = string
  # No default - must be provided
}

variable "subject_alternative_names" {
  description = "Subject alternative names for the SSL certificate"
  type        = list(string)
  default     = []
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for certificate validation (required when using custom domain)"
  type        = string
  # No default - must be provided when using custom domain
}

# Logging Configuration Variables
variable "log_level" {
  description = "Log level for the application (debug, info, warn, error)"
  type        = string
  default     = "debug"
}

variable "enable_debug_logging" {
  description = "Enable debug logging"
  type        = bool
  default     = false
}

variable "enable_nova_debug_logging" {
  description = "Enable Nova Sonic debug logging"
  type        = bool
  default     = false
}

variable "cloudwatch_log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 7
}

# Twilio Configuration Variables
variable "twilio_auth_token" {
  description = "Twilio Auth Token for webhook signature verification"
  type        = string
  sensitive   = true
  default     = null
}

variable "verify_twilio_signature" {
  description = "Enable/disable Twilio signature verification"
  type        = bool
  default     = true
}

# CloudWatch Alarms Notification Variables
variable "notification_emails" {
  description = "List of email addresses to receive CloudWatch alarm notifications"
  type        = list(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for CloudWatch alarm notifications (optional)"
  type        = string
  default     = null
  sensitive   = true
}

# Knowledge Base and Agent Configuration Variables
variable "knowledge_base_arns" {
  description = "List of Bedrock Knowledge Base ARNs that the service can access (deprecated - use external_knowledge_base_arns)"
  type        = list(string)
  default     = ["*"]
}

variable "agent_arns" {
  description = "List of Bedrock Agent ARNs that the service can invoke (deprecated - use external_agent_arns)"
  type        = list(string)
  default     = ["*"]
}

# New Bedrock Knowledge Base Module Variables
variable "create_knowledge_base" {
  description = "Whether to create a new Bedrock Knowledge Base"
  type        = bool
  default     = false
}

variable "knowledge_base_embedding_model_id" {
  description = "Bedrock embedding model ID for the knowledge base"
  type        = string
  default     = "amazon.titan-embed-text-v1"
}

variable "knowledge_base_database_name" {
  description = "Name of the PostgreSQL database for vector storage"
  type        = string
  default     = "knowledge_base_vectors"
}

variable "knowledge_base_db_username" {
  description = "Master username for the Aurora cluster"
  type        = string
  default     = "postgres"
}

variable "knowledge_base_vector_table_name" {
  description = "Name of the table for storing vectors in PostgreSQL"
  type        = string
  default     = "bedrock_integration"
}

variable "knowledge_base_min_capacity" {
  description = "Minimum Aurora Serverless v2 capacity (ACUs)"
  type        = number
  default     = 0.5
}

variable "knowledge_base_max_capacity" {
  description = "Maximum Aurora Serverless v2 capacity (ACUs)"
  type        = number
  default     = 2
}

variable "knowledge_base_skip_final_snapshot" {
  description = "Whether to skip final snapshot when deleting the cluster"
  type        = bool
  default     = true
}

variable "knowledge_base_deletion_protection" {
  description = "Whether to enable deletion protection for the cluster"
  type        = bool
  default     = false
}

variable "knowledge_base_auto_ingestion_prefix" {
  description = "S3 prefix to monitor for auto-ingestion (empty for all objects)"
  type        = string
  default     = ""
}

variable "knowledge_base_s3_inclusion_prefixes" {
  description = "List of S3 prefixes to include in the knowledge base data source"
  type        = list(string)
  default     = []
}

variable "knowledge_base_chunking_strategy" {
  description = "Chunking strategy for document processing (FIXED_SIZE, NONE)"
  type        = string
  default     = "FIXED_SIZE"
}

variable "knowledge_base_max_tokens" {
  description = "Maximum number of tokens per chunk"
  type        = number
  default     = 300
}

variable "knowledge_base_overlap_percentage" {
  description = "Percentage of overlap between chunks"
  type        = number
  default     = 20
}

variable "external_knowledge_base_arns" {
  description = "List of external Bedrock Knowledge Base ARNs that the service can access"
  type        = list(string)
  default     = []
}

# New Bedrock Agent Module Variables
variable "create_agent" {
  description = "Whether to create a new Bedrock Agent"
  type        = bool
  default     = false
}

variable "agent_foundation_model_ids" {
  description = "List of foundation model IDs that the agent can use"
  type        = list(string)
  default     = ["anthropic.claude-3-sonnet-20240229-v1:0"]
}

variable "agent_instruction" {
  description = "Instructions for the Bedrock Agent"
  type        = string
  default     = "You are a helpful AI assistant that can answer questions and perform tasks using available tools and knowledge bases."
}

variable "agent_description" {
  description = "Description of the Bedrock Agent"
  type        = string
  default     = "AI assistant with access to knowledge bases and custom actions"
}

variable "agent_idle_session_ttl_in_seconds" {
  description = "Idle session timeout in seconds"
  type        = number
  default     = 3600
}

variable "agent_alias_name" {
  description = "Name for the agent alias"
  type        = string
  default     = "live"
}

variable "agent_action_groups" {
  description = "List of action groups for the agent"
  type = list(object({
    name                           = string
    description                    = string
    state                         = optional(string, "ENABLED")
    lambda_function_arn           = optional(string)
    api_schema                    = optional(string)
    create_lambda_function        = optional(bool, false)
    lambda_function_code          = optional(string)
    lambda_handler               = optional(string, "index.handler")
    lambda_runtime               = optional(string, "python3.11")
    lambda_timeout               = optional(number, 30)
    lambda_environment_variables = optional(map(string), {})
  }))
  default = []
}

variable "agent_prompt_override_configuration" {
  description = "Prompt override configuration for the agent"
  type = object({
    base_prompt_template    = string
    maximum_length         = optional(number, 2048)
    stop_sequences         = optional(list(string), [])
    temperature           = optional(number, 0.7)
    top_k                 = optional(number, 250)
    top_p                 = optional(number, 0.999)
    parser_mode           = optional(string, "DEFAULT")
    prompt_creation_mode  = optional(string, "OVERRIDDEN")
    prompt_state          = optional(string, "ENABLED")
    prompt_type           = optional(string, "ORCHESTRATION")
  })
  default = null
}

variable "agent_routing_configuration" {
  description = "Routing configuration for the agent alias"
  type = object({
    agent_version = optional(string, "DRAFT")
  })
  default = null
}

variable "external_agent_arns" {
  description = "List of external Bedrock Agent ARNs that the service can invoke"
  type        = list(string)
  default     = []
}
