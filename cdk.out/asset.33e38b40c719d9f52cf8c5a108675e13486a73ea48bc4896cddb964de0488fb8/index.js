const { S3Client, DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client();

exports.handler = async (event) => {
  console.log(event);
  console.log(process.env.bucketName);
  var bucketName = process.env.bucketName;
  if (event['RequestType'] == 'Create') {
    const command = new PutObjectCommand({
      Key: "mapping.json",
      Bucket: process.env.bucketName,
      Body: 
      `{
          "Mapping": [
              {
                  "CTEventName" : "RunInstances", 
                  "CTEventSource": "ec2.amazonaws.com",
                  "REResourceType": "ec2:instance",
                  "Global": false
              },
              {
                  "CTEventName" : "CreateBucket", 
                  "CTEventSource": "s3.amazonaws.com",
                  "REResourceType": "s3:bucket",
                  "Global": true
              },
              {
                  "CTEventName" : "CreateFunction20150331", 
                  "CTEventSource": "lambda.amazonaws.com",
                  "REResourceType": "lambda:function",
                  "Global": false
              },
              {
                  "CTEventName" : "CreateCluster", 
                  "CTEventSource": "ecs.amazonaws.com",
                  "REResourceType": "ecs:cluster",
                  "Global": false
              }        
      
          ]
      }`
    });
    const response = await s3Client.send(command);
  } 
  const response = {
    statusCode: 200,
    body: JSON.stringify('S3 Loader done'),
  };
  return response;
};