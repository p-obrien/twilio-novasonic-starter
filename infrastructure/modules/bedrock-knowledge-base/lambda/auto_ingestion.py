import json
import boto3
import logging
from urllib.parse import unquote_plus
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Bedrock client
bedrock_client = boto3.client('bedrock-agent')

def handler(event, context):
    """
    Lambda function to automatically trigger Bedrock Knowledge Base ingestion
    when documents are uploaded to S3.
    """
    
    try:
        # Parse S3 event
        for record in event['Records']:
            # Get S3 event details
            event_name = record['eventName']
            bucket_name = record['s3']['bucket']['name']
            object_key = unquote_plus(record['s3']['object']['key'])
            
            logger.info(f"Processing S3 event: {event_name} for object: {object_key}")
            
            # Only process document uploads/deletions
            if event_name.startswith('ObjectCreated') or event_name.startswith('ObjectRemoved'):
                
                # Check if there's already an ingestion job running
                if is_ingestion_running():
                    logger.info("Ingestion job already running, skipping trigger")
                    continue
                
                # Trigger ingestion job
                response = start_ingestion_job()
                
                if response:
                    logger.info(f"Successfully started ingestion job: {response['ingestionJobId']}")
                else:
                    logger.error("Failed to start ingestion job")
            
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Ingestion processing completed',
                'timestamp': datetime.utcnow().isoformat()
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing S3 event: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            })
        }

def is_ingestion_running():
    """Check if there's already an ingestion job running"""
    try:
        response = bedrock_client.list_ingestion_jobs(
            knowledgeBaseId='${knowledge_base_id}',
            dataSourceId='${data_source_id}',
            maxResults=5
        )
        
        # Check if any jobs are in progress
        for job in response.get('ingestionJobSummaries', []):
            if job['status'] in ['STARTING', 'IN_PROGRESS']:
                logger.info(f"Found running ingestion job: {job['ingestionJobId']}")
                return True
                
        return False
        
    except Exception as e:
        logger.error(f"Error checking ingestion status: {str(e)}")
        return False

def start_ingestion_job():
    """Start a new ingestion job"""
    try:
        response = bedrock_client.start_ingestion_job(
            knowledgeBaseId='${knowledge_base_id}',
            dataSourceId='${data_source_id}',
            description=f'Auto-triggered ingestion at {datetime.utcnow().isoformat()}'
        )
        
        return response.get('ingestionJob', {})
        
    except Exception as e:
        logger.error(f"Error starting ingestion job: {str(e)}")
        return None