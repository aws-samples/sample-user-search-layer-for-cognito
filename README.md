# Searchable Cognito Users

A sample solution that makes Amazon Cognito user pool users searchable via Amazon OpenSearch Serverless. User profile data is synced to OpenSearch through three complementary paths: sign-up confirmation, sign-in triggers, and admin action capture via CloudTrail + EventBridge.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Ingestion                           │
│                                                                 │
│  User signs up ──► POST_CONFIRMATION trigger ──► Lambda         │
│                    (creates initial DynamoDB record)             │
│                                                                 │
│  User signs in ──► PRE_TOKEN_GENERATION trigger ──► Lambda      │
│                    (updates login-specific fields only:          │
│                     lastLoginTimestamp, appClientLogins)         │
│                                                                 │
│  Admin action ──► CloudTrail ──► EventBridge ──► Lambda         │
│  (Console/CLI)     (AdminCreateUser, AdminDeleteUser,           │
│                     AdminDisableUser, AdminEnableUser,           │
│                     AdminAddUserToGroup,                         │
│                     AdminRemoveUserFromGroup,                    │
│                     AdminUpdateUserAttributes)                   │
│                    (re-reads full state from Cognito,            │
│                     updates profile fields in DynamoDB)          │
│                                                                 │
│                           │                                     │
│                           ▼                                     │
│                    DynamoDB (UserDetailsTable)                   │
│                           │                                     │
│                    DynamoDB Stream                               │
│                           │                                     │
│                           ▼                                     │
│                    Lambda: OSS ingest                            │
│                           │                                     │
│                           ▼                                     │
│              OpenSearch Serverless (search index)                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Search API                               │
│                                                                 │
│  React Frontend (CloudFront + S3)                               │
│       │                                                         │
│       ▼                                                         │
│  API Gateway (POST /users/search) ──► Lambda ──► OpenSearch     │
└─────────────────────────────────────────────────────────────────┘
```

### Responsibility Split

| Trigger | Owns | Fields |
|---------|------|--------|
| PostConfirmation | Initial record creation | All profile fields, `userStatus: CONFIRMED` |
| PreTokenGeneration | Login tracking | `lastLoginTimestamp`, `appClientLogins` (per-client timestamps) |
| EventBridge (CloudTrail) | Profile/state updates, user creation via admin | `userStatus`, `groups`, `email`, `givenName`, `familyName`, user deletion |

This split avoids write conflicts — each path uses `update_item` on its own set of attributes.

### Stacks

| Stack | Purpose |
|-------|---------|
| `SearchableUsers-CoreInfrastructure` | VPC, VPC endpoints (DynamoDB, OpenSearch Serverless), CloudTrail trail |
| `SearchableUsers-AuthenticationService` | Cognito user pool, DynamoDB table (PITR enabled), OpenSearch collection, Lambda functions, EventBridge rule |
| `SearchableUsers-ApiGateway` | REST API with Cognito authorizer |
| `SearchableUsers-Frontend` | S3 bucket, CloudFront distribution, Cognito app client |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Python 3](https://www.python.org/) with [boto3](https://pypi.org/project/boto3/) (`pip install boto3`)
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) v2 (`npm install -g aws-cdk`)
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configured with credentials
- CDK bootstrapped in your target account/region (`cdk bootstrap`)

> **Note:** The stack deploys a CloudTrail trail for management events. If your account already has an org trail with management events enabled, you can remove the trail from `CoreInfrastructureStack` — the EventBridge rule works with any trail.

## Deploy

```bash
./deploy.sh
```

Deploys all CDK stacks, builds the React frontend, uploads to S3, and invalidates CloudFront.

## Seed Sample Users

```bash
./seed.sh
```

Creates 50 sample users across three groups (Admins, Editors, Viewers) in Cognito. DynamoDB and OpenSearch indexing happens automatically via the CloudTrail → EventBridge → Lambda pipeline.

## Local Development

```bash
cd src/webapp
./generate-env.sh
npm install
npm run dev
```

## Cleanup

```bash
npx cdk destroy --all
```
