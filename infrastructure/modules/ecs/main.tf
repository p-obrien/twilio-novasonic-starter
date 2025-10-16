# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.ecs_cluster_name}-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# IAM Role for ECS Task
resource "aws_iam_role" "ecs_task_role" {
  name = "${var.ecs_cluster_name}-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

# IAM Policy for Bedrock access and observability
resource "aws_iam_role_policy" "ecs_task_bedrock_policy" {
  name = "${var.ecs_cluster_name}-bedrock-policy"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream", 
          "bedrock:InvokeModelWithBidirectionalStream",
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel",
          "bedrock:GetModelInvocationLoggingConfiguration",
          "bedrock:ListCustomModels",
          "bedrock:GetCustomModel"
        ]
        Resource = [
          "*",
          "arn:aws:bedrock:*::foundation-model/amazon.nova-sonic-v1:0",
          "arn:aws:bedrock:*:*:foundation-model/amazon.nova-sonic-v1:0"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "sts:GetCallerIdentity"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream", 
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = [
              "AWS/X-Ray",
              "OpenTelemetry/Application",
              "TwilioBedrockBridge"
            ]
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "logs:PutLogEvents",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogStreams",
          "logs:DescribeLogGroups"
        ]
        Resource = [
          "arn:aws:logs:*:*:log-group:/aws/ecs/twilio-bedrock-bridge*"
        ]
      }
    ],
    # Conditionally add Knowledge Base permissions if ARNs are provided and not just "*"
    length(var.knowledge_base_arns) > 0 && !contains(var.knowledge_base_arns, "*") ? [
      {
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve",
          "bedrock:RetrieveAndGenerate"
        ]
        Resource = var.knowledge_base_arns
        Condition = {
          StringEquals = {
            "aws:RequestedRegion" = var.region
          }
        }
      }
    ] : [],
    # Conditionally add Agent permissions if ARNs are provided and not just "*"
    length(var.agent_arns) > 0 && !contains(var.agent_arns, "*") ? [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeAgent"
        ]
        Resource = var.agent_arns
        Condition = {
          StringEquals = {
            "aws:RequestedRegion" = var.region
          }
        }
      }
    ] : [],
    # Add wildcard permissions for Knowledge Base and Agent if "*" is specified
    contains(var.knowledge_base_arns, "*") || contains(var.agent_arns, "*") ? [
      {
        Effect = "Allow"
        Action = [
          "bedrock:Retrieve",
          "bedrock:RetrieveAndGenerate",
          "bedrock:InvokeAgent"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestedRegion" = var.region
          }
        }
      }
    ] : [])
  })
}

# Security Group for ECS Tasks - simplified approach
resource "aws_security_group" "ecs_tasks" {
  name        = "${var.ecs_cluster_name}-ecs-tasks"
  description = "Security group for ECS tasks"
  vpc_id      = var.vpc_id

  # Always allow egress
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# ALB ingress rule - ALB will always be present
resource "aws_security_group_rule" "ecs_ingress_alb" {
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  source_security_group_id = var.alb_security_group_id
  security_group_id        = aws_security_group.ecs_tasks.id
}

# CloudWatch Log Group for ECS Tasks
resource "aws_cloudwatch_log_group" "ecs_logs" {
  name              = "/ecs/${var.ecs_cluster_name}"
  retention_in_days = var.cloudwatch_log_retention_days

  tags = var.tags
}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = var.ecs_cluster_name

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs_logs.name
      }
    }
  }

  tags = var.tags
}

# Enable ADOT ECS Add-On
resource "aws_ecs_service" "adot_collector" {
  name            = "adot-collector"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.adot_collector.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.adot_collector.id]
    assign_public_ip = var.assign_public_ip
  }

  service_registries {
    registry_arn = aws_service_discovery_service.adot_collector.arn
  }

  tags = var.tags
}

# ADOT Collector Task Definition
resource "aws_ecs_task_definition" "adot_collector" {
  family                   = "adot-collector"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn           = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "aws-otel-collector"
      image     = "public.ecr.aws/aws-observability/aws-otel-collector:latest"
      essential = true

      portMappings = [
        {
          containerPort = 4317
          protocol      = "tcp"
        },
        {
          containerPort = 4318
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "AWS_REGION"
          value = var.region
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs_logs.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "adot-collector"
        }
      }

      command = ["--config=/etc/ecs/ecs-default-config.yaml"]
    }
  ])

  tags = var.tags
}

# Security Group for ADOT Collector
resource "aws_security_group" "adot_collector" {
  name        = "${var.ecs_cluster_name}-adot-collector"
  description = "Security group for ADOT Collector"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 4317
    to_port         = 4317
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  ingress {
    from_port       = 4318
    to_port         = 4318
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# Service Discovery
resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.ecs_cluster_name}.local"
  vpc  = var.vpc_id
  tags = var.tags
}

resource "aws_service_discovery_service" "adot_collector" {
  name = "adot-collector"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  tags = var.tags
}

