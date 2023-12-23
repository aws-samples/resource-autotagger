const { Stack, Duration, CustomResource, CustomResourceProvider, CustomResourceProviderRuntime, RemovalPolicy } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const path = require('path');
const nodejs = require('aws-cdk-lib/aws-lambda-nodejs');
const { Role, ServicePrincipal, PolicyDocument, ManagedPolicy } = require('aws-cdk-lib/aws-iam');
const { Rule, Schedule } = require('aws-cdk-lib/aws-events');
const { LambdaFunction } = require('aws-cdk-lib/aws-events-targets');
const { s3, Bucket, BlockPublicAccess, BucketEncryption, ObjectOwnership } = require('aws-cdk-lib/aws-s3');

class ResourceAutoTagCdkStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    var accountId = process.env.CDK_DEFAULT_ACCOUNT;
    var region = process.env.CDK_DEFAULT_REGION;
    
    const accessLogsBucket = new Bucket(this, 'AccessLogsBucket', {
        versioned: true,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryption: BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED
      });

    const bucket = new Bucket(this, 'resource-auto-tag-bucket', {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryption: BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        serverAccessLogsBucket: accessLogsBucket
    });

    const lambdaS3LoaderProvider = CustomResourceProvider.getOrCreateProvider(this, 'Custom::LambdaS3Loader', {
      codeDirectory: path.join("./handlers/lambda-s3-loader"),
      runtime: CustomResourceProviderRuntime.NODEJS_18_X,
      environment:  { "bucketName" : bucket.bucketName},
      policyStatements: [
        {
            "Sid": "ResourceAutoTaggerS3MappingLoader",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                `arn:aws:s3:::${bucket.bucketName}/*`
            ]
        }
      ],
    });

    new CustomResource(this, 'LambdaS3LoaderCustomResource', {
      resourceType: 'Custom::LambdaS3Loader',
      serviceToken: lambdaS3LoaderProvider.serviceToken
    });

    const policyDocumentJSON = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ResourceAutoTaggerObserveAnnotate",
                "Effect": "Allow",
                "Action": [
                    "cloudwatch:PutMetricData",
                    "ec2:DescribeInstances",
                    "ec2:DescribeVolumes"
                ],
                "Resource": "*"
            },
            {
                "Sid": "ResourceAutoTaggerCreateUpdate",
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogStream",
                    "ec2:CreateTags",
                    "logs:CreateLogGroup",
                    "logs:PutLogEvents"
                ],
                "Resource": [
                    `arn:aws:ec2:*:${accountId}:instance/*`,
                    `arn:aws:ec2:*:${accountId}:volume/*`,
                    `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/ResourceAutoTagCdkStack*:log-stream:*`,
                    `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/ResourceAutoTagCdkStack*`
                ]
            },
            {
                "Sid": "ResourceAutoTaggerRead",
                "Effect": "Allow",
                "Action": [
                    "iam:ListRoleTags",
                    "iam:ListUserTags",
                    "logs:DescribeLogGroups",
                    "logs:DescribeLogStreams",
                    "logs:GetLogEvents",
                    "ssm:GetParametersByPath"
                ],
                "Resource": [
                    `arn:aws:iam::${accountId}:role/*`,
                    `arn:aws:iam::${accountId}:user/*`,
                    `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/ResourceAutoTagCdkStack*:log-stream:*`,
                    `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/ResourceAutoTagCdkStack*`,
                    `arn:aws:ssm:*:${accountId}:parameter/*`
                ]
            },
            {
                "Sid": "ResourceAutoTaggerReadMappingInS3",
                "Effect": "Allow",
                "Action": [
                    "s3:GetObject"
                ],
                "Resource": [
                    `arn:aws:s3:::${bucket.bucketName}/*`
                ]
            },            
            {
                "Sid": "ResourceAutoTaggerResourceExplorer2",
                "Effect": "Allow",
                "Action": [
                    "resource-explorer-2:Search"
                ],
                "Resource": [
                    `arn:aws:resource-explorer-2:${region}:${accountId}:view/*/*`
                ]
            },
            {
                "Sid": "ResourceAutoTaggerCloudTrailEvents",
                "Effect": "Allow",
                "Action": [
                    "cloudtrail:LookupEvents"
                ],
                "Resource": [
                    `*`
                ]
            },
            {
                "Sid": "ResourceAutoTaggerS3Tagging",
                "Effect": "Allow",
                "Action": [
                    "s3:PutBucketTagging"
                ],
                "Resource": [
                    "arn:aws:s3:::*"
                ]
            },
            {
                "Sid": "ResourceAutoTaggerS3Tagging1",
                "Effect": "Allow",
                "Action": [
                    "s3:GetBucketTagging"
                ],
                "Resource": [
                    "arn:aws:s3:::*"
                ]
            },
            {
                "Sid": "ResourceAutoTaggerResourceGroupTagging",
                "Effect": "Allow",
                "Action": [
                    "tag:TagResources"
                ],
                "Resource": [
                    "*"
                ]
            },
            {
                "Sid": "ResourceAutoTaggerLambdaTagging",
                "Effect": "Allow",
                "Action": [
                    "lambda:TagResource"
                ],
                "Resource": [
                    `arn:aws:lambda:${region}:${accountId}:function:*`
                ]
            },
            {
                "Sid": "ResourceAutoTaggerECSTagging",
                "Effect": "Allow",
                "Action": [
                    "ecs:TagResource"
                ],
                "Resource": [
                    `arn:aws:ecs:${region}:${accountId}:cluster/*`
                ]
            }
        ]
    }
    const customPolicyDocument = PolicyDocument.fromJson(policyDocumentJSON);
    
    const lambdaExecutionRole = new Role(this, 'ResourceAutoTagSchedulerLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {'inlinePolicy' : customPolicyDocument }
    });
    
    const resourceAutoTagLambdaFn = new lambda.Function(this, "resource-auto-tag1", {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join("./handlers/resource-auto-tag/")),
      role: lambdaExecutionRole,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment:  { "bucketName" : bucket.bucketName}
    });
    
    // new nodejs.NodejsFunction(this, "resource-auto-tag", {
    //   runtime: lambda.Runtime.NODEJS_18_X,
    //   handler: "index.handler",
    //   //code: lambda.Code.fromAsset(path.join("./handlers/resource-auto-tag/")),
    //   entry: path.join("./handlers/resource-auto-tag/")+"index.mjs",
    //   bundling: { 
    //     externalModules: ['@aws-sdk/client-dynamodb','@aws-sdk/client-cloudtrail','@aws-sdk/client-iam','@aws-sdk/client-ssm','@aws-sdk/client-resource-groups-tagging-api'],
    //     nodeModules: ['@aws-sdk/client-resource-explorer-2']
    //   }         
    // });
    
    const lambdaFunctionTarget = new LambdaFunction(resourceAutoTagLambdaFn);

    new Rule(this, 'ResourceAutoTagScheduleRule', {
     schedule: Schedule.rate(Duration.minutes(30)),
     targets: [lambdaFunctionTarget],
    });
    
  }
}

module.exports = { ResourceAutoTagCdkStack }
