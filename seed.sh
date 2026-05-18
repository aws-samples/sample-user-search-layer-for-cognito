#!/bin/bash

echo "=========================================="
echo "  Seeding Cognito Users"
echo "=========================================="
echo ""

echo "🔧 Step 1: Retrieving Stack Outputs..."
echo "------------------------------------------"
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name SearchableUsers-AuthenticationService \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
  echo "❌ Could not retrieve User Pool ID. Is the stack deployed?"
  exit 1
fi

echo "  User Pool ID:    $USER_POOL_ID"
echo ""

echo "🌱 Step 2: Seeding 50 users..."
echo "------------------------------------------"
python scripts/seed_users.py \
  --user-pool-id "$USER_POOL_ID" \
  --count 50

echo ""
echo "=========================================="
echo "  ✨ Seeding Complete!"
echo "=========================================="
