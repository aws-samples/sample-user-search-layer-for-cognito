import boto3
import logging
import os
from datetime import datetime, timezone
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DYNAMO_TABLE'])
cognito = boto3.client('cognito-idp')

USER_POOL_ID = os.environ['USER_POOL_ID']

REMOVE_EVENTS = {'AdminDeleteUser', 'AdminDisableUser'}
SYNC_EVENTS = {'AdminCreateUser', 'AdminEnableUser', 'AdminAddUserToGroup',
               'AdminRemoveUserFromGroup', 'AdminUpdateUserAttributes'}


def handler(event, context):
    """Handles CloudTrail events for Cognito admin actions via EventBridge."""
    _process_cloudtrail_event(event)


def _process_cloudtrail_event(event):
    """Process a single CloudTrail event from EventBridge."""
    detail = event.get('detail', {})
    event_name = detail.get('eventName', '')
    request_params = detail.get('requestParameters', {})
    sub = detail.get('additionalEventData', {}).get('sub', '')

    if detail.get('errorCode'):
        logger.info(f"Skipping failed event: {event_name}, error={detail['errorCode']}")
        return

    if request_params.get('userPoolId', '') != USER_POOL_ID:
        logger.info(f"Ignoring event for different user pool: {request_params.get('userPoolId')}")
        return

    if not sub:
        logger.warning(f"No sub in additionalEventData for event: {event_name}")
        return

    logger.info(f"Processing: {event_name}, sub={sub}")

    if event_name in REMOVE_EVENTS:
        table.delete_item(Key={'sub': sub})
        logger.info(f"Removed user sub={sub}")
    elif event_name in SYNC_EVENTS:
        _sync_user_from_cognito(sub)
    else:
        logger.info(f"Unhandled event: {event_name}")


def _sync_user_from_cognito(sub):
    """Read current user state from Cognito and upsert profile fields in DynamoDB.
    Skips login-specific fields (lastLoginTimestamp, appClientLogins)."""
    response = cognito.list_users(
        UserPoolId=USER_POOL_ID,
        Filter=f'sub = "{sub}"',
        Limit=1,
    )
    users = response.get('Users', [])
    if not users:
        logger.warning(f"User sub={sub} not found in Cognito, removing from DynamoDB")
        table.delete_item(Key={'sub': sub})
        return

    user = users[0]
    attrs = {a['Name']: a['Value'] for a in user.get('Attributes', [])}
    username = user.get('Username', '')
    user_status = 'DISABLED' if not user.get('Enabled', True) else user.get('UserStatus', 'UNKNOWN')
    groups = _list_user_groups(username)
    now = datetime.now(timezone.utc).isoformat()

    try:
        table.update_item(
            Key={'sub': sub},
            UpdateExpression=(
                'SET userPoolId = :upid, userName = :un, email = :em, '
                'givenName = :gn, familyName = :fn, userStatus = :us, '
                'groups = :gr, lastUpdatedTimestamp = :lut'
            ),
            ConditionExpression='attribute_not_exists(lastUpdatedTimestamp) OR lastUpdatedTimestamp <= :lut',
            ExpressionAttributeValues={
                ':upid': USER_POOL_ID,
                ':un': username,
                ':em': attrs.get('email', ''),
                ':gn': attrs.get('given_name', ''),
                ':fn': attrs.get('family_name', ''),
                ':us': user_status,
                ':gr': groups,
                ':lut': now,
            },
        )
        logger.info(f"Synced sub={sub}, status={user_status}, groups={groups}")
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            logger.info(f"Skipping stale update for sub={sub}")
        else:
            raise


_groups_paginator = cognito.get_paginator('admin_list_groups_for_user')


def _list_user_groups(username):
    """Paginate through all groups for a user."""
    return [
        g['GroupName']
        for page in _groups_paginator.paginate(UserPoolId=USER_POOL_ID, Username=username)
        for g in page.get('Groups', [])
    ]
