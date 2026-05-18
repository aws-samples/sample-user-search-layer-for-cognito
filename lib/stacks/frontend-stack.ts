import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';

export interface FrontendStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  api: apigateway.RestApi;
}

/**
 * Responsible for building and deploying the React web app with Cognito configuration.
 */
export class FrontendStack extends cdk.Stack {
  public readonly websiteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    this.websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.websiteBucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html'
        }
      ],
    });
    this.distribution.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: props.userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `https://${this.distribution.distributionDomainName}`,
          `https://${this.distribution.distributionDomainName}/callback`,
          'http://localhost:5173',
          'http://localhost:5173/callback'
        ],
        logoutUrls: [
          `https://${this.distribution.distributionDomainName}`,
          `https://${this.distribution.distributionDomainName}/logout`,
          'http://localhost:5173',
          'http://localhost:5173/logout'
        ]
      }
    });

    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: props.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${this.distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'S3BucketName', {
      value: this.websiteBucket.bucketName,
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/WebsiteBucket/Resource`, [
      { id: 'AwsSolutions-S1', reason: 'Server access logging is not enabled for this blog post sample static website bucket to minimize infrastructure. In production, enable access logging to a dedicated log bucket.' },
      { id: 'AwsSolutions-S5', reason: 'The bucket uses CloudFront Origin Access Control (OAC) for access. Public read access is disabled and BlockPublicAccess is set to BLOCK_ALL. The cdk-nag rule does not yet recognize OAC as a valid alternative to OAI.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/CloudFrontDistribution/Resource`, [
      { id: 'AwsSolutions-CFR1', reason: 'Geo restrictions are not required for this blog post sample. In production, configure geo restrictions based on your application requirements.' },
      { id: 'AwsSolutions-CFR2', reason: 'WAF integration is not configured for this blog post sample to avoid additional costs. In production, associate a WAFv2 web ACL for application-layer protection.' },
      { id: 'AwsSolutions-CFR3', reason: 'CloudFront access logging is not enabled for this blog post sample to minimize infrastructure. In production, enable access logging to a dedicated S3 bucket.' },
      { id: 'AwsSolutions-CFR4', reason: 'The distribution uses the default CloudFront viewer certificate which sets minimum TLS to v1. For a blog post sample this is acceptable. In production, use a custom certificate with TLSv1.2 minimum.' },
    ]);
  }
}
