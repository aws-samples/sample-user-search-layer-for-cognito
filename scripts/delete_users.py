"""Delete all users from the Cognito user pool except a specified user.

Usage:
    python scripts/delete_users.py --user-pool-id <USER_POOL_ID> --keep philip.chen4

Requires: boto3
"""

import argparse
import boto3
import sys

def delete_all_users(user_pool_id, keep_usernames):
    client = boto3.client('cognito-idp')
    keep = set(keep_usernames)
    deleted = 0
    skipped = 0
    pagination_token = None

    while True:
        params = {'UserPoolId': user_pool_id, 'Limit': 60}
        if pagination_token:
            params['PaginationToken'] = pagination_token

        response = client.list_users(**params)

        for user in response.get('Users', []):
            username = user['Username']
            if username in keep:
                print(f"  SKIP: {username}")
                skipped += 1
                continue
            try:
                client.admin_delete_user(UserPoolId=user_pool_id, Username=username)
                print(f"  DELETED: {username}")
                deleted += 1
            except Exception as e:
                print(f"  ERROR deleting {username}: {e}")

        pagination_token = response.get('PaginationToken')
        if not pagination_token:
            break

    print(f"\nDone. Deleted: {deleted}, Skipped: {skipped}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Delete Cognito users except specified ones')
    parser.add_argument('--user-pool-id', required=True, help='Cognito User Pool ID')
    parser.add_argument('--keep', nargs='+', default=['philip.chen4'], help='Usernames to keep (default: philip.chen4)')
    parser.add_argument('--dry-run', action='store_true', help='List users that would be deleted without deleting')
    args = parser.parse_args()

    if args.dry_run:
        client = boto3.client('cognito-idp')
        keep = set(args.keep)
        pagination_token = None
        print(f"DRY RUN — users that would be deleted from {args.user_pool_id}:\n")
        while True:
            params = {'UserPoolId': args.user_pool_id, 'Limit': 60}
            if pagination_token:
                params['PaginationToken'] = pagination_token
            response = client.list_users(**params)
            for user in response.get('Users', []):
                username = user['Username']
                action = 'KEEP' if username in keep else 'DELETE'
                print(f"  {action}: {username}")
            pagination_token = response.get('PaginationToken')
            if not pagination_token:
                break
        sys.exit(0)

    print(f"Deleting all users from {args.user_pool_id} except: {args.keep}\n")
    delete_all_users(args.user_pool_id, args.keep)
