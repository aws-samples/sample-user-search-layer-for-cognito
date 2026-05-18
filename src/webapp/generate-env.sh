#!/bin/bash

echo "🔧 Fetching stack outputs for local development..."

VITE_COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name SearchableUsers-AuthenticationService --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)
VITE_COGNITO_USER_POOL_WEB_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name SearchableUsers-Frontend --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' --output text)
VITE_API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name SearchableUsers-ApiGateway --query 'Stacks[0].Outputs[?OutputKey==`ApiURL`].OutputValue' --output text)
VITE_COGNITO_OAUTH_DOMAIN=$(aws cloudformation describe-stacks --stack-name SearchableUsers-AuthenticationService --query 'Stacks[0].Outputs[?OutputKey==`UserPoolDomain`].OutputValue' --output text)

cat > .env <<EOF
VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID
VITE_COGNITO_USER_POOL_WEB_CLIENT_ID=$VITE_COGNITO_USER_POOL_WEB_CLIENT_ID
VITE_API_ENDPOINT=$VITE_API_ENDPOINT
VITE_COGNITO_REDIRECT_SIGNIN=http://localhost:5173
VITE_COGNITO_REDIRECT_SIGNOUT=http://localhost:5173
VITE_COGNITO_OAUTH_DOMAIN=$VITE_COGNITO_OAUTH_DOMAIN
EOF

echo "✅ .env file created with:"
cat .env
