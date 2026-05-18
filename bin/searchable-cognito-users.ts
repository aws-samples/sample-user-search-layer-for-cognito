#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AuthenticationStack as AuthenticationServiceStack } from '../lib/stacks/authentication-service-stack';
import { CoreInfrastructureStack } from '../lib/stacks/core-infrastructure-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { ApiGatewayStack } from '../lib/stacks/api-gateway-stack';

const app = new cdk.App();

// Apply cdk-nag AwsSolutionsChecks
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const coreInfrastructureStack = new CoreInfrastructureStack(app, 'SearchableUsers-CoreInfrastructure', {});

const authenticationServiceStack = new AuthenticationServiceStack(app, 'SearchableUsers-AuthenticationService', {
    vpc: coreInfrastructureStack.vpc,
    vpces: coreInfrastructureStack.vpces,
});

const apiGatewayStack = new ApiGatewayStack(app, 'SearchableUsers-ApiGateway', {
    userPool: authenticationServiceStack.userPool,
});
authenticationServiceStack.addApiResources(apiGatewayStack);

const frontendStack = new FrontendStack(app, 'SearchableUsers-Frontend', {
    userPool: authenticationServiceStack.userPool,
    api: apiGatewayStack.api,
});
