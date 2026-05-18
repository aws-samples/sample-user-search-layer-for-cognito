#!/bin/bash

echo "=========================================="
echo "  Deploying Searchable Cognito Users"
echo "=========================================="
echo ""

echo "📦 Step 1: Deploying CDK Infrastructure..."
echo "------------------------------------------"
npx cdk deploy --all --require-approval never
echo "✅ CDK deployment complete"
echo ""

echo "🔧 Step 2: Retrieving Stack Outputs..."
echo "------------------------------------------"
WEBSITE_S3_BUCKET=$(aws cloudformation describe-stacks --stack-name SearchableUsers-Frontend --query 'Stacks[0].Outputs[?OutputKey==`S3BucketName`].OutputValue' --output text)
WEBSITE_URL=$(aws cloudformation describe-stacks --stack-name SearchableUsers-Frontend --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' --output text)
export VITE_COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name SearchableUsers-AuthenticationService --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)
export VITE_COGNITO_USER_POOL_WEB_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name SearchableUsers-Frontend --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' --output text)
export VITE_API_ENDPOINT=$(aws cloudformation describe-stacks --stack-name SearchableUsers-ApiGateway --query 'Stacks[0].Outputs[?OutputKey==`ApiURL`].OutputValue' --output text)
export VITE_COGNITO_OAUTH_DOMAIN=$(aws cloudformation describe-stacks --stack-name SearchableUsers-AuthenticationService --query 'Stacks[0].Outputs[?OutputKey==`UserPoolDomain`].OutputValue' --output text)
export VITE_COGNITO_REDIRECT_SIGNIN=$WEBSITE_URL
export VITE_COGNITO_REDIRECT_SIGNOUT=$WEBSITE_URL

echo "  User Pool ID:        $VITE_COGNITO_USER_POOL_ID"
echo "  Client ID:           $VITE_COGNITO_USER_POOL_WEB_CLIENT_ID"
echo "  API Endpoint:        $VITE_API_ENDPOINT"
echo "  OAuth Domain:        $VITE_COGNITO_OAUTH_DOMAIN"
echo "  Redirect Sign In:    $VITE_COGNITO_REDIRECT_SIGNIN"
echo "  Redirect Sign Out:   $VITE_COGNITO_REDIRECT_SIGNOUT"
echo "  Website S3 Bucket:   $WEBSITE_S3_BUCKET"
echo ""

echo "🏗️  Step 3: Building Web Application..."
echo "------------------------------------------"
cd src/webapp
npm install
npm run build
echo "✅ Build complete"
echo ""

echo "🚀 Step 4: Deploying to S3..."
echo "------------------------------------------"
aws s3 sync ./dist/ s3://$WEBSITE_S3_BUCKET --delete
echo "✅ Deployment complete"
echo ""

echo "🔄 Step 5: Invalidating CloudFront cache..."
echo "------------------------------------------"
CF_DOMAIN=$(aws cloudformation describe-stacks --stack-name SearchableUsers-Frontend --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' --output text | sed 's|https://||')
CF_DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?DomainName=='${CF_DOMAIN}'].Id" --output text)
if [ -n "$CF_DIST_ID" ]; then
  aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*" > /dev/null
  echo "✅ CloudFront invalidation created"
else
  echo "⚠️  Could not determine CloudFront distribution ID — skip invalidation"
fi
echo ""

echo "=========================================="
echo "  ✨ Deployment Successful!"
echo "=========================================="
echo "  Application URL: $VITE_COGNITO_REDIRECT_SIGNIN"
echo "=========================================="