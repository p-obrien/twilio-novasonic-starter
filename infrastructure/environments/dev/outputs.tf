# VPC Outputs
output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "List of IDs of private subnets"
  value       = module.vpc.private_subnets
}

# ECR Outputs
output "ecr_repository_arn" {
  description = "Full ARN of the ECR repository"
  value       = module.ecr.repository_arn
}

output "ecr_repository_name" {
  description = "Name of the ECR repository"
  value       = module.ecr.repository_name
}

output "ecr_repository_url" {
  description = "The URL of the ECR repository"
  value       = module.ecr.repository_url
}

output "ecr_registry_id" {
  description = "The registry ID where the ECR repository was created"
  value       = module.ecr.registry_id
}

# ALB Outputs
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "websocket_url" {
  description = "WebSocket URL for Twilio Media Streams"
  value       = module.alb.websocket_url
}

output "websocket_secure_url" {
  description = "Secure WebSocket URL for Twilio Media Streams (WSS)"
  value       = module.alb.websocket_secure_url
}

output "alb_https_url" {
  description = "HTTPS URL of the Application Load Balancer"
  value       = module.alb.alb_https_url
}

output "certificate_arn" {
  description = "ARN of the ACM certificate (if domain is configured)"
  value       = module.alb.certificate_arn
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = module.alb.alb_arn
}

output "target_group_arn" {
  description = "ARN of the target group"
  value       = module.alb.target_group_arn
}

# Knowledge Base Outputs (conditional)
output "knowledge_base_id" {
  description = "ID of the Bedrock Knowledge Base (if created)"
  value       = var.create_knowledge_base ? module.knowledge_base[0].knowledge_base_id : null
}

output "knowledge_base_arn" {
  description = "ARN of the Bedrock Knowledge Base (if created)"
  value       = var.create_knowledge_base ? module.knowledge_base[0].knowledge_base_arn : null
}

output "knowledge_base_s3_documents_bucket_name" {
  description = "Name of the S3 bucket for knowledge base documents (if created)"
  value       = var.create_knowledge_base ? module.knowledge_base[0].s3_documents_bucket_name : null
}

output "knowledge_base_rds_cluster_endpoint" {
  description = "Endpoint of the Aurora Serverless cluster for vector storage (if created)"
  value       = var.create_knowledge_base ? module.knowledge_base[0].rds_cluster_endpoint : null
}

output "knowledge_base_database_name" {
  description = "Name of the PostgreSQL database for vector storage (if created)"
  value       = var.create_knowledge_base ? module.knowledge_base[0].database_name : null
}

# Agent Outputs (conditional)
output "agent_id" {
  description = "ID of the Bedrock Agent (if created)"
  value       = var.create_agent ? module.agent[0].agent_id : null
}

output "agent_arn" {
  description = "ARN of the Bedrock Agent (if created)"
  value       = var.create_agent ? module.agent[0].agent_arn : null
}

output "agent_alias_id" {
  description = "ID of the agent alias (if created)"
  value       = var.create_agent ? module.agent[0].agent_alias_id : null
}

output "agent_alias_arn" {
  description = "ARN of the agent alias (if created)"
  value       = var.create_agent ? module.agent[0].agent_alias_arn : null
}
