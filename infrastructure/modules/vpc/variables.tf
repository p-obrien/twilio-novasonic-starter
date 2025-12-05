variable "vpc_name" {
  description = "Name for the VPC"
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR block for the VPC (e.g., 10.0.0.0/16)"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnets" {
  description = "List of CIDR blocks for public subnets"
  type        = list(string)
}

variable "private_subnets" {
  description = "List of CIDR blocks for private subnets"
  type        = list(string)
}

variable "azs" {
  description = "List of availability zones for subnet placement"
  type        = list(string)
}

variable "tags" {
  description = "Map of tags to apply to all VPC resources"
  type        = map(string)
  default     = {}
}
