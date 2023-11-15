const { DynamoDBClient, BatchWriteItemCommand } = require("@aws-sdk/client-dynamodb");

const ddbClient = new DynamoDBClient();

exports.handler = async (event) => {
  console.log(event);
  console.log(process.env.tableName);
  var tableName = process.env.tableName;
  if (event['RequestType'] == 'Create') {
    var param = { 
      RequestItems : {
        [tableName] : [
          {
            PutRequest : {
              Item : {
                "ID": {"N": "0" },
                "CTEventName": { "S": "RunInstances" },
                "CTEventSource": { "S": "ec2.amazonaws.com" },
                "REResourceType": { "S":"ec2:instance"}
              }
            }
          },
          {
            PutRequest : {
              Item : {
                "ID": {"N": "1" },
                "CTEventName": { "S": "CreateBucket" },
                "CTEventSource": { "S": "s3.amazonaws.com" },
                "REResourceType": { "S":"s3:bucket"}
              }
            }
          },
          {
            PutRequest : {
              Item : {
                "ID": {"N": "2" },
                "CTEventName": { "S": "CreateFunction20150331" },
                "CTEventSource": { "S": "lambda.amazonaws.com" },
                "REResourceType": { "S":"lambda:function"}
              }
            }
          },
          {
            PutRequest : {
              Item : {
                "ID": {"N": "3" },
                "CTEventName": { "S": "CreateCluster" },
                "CTEventSource": { "S": "ecs.amazonaws.com" },
                "REResourceType": { "S":"ecs:cluster"}
              }
            }
          }
        ]
      }
    }
    try {
      var command1 = new BatchWriteItemCommand(param);
      const response = await ddbClient.send(command1);
    } catch (e) {
      console.log(e);
      const response1 = {
        body: JSON.stringify(e),
      };
      return response1;
    }
  } else 
  if (event['RequestType'] == 'Delete') {
    //Do nothing as there might be additional items added manually into DynamoDB by users, hence users need to manually delete it
  }
  const response = {
    statusCode: 200,
    body: JSON.stringify('DynamoDB Loader done'),
  };
  return response;
};