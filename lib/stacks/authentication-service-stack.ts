import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NagSuppressions } from 'cdk-nag';
import { ApiGatewayStack } from './api-gateway-stack';

export interface AuthenticationStackProps extends cdk.StackProps {
  vpc: ec2.IVpc,
  vpces: Map<string, oss.CfnVpcEndpoint | ec2.IVpcEndpoint>,
}

/**
 * Responsible for setting up Cognito user pools and client for user authentication.
 */
export class AuthenticationStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userDetailsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AuthenticationStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'CognitoUserPool', {
      signInAliases: {
        email: true,
        username: true,
      },
      selfSignUpEnabled: true,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        middleName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });


    this.userDetailsTable = new dynamodb.Table(this, 'UserDetailsTable', {
      partitionKey: {
        name: 'sub',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const ossVpce = props.vpces.get('opensearchserverless') as oss.CfnVpcEndpoint;
    const [ossEndpoint, ossIndexName, ossReadWriteRole, ossReadOnlyRole] = this.createOpenSearchResources(ossVpce);

    const ossAccessSg = new ec2.SecurityGroup(this, 'AccessToOssVpce', {
      securityGroupName: `oss-vpce-access-sg`,
      vpc: props.vpc
    });

    let count = 0;
    for (const ossSgId of ossVpce.securityGroupIds || []) {
      const ossSg = ec2.SecurityGroup.fromSecurityGroupId(this, `oss-vpce-sg-ingress-user-service-${count}`, ossSgId);
      ossSg.addIngressRule(ossAccessSg, ec2.Port.HTTPS);
      count += 1;
    }

    this.createUserDetailsIngestService(props.vpc, ossAccessSg, ossEndpoint, ossIndexName, ossReadWriteRole, this.userDetailsTable);

    this.createUserApiService(props.vpc, ossAccessSg, ossEndpoint, ossIndexName, ossReadOnlyRole);

    const userPoolDomain = this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: `searchable-users-${cdk.Aws.ACCOUNT_ID}`,
      },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: `${userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: 'Cognito hosted UI domain',
    });

    new cdk.CfnOutput(this, 'UserDetailsTableName', {
      value: this.userDetailsTable.tableName,
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/CognitoUserPool/Resource`, [
      { id: 'AwsSolutions-COG1', reason: 'Password policy is managed by Cognito defaults for this blog post sample. In production, configure explicit password policy with minimum length, uppercase, numeric, and special character requirements.' },
      { id: 'AwsSolutions-COG2', reason: 'MFA is not enforced for this blog post sample to simplify user onboarding. In production, enable MFA for enhanced security.' },
      { id: 'AwsSolutions-COG3', reason: 'AdvancedSecurityMode ENFORCED is not enabled for this blog post sample to avoid additional costs. In production, enable advanced security features.' },
    ]);

    const lambdaServiceRolePaths = [
      `/${id}/ManageOssIndexFn/ServiceRole/Resource`,
      `/${id}/IngestCognitoTriggerToDynamoFn/ServiceRole/Resource`,
      `/${id}/IngestUserDetailsToOssFn/ServiceRole/Resource`,
      `/${id}/IngestCognitoCloudTrailToDynamoFn/ServiceRole/Resource`,
      `/${id}/SearchUserDetailsFunction/ServiceRole/Resource`,
      `/${id}/OssIndexProvider/framework-onEvent/ServiceRole/Resource`,
    ];
    for (const path of lambdaServiceRolePaths) {
      NagSuppressions.addResourceSuppressionsByPath(this, path, [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'AWS managed policies (AWSLambdaBasicExecutionRole, AWSLambdaVPCAccessExecutionRole) are required for Lambda functions to write logs to CloudWatch and manage VPC ENIs. These are standard AWS-recommended policies for Lambda execution roles.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
          ],
        },
      ]);
    }

    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/OssIndexProvider/framework-onEvent/ServiceRole/DefaultPolicy/Resource`, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'The wildcard on the Lambda ARN is added by the CDK custom resource Provider framework to allow invoking all versions/aliases of the onEvent handler function. This is standard CDK Provider behavior.',
        appliesTo: ['Resource::<ManageOssIndexFnAE7E3D4F.Arn>:*'],
      },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/IngestUserDetailsToOssFn/ServiceRole/DefaultPolicy/Resource`, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard resource is required for DynamoDB Streams DescribeStream, GetRecords, GetShardIterator, and ListStreams actions as these operations need access to all shards within the stream. This is standard CDK behavior when granting stream read access.',
        appliesTo: ['Resource::*'],
      },
    ]);

    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/OssIndexProvider/framework-onEvent/Resource`, [
      { id: 'AwsSolutions-L1', reason: 'The Lambda runtime for the CDK custom resource Provider framework is managed by the CDK framework itself and cannot be directly controlled. It will be updated when the CDK library is updated.' },
    ]);
  }

  private createOpenSearchResources(vpce: oss.CfnVpcEndpoint): [ossEndpoint: string, ossIndex: string, ossReadWriteRole: iam.Role, ossReadRole: iam.Role] {
    const ossCollectionName = 'searchable-users-collection';
    const ossIndexName = 'searchable-users-index';
    const stack = cdk.Stack.of(this);

    const ossCollection = new oss.CfnCollection(this, 'OssCollection', {
      name: ossCollectionName,
      description: 'Stores Cognito user metadata for search',
      type: 'SEARCH',
    });

    const ossEncryptionPolicy = new oss.CfnSecurityPolicy(this, 'OssEncryptionPolicy', {
      name: `ep-searchable-users`,
      type: 'encryption',
      description: `Encryption policy for ${ossCollectionName}`,
      policy: JSON.stringify({
        "Rules": [
          {
            "ResourceType": "collection",
            "Resource": [
              `collection/${ossCollectionName}`
            ]
          }
        ],
        "AWSOwnedKey": true
      })
    });
    ossCollection.addDependency(ossEncryptionPolicy);

    const ossNetworkPolicy = new oss.CfnSecurityPolicy(this, 'OssNetworkPolicy', {
      name: `np-searchable-users`,
      type: 'network',
      description: `Network policy for ${ossCollectionName}`,
      policy: JSON.stringify([
        {
          "SourceVPCEs": [
            vpce.attrId
          ],
          "Rules": [
            {
              "ResourceType": "collection",
              "Resource": [
                `collection/${ossCollectionName}`
              ]
            }
          ],
          "AllowFromPublic": false
        }
      ])
    });
    ossCollection.addDependency(ossNetworkPolicy);

    const ossReadWriteDataPolicy = new oss.CfnAccessPolicy(this, 'OssReadWriteDataPolicy', {
      name: `ap-rw-searchable-users`,
      type: 'data',
      description: `Data policy (read/write) for ${ossCollectionName}`,
      policy: JSON.stringify([
        {
          "Rules": [
            {
              "ResourceType": "collection",
              "Resource": [
                `collection/${ossCollectionName}`
              ],
              "Permission": [
                "aoss:CreateCollectionItems",
                "aoss:UpdateCollectionItems",
                "aoss:DescribeCollectionItems",
              ]
            },
            {
              "ResourceType": "index",
              "Resource": [
                `index/${ossCollectionName}/${ossIndexName}`
              ],
              "Permission": [
                "aoss:CreateIndex",
                "aoss:UpdateIndex",
                "aoss:DeleteIndex",
                "aoss:WriteDocument",
                "aoss:ReadDocument",
                "aoss:DescribeIndex",
              ]
            }
          ],
          "Principal": [
            cdk.Arn.format({
              service: "iam",
              resource: "role",
              region: "",
              resourceName: `cdk-${stack.synthesizer.bootstrapQualifier}-cfn-exec-role-${stack.account}-${stack.region}`
            }, stack),
            cdk.Arn.format(
              {
                service: "iam",
                resource: "role",
                region: "",
                resourceName: `read-write-oss-users-index`
              }, stack
            ),
          ]
        }
      ])
    });
    ossCollection.addDependency(ossReadWriteDataPolicy);

    const ossReadWriteRole = new iam.Role(this, 'OssReadWriteRole', {
      roleName: "read-write-oss-users-index",
      assumedBy: new iam.AccountPrincipal(this.account),
      inlinePolicies: {
        'ReadWriteOssIndex': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "aoss:APIAccessAll"
              ],
              resources: [
                ossCollection.attrArn
              ]
            })
          ]
        })
      }
    });

    // Policy is a CloudFormation-only resource; the role reference below is what grants runtime access.
    new oss.CfnAccessPolicy(this, 'OssReadOnlyDataPolicy', {
      name: `ap-ro-searchable-users`,
      type: 'data',
      description: `Data policy (read only) for ${ossCollectionName}`,
      policy: JSON.stringify([
        {
          "Rules": [
            {
              "ResourceType": "index",
              "Resource": [
                `index/${ossCollectionName}/${ossIndexName}`
              ],
              "Permission": [
                "aoss:ReadDocument",
              ]
            }
          ],
          "Principal": [
            cdk.Arn.format(
              {
                service: "iam",
                resource: "role",
                region: "",
                resourceName: `read-oss-users-index`
              }, stack
            ),
          ]
        }
      ])
    });

    const ossReadOnlyRole = new iam.Role(this, 'OssReadOnlyRole', {
      roleName: "read-oss-users-index",
      assumedBy: new iam.AccountPrincipal(this.account),
      inlinePolicies: {
        'ReadOssIndex': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "aoss:APIAccessAll"
              ],
              resources: [
                ossCollection.attrArn
              ]
            })
          ]
        })
      }
    });

    return [ossCollection.attrCollectionEndpoint, ossIndexName, ossReadWriteRole, ossReadOnlyRole]
  }

  private createUserDetailsIngestService(vpc: ec2.IVpc, ossAccessSg: ec2.SecurityGroup, ossEndpoint: string, ossIndex: string, ossReadWriteRole: iam.Role, usersDetailsTable: dynamodb.Table) {
    const index_mappings = {
      settings: {
        analysis: {
          normalizer: {
            lowercase_normalizer: {
              type: 'custom',
              filter: ['lowercase']
            }
          }
        }
      },
      properties: {
        sub: { type: 'keyword' },
        userPoolId: { type: 'keyword' },
        userStatus: { type: 'keyword' },
        userName: {
          type: 'text',
          index: true,
          fields: { keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' } }
        },
        givenName: {
          type: 'text',
          index: true,
          fields: { keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' } }
        },
        familyName: {
          type: 'text',
          index: true,
          fields: { keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' } }
        },
        email: {
          type: 'text',
          index: true,
          fields: { keyword: { type: 'keyword', normalizer: 'lowercase_normalizer' } }
        },
        groups: { type: 'keyword' },
        appClientLogins: {
          type: 'nested',
          properties: {
            clientId: { type: 'keyword' },
            lastLogin: { type: 'date' }
          }
        },
        lastUpdatedTimestamp: { type: 'date' },
        lastLoginTimestamp: { type: 'date' }
      }
    };

    const manageOssIndexFn = new lambda.Function(this, 'ManageOssIndexFn', {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/lambdas/custom_resource/manage_oss_index')),
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
      securityGroups: [ossAccessSg],
      timeout: cdk.Duration.minutes(3),
      environment: {
        "OSS_READWRITE_ROLE_ARN": ossReadWriteRole.roleArn,
      },
    });
    manageOssIndexFn.logGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    ossReadWriteRole.grantAssumeRole(manageOssIndexFn.role!);

    const ossIndexProviderLogGroup = new logs.LogGroup(this, 'OssIndexProviderLogGroup', {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const ossIndexProvider = new cr.Provider(this, 'OssIndexProvider', {
      onEventHandler: manageOssIndexFn,
      logGroup: ossIndexProviderLogGroup
    });

    const ossIndexCr = new cdk.CustomResource(this, 'OssIndexCr', {
      serviceToken: ossIndexProvider.serviceToken,
      properties: {
        CollectionEndpoint: ossEndpoint,
        IndexName: ossIndex,
        Mappings: JSON.stringify(index_mappings),
        OssReadWriteRoleArn: ossReadWriteRole.roleArn,
      }
    });

    const ingestCognitoTriggerToDynamoFn = new lambda.Function(this, 'IngestCognitoTriggerToDynamoFn', {
    runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/lambdas/ingest_user_details/dynamo/cognito_trigger')),
      environment: {
        "DYNAMO_TABLE": usersDetailsTable.tableName,
      },
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
      securityGroups: [ossAccessSg],
      timeout: cdk.Duration.seconds(30),
    });
    ingestCognitoTriggerToDynamoFn.logGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    usersDetailsTable.grantReadWriteData(ingestCognitoTriggerToDynamoFn);
    ingestCognitoTriggerToDynamoFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [cdk.Arn.format({ service: 'events', resource: 'event-bus', resourceName: 'default' }, this)],
    }));

    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_TOKEN_GENERATION, ingestCognitoTriggerToDynamoFn);
    this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, ingestCognitoTriggerToDynamoFn);

    const ingestOssFn = new lambda.Function(this, 'IngestUserDetailsToOssFn', {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/lambdas/ingest_user_details/oss')),
      environment: {
        "OSS_COLLECTION_ENDPOINT": ossEndpoint,
        "OSS_INDEX_NAME": ossIndex,
        "OSS_READWRITE_ROLE_ARN": ossReadWriteRole.roleArn,
      },
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
      securityGroups: [ossAccessSg],
      timeout: cdk.Duration.minutes(2),
    });
    ingestOssFn.logGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    ossReadWriteRole.grantAssumeRole(ingestOssFn.role!);

    // OSS index must exist before the stream-processing Lambda starts receiving events
    ingestOssFn.node.addDependency(ossIndexCr);

    usersDetailsTable.grantStreamRead(ingestOssFn);
    ingestOssFn.addEventSourceMapping('DynamoUserDetailsEventSource', {
      eventSourceArn: usersDetailsTable.tableStreamArn!,
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      bisectBatchOnError: true,
      retryAttempts: 3,
      enabled: true,
    });

    const ingestCognitoCloudTrailToDynamoFn = new lambda.Function(this, 'IngestCognitoCloudTrailToDynamoFn', {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/lambdas/ingest_user_details/dynamo/cloudtrail_event')),
      environment: {
        DYNAMO_TABLE: usersDetailsTable.tableName,
        USER_POOL_ID: this.userPool.userPoolId,
      },
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
      timeout: cdk.Duration.seconds(30),
    });
    ingestCognitoCloudTrailToDynamoFn.logGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    usersDetailsTable.grantReadWriteData(ingestCognitoCloudTrailToDynamoFn);
    ingestCognitoCloudTrailToDynamoFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:AdminListGroupsForUser',
      ],
      resources: [this.userPool.userPoolArn],
    }));

    const cognitoAdminEventsRule = new events.Rule(this, 'CognitoAdminEventsRule', {
      description: 'Captures Cognito admin actions to sync user data',
      eventPattern: {
        source: ['aws.cognito-idp'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['cognito-idp.amazonaws.com'],
          requestParameters: {
            userPoolId: [this.userPool.userPoolId]
          },
          eventName: [
            'AdminCreateUser',
            'AdminDeleteUser',
            'AdminDisableUser',
            'AdminEnableUser',
            'AdminAddUserToGroup',
            'AdminRemoveUserFromGroup',
            'AdminUpdateUserAttributes',
          ],
        },
      },
    });
    cognitoAdminEventsRule.addTarget(new targets.LambdaFunction(ingestCognitoCloudTrailToDynamoFn));
  }

  private createUserApiService(vpc: ec2.IVpc, ossAccessSg: ec2.SecurityGroup, ossEndpoint: string, ossIndex: string, ossReadOnlyRole: iam.Role) {
    const searchUserDetailsLambda = new lambda.Function(this, 'SearchUserDetailsFunction', {
      runtime: lambda.Runtime.PYTHON_3_14,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('src/lambdas/search_user_details'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        OSS_COLLECTION_ENDPOINT: ossEndpoint,
        OSS_INDEX_NAME: ossIndex,
        OSS_READONLY_ROLE_ARN: ossReadOnlyRole.roleArn,
      },
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [ossAccessSg],
    });
    searchUserDetailsLambda.logGroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    ossReadOnlyRole.grantAssumeRole(searchUserDetailsLambda.role!);

    new ssm.StringParameter(this, 'SearchUserDetailsFunctionArnParameter', {
      parameterName: '/users-service/lambda/search-user-details/arn',
      stringValue: searchUserDetailsLambda.functionArn,
    });
  }

  public addApiResources(apigatewayStack: ApiGatewayStack) {
    const allowedOrigins = apigateway.Cors.ALL_ORIGINS;

    const usersResource = apigatewayStack.api.root.addResource('users', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['OPTIONS', 'POST'],
        allowHeaders: ['Content-Type', 'Authorization'],
      }
    });

    const searchResource = usersResource.addResource('search', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['OPTIONS', 'POST'],
        allowHeaders: ['Content-Type', 'Authorization'],
      }
    });

    const searchUserDetailsLambdaArn = ssm.StringParameter.fromStringParameterName(apigatewayStack, 'ImportedSearchUserDetailsFunctionArnParam', '/users-service/lambda/search-user-details/arn');
    const searchUserDetailsLambda = lambda.Function.fromFunctionAttributes(apigatewayStack, 'ImportedSearchUserDetailsFunction', {
      functionArn: searchUserDetailsLambdaArn.stringValue,
      sameEnvironment: true
    });

    const searchRequestModel = apigatewayStack.api.addModel('SearchRequestModel', {
      contentType: 'application/json',
      modelName: 'SearchRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          search: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              text: { type: apigateway.JsonSchemaType.STRING },
              fields: {
                type: apigateway.JsonSchemaType.ARRAY,
                items: { type: apigateway.JsonSchemaType.STRING },
              },
              fuzziness: { type: apigateway.JsonSchemaType.STRING },
            },
          },
          filters: { type: apigateway.JsonSchemaType.OBJECT },
          dateFilters: { type: apigateway.JsonSchemaType.OBJECT },
          pagination: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              size: { type: apigateway.JsonSchemaType.INTEGER },
              page: { type: apigateway.JsonSchemaType.INTEGER },
            },
          },
        },
      },
    });

    const requestValidator = new apigateway.RequestValidator(apigatewayStack, 'SearchRequestValidator', {
      restApi: apigatewayStack.api,
      requestValidatorName: 'search-request-body-validator',
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    const searchIntegration = new apigateway.LambdaIntegration(searchUserDetailsLambda, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });
    searchResource.addMethod('POST', searchIntegration, {
      authorizer: apigatewayStack.authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      requestValidator: requestValidator,
      requestModels: {
        'application/json': searchRequestModel,
      },
    });
  }
}
