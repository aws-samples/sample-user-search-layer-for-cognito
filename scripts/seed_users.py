#!/usr/bin/env python3
"""
Seed Cognito User Pool with 50 users across 3 groups.
DynamoDB and OpenSearch indexing happens automatically via
CloudTrail → EventBridge → IngestCognitoCloudTrailToDynamoFn → DynamoDB Stream → OpenSearch.

Usage:
    python3 scripts/seed_users.py \
        --user-pool-id <USER_POOL_ID> \
        [--count 50]
"""

import argparse
import boto3
import random
import string
import sys

FIRST_NAMES = [
    "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
    "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Christopher", "Karen", "Charles", "Lisa", "Daniel", "Nancy",
    "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
    "Steven", "Dorothy", "Paul", "Kimberly", "Andrew", "Emily", "Joshua", "Donna",
    "Kenneth", "Michelle", "Kevin", "Carol", "Brian", "Amanda", "George", "Melissa",
    "Timothy", "Deborah",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
    "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Carter", "Roberts",
]

GROUPS = [
    {"name": "Admins", "description": "Administrator users with full access"},
    {"name": "Editors", "description": "Users who can edit content"},
    {"name": "Viewers", "description": "Read-only users"},
]


def generate_password():
    lower = random.choices(string.ascii_lowercase, k=4)
    upper = random.choices(string.ascii_uppercase, k=2)
    digits = random.choices(string.digits, k=2)
    special = random.choices("!@#$%^&*", k=1)
    pw = lower + upper + digits + special
    random.shuffle(pw)
    return "".join(pw)


def ensure_groups(cognito, user_pool_id):
    """Create Cognito groups if they don't exist."""
    existing = set()
    try:
        resp = cognito.list_groups(UserPoolId=user_pool_id, Limit=60)
        existing = {g["GroupName"] for g in resp.get("Groups", [])}
    except Exception as e:
        print(f"  ⚠️  Could not list groups: {e}")

    for group in GROUPS:
        if group["name"] not in existing:
            try:
                cognito.create_group(
                    GroupName=group["name"],
                    UserPoolId=user_pool_id,
                    Description=group["description"],
                )
                print(f"  ✅ Created group: {group['name']}")
            except Exception as e:
                print(f"  ⚠️  Could not create group {group['name']}: {e}")
        else:
            print(f"  ⏭️  Group already exists: {group['name']}")


def seed_users(user_pool_id, count):
    cognito = boto3.client("cognito-idp")

    # Ensure groups exist first
    print("\n📂 Creating groups...")
    ensure_groups(cognito, user_pool_id)
    print()

    created = 0
    skipped = 0
    group_names = [g["name"] for g in GROUPS]

    for i in range(count):
        first = FIRST_NAMES[i % len(FIRST_NAMES)]
        last = LAST_NAMES[i % len(LAST_NAMES)]
        suffix = f"{i + 1:03d}"
        username = f"{first.lower()}.{last.lower()}.{suffix}"
        email = f"{username}@example.com"
        password = generate_password()

        # Assign group round-robin
        group = group_names[i % len(group_names)]

        try:
            cognito.admin_create_user(
                UserPoolId=user_pool_id,
                Username=username,
                UserAttributes=[
                    {"Name": "email", "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                    {"Name": "given_name", "Value": first},
                    {"Name": "family_name", "Value": last},
                ],
                MessageAction="SUPPRESS",
            )

            cognito.admin_set_user_password(
                UserPoolId=user_pool_id,
                Username=username,
                Password=password,
                Permanent=True,
            )

            # Add user to group
            cognito.admin_add_user_to_group(
                UserPoolId=user_pool_id,
                Username=username,
                GroupName=group,
            )

            created += 1
            print(f"  ✅ [{created}/{count}] {username} -> {group}")

        except cognito.exceptions.UsernameExistsException:
            skipped += 1
            print(f"  ⏭️  [{skipped} skipped] {username} already exists")
        except Exception as e:
            print(f"  ❌ Error creating {username}: {e}", file=sys.stderr)

    print(f"\nDone: {created} created, {skipped} skipped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed Cognito users")
    parser.add_argument("--user-pool-id", required=True)
    parser.add_argument("--count", type=int, default=50)
    args = parser.parse_args()

    seed_users(args.user_pool_id, args.count)
