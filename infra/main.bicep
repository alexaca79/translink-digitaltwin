targetScope = 'subscription'

@description('Azure region for the isolated TransLink publisher resources.')
param location string = 'westus2'

@description('New resource group that owns all TransLink publisher resources.')
param resourceGroupName string = 'rg-translink-digital-twin'

@description('Tags applied to the resource group and publisher resources.')
param tags object = {
  application: 'translink-digital-twin'
  dataClassification: 'public'
  workload: 'transit-operations'
}

var suffix = take(uniqueString(subscription().id, resourceGroupName), 8)
var resourceNames = {
  registry: 'acrtranslink${suffix}'
  logAnalytics: 'log-translink-${suffix}'
  environment: 'cae-translink-digital-twin'
  identity: 'id-translink-publisher'
}

module resourceGroupDeployment 'br/public:avm/res/resources/resource-group:0.4.4' = {
  params: {
    name: resourceGroupName
    location: location
    tags: tags
    enableTelemetry: false
  }
}

module foundation './foundation.bicep' = {
  scope: resourceGroup(resourceGroupName)
  params: {
    location: location
    names: resourceNames
    tags: tags
  }
  dependsOn: [resourceGroupDeployment]
}

@description('Resource group created for the isolated publisher.')
output resourceGroupName string = resourceGroupDeployment.outputs.name

@description('Login server used for immutable publisher images.')
output registryLoginServer string = foundation.outputs.registryLoginServer

@description('Registry resource ID used by deployment validation.')
output registryResourceId string = foundation.outputs.registryResourceId

@description('Container Apps environment resource ID used by the publisher deployment.')
output environmentResourceId string = foundation.outputs.environmentResourceId

@description('Log Analytics resource ID used for publisher diagnostics.')
output logAnalyticsResourceId string = foundation.outputs.logAnalyticsResourceId

@description('User-assigned identity resource ID used by the publisher.')
output publisherIdentityResourceId string = foundation.outputs.publisherIdentityResourceId

@description('User-assigned identity client ID used for managed identity token selection.')
output publisherIdentityClientId string = foundation.outputs.publisherIdentityClientId

@description('User-assigned identity principal ID used for Fabric authorization.')
output publisherIdentityPrincipalId string = foundation.outputs.publisherIdentityPrincipalId
