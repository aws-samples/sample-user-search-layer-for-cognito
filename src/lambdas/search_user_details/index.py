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
REGION = os.environ['AWS_REGION']

_sts_client = boto3.client('sts')
_http = urllib3.PoolManager(maxsize=4, retries=urllib3.Retry(total=2, backoff_factor=0.1))
_OSS_HOST = urllib.parse.urlparse(OSS_COLLECTION_ENDPOINT).netloc if OSS_COLLECTION_ENDPOINT else ''

_cached_credentials = None
_cached_credentials_expiry = 0
_CRED_REFRESH_BUFFER_SECS = 300  # refresh 5 min before expiry


def _get_credentials(role_arn):
    """Return cached STS credentials, refreshing only when near expiry."""
    global _cached_credentials, _cached_credentials_expiry

    if _cached_credentials and time.time() < _cached_credentials_expiry:
        return _cached_credentials

    response = _sts_client.assume_role(
        RoleArn=role_arn,
        RoleSessionName="search-user-details-session"
    )
    creds = response['Credentials']
    _cached_credentials = Credentials(
        access_key=creds['AccessKeyId'],
        secret_key=creds['SecretAccessKey'],
        token=creds['SessionToken']
    )
    _cached_credentials_expiry = creds['Expiration'].timestamp() - _CRED_REFRESH_BUFFER_SECS
    return _cached_credentials


ALLOWED_SEARCH_FIELDS = {'givenName', 'familyName', 'email', 'userName'}
ALLOWED_FILTER_FIELDS = {'givenName', 'familyName', 'email', 'userName', 'groups', 'appClientLogins.clientId', 'sub', 'userPoolId', 'userStatus'}
ALLOWED_FUZZINESS = {'AUTO', '0', '1', '2'}
KEYWORD_FIELDS = {'groups', 'sub', 'userPoolId', 'userStatus'}
DATE_FIELDS = {'lastLoginTimestamp', 'lastUpdatedTimestamp'}
_SOURCE_FIELDS = ["sub", "userPoolId", "userName", "userStatus", "givenName",
                  "familyName", "email", "groups", "appClientLogins",
                  "lastUpdatedTimestamp", "lastLoginTimestamp"]

_WILDCARD_SPECIAL = str.maketrans({'*': r'\*', '?': r'\?', '\\': r'\\'})


def handler(event, context):
    try:
        body = json.loads(event['body']) if event['body'] else {}

        if not isinstance(body, dict):
            return build_response(400, {'error': 'Request body must be a JSON object'})

        search_params = body.get('search', {})
        filters = body.get('filters', {})
        date_filters = body.get('dateFilters', {})
        pagination = body.get('pagination', {})
        
        search_text = search_params.get('text', '')
        raw_fields = search_params.get('fields', ['givenName', 'familyName', 'email', 'userName'])
        search_fields = [f for f in raw_fields if f in ALLOWED_SEARCH_FIELDS]
        if not search_fields:
            search_fields = list(ALLOWED_SEARCH_FIELDS)

        fuzziness = search_params.get('fuzziness', 'AUTO')
        if str(fuzziness) not in ALLOWED_FUZZINESS:
            fuzziness = 'AUTO'

        try:
            size = max(1, min(int(pagination.get('size', 10)), 100))
        except (ValueError, TypeError):
            size = 10
        try:
            page = max(0, int(pagination.get('page', 0)))
        except (ValueError, TypeError):
            page = 0
        from_offset = page * size

        filters = {k: v for k, v in filters.items() if k in ALLOWED_FILTER_FIELDS}

        if not search_text and not filters and not date_filters:
            return build_response(400, {'error': 'search.text, filters, or dateFilters parameter is required'})

        results = search_users(search_text, search_fields, fuzziness, filters, date_filters, size, from_offset)

        logger.info(f"Search completed: fields={search_fields}, filterFields={list(filters.keys())}, dateFilterFields={list(date_filters.keys())}, size={size}, page={page}, totalHits={results.get('total', 0)}, took={results.get('took', 0)}ms")
        
        return build_response(200, {
            'users': results.get('hits', []),
            'total': results.get('total', 0),
            'took': results.get('took', 0)
        })
        
    except json.JSONDecodeError:
        return build_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        logger.error(f"Error searching users: {str(e)}", exc_info=True)
        return build_response(500, {'error': 'Internal server error'})


