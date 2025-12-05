# ACM Certificate for HTTPS/WSS support (only for custom domains)
resource "aws_acm_certificate" "main" {
  count = var.domain_name != null ? 1 : 0

  domain_name       = var.domain_name
  validation_method = "DNS"

  subject_alternative_names = var.subject_alternative_names

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(var.tags, {
    Name = "${var.alb_name}-certificate"
  })
}

# Route53 records for certificate validation (only for custom domains)
resource "aws_route53_record" "cert_validation" {
  for_each = var.hosted_zone_id != null && var.domain_name != null ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

# Certificate validation (only for custom domains with Route53)
resource "aws_acm_certificate_validation" "main" {
  count = var.hosted_zone_id != null && var.domain_name != null ? 1 : 0

  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]

  timeouts {
    create = "5m"
  }
}

# Security Group for ALB
resource "aws_security_group" "alb" {
  name        = "${var.alb_name}-alb"
  description = "Security group for Application Load Balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.alb_name}-alb-sg"
  })
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = var.alb_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  # Deletion protection should be configured inline in environment-specific main.tf
  # Development: false (default)
  # Production: true (override in environment)
  enable_deletion_protection = false

  tags = var.tags
}

# Target Group for ECS Service
resource "aws_lb_target_group" "ecs_service" {
  name             = "${var.alb_name}-tg"
  port             = var.target_port
  protocol         = "HTTP"
  protocol_version = "HTTP1"  # Required for WebSocket support
  vpc_id           = var.vpc_id
  target_type      = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = var.health_check_path
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }

  # Enable sticky sessions for WebSocket connections
  stickiness {
    enabled         = true
    type            = "lb_cookie"
    cookie_duration = 86400  # 24 hours
  }

  tags = var.tags
}

# ALB Listener for HTTP with WebSocket support
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ecs_service.arn
  }

  tags = var.tags
}

# Listener rule for WebSocket connections
resource "aws_lb_listener_rule" "websocket" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ecs_service.arn
  }

  condition {
    http_header {
      http_header_name = "Connection"
      values           = ["*upgrade*"]
    }
  }

  condition {
    http_header {
      http_header_name = "Upgrade"
      values           = ["websocket"]
    }
  }

  tags = var.tags
}

# HTTPS listener using ACM certificate (only when domain is provided)
resource "aws_lb_listener" "https" {
  count = var.domain_name != null ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = var.hosted_zone_id != null ? aws_acm_certificate_validation.main[0].certificate_arn : aws_acm_certificate.main[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ecs_service.arn
  }

  tags = var.tags

  depends_on = [aws_acm_certificate.main]
}

# HTTPS WebSocket listener rule (only when domain is provided)
resource "aws_lb_listener_rule" "websocket_https" {
  count = var.domain_name != null ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ecs_service.arn
  }

  condition {
    http_header {
      http_header_name = "Connection"
      values           = ["*upgrade*"]
    }
  }

  condition {
    http_header {
      http_header_name = "Upgrade"
      values           = ["websocket"]
    }
  }

  tags = var.tags
}

# Note: HTTP to HTTPS redirect is disabled to allow WebSocket connections on HTTP
# WebSocket connections need to be tested on both HTTP and HTTPS
