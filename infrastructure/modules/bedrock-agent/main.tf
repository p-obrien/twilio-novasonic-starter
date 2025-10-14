# IAM role for Bedrock Agent
resource "aws_iam_role" "agent_role" {
  name = "${var.agent_name}-agent-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:agent/*"
          }
        }
      }
    ]
  })

  tags = var.tags
}

data "aws_caller_identity" "current" {}

# IAM policy for Agent to access foundation models
resource "aws_iam_role_policy" "agent_bedrock_policy" {
  name = "${var.agent_name}-bedrock-policy"
  role = aws_iam_role.agent_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          for model_id in var.foundation_model_ids : 
          "arn:aws:bedrock:${var.region}::foundation-model/${model_id}"
        ]
      }
    ]
  })
}

# IAM policy for Agent to access Knowledge Bases (if provided)
resource "aws_iam_role_policy" "agent_knowledge_base_policy" {
  count = length(var.knowledge_base_arns) > 0 ? 1 : 0
  name  = "${var.agent_name}-knowledge-base-policy"
  role  = aws_iam_role.agent_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve"
        ]
        Resource = var.knowledge_base_arns
      }
    ]
  })
}

# IAM policy for Agent to invoke Lambda functions (if action groups are defined)
resource "aws_iam_role_policy" "agent_lambda_policy" {
  count = length(var.action_groups) > 0 ? 1 : 0
  name  = "${var.agent_name}-lambda-policy"
  role  = aws_iam_role.agent_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "lambda:InvokeFunction"
        ]
        Resource = [
          for action_group in var.action_groups : 
          action_group.lambda_function_arn
          if action_group.lambda_function_arn != null
        ]
      }
    ]
  })
}

# Bedrock Agent
resource "aws_bedrockagent_agent" "main" {
  agent_name                  = var.agent_name
  agent_resource_role_arn     = aws_iam_role.agent_role.arn
  foundation_model            = var.foundation_model_ids[0] # Primary model
  instruction                 = var.agent_instruction
  description                 = var.agent_description
  idle_session_ttl_in_seconds = var.idle_session_ttl_in_seconds
  
  dynamic "prompt_override_configuration" {
    for_each = var.prompt_override_configuration != null ? [var.prompt_override_configuration] : []
    content {
      prompt_configurations {
        base_prompt_template = prompt_override_configuration.value.base_prompt_template
        inference_configuration {
          max_length     = prompt_override_configuration.value.maximum_length
          stop_sequences = prompt_override_configuration.value.stop_sequences
          temperature    = prompt_override_configuration.value.temperature
          top_k         = prompt_override_configuration.value.top_k
          top_p         = prompt_override_configuration.value.top_p
        }
        parser_mode           = prompt_override_configuration.value.parser_mode
        prompt_creation_mode  = prompt_override_configuration.value.prompt_creation_mode
        prompt_state         = prompt_override_configuration.value.prompt_state
        prompt_type          = prompt_override_configuration.value.prompt_type
      }
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy.agent_bedrock_policy
  ]
}

# Agent Action Groups
resource "aws_bedrockagent_agent_action_group" "action_groups" {
  for_each = { for idx, ag in var.action_groups : idx => ag }

  action_group_name          = each.value.name
  agent_id                   = aws_bedrockagent_agent.main.id
  agent_version             = "DRAFT"
  description               = each.value.description
  action_group_state        = each.value.state

  dynamic "action_group_executor" {
    for_each = each.value.lambda_function_arn != null ? [1] : []
    content {
      lambda = each.value.lambda_function_arn
    }
  }

  dynamic "api_schema" {
    for_each = each.value.api_schema != null ? [1] : []
    content {
      payload = each.value.api_schema
    }
  }

  depends_on = [aws_bedrockagent_agent.main]
}

# Agent Knowledge Base Associations
resource "aws_bedrockagent_agent_knowledge_base_association" "knowledge_base_associations" {
  for_each = { for idx, kb_arn in var.knowledge_base_arns : idx => kb_arn }

  agent_id             = aws_bedrockagent_agent.main.id
  agent_version        = "DRAFT"
  description          = "Knowledge base association for ${var.agent_name}"
  knowledge_base_id    = split("/", each.value)[1] # Extract KB ID from ARN
  knowledge_base_state = "ENABLED"

  depends_on = [aws_bedrockagent_agent.main]
}

# Agent Alias for different environments
resource "aws_bedrockagent_agent_alias" "main" {
  agent_alias_name = var.agent_alias_name
  agent_id         = aws_bedrockagent_agent.main.id
  description      = "Agent alias for ${var.environment} environment"

  dynamic "routing_configuration" {
    for_each = var.routing_configuration != null ? [var.routing_configuration] : []
    content {
      agent_version = routing_configuration.value.agent_version
    }
  }

  tags = var.tags

  depends_on = [
    aws_bedrockagent_agent_action_group.action_groups,
    aws_bedrockagent_agent_knowledge_base_association.knowledge_base_associations
  ]
}

# Lambda functions for custom actions (if needed)
resource "aws_lambda_function" "action_functions" {
  for_each = { 
    for idx, ag in var.action_groups : idx => ag 
    if ag.create_lambda_function && ag.lambda_function_code != null 
  }

  function_name = "${var.agent_name}-${each.value.name}-action"
  role         = aws_iam_role.lambda_execution_role[each.key].arn
  handler      = each.value.lambda_handler
  runtime      = each.value.lambda_runtime
  timeout      = each.value.lambda_timeout

  filename         = each.value.lambda_function_code
  source_code_hash = filebase64sha256(each.value.lambda_function_code)

  environment {
    variables = merge(
      {
        AGENT_NAME = var.agent_name
        REGION     = var.region
      },
      each.value.lambda_environment_variables
    )
  }

  tags = var.tags
}

# IAM role for Lambda execution (if Lambda functions are created)
resource "aws_iam_role" "lambda_execution_role" {
  for_each = { 
    for idx, ag in var.action_groups : idx => ag 
    if ag.create_lambda_function 
  }

  name = "${var.agent_name}-${each.value.name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# Basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  for_each = { 
    for idx, ag in var.action_groups : idx => ag 
    if ag.create_lambda_function 
  }

  role       = aws_iam_role.lambda_execution_role[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Lambda resource-based policy to allow Bedrock Agent to invoke
resource "aws_lambda_permission" "allow_bedrock_agent" {
  for_each = { 
    for idx, ag in var.action_groups : idx => ag 
    if ag.create_lambda_function 
  }

  statement_id  = "AllowBedrockAgentInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.action_functions[each.key].function_name
  principal     = "bedrock.amazonaws.com"
  source_arn    = aws_bedrockagent_agent.main.agent_arn
}