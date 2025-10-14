variable "knowledge_base_name" {
  description = "Name for the Bedrock Knowledge Base"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "embedding_model_id" {
  description = "Bedrock embedding model ID for the knowledge base"
  type        = string
  default     = "amazon.titan-embed-text-v1"
}

variable "database_name" {
  description = "Name of the PostgreSQL database for vector storage"
  type        = string
  default     = "knowledge_base_vectors"
}

variable "db_username" {
  description = "Master username for the Aurora cluster"
  type        = string
  default     = "postgres"
}

variable "vector_table_name" {
  description = "Name of the table for storing vectors in PostgreSQL"
  type        = string
  default     = "bedrock_integration"
}

variable "min_capacity" {
  description = "Minimum Aurora Serverless v2 capacity (ACUs)"
  type        = number
  default     = 0.5
}

variable "max_capacity" {
  description = "Maximum Aurora Serverless v2 capacity (ACUs)"
  type        = number
  default     = 2
}

variable "skip_final_snapshot" {
  description = "Whether to skip final snapshot when deleting the cluster"
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Whether to enable deletion protection for the cluster"
  type        = bool
  default     = false
}

variable "subnet_ids" {
  description = "List of subnet IDs for the RDS subnet group"
  type        = list(string)
}

variable "vpc_id" {
  description = "VPC ID where the RDS cluster will be created"
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR block of the VPC for security group rules"
  type        = string
}

# Auto-ingestion configuration (always enabled)
variable "auto_ingestion_prefix" {
  description = "S3 prefix to monitor for auto-ingestion (empty for all objects)"
  type        = string
  default     = ""
}

variable "auto_ingestion_log_retention_days" {
  description = "CloudWatch log retention for auto-ingestion Lambda"
  type        = number
  default     = 14
}

variable "s3_inclusion_prefixes" {
  description = "List of S3 prefixes to include in the data source"
  type        = list(string)
  default     = []
}

variable "chunking_strategy" {
  description = "Chunking strategy for document processing (FIXED_SIZE, NONE)"
  type        = string
  default     = "FIXED_SIZE"
  
  validation {
    condition     = contains(["FIXED_SIZE", "NONE"], var.chunking_strategy)
    error_message = "Chunking strategy must be either FIXED_SIZE or NONE."
  }
}

variable "max_tokens" {
  description = "Maximum number of tokens per chunk (only used with FIXED_SIZE chunking)"
  type        = number
  default     = 300
  
  validation {
    condition     = var.max_tokens >= 1 && var.max_tokens <= 8192
    error_message = "Max tokens must be between 1 and 8192."
  }
}

variable "overlap_percentage" {
  description = "Percentage of overlap between chunks (only used with FIXED_SIZE chunking)"
  type        = number
  default     = 20
  
  validation {
    condition     = var.overlap_percentage >= 1 && var.overlap_percentage <= 99
    error_message = "Overlap percentage must be between 1 and 99."
  }
}