# ECS Cluster Capacity Providers
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 0
    weight            = 100
    capacity_provider = "FARGATE_SPOT"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "twilio_media_stream" {
  family                   = "twilio-media-stream-server"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "2048"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn           = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "twilio-media-stream-server"
      image     = "${var.ecr_repository_url}:latest"
      essential = true
      
      portMappings = [
        {
          containerPort = 8080
          protocol      = "tcp"
        }
      ]

      environment = concat([
        {
          name  = "PORT"
          value = "8080"
        },
        {
          name  = "AWS_REGION"
          value = var.region
        },
        {
          name  = "AWS_DEFAULT_REGION"
          value = var.region
        },
        {
          name  = "DEPLOYMENT_REGION"
          value = var.region
        },
        {
          name  = "NOVA_SONIC_REGION"
          value = var.region
        },
        {
          name  = "LOG_LEVEL"
          value = var.log_level
        },
        {
          name  = "DEBUG"
          value = tostring(var.enable_debug_logging)
        },
        {
          name  = "NOVA_DEBUG"
          value = tostring(var.enable_nova_debug_logging)
        },
        {
          name  = "PUBLIC_URL"
          value = var.domain_name != null ? "https://${var.domain_name}" : ""
        },
        {
          name  = "VERIFY_TWILIO_SIGNATURE"
          value = tostring(var.verify_twilio_signature)
        },
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "BEDROCK_MODEL_ID"
          value = "amazon.nova-sonic-v1:0"
        },
        {
          name  = "OTEL_SERVICE_NAME"
          value = "twilio-bedrock-bridge"
        },
        {
          name  = "OTEL_SERVICE_VERSION"
          value = "0.1.0"
        },
        {
          name  = "OTEL_RESOURCE_ATTRIBUTES"
          value = "service.name=twilio-bedrock-bridge,service.version=0.1.0,deployment.environment=${var.environment}"
        },
        {
          name  = "ENABLE_XRAY"
          value = "true"
        },
        {
          name  = "OTEL_EXPORTER_OTLP_ENDPOINT"
          value = "http://adot-collector.${var.ecs_cluster_name}.local:4317"
        },
        {
          name  = "OTEL_EXPORTER_OTLP_PROTOCOL"
          value = "grpc"
        },
        {
          name  = "OTEL_TRACES_EXPORTER"
          value = "otlp"
        },
        {
          name  = "OTEL_METRICS_EXPORTER"
          value = "otlp"
        },
        {
          name  = "OTEL_LOGS_EXPORTER"
          value = "otlp"
        },
        {
          name  = "OTEL_PROPAGATORS"
          value = "tracecontext,baggage,xray"
        },
        {
          name  = "OTEL_EXPORTER_OTLP_TIMEOUT"
          value = "30000"
        },
        {
          name  = "OTEL_BSP_EXPORT_TIMEOUT"
          value = "30000"
        },
        {
          name  = "OTEL_EXPORTER_OTLP_INSECURE"
          value = "true"
        },
        {
          name  = "OTEL_LOG_LEVEL"
          value = "debug"
        },
        {
          name  = "OTEL_METRIC_EXPORT_INTERVAL"
          value = "5000"
        },
        {
          name  = "OTEL_METRIC_EXPORT_TIMEOUT"
          value = "30000"
        },
        {
          name  = "OTEL_SDK_DISABLED"
          value = "true"
        }
      ], var.twilio_auth_token != null ? [
        {
          name  = "TWILIO_AUTH_TOKEN"
          value = var.twilio_auth_token
        }
      ] : [], var.knowledge_base_id != null ? [
        {
          name  = "BEDROCK_KNOWLEDGE_BASE_ID"
          value = var.knowledge_base_id
        }
      ] : [], var.agent_id != null ? [
        {
          name  = "BEDROCK_AGENT_ID"
          value = var.agent_id
        }
      ] : [], var.agent_alias_id != null ? [
        {
          name  = "BEDROCK_AGENT_ALIAS_ID"
          value = var.agent_alias_id
        }
      ] : [])

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs_logs.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "twilio-media-stream"
        }
      }

      stopTimeout = 30
    }
  ])

  tags = var.tags
}

# ECS Service
resource "aws_ecs_service" "twilio_media_stream" {
  name            = var.service_name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.twilio_media_stream.arn
  desired_count   = var.desired_count

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight           = 100
    base             = 0
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = var.assign_public_ip
  }

  # Load balancer configuration (if target group ARN is provided)
  dynamic "load_balancer" {
    for_each = var.target_group_arn != null ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = "twilio-media-stream-server"
      container_port   = 8080
    }
  }

  # Health check grace period to allow container to start up
  health_check_grace_period_seconds = 300

  tags = var.tags

  depends_on = [
    aws_ecs_task_definition.twilio_media_stream,
    aws_ecs_cluster_capacity_providers.main,
    aws_ecs_service.adot_collector
  ]
}
