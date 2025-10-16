variable "ecs_cluster_name" {
  description = "Name for the ECS Cluster"
  type = string
}

variable "tags" {
  description = "Tags to apply to all ECS resources"
  type        = map(string)
  default     = {}
}

variable "ecr_repository_url" {
  description = "URL of the ECR repository"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "service_name" {
  description = "Name of the ECS service"
  type        = string
  default     = "twilio-media-stream-service"
}

variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
  default     = 1
}

variable "subnet_ids" {
  description = "List of subnet IDs for the ECS service"
  type        = list(string)
}

variable "assign_public_ip" {
  description = "Whether to assign a public IP to the ECS tasks"
  type        = bool
  default     = true
}

variable "vpc_id" {
  description = "VPC ID where the ECS resources will be created"
  type        = string
}

variable "target_group_arn" {
  description = "ARN of the ALB target group"
  type        = string
  default     = null
}

variable "alb_security_group_id" {
  description = "Security group ID of the ALB"
  type        = string
  default     = null
}

# Logging configuration variables
variable "log_level" {
  description = "Log level for the application (debug, info, warn, error)"
  type        = string
  default     = "info"
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

variable "domain_name" {
  description = "Domain name for the PUBLIC_URL environment variable"
  type        = string
  default     = null
}

# Twilio configuration variables
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

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

# Knowledge Base and Agent configuration variables
variable "knowledge_base_arns" {
  description = "List of Bedrock Knowledge Base ARNs that the service can access. Use ['*'] for all knowledge bases."
  type        = list(string)
  default     = []
}

variable "knowledge_base_id" {
  description = "Primary Bedrock Knowledge Base ID for the application"
  type        = string
  default     = null
}

variable "agent_arns" {
  description = "List of Bedrock Agent ARNs that the service can invoke. Use ['*'] for all agents."
  type        = list(string)
  default     = []
}

variable "agent_id" {
  description = "Primary Bedrock Agent ID for the application"
  type        = string
  default     = null
}

variable "agent_alias_id" {
  description = "Primary Bedrock Agent Alias ID for the application"
  type        = string
  default     = null
}
