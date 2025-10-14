# S3 Bucket for Knowledge Base document storage
resource "aws_s3_bucket" "knowledge_base_documents" {
  bucket = "${var.knowledge_base_name}-documents-${random_id.bucket_suffix.hex}"

  tags = var.tags
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# S3 Bucket versioning for documents
resource "aws_s3_bucket_versioning" "knowledge_base_documents" {
  bucket = aws_s3_bucket.knowledge_base_documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket encryption for documents
resource "aws_s3_bucket_server_side_encryption_configuration" "knowledge_base_documents" {
  bucket = aws_s3_bucket.knowledge_base_documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# S3 Bucket public access block for documents
resource "aws_s3_bucket_public_access_block" "knowledge_base_documents" {
  bucket = aws_s3_bucket.knowledge_base_documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Aurora Serverless v2 cluster for vector storage with pgvector
resource "aws_rds_cluster" "knowledge_base_vector_db" {
  cluster_identifier     = "${var.knowledge_base_name}-vector-db"
  engine                = "aurora-postgresql"
  engine_mode           = "provisioned"
  engine_version        = "15.4"
  database_name         = var.database_name
  master_username       = var.db_username
  manage_master_user_password = true
  
  # Enable Data API v2 (required for Bedrock Knowledge Base integration)
  enable_http_endpoint = true
  
  serverlessv2_scaling_configuration {
    max_capacity = var.max_capacity
    min_capacity = var.min_capacity
  }

  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  db_subnet_group_name   = aws_db_subnet_group.knowledge_base_subnet_group.name
  
  skip_final_snapshot = var.skip_final_snapshot
  deletion_protection = var.deletion_protection
  
  tags = var.tags
}

# Aurora Serverless v2 instance
resource "aws_rds_cluster_instance" "knowledge_base_vector_db_instance" {
  identifier         = "${var.knowledge_base_name}-vector-db-instance"
  cluster_identifier = aws_rds_cluster.knowledge_base_vector_db.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.knowledge_base_vector_db.engine
  engine_version     = aws_rds_cluster.knowledge_base_vector_db.engine_version

  tags = var.tags
}

# Initialize the database with pgvector extension and required table
resource "null_resource" "initialize_vector_db" {
  depends_on = [
    aws_rds_cluster_instance.knowledge_base_vector_db_instance
  ]

  provisioner "local-exec" {
    command = <<-EOT
      set -e  # Exit on any error
      
      echo "Waiting for Aurora cluster to be available..."
      aws rds wait db-cluster-available --db-cluster-identifier ${aws_rds_cluster.knowledge_base_vector_db.cluster_identifier}
      
      echo "Creating pgvector extension..."
      aws rds-data execute-statement \
        --resource-arn "${aws_rds_cluster.knowledge_base_vector_db.arn}" \
        --secret-arn "${aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn}" \
        --database "${var.database_name}" \
        --sql "CREATE EXTENSION IF NOT EXISTS vector;"
      
      echo "Creating bedrock_integration table..."
      aws rds-data execute-statement \
        --resource-arn "${aws_rds_cluster.knowledge_base_vector_db.arn}" \
        --secret-arn "${aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn}" \
        --database "${var.database_name}" \
        --sql "CREATE TABLE IF NOT EXISTS ${var.vector_table_name} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chunks TEXT,
          embedding vector(1536),
          metadata JSONB
        );"
      
      echo "Creating GIN index for text search on chunks column (required by Bedrock Knowledge Base)..."
      aws rds-data execute-statement \
        --resource-arn "${aws_rds_cluster.knowledge_base_vector_db.arn}" \
        --secret-arn "${aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn}" \
        --database "${var.database_name}" \
        --sql "CREATE INDEX IF NOT EXISTS ${var.vector_table_name}_chunks_gin_idx ON ${var.vector_table_name} USING gin (to_tsvector('simple', chunks));"
      
      echo "Creating HNSW vector index for embedding column (required by Bedrock Knowledge Base)..."
      aws rds-data execute-statement \
        --resource-arn "${aws_rds_cluster.knowledge_base_vector_db.arn}" \
        --secret-arn "${aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn}" \
        --database "${var.database_name}" \
        --sql "CREATE INDEX IF NOT EXISTS ${var.vector_table_name}_embedding_idx ON ${var.vector_table_name} USING hnsw (embedding vector_cosine_ops);"
      
      echo "Database initialization completed successfully!"
      
      # Verify the required indexes were created
      echo "Verifying required indexes for Bedrock Knowledge Base..."
      aws rds-data execute-statement \
        --resource-arn "${aws_rds_cluster.knowledge_base_vector_db.arn}" \
        --secret-arn "${aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn}" \
        --database "${var.database_name}" \
        --sql "SELECT COUNT(*) as index_count FROM pg_indexes WHERE tablename = '${var.vector_table_name}' AND (indexname LIKE '%chunks_gin_idx' OR indexname LIKE '%embedding_idx');" \
        --output text
    EOT
  }

  # Trigger re-creation if configuration changes
  triggers = {
    table_name = var.vector_table_name
    cluster_id = aws_rds_cluster.knowledge_base_vector_db.id
    database_name = var.database_name
  }
}

# DB Subnet Group
resource "aws_db_subnet_group" "knowledge_base_subnet_group" {
  name       = "${var.knowledge_base_name}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.knowledge_base_name}-subnet-group"
  })
}

# Security Group for RDS
resource "aws_security_group" "rds_sg" {
  name        = "${var.knowledge_base_name}-rds-sg"
  description = "Security group for Knowledge Base RDS cluster"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.knowledge_base_name}-rds-sg"
  })
}

