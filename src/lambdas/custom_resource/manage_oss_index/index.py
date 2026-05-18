import boto3
import json
import urllib.parse
import urllib3
from botocore.auth import SigV4Auth
from botocore.credentials import Credentials
from botocore.awsrequest import AWSRequest
import hashlib
import logging
import os
from cfnresponse import send, SUCCESS, FAILED

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

REGION = os.environ['AWS_REGION']

_sts_client = boto3.client('sts')
_http = urllib3.PoolManager(maxsize=2, retries=urllib3.Retry(total=2, backoff_factor=0.1))


def _get_credentials():
    """Return SigV4-compatible credentials, assuming a role if configured."""
    oss_role_arn = os.environ.get('OSS_READWRITE_ROLE_ARN')
    if oss_role_arn:
        resp = _sts_client.assume_role(
            RoleArn=oss_role_arn,
            RoleSessionName="manage-oss-index-session",
        )
        creds = resp['Credentials']
        return Credentials(
            access_key=creds['AccessKeyId'],
            secret_key=creds['SecretAccessKey'],
            token=creds['SessionToken'],
        )
    return boto3.Session().get_credentials()


def _signed_request(method, url, body=None):
    """Send a SigV4-signed request to OpenSearch Serverless."""
    host = urllib.parse.urlparse(url).netloc
    headers = {'Host': host}

    if body is not None:
        payload = json.dumps(body) if isinstance(body, dict) else body
        payload_hash = hashlib.sha256(payload.encode('utf-8')).hexdigest()
        headers['Content-Type'] = 'application/json'
        headers['x-amz-content-sha256'] = payload_hash
    else:
        payload = None

    request = AWSRequest(method=method, url=url, data=payload, headers=headers)
    SigV4Auth(_get_credentials(), 'aoss', REGION).add_auth(request)

    return _http.request(
        method, url,
        headers=dict(request.headers),
        body=payload,
        timeout=30,
    )


def handler(event, context):
    try:
        logger.info(f"Received event: RequestType={event['RequestType']}, IndexName={event['ResourceProperties'].get('IndexName', 'unknown')}")
        collection_endpoint = event['ResourceProperties']['CollectionEndpoint']
        index_name = event['ResourceProperties']['IndexName']
        mappings = json.loads(event['ResourceProperties']['Mappings'])

        request_type = event['RequestType']
        if request_type == 'Create':
            create_index(collection_endpoint, index_name, mappings)
            logger.info(f"Successfully created index {index_name}")
            send(event, context, SUCCESS, {}, f"{collection_endpoint}/{index_name}")
        elif request_type == 'Update':
            create_index(collection_endpoint, index_name, mappings)
            logger.info(f"Successfully updated/ensured index {index_name}")
            send(event, context, SUCCESS, {})
        elif request_type == 'Delete':
            delete_index(collection_endpoint, index_name)
            logger.info(f"Successfully deleted index {index_name}")
            send(event, context, SUCCESS, {})
        else:
            error_msg = f"Unsupported operation: {request_type}"
            logger.error(error_msg)
            send(event, context, FAILED, {"Error": error_msg})
    except Exception as e:
        logger.exception("Error occurred handling the custom resource event")
        send(event, context, FAILED, {"Error": str(e)})


def create_index(collection_endpoint, index_name, mappings):
    """Create or update an OpenSearch index."""
    mappings = dict(mappings)
    index_config = {}
    if 'settings' in mappings:
        index_config['settings'] = mappings.pop('settings')
    index_config['mappings'] = mappings

    url = f"{collection_endpoint}/{index_name}"
    response = _signed_request('PUT', url, body=index_config)

    if response.status < 200 or response.status >= 300:
        error_msg = response.data.decode()
        logger.error(f"Failed to create index ({response.status}): {error_msg}")
        raise Exception(f"Failed to create index: {error_msg}")

    logger.info(f"Index creation successful: {response.data.decode()}")


def delete_index(collection_endpoint, index_name):
    """Delete an OpenSearch index. Treats 404 as success (already deleted)."""
    url = f"{collection_endpoint}/{index_name}"
    response = _signed_request('DELETE', url)

    if response.status < 200 or (response.status >= 300 and response.status != 404):
        error_msg = response.data.decode()
        logger.error(f"Failed to delete index ({response.status}): {error_msg}")
        raise Exception(f"Failed to delete index: {error_msg}")

    if response.status == 404:
        logger.info(f"Index {index_name} not found - may already be deleted")
    else:
        logger.info(f"Index deletion successful: {response.data.decode()}")
