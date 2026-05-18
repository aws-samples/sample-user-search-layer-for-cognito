import boto3
import logging
import os
from datetime import datetime, timezone
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DYNAMO_TABLE'])

# Trigger sources this Lambda handles:
# - PostConfirmation_ConfirmSignUp: initial user record in DynamoDB
# - TokenGeneration_*: login tracking (lastLoginTimestamp, appClientLogins)
POST_CONFIRMATION_PREFIX = 'PostConfirmation_'
TOKEN_GENERATION_PREFIX = 'TokenGeneration_'


def handler(event, context):
    trigger_source = event.get('triggerSource', '')
    user_attributes = event['request']['userAttributes']
    sub = user_attributes.get('sub')
    logger.info(f"Received Cognito event: triggerSource={trigger_source}, sub={sub}")
    now = datetime.now(timezone.utc).isoformat()

    if trigger_source.startswith(POST_CONFIRMATION_PREFIX):
        _upsert_user_record(event, sub, user_attributes, now)
    elif trigger_source.startswith(TOKEN_GENERATION_PREFIX):
        _track_login(event, sub, user_attributes, now)
    else:
        logger.warning(f"Unexpected trigger source: {trigger_source}, skipping")

    return event


def _build_user_item(event, sub, user_attributes, now):
    """Build a complete user record from a Cognito trigger event."""
    return {
        'sub': sub,
        'userPoolId': event['userPoolId'],
        'userName': event['userName'],
        'email': user_attributes.get('email', ''),
        'givenName': user_attributes.get('given_name', ''),
        'familyName': user_attributes.get('family_name', ''),
        'userStatus': event['request'].get('userStatus', 'CONFIRMED'),
        'groups': event['request'].get('groupConfiguration', {}).get('groupsToOverride', []) or [],
        'appClientLogins': {},
        'lastUpdatedTimestamp': now,
    }


def _upsert_user_record(event, sub, user_attributes, now):
    """Create the initial user record on sign-up confirmation."""
    item = _build_user_item(event, sub, user_attributes, now)
    table.put_item(Item=item)
    logger.info(f"User created for sub: {sub}")


def _track_login(event, sub, user_attributes, now):
    """Track login timestamp and app client. If no record exists yet
    (e.g. admin-created user's first login), creates a full record."""
    client_id = event.get('callerContext', {}).get('clientId', '')

    try:
        update_parts = [
            'lastLoginTimestamp = :llt',
            'lastUpdatedTimestamp = :lut',
        ]
        expr_names = {}
        expr_values = {
            ':llt': now,
            ':lut': now,
        }

        if client_id:
            update_parts.append('appClientLogins.#cid = :cllt')
            expr_names['#cid'] = client_id
            expr_values[':cllt'] = now

        kwargs = {
            'Key': {'sub': sub},
            'UpdateExpression': 'SET ' + ', '.join(update_parts),
            'ConditionExpression': 'attribute_exists(#sub) AND attribute_exists(appClientLogins)',
            'ExpressionAttributeValues': expr_values,
        }
        expr_names['#sub'] = 'sub'
        kwargs['ExpressionAttributeNames'] = expr_names

        table.update_item(**kwargs)
        logger.info(f"Login tracked for sub: {sub}, appClient: {client_id}")

    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            # Record doesn't exist yet — create full record with login fields
            item = _build_user_item(event, sub, user_attributes, now)
            item['lastLoginTimestamp'] = now
            if client_id:
                item['appClientLogins'] = {client_id: now}
            table.put_item(Item=item)
            logger.info(f"Created full record on first login for sub: {sub}, appClient: {client_id}")
        else:
            raise
