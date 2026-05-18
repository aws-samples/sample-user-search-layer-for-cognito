import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as oss from 'aws-cdk-lib/aws-opensearchserverless';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';

export interface CoreInfrastructureStackProps extends cdk.StackProps {
}

/**
 * Responsible for deploying core infrastructure used across the application.
 */
export class CoreInfrastructureStack extends cdk.Stack {
  private _vpc: ec2.IVpc;
  private _vpces: Map<string, oss.CfnVpcEndpoint | ec2.IVpcEndpoint> = new Map();

  constructor(scope: Construct, id: string, props: CoreInfrastructureStackProps) {
    super(scope, id, props);

    this._vpc = new ec2.Vpc(this, 'Vpc');
    
    const dynamoVpce = this._vpc.addGatewayEndpoint('DynamoVpce', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    })

    const ossSg = new ec2.SecurityGroup(this, 'OssSg', {
      securityGroupName: 'oss-sg',
      vpc: this._vpc,
    });
    
    const ossVpce = new oss.CfnVpcEndpoint(this, 'OssVpce', {
      name: `oss-vpce`,
      vpcId: this._vpc.vpcId,
      subnetIds: this._vpc.privateSubnets.map(subnet => subnet.subnetId),
      securityGroupIds: [ossSg.securityGroupId]
    });

    this._vpces.set('opensearchserverless', ossVpce);
    this._vpces.set('dynamodb', dynamoVpce);

    // Trail required for EventBridge to receive Cognito admin action events
    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cloudtrail.Trail(this, 'ManagementEventsTrail', {
      bucket: trailBucket,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    // cdk-nag suppressions
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/Vpc/Resource`, [
      { id: 'AwsSolutions-VPC7', reason: 'VPC Flow Logs not required for this blog post sample application. In production, enable VPC Flow Logs for network troubleshooting.' },
    ]);
    NagSuppressions.addResourceSuppressionsByPath(this, `/${id}/CloudTrailBucket/Resource`, [
      { id: 'AwsSolutions-S1', reason: 'This is the CloudTrail log bucket itself. Enabling access logs on the log destination bucket would create a logging loop. Access patterns are audited via CloudTrail.' },
    ]);
  }

  get vpc(): ec2.IVpc {
    return this._vpc;
  }

  get vpces(): Map<string, oss.CfnVpcEndpoint | ec2.IVpcEndpoint> {
    return new Map(this._vpces);
  }
}
