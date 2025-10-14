# Lambda function for automatic ingestion (always enabled)
resource "aws_lambda_function" "auto_ingestion" {
  filename         = data.archive_file.auto_ingestion_zip.output_path
  function_name    = "${var.knowledge_base_name}-auto-ingestion"
  role            = aws_iam_role.auto_ingestion_role.arn
  handler         = "index.handler"
  runtime         = "python3.11"
  timeout         = 300
  
  source_code_hash = data.archive_file.auto_ingestion_zip.output_base64sha256

  environment {
    variables = {
      KNOWLEDGE_BASE_ID = aws_bedrockagent_knowledge_base.main.id
      DATA_SOURCE_ID    = aws_bedrockagent_data_source.main.data_source_id
    }
  }

  tags = var.tags
}

# Create the Lambda deployment package
data "archive_file" "auto_ingestion_zip" {
  type        = "zip"
  output_path = "${path.module}/auto_ingestion.zip"
  
  source {
    content = templatefile("${path.module}/lambda/auto_ingestion.py", {
      knowledge_base_id = aws_bedrockagent_knowledge_base.main.id
      data_source_id    = aws_bedrockagent_data_source.main.data_source_id
    })
    filename = "index.py"
  }
}

# IAM role for the Lambda function
resource "aws_iam_role" "auto_ingestion_role" {
  name = "${var.knowledge_base_name}-auto-ingestion-role"

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

# IAM policy for Lambda to trigger ingestion
resource "aws_iam_role_policy" "auto_ingestion_policy" {
  name = "${var.knowledge_base_name}-auto-ingestion-policy"
  role = aws_iam_role.auto_ingestion_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:StartIngestionJob",
          "bedrock:GetIngestionJob",
          "bedrock:ListIngestionJobs"
        ]
        Resource = [
          aws_bedrockagent_knowledge_base.main.arn,
          "${aws_bedrockagent_knowledge_base.main.arn}/*"
        ]
      }
    ]
  })
}

# S3 bucket notification to trigger Lambda
resource "aws_s3_bucket_notification" "auto_ingestion_trigger" {
  bucket = aws_s3_bucket.knowledge_base_documents.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.auto_ingestion.arn
    events              = ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
    filter_prefix       = var.auto_ingestion_prefix
    filter_suffix       = ""
  }

  depends_on = [aws_lambda_permission.allow_s3_invoke]
}

# Permission for S3 to invoke Lambda
resource "aws_lambda_permission" "allow_s3_invoke" {
  statement_id  = "AllowExecutionFromS3Bucket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auto_ingestion.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.knowledge_base_documents.arn
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "auto_ingestion_logs" {
  name              = "/aws/lambda/${aws_lambda_function.auto_ingestion.function_name}"
  retention_in_days = var.auto_ingestion_log_retention_days

  tags = var.tags
}