def build_response(status_code, body):
    """Build CORS-enabled HTTP response for API Gateway."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'OPTIONS,POST',
        },
        'body': json.dumps(body)
    }


def search_users(search_text, search_fields, fuzziness, filters, date_filters, size, from_offset):
    """Search users in OpenSearch Serverless. Filters are ANDed together.
    Date filters use range queries with optional gte/lte bounds."""
    oss_readonly_role_arn = os.environ.get('OSS_READONLY_ROLE_ARN')
    if not oss_readonly_role_arn:
        raise Exception("OSS_READONLY_ROLE_ARN environment variable not set")
    
    credentials = _get_credentials(oss_readonly_role_arn)
    
    search_query = None
    filter_clauses = []
    
    if search_text and search_text != '*':
        safe_text = search_text.lower().translate(_WILDCARD_SPECIAL)
        search_query = {
            "bool": {
                "should": [
                    {
                        "multi_match": {
                            "query": search_text,
                            "fields": search_fields,
                            "type": "best_fields",
                            "fuzziness": fuzziness,
                            "boost": 3.0
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        f"{field}.keyword": {
                                            "value": f"*{safe_text}*",
                                            "boost": 2.0 if field in ('givenName', 'familyName', 'userName') else 1.5
                                        }
                                    }
                                } for field in search_fields
                            ]
                        }
                    }
                ],
                "minimum_should_match": 1
            }
        }
    
    for field, filter_config in filters.items():
        if filter_config is None:
            continue
        
        if isinstance(filter_config, str):
            filter_config = {"value": filter_config, "mode": "contains"}
        
        value = filter_config.get("value", "")
        mode = filter_config.get("mode", "contains")
        
        if not value or isinstance(value, list):
            continue
        
        # appClientLogins is a nested type — requires nested query
        if field == 'appClientLogins.clientId':
            if mode == "exact":
                inner_query = {"term": {"appClientLogins.clientId": value}}
            else:
                safe_value = value.lower().translate(_WILDCARD_SPECIAL)
                inner_query = {"wildcard": {"appClientLogins.clientId": {"value": f"*{safe_value}*", "case_insensitive": True}}}
            filter_clauses.append({
                "nested": {
                    "path": "appClientLogins",
                    "query": inner_query
                }
            })
            continue
        
        is_keyword = field in KEYWORD_FIELDS
        target_field = field if is_keyword else f"{field}.keyword"
        
        if mode == "exact":
            filter_clauses.append({
                "term": {target_field: value if is_keyword else value.lower()}
            })
        else:
            safe_value = value.lower().translate(_WILDCARD_SPECIAL)
            filter_clauses.append({
                "wildcard": {target_field: {"value": f"*{safe_value}*", "case_insensitive": True}}
            })
    
    for field, range_config in date_filters.items():
        if field not in DATE_FIELDS or not isinstance(range_config, dict):
            continue
        range_query = {}
        if 'gte' in range_config:
            range_query['gte'] = range_config['gte']
        if 'lte' in range_config:
            range_query['lte'] = range_config['lte']
        if range_query:
            filter_clauses.append({"range": {field: range_query}})
    
    if search_query and filter_clauses:
        final_query = {"bool": {"must": [search_query], "filter": filter_clauses}}
    elif search_query:
        final_query = search_query
    elif filter_clauses:
        final_query = {"bool": {"filter": filter_clauses}}
    else:
        final_query = {"match_all": {}}
    
    search_body = {
        "query": final_query,
        "size": size,
        "from": from_offset,
        "_source": _SOURCE_FIELDS
    }
    
    url = f"{OSS_COLLECTION_ENDPOINT}/{OSS_INDEX_NAME}/_search"
    request_payload = json.dumps(search_body)
    payload_hash = hashlib.sha256(request_payload.encode('utf-8')).hexdigest()
    
    request = AWSRequest(
        method='POST',
        url=url,
        data=request_payload,
        headers={
            'Content-Type': 'application/json',
            'Host': _OSS_HOST,
            'x-amz-content-sha256': payload_hash
        }
    )
    
    auth = SigV4Auth(credentials, 'aoss', REGION)
    auth.add_auth(request)
    
    response = _http.request(
        'POST',
        url,
        headers=dict(request.headers),
        body=request_payload,
        timeout=10
    )
    
    if response.status < 200 or response.status >= 300:
        error_msg = response.data.decode()
        logger.error(f"OpenSearch search error ({response.status}): {error_msg}")
        raise Exception(f"Search failed: {error_msg}")
    
    search_results = json.loads(response.data.decode())
    
    return {
        'hits': [
            {**hit['_source'], '_score': hit['_score']} 
            for hit in search_results['hits']['hits']
        ],
        'total': search_results['hits']['total']['value'],
        'took': search_results['took']
    }
