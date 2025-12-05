variable "repository_name" {
  description = "Name of the ECR repository. This will be used as the Docker image repository name."
  type        = string
}

variable "image_tag_mutability" {
  description = "Tag mutability setting for the repository. MUTABLE allows tags to be overwritten, IMMUTABLE prevents tag changes. Default is MUTABLE for development flexibility."
  type        = string
  default     = "MUTABLE"
}

variable "scan_on_push" {
  description = "Enable automatic vulnerability scanning when images are pushed to the repository. Recommended for security compliance."
  type        = bool
  default     = true
}

variable "encryption_type" {
  description = "Encryption type for images at rest. AES256 uses AWS-managed encryption, KMS allows custom key management. Default is AES256 for simplicity."
  type        = string
  default     = "AES256"
}

variable "force_delete" {
  description = "Allow repository deletion even when it contains images. Default is false to prevent accidental data loss. Set to true only in non-production environments."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Map of tags to assign to the ECR repository. Typically includes Environment, Project, and ManagedBy tags."
  type        = map(string)
  default     = {}
}
