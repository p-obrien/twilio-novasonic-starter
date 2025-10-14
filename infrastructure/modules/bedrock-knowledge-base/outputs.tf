output "knowledge_base_id" {
  description = "ID of the Bedrock Knowledge Base"
  value       = aws_bedrockagent_knowledge_base.main.id
}

output "knowledge_base_arn" {
  description = "ARN of the Bedrock Knowledge Base"
  value       = aws_bedrockagent_knowledge_base.main.arn
}

output "knowledge_base_name" {
  description = "Name of the Bedrock Knowledge Base"
  value       = aws_bedrockagent_knowledge_base.main.name
}

output "data_source_id" {
  description = "ID of the Knowledge Base data source"
  value       = aws_bedrockagent_data_source.main.data_source_id
}

output "s3_documents_bucket_name" {
  description = "Name of the S3 bucket for document storage"
  value       = aws_s3_bucket.knowledge_base_documents.bucket
}

output "s3_documents_bucket_arn" {
  description = "ARN of the S3 bucket for document storage"
  value       = aws_s3_bucket.knowledge_base_documents.arn
}

output "rds_cluster_arn" {
  description = "ARN of the Aurora Serverless cluster for vector storage"
  value       = aws_rds_cluster.knowledge_base_vector_db.arn
}

output "rds_cluster_endpoint" {
  description = "Endpoint of the Aurora Serverless cluster"
  value       = aws_rds_cluster.knowledge_base_vector_db.endpoint
}

output "rds_cluster_id" {
  description = "ID of the Aurora Serverless cluster"
  value       = aws_rds_cluster.knowledge_base_vector_db.cluster_identifier
}

output "database_name" {
  description = "Name of the PostgreSQL database"
  value       = aws_rds_cluster.knowledge_base_vector_db.database_name
}

output "knowledge_base_role_arn" {
  description = "ARN of the IAM role used by the Knowledge Base"
  value       = aws_iam_role.knowledge_base_role.arn
}

# Auto-ingestion outputs
output "auto_ingestion_lambda_arn" {
  description = "ARN of the auto-ingestion Lambda function"
  value       = aws_lambda_function.auto_ingestion.arn
}

output "auto_ingestion_lambda_name" {
  description = "Name of the auto-ingestion Lambda function"
  value       = aws_lambda_function.auto_ingestion.function_name
}