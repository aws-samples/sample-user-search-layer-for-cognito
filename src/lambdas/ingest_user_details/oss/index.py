import os
import json
import time
import boto3
import urllib.parse
import urllib3
from botocore.auth import SigV4Auth
from botocore.credentials import Credentials
from botocore.awsrequest import AWSRequest
import hashlib
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

OSS_COLLECTION_ENDPOINT = os.environ.get('OSS_COLLECTION_ENDPOINT', '')
OSS_INDEX_NAME = os.environ.get('OSS_INDEX_NAME', '')
OSS_READWRITE_ROLE_ARN = os.environ.get('OSS_READWRITE_ROLE_ARN', '')
REGION = os.environ['AWS_REGION']

_sts_client = boto3.client('sts')
_http = urllib3.PoolManager(maxsize=4, retries=urllib3.Retry(total=2, backoff_factor=0.1))
_OSS_HOST = urllib.parse.urlparse(OSS_COLLECTION_ENDPOINT).netloc if OSS_COLLECTION_ENDPOINT else ''

_cached_credentials = None
_cached_credentials_expiry = 0
_CRED_REFRESH_BUFFER_SECS = 300


def _get_credentials():
    """Return cached STS credentials for OSS access, refreshing only when near expiry."""
    global _cached_credentials, _cached_credentials_expiry

    if not OSS_READWRITE_ROLE_ARN:
        return boto3.Session().get_credentials()

    if _cached_credentials and time.time() < _cached_credentials_expiry:
        return _cached_credentials

    resp = _sts_client.assume_role(
        RoleArn=OSS_READWRITE_ROLE_ARN,
        RoleSessionName="ingest-oss-session",
    )
    creds = resp['Credentials']
    _cached_credentials = Credentials(
        access_key=creds['AccessKeyId'],
        secret_key=creds['SecretAccessKey'],
        token=creds['SessionToken'],
    )
    _cached_credentials_expiry = creds['Expiration'].timestamp() - _CRED_REFRESH_BUFFER_SECS
    return _cached_credentials


def _signed_request(method, url, body=None):
    """Send a SigV4-signed request to OpenSearch Serverless."""
    headers = {'Host': _OSS_HOST}

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
        timeout=10,
    )


def handler(event, context):
    """
    Process DynamoDB Stream events and sync user data to OpenSearch Serverless.
    Errors are raised (not swallowed) so the event source mapping can retry.
    """
    records = event.get('Records', [])
    if not records:
        return

    logger.info(f"Processing {len(records)} DynamoDB stream records")
    for record in records:
        _process_stream_record(record)


def _process_stream_record(record):
    """Process a single DynamoDB stream record."""
    event_name = record['eventName']
    event_id = record.get('eventID', 'unknown')
    logger.info(f"Processing DynamoDB stream record: eventName={event_name}, eventID={event_id}")

    if event_name in ('INSERT', 'MODIFY'):
        new_image = record['dynamodb']['NewImage']
        user_data = parse_dynamodb_item(new_image)
        document_id = user_data['sub']
        logger.info(f"Indexing user {document_id} to OpenSearch")
        index_user_to_opensearch(document_id, user_data)

    elif event_name == 'REMOVE':
        old_image = record['dynamodb']['OldImage']
        document_id = old_image['sub']['S']
        logger.info(f"Removing user {document_id} from OpenSearch")
        delete_user_from_opensearch(document_id)


def parse_dynamodb_item(dynamodb_item):
    """Convert DynamoDB item format to regular dict."""
    item = {
        'sub': dynamodb_item['sub']['S'],
        'userPoolId': dynamodb_item.get('userPoolId', {}).get('S', ''),
        'userName': dynamodb_item.get('userName', {}).get('S', ''),
        'userStatus': dynamodb_item.get('userStatus', {}).get('S', ''),
        'givenName': dynamodb_item.get('givenName', {}).get('S', ''),
        'familyName': dynamodb_item.get('familyName', {}).get('S', ''),
        'email': dynamodb_item.get('email', {}).get('S', ''),
    }
    # Omit empty date strings — they break OpenSearch date mapping
    last_updated = dynamodb_item.get('lastUpdatedTimestamp', {}).get('S', '')
    if last_updated:
        item['lastUpdatedTimestamp'] = last_updated
    last_login = dynamodb_item.get('lastLoginTimestamp', {}).get('S', '')
    if last_login:
        item['lastLoginTimestamp'] = last_login

    groups_attr = dynamodb_item.get('groups', {})
    item['groups'] = [g['S'] for g in groups_attr.get('L', []) if 'S' in g]

    # Map → nested array: {clientId: ts} → [{clientId, lastLogin}]
    app_client_logins_attr = dynamodb_item.get('appClientLogins', {})
    if 'M' in app_client_logins_attr:
        item['appClientLogins'] = [
            {'clientId': k, 'lastLogin': v['S']}
            for k, v in app_client_logins_attr['M'].items() if 'S' in v
        ]
    else:
        item['appClientLogins'] = []

    return item


def index_user_to_opensearch(document_id, user_data):
    """Index user data to OpenSearch Serverless. Uses a scripted upsert so
    out-of-order stream records don't overwrite newer data."""
    incoming_ts = user_data.get('lastUpdatedTimestamp', '')

    if incoming_ts:
        update_body = {
            "script": {
                "source": (
                    "if (ctx._source.lastUpdatedTimestamp == null || "
                    "params.lastUpdatedTimestamp.compareTo(ctx._source.lastUpdatedTimestamp) >= 0) "
                    "{ ctx._source.putAll(params) } else { ctx.op = 'noop' }"
                ),
                "lang": "painless",
                "params": user_data,
            },
            "upsert": user_data,
        }
        url = f"{OSS_COLLECTION_ENDPOINT}/{OSS_INDEX_NAME}/_update/{document_id}"
        method = 'POST'
    else:
        update_body = user_data
        url = f"{OSS_COLLECTION_ENDPOINT}/{OSS_INDEX_NAME}/_doc/{document_id}"
        method = 'PUT'

    response = _signed_request(method, url, body=update_body)

    if response.status < 200 or response.status >= 300:
        logger.error(f"OpenSearch error ({response.status}): {response.data.decode()}")
        raise Exception(f"Failed to index user data: {response.data.decode()}")

    logger.info(f"Successfully indexed user {document_id}")


def delete_user_from_opensearch(document_id):
    """Delete user from OpenSearch Serverless."""
    url = f"{OSS_COLLECTION_ENDPOINT}/{OSS_INDEX_NAME}/_doc/{document_id}"
    response = _signed_request('DELETE', url)

    if response.status == 404:
        logger.info(f"User {document_id} not found in OpenSearch — already deleted")
        return

    if response.status < 200 or response.status >= 300:
        logger.error(f"OpenSearch delete error ({response.status}): {response.data.decode()}")
        raise Exception(f"Failed to delete user: {response.data.decode()}")

    logger.info(f"Successfully deleted user {document_id}")