# IAM role for Bedrock Knowledge Base
resource "aws_iam_role" "knowledge_base_role" {
  name = "${var.knowledge_base_name}-knowledge-base-role"

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
            "aws:SourceArn" = "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:knowledge-base/*"
          }
        }
      }
    ]
  })

  tags = var.tags
}

data "aws_caller_identity" "current" {}

# IAM policy for Knowledge Base to access S3 documents
resource "aws_iam_role_policy" "knowledge_base_s3_policy" {
  name = "${var.knowledge_base_name}-s3-policy"
  role = aws_iam_role.knowledge_base_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.knowledge_base_documents.arn,
          "${aws_s3_bucket.knowledge_base_documents.arn}/*"
        ]
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# IAM policy for Knowledge Base to access RDS
resource "aws_iam_role_policy" "knowledge_base_rds_policy" {
  name = "${var.knowledge_base_name}-rds-policy"
  role = aws_iam_role.knowledge_base_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "rds:DescribeDBClusters",
          "rds:DescribeDBInstances",
          "rds:DescribeDBSubnetGroups"
        ]
        Resource = [
          aws_rds_cluster.knowledge_base_vector_db.arn,
          "${aws_rds_cluster.knowledge_base_vector_db.arn}:*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "rds-data:BatchExecuteStatement",
          "rds-data:BeginTransaction",
          "rds-data:CommitTransaction",
          "rds-data:ExecuteStatement",
          "rds-data:RollbackTransaction"
        ]
        Resource = aws_rds_cluster.knowledge_base_vector_db.arn
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn
      }
    ]
  })
}

# IAM policy for Knowledge Base to access embedding models
resource "aws_iam_role_policy" "knowledge_base_bedrock_policy" {
  name = "${var.knowledge_base_name}-bedrock-policy"
  role = aws_iam_role.knowledge_base_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:aws:bedrock:${var.region}::foundation-model/${var.embedding_model_id}"
        ]
      }
    ]
  })
}

# Wait for database initialization to complete before creating knowledge base
resource "time_sleep" "wait_for_db_init" {
  depends_on = [null_resource.initialize_vector_db]
  create_duration = "30s"
}

# Bedrock Knowledge Base with Aurora Serverless vector storage
resource "aws_bedrockagent_knowledge_base" "main" {
  name     = var.knowledge_base_name
  role_arn = aws_iam_role.knowledge_base_role.arn

  knowledge_base_configuration {
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${var.region}::foundation-model/${var.embedding_model_id}"
    }
    type = "VECTOR"
  }

  storage_configuration {
    type = "RDS"
    rds_configuration {
      credentials_secret_arn = aws_rds_cluster.knowledge_base_vector_db.master_user_secret[0].secret_arn
      database_name         = aws_rds_cluster.knowledge_base_vector_db.database_name
      resource_arn          = aws_rds_cluster.knowledge_base_vector_db.arn
      table_name           = var.vector_table_name
      field_mapping {
        metadata_field    = "metadata"
        primary_key_field = "id"
        text_field        = "chunks"
        vector_field      = "embedding"
      }
    }
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy.knowledge_base_s3_policy,
    aws_iam_role_policy.knowledge_base_rds_policy,
    aws_iam_role_policy.knowledge_base_bedrock_policy,
    null_resource.initialize_vector_db,
    time_sleep.wait_for_db_init
  ]
}

# Bedrock Knowledge Base Data Source
resource "aws_bedrockagent_data_source" "main" {
  knowledge_base_id = aws_bedrockagent_knowledge_base.main.id
  name              = "${var.knowledge_base_name}-data-source"

  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn = aws_s3_bucket.knowledge_base_documents.arn
      inclusion_prefixes = var.s3_inclusion_prefixes
    }
  }

  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = var.chunking_strategy
      dynamic "fixed_size_chunking_configuration" {
        for_each = var.chunking_strategy == "FIXED_SIZE" ? [1] : []
        content {
          max_tokens         = var.max_tokens
          overlap_percentage = var.overlap_percentage
        }
      }
    }
  }
}