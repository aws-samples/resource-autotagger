import { ResourceExplorer2Client, SearchCommand } from "@aws-sdk/client-resource-explorer-2";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import { IAMClient, ListUserTagsCommand, ListRoleTagsCommand } from "@aws-sdk/client-iam";
import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { ResourceGroupsTaggingAPIClient, TagResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const re2Client = new ResourceExplorer2Client();
const ctClient = new CloudTrailClient();
const iamClient = new IAMClient();
const ssmClient = new SSMClient();
const rgtaClient = new ResourceGroupsTaggingAPIClient();
const s3Client = new S3Client();

const TAG_KEY = 'blog';
const TAG_VALUE = 'ResourceAutoTagEnhanced';
const DURATION_IN_MINUTES = 14400;

async function arnFinder(jsonObject, searchedArn, searchedId) {
  if (Array.isArray(jsonObject)) {
    for(var i in jsonObject) {
      if (await arnFinder(jsonObject[i], searchedArn,searchedId)) return true;
    }
  } else {
    for(var i in jsonObject) {
      if (jsonObject[i] !== null && typeof (jsonObject[i]) === 'object') {
        if (await arnFinder(jsonObject[i], searchedArn,searchedId)) { return true; }
      } else {
        if (jsonObject[i] == searchedArn || jsonObject[i] == searchedId) return true;
      }
    }
  }
  return false;
}

async function getResourceExplorer2List(resourceType, isGlobal) {
  
  var region = isGlobal ? 'global': process.env.AWS_REGION;
  var params = {
    QueryString: `resourcetype:${resourceType} -tag.${TAG_KEY}=${TAG_VALUE} region:${region}`, 
    MaxResults: Number('1000') 
  };
  //console.log("resourceType " + resourceType);
  //console.log(params);
  try {
    const command = new SearchCommand(params);
    var res = await re2Client.send(command);
  
    return res;
  } catch (error) {
    console.error('error in getResourceExplorer2List ', error)
    return null;
  }
}

async function getCloudTrailRecord(eventName, eventSource) {

  var endDate = new Date();
  var startDate = new Date(endDate);
  var minDuration = DURATION_IN_MINUTES;
  startDate.setMinutes(endDate.getMinutes() - minDuration);
  //console.log("start date " + startDate);
  //console.log("end date " + endDate);
  
  var params = {
    LookupAttributes: [
      {
          AttributeKey: "EventName",
          AttributeValue: eventName
      },
      {
          AttributeKey: "EventSource",
          AttributeValue: eventSource
      }],  
      MaxResults: Number("1000"),
      StartTime: startDate,
      EndTime: endDate
  };
  try {
    var command = new LookupEventsCommand(params);
    var res = await ctClient.send(command);
    return res;
  } catch (error) {
    console.error('error in getCloudTrailRecord ', error)
    return null;    
  }
}

async function processResourceARN(ArnString, CTEvents) {
  //find id by searching : or /
  var ArnAltId = '';
  var idx = ArnString.lastIndexOf('/');
  if (idx > 0) {
    ArnAltId = ArnString.substring(idx+1, ArnString.length);
  } else {
    idx = ArnString.lastIndexOf(':');
    if (idx > 0) {
      ArnAltId = ArnString.substring(idx+1, ArnString.length);
    }
  }
  //console.log("Searching Arn " + ArnString + " and " + ArnAltId);
  for (var idx=0; idx<CTEvents.length; idx++) {
    var foundIt =  await arnFinder(CTEvents[idx], ArnString, ArnAltId);
    if (!foundIt) {
      foundIt =  await arnFinder(JSON.parse(CTEvents[idx].CloudTrailEvent), ArnString, ArnAltId);
    }    
    if (foundIt) {
      //console.log("Arn " + ArnString + " is found in CloudTrail ");
      //console.log(CTEvents[idx]);
      
      var tagList = await generateTaggingFromCloudTrail(CTEvents[idx]);
      //console.log("Generated tagList " + JSON.stringify(tagList));
      
      await tagResourceByARN(ArnString, tagList);
      
      break;
    }
  }
}

async function cloudtrail_event_parser(event) {
  var returned_event_fields = new Object();

  //Check if an IAM user created these instances & get that user
  if (event.userIdentity.type == "IAMUser") {
        returned_event_fields["iam_user_name"] = event.userIdentity.userName;
  }
  if (event.userIdentity.type == "AssumedRole") {
    // Check if optional Cloudtrail sessionIssuer field indicates assumed role credential type
    // If so, extract the IAM role named used during creation
    if (event.userIdentity.sessionContext.sessionIssuer.type == "Role") {
      var role_arn = event.userIdentity.sessionContext.sessionIssuer.arn;
      var role_components = role_arn.split("/");
      returned_event_fields["role_name"] = role_components[role_components.length-1];
      //Get the user ID who assumed the IAM role
      if (event.userIdentity.arn != null) {
          var user_id_arn = event.userIdentity.arn;
          var user_id_components = user_id_arn.split("/");
          returned_event_fields["user_id"] = user_id_components[user_id_components.length-1];
      } else {
          returned_event_fields["user_id"] = "";
      } 
    } else {
        returned_event_fields["role_name"] = "";
    }
  }

  // Extract the date & time of the instance creation
  returned_event_fields["resource_date"] = event.eventTime;
  
  return returned_event_fields;
}

async function get_iam_user_tags(iam_user_name) {

  var params = { "UserName": iam_user_name };
  var command = new ListUserTagsCommand(params);
  
  var result = await iamClient.send(command);
  return (result.Tags != undefined ? result.Tags : null);
}

async function get_iam_role_tags(role_name) {

  var params = { "RoleName": role_name };
  var command = new ListRoleTagsCommand(params);
  var result = await iamClient.send(command);
  return (result.Tags != undefined ? result.Tags : null);
}

async function get_ssm_parameter_tags(iam_user_name, role_name, user_id) {
    var path_string = '';
    if (iam_user_name != null) {
        path_string = `/auto-tag/${iam_user_name}/tag`;
    }     
    else { 
      if (role_name != null && user_id !=null) {
        path_string = `/auto-tag/${role_name}/${user_id}/tag`;
      } else {
        path_string = '';
      }
    }
    if (path_string != '') {
      var params = { Path: path_string, Recursive: true, WithDecryption: true };
      var command = new GetParametersByPathCommand(params); 
      var get_parameter_response = await ssmClient.send(command);
      if (get_parameter_response.Parameters != undefined && get_parameter_response.Parameters != null && get_parameter_response.Parameters.length > 0) {
        var tag_list = [];
        for (var i=0; i< get_parameter_response.Parameters.length;i++) {
          var path_components = get_parameter_response[i]["Name"].split("/");
          var tag_key = path_components[path_components.length-1];
          tag_list.push({"Key": tag_key, "Value": get_parameter_response[i]["Value"]});
        }
        return tag_list;
      } else {
        return null;
      }
    } else {
      return null;
    }
}

async function generateTaggingFromCloudTrail(CTEvent) {
  var resource_tags = [];

  var event_fields = await cloudtrail_event_parser(JSON.parse(CTEvent.CloudTrailEvent));

  var iam_user_resource_tags = null;
  var ssm_parameter_resource_tags = null;
  //Check for IAM User initiated event & get any associated resource tags
  if (event_fields["iam_user_name"] != undefined && event_fields["iam_user_name"] != null) {
    resource_tags.push( {"Key": "IAM User Name", "Value": event_fields["iam_user_name"]} );
    iam_user_resource_tags = await get_iam_user_tags(event_fields["iam_user_name"]);
    if (iam_user_resource_tags != null) {
        resource_tags = resource_tags.concat(iam_user_resource_tags);
    }
    ssm_parameter_resource_tags = await get_ssm_parameter_tags(event_fields["iam_user_name"], null, null);
    if (ssm_parameter_resource_tags != null) {
      resource_tags = resource_tags.concat(ssm_parameter_resource_tags);
    }
  }

  // Check for event date & time in returned CloudTrail event field
  // and append as resource tag
  if (event_fields["resource_date"] != undefined && event_fields["resource_date"] != null) {
      resource_tags.push(
          {"Key": "Date created", "Value": event_fields["resource_date"]}
      );
  }
  
  //Check for IAM assumed role initiated event & get any associated resource tags
  if (event_fields["role_name"] != undefined && event_fields["role_name"] != null) {
    resource_tags.push({"Key": "IAM Role Name", "Value": event_fields["role_name"]});
    var iam_role_resource_tags = await get_iam_role_tags(event_fields["role_name"]);

    if (iam_user_resource_tags != null) {
        resource_tags = resource_tags.concat(iam_user_resource_tags);
    }
    if (event_fields["user_id"] != null && event_fields["user_id"] != undefined) {
      resource_tags.push({"Key": "Created by", "Value": event_fields["user_id"]});

      ssm_parameter_resource_tags = await get_ssm_parameter_tags(
          null, event_fields["role_name"], event_fields["user_id"]
      );
      if (ssm_parameter_resource_tags != null) {
          resource_tags = resource_tags.concat(ssm_parameter_resource_tags);
      }
    }
  }
  resource_tags.push({"Key": TAG_KEY, "Value": TAG_VALUE});

  return resource_tags;
}

async function tagResourceByARN(ArnString, tagList) {
  var arnList = [ArnString];
  for (var i=0; i<tagList.length; i++) {
    var params = {  
      ResourceARNList : arnList,
      Tags: {
        [tagList[i].Key] : tagList[i].Value
      }
    };  
    var command = new TagResourcesCommand(params);  
      
    await rgtaClient.send(command);
  }
}

async function getJSONfromS3() {

  const command = new GetObjectCommand({
    Key: "mapping.json",
    Bucket: process.env.bucketName
  });
  const response = await s3Client.send(command);
  try {
    const jsonString = await response.Body?.transformToString();
    const json = JSON.parse(jsonString ?? '')
    return json
  } catch (error) {
    console.error('error parsing json', error)
    return null
  }
}

export const handler = async (event) => {
    
  // Get list of all resource type from mapping file stored in S3
  var jsonMapping = await getJSONfromS3();
  var res = jsonMapping.Mapping;
  //console.log(res);
  
  if (res == null || res == '') {
    console.error('Error in reading mapping.json')
    return
  } else {
    // For each resource type, query resource explorer resources that has no tagging, and collect its ARN
    for (var i=0; i < res.length; i++) {
      var reResult = await getResourceExplorer2List(res[i].REResourceType, res[i].Global);
  
      if (reResult != null && reResult.Resources.length > 0) {
        var ctResult = await getCloudTrailRecord(res[i].CTEventName, res[i].CTEventSource);
  
        for (var j=0; j < reResult.Resources.length; j++) {
          //Get ARN from reResult.Resources[j].Arn and match CT event and find out who created it and tag it 
          await processResourceARN(reResult.Resources[j].Arn, ctResult.Events)
        }
      }
      
    }
  }  
  const response = {
    statusCode: 200,
    body: JSON.stringify('Resource Auto Tagging done'),
  };
  return response;
};