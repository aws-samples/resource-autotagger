rm my_deployment_package.zip

zip -r my_deployment_package.zip .

aws lambda update-function-code --function-name resource-auto-tag \
	--zip-file fileb://my_deployment_package.zip




