variable "alb_name" {
  description = "Name of the Application Load Balancer"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the ALB will be created"
  type        = string
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs for the ALB"
  type        = list(string)
}

variable "target_port" {
  description = "Port on which the target service is running"
  type        = number
  default     = 8080
}

variable "health_check_path" {
  description = "Health check path for the target group"
  type        = string
  default     = "/health/liveness"
}

# SSL Certificate Configuration
# Two patterns are supported:
# 1. Use existing certificate: Provide certificate_arn only
# 2. Create new certificate: Provide domain_name and hosted_zone_id (for DNS validation)
#
# When using pattern 2 (domain_name), the module will:
# - Create an ACM certificate for the domain
# - Create Route53 DNS records for validation (requires hosted_zone_id)
# - Wait for certificate validation to complete
# - Configure HTTPS listener with the new certificate

variable "certificate_arn" {
  description = <<-EOT
    ARN of an existing SSL certificate for HTTPS listener.
    Use this when you have a pre-existing ACM certificate.
    Optional: If not provided and domain_name is null, only HTTP listener will be created.
    Mutually exclusive with domain_name - provide either certificate_arn OR domain_name, not both.
  EOT
  type        = string
  default     = null
}

variable "domain_name" {
  description = <<-EOT
    Domain name for creating a new SSL certificate via ACM.
    Use this when you want the module to create and validate a new certificate.
    Optional: If not provided and certificate_arn is null, only HTTP listener will be created.
    Required when provided: hosted_zone_id must also be provided for DNS validation.
    Mutually exclusive with certificate_arn - provide either certificate_arn OR domain_name, not both.
  EOT
  type        = string
  default     = null
}

variable "subject_alternative_names" {
  description = <<-EOT
    Subject alternative names (SANs) for the SSL certificate.
    Only used when domain_name is provided (creating a new certificate).
    Optional: Defaults to empty list. Add additional domains to be covered by the certificate.
  EOT
  type        = list(string)
  default     = []
}

variable "hosted_zone_id" {
  description = <<-EOT
    Route53 hosted zone ID for DNS-based certificate validation.
    Required when domain_name is provided (creating a new certificate).
    Optional when certificate_arn is provided (using existing certificate).
    The hosted zone must be configured to manage DNS for the domain specified in domain_name.
  EOT
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
