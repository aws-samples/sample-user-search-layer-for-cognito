import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { NagSuppressions } from 'cdk-nag';

export interface ApiGatewayStackProps extends cdk.StackProps {
    userPool: cognito.UserPool;
}

/**
 * Responsible for creating and configuring the API Gateway with Cognito authorizer.
 */
export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly authorizer: apigateway.IAuthorizer;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);
    this.api = new apigateway.RestApi(this, 'SearchableUsersApi', {
      restApiName: `searchable-users-api`
    });

    this.authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });

    this.addSharedModels();

    new cdk.CfnOutput(this, 'ApiURL', {
      value: this.api.url,
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/SearchableUsersApi/Resource`, [
      { id: 'AwsSolutions-APIG2', reason: 'Request body validation is configured on the POST /users/search method via a request model and validator. The APIG2 rule flags at the API level but validation is applied per-method where needed.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/SearchableUsersApi/DeploymentStage.prod/Resource`, [
      { id: 'AwsSolutions-APIG1', reason: 'API Gateway access logging is not configured for this blog post sample to minimize infrastructure complexity. In production, enable access logging to an appropriate log destination.' },
      { id: 'AwsSolutions-APIG3', reason: 'WAFv2 web ACL is not associated for this blog post sample to avoid additional costs and complexity. In production, associate a WAFv2 web ACL for application-layer protection.' },
      { id: 'AwsSolutions-APIG6', reason: 'CloudWatch execution logging is not enabled for this blog post sample to minimize costs. In production, enable CloudWatch logging for all methods for operational visibility.' },
    ]);
  }

  private addSharedModels() {
    this.api.addModel('ErrorResponse', {
      contentType: 'application/json',
      modelName: 'ErrorResponse',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          message: { type: apigateway.JsonSchemaType.STRING },
          errorCode: { type: apigateway.JsonSchemaType.STRING },
        },
      },
    });
  }
}
