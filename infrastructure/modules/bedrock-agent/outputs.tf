output "agent_id" {
  description = "ID of the Bedrock Agent"
  value       = aws_bedrockagent_agent.main.id
}

output "agent_arn" {
  description = "ARN of the Bedrock Agent"
  value       = aws_bedrockagent_agent.main.agent_arn
}

output "agent_name" {
  description = "Name of the Bedrock Agent"
  value       = aws_bedrockagent_agent.main.agent_name
}

output "agent_alias_id" {
  description = "ID of the agent alias"
  value       = aws_bedrockagent_agent_alias.main.agent_alias_id
}

output "agent_alias_arn" {
  description = "ARN of the agent alias"
  value       = aws_bedrockagent_agent_alias.main.agent_alias_arn
}

output "agent_role_arn" {
  description = "ARN of the IAM role used by the agent"
  value       = aws_iam_role.agent_role.arn
}

output "action_group_ids" {
  description = "Map of action group names to their IDs"
  value = {
    for idx, ag in aws_bedrockagent_agent_action_group.action_groups :
    ag.action_group_name => ag.action_group_id
  }
}

output "lambda_function_arns" {
  description = "Map of action group names to their Lambda function ARNs"
  value = {
    for idx, func in aws_lambda_function.action_functions :
    var.action_groups[idx].name => func.arn
  }
}

output "knowledge_base_association_ids" {
  description = "List of knowledge base association IDs"
  value = [
    for assoc in aws_bedrockagent_agent_knowledge_base_association.knowledge_base_associations :
    assoc.id
  ]
}