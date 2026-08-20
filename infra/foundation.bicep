targetScope = 'resourceGroup'

@description('Azure region for the publisher foundation.')
param location string

@description('Stable names for resources in the publisher foundation.')
param names object

@description('Tags applied to every publisher resource.')
param tags object

module publisherIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.6.0' = {
  params: {
    name: names.identity
    location: location
    tags: tags
    enableTelemetry: false
  }
}

module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.16.1' = {
  params: {
    name: names.logAnalytics
    location: location
    dataRetention: 30
    dailyQuotaGb: '0.5'
    features: {
      disableLocalAuth: false
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    forceCmkForQuery: false
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    skuName: 'PerGB2018'
    tags: tags
    enableTelemetry: false
  }
}

module registry 'br/public:avm/res/container-registry/registry:0.13.0' = {
  params: {
    name: names.registry
    location: location
    acrAdminUserEnabled: false
    acrSku: 'Basic'
    anonymousPullEnabled: false
    networkRuleSetDefaultAction: 'Allow'
    publicNetworkAccess: 'Enabled'
    roleAssignmentMode: 'LegacyRegistryPermissions'
    roleAssignments: [
      {
        principalId: publisherIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'AcrPull'
        description: 'Allows the TransLink publisher identity to pull immutable images.'
      }
    ]
    zoneRedundancy: 'Disabled'
    diagnosticSettings: [
      {
        workspaceResourceId: logAnalytics.outputs.resourceId
      }
    ]
    tags: tags
    enableTelemetry: false
  }
}

module managedEnvironment 'br/public:avm/res/app/managed-environment:0.15.0' = {
  params: {
    name: names.environment
    location: location
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsWorkspaceResourceId: logAnalytics.outputs.resourceId
    }
    diagnosticSettings: [
      {
        workspaceResourceId: logAnalytics.outputs.resourceId
      }
    ]
    peerTrafficEncryption: true
    publicNetworkAccess: 'Enabled'
    zoneRedundant: false
    tags: tags
    enableTelemetry: false
  }
}

@description('ACR login server for image build and publisher deployment.')
output registryLoginServer string = registry.outputs.loginServer

@description('ACR resource ID for deployment inspection.')
output registryResourceId string = registry.outputs.resourceId

@description('Container Apps environment resource ID.')
output environmentResourceId string = managedEnvironment.outputs.resourceId

@description('Log Analytics workspace resource ID.')
output logAnalyticsResourceId string = logAnalytics.outputs.resourceId

@description('Publisher user-assigned identity resource ID.')
output publisherIdentityResourceId string = publisherIdentity.outputs.resourceId

@description('Publisher user-assigned identity client ID.')
output publisherIdentityClientId string = publisherIdentity.outputs.clientId

@description('Publisher user-assigned identity principal ID.')
output publisherIdentityPrincipalId string = publisherIdentity.outputs.principalId
