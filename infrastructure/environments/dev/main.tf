terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# Define common tags and locals for all resources
locals {
  service_name = "twilio-media-stream-service"
  common_tags = merge(var.common_tags, {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "opentofu"
  })
  tags = local.common_tags
}

# Creating a new VPC just for this workload, you may not want to do this
module "vpc" {
  source = "../../modules/vpc"

  vpc_name        = var.vpc_name
  vpc_cidr_block  = var.vpc_cidr_block
  azs             = var.azs
  private_subnets = var.private_subnets
  public_subnets  = var.public_subnets
  region          = var.region
  tags            = local.common_tags
}

# ECR Repository for container images
module "ecr" {
  source = "../../modules/ecr"

  repository_name      = var.ecr_repository_name
  image_tag_mutability = var.ecr_image_tag_mutability
  scan_on_push         = var.ecr_scan_on_push
  encryption_type      = var.ecr_encryption_type
  lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus      = "tagged"
          tagPrefixList  = ["v"]
          countType      = "imageCountMoreThan"
          countNumber    = 10
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images older than 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
  force_delete         = var.ecr_force_delete
  tags                 = local.common_tags
}

# Application Load Balancer
module "alb" {
  source = "../../modules/alb"

  alb_name                   = "${var.project_name}-${var.environment}-alb"
  vpc_id                     = module.vpc.vpc_id
  public_subnet_ids          = module.vpc.public_subnets
  target_port                = 8080
  health_check_path          = "/health/liveness"
  enable_deletion_protection = false
  
  # SSL Certificate configuration using existing hosted zone
  domain_name                = var.domain_name
  subject_alternative_names  = var.subject_alternative_names
  hosted_zone_id            = var.hosted_zone_id
  
  tags                       = local.common_tags

  depends_on = [
    module.vpc
  ]
}

# DNS A record pointing to ALB (create the subdomain)
resource "aws_route53_record" "alb_alias" {
  count   = var.domain_name != null && var.hosted_zone_id != null ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = module.alb.alb_dns_name
    zone_id                = module.alb.alb_zone_id
    evaluate_target_health = true
  }

  depends_on = [module.alb]
}

# Bedrock Knowledge Base (optional)
module "knowledge_base" {
  count  = var.create_knowledge_base ? 1 : 0
  source = "../../modules/bedrock-knowledge-base"

  knowledge_base_name     = "${var.project_name}-${var.environment}-kb"
  region                  = var.region
  embedding_model_id      = var.knowledge_base_embedding_model_id
  database_name          = var.knowledge_base_database_name
  db_username            = var.knowledge_base_db_username
  vector_table_name      = var.knowledge_base_vector_table_name
  min_capacity           = var.knowledge_base_min_capacity
  max_capacity           = var.knowledge_base_max_capacity
  skip_final_snapshot    = var.knowledge_base_skip_final_snapshot
  deletion_protection    = var.knowledge_base_deletion_protection
  subnet_ids             = module.vpc.private_subnets
  vpc_id                 = module.vpc.vpc_id
  vpc_cidr_block         = var.vpc_cidr_block
  s3_inclusion_prefixes  = var.knowledge_base_s3_inclusion_prefixes
  chunking_strategy      = var.knowledge_base_chunking_strategy
  max_tokens             = var.knowledge_base_max_tokens
  overlap_percentage     = var.knowledge_base_overlap_percentage
  auto_ingestion_prefix  = var.knowledge_base_auto_ingestion_prefix
  
  tags = local.common_tags
}

# Bedrock Agent (optional)
module "agent" {
  count  = var.create_agent ? 1 : 0
  source = "../../modules/bedrock-agent"

  agent_name                    = "${var.project_name}-${var.environment}-agent"
  region                        = var.region
  environment                   = var.environment
  foundation_model_ids          = var.agent_foundation_model_ids
  agent_instruction            = var.agent_instruction
  agent_description            = var.agent_description
  idle_session_ttl_in_seconds  = var.agent_idle_session_ttl_in_seconds
  agent_alias_name             = var.agent_alias_name
  knowledge_base_arns          = var.create_knowledge_base ? [module.knowledge_base[0].knowledge_base_arn] : var.external_knowledge_base_arns
  action_groups                = var.agent_action_groups
  prompt_override_configuration = var.agent_prompt_override_configuration
  routing_configuration        = var.agent_routing_configuration
  
  tags = local.common_tags

  depends_on = [
    module.knowledge_base
  ]
}

# ECS Cluster and Service
module "ecs" {
  source = "../../modules/ecs"

  ecs_cluster_name              = var.ecs_cluster_name
  ecr_repository_url            = module.ecr.repository_url
  region                        = var.region
  service_name                  = local.service_name
  desired_count                 = 1
  subnet_ids                    = module.vpc.private_subnets
  assign_public_ip              = false
  vpc_id                        = module.vpc.vpc_id
  target_group_arn              = module.alb.target_group_arn
  alb_security_group_id         = module.alb.alb_security_group_id
  
  # Domain configuration
  domain_name                   = var.domain_name
  
  # Logging configuration
  log_level                     = var.log_level
  enable_debug_logging          = var.enable_debug_logging
  enable_nova_debug_logging     = var.enable_nova_debug_logging
  cloudwatch_log_retention_days = var.cloudwatch_log_retention_days
  
  # Twilio configuration
  twilio_auth_token             = var.twilio_auth_token
  verify_twilio_signature       = var.verify_twilio_signature
  
  # Knowledge Base and Agent configuration - use created resources or external ARNs
  knowledge_base_arns           = concat(
    var.create_knowledge_base ? [module.knowledge_base[0].knowledge_base_arn] : [],
    var.external_knowledge_base_arns
  )
  knowledge_base_id             = var.create_knowledge_base ? module.knowledge_base[0].knowledge_base_id : null
  agent_arns                    = concat(
    var.create_agent ? [module.agent[0].agent_alias_arn] : [],
    var.external_agent_arns
  )
  agent_id                      = var.create_agent ? module.agent[0].agent_id : null
  agent_alias_id                = var.create_agent ? module.agent[0].agent_alias_id : null
  
  tags = local.common_tags

  depends_on = [
    module.ecr,
    module.vpc,
    module.alb,
    module.knowledge_base,
    module.agent
  ]
}
