variable "agent_name" {
  description = "Name for the Bedrock Agent"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "foundation_model_ids" {
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

variable "idle_session_ttl_in_seconds" {
  description = "Idle session timeout in seconds"
  type        = number
  default     = 3600
  
  validation {
    condition     = var.idle_session_ttl_in_seconds >= 60 && var.idle_session_ttl_in_seconds <= 3600
    error_message = "Idle session TTL must be between 60 and 3600 seconds."
  }
}

variable "agent_alias_name" {
  description = "Name for the agent alias"
  type        = string
  default     = "live"
}

variable "knowledge_base_arns" {
  description = "List of Knowledge Base ARNs to associate with the agent"
  type        = list(string)
  default     = []
}

variable "action_groups" {
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

variable "prompt_override_configuration" {
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

variable "routing_configuration" {
  description = "Routing configuration for the agent alias"
  type = object({
    agent_version = optional(string, "DRAFT")
  })
  default = null
}