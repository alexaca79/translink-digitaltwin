targetScope = 'resourceGroup'

@description('Azure region of the existing Container Apps environment.')
param location string = resourceGroup().location

@description('Container App name for the TransLink publisher.')
param containerAppName string = 'ca-translink-publisher'

@description('Existing Container Apps environment resource ID.')
param environmentResourceId string

@description('Existing Log Analytics workspace resource ID.')
param logAnalyticsResourceId string

@description('Existing ACR login server.')
param registryLoginServer string

@description('Existing user-assigned identity resource ID.')
param publisherIdentityResourceId string

@description('Client ID of the publisher user-assigned identity.')
param publisherIdentityClientId string

@description('Immutable publisher image tag, normally the Git commit SHA.')
param imageTag string

@description('Fabric Eventstream Kafka brokers as a comma-separated string.')
param eventstreamBrokers string

@description('Fabric Eventstream Kafka topic.')
param eventstreamTopic string

@description('Fabric Eventstream Kafka username.')
param eventstreamUsername string = '$ConnectionString'

@secure()
@description('Fabric Eventstream Kafka password.')
param eventstreamPassword string

@description('Fabric Eventhouse query service URI.')
param kqlQueryUri string

@description('Fabric Eventhouse database name.')
param kqlDatabase string = 'TransLinkOperations'

@secure()
@description('TransLink Open API key used only by the server-side publisher.')
param translinkApiKey string

@description('Exact browser origin allowed by the publisher CORS policy.')
param allowedOrigin string = 'https://deployment-pending.invalid'

@description('Tags applied to the Container App.')
param tags object = {
  application: 'translink-digital-twin'
  dataClassification: 'public'
  workload: 'transit-operations'
}

var publisherImage = '${registryLoginServer}/translink-digital-twin-publisher:${imageTag}'

module publisher 'br/public:avm/res/app/container-app:0.23.0' = {
  params: {
    name: containerAppName
    location: location
    environmentResourceId: environmentResourceId
    managedIdentities: {
      userAssignedResourceIds: [publisherIdentityResourceId]
    }
    registries: [
      {
        server: registryLoginServer
        identity: publisherIdentityResourceId
      }
    ]
    secrets: [
      {
        name: 'translink-api-key'
        value: translinkApiKey
      }
      {
        name: 'eventstream-password'
        value: eventstreamPassword
      }
    ]
    containers: [
      {
        name: 'publisher'
        image: publisherImage
        env: [
          {
            name: 'PORT'
            value: '7071'
          }
          {
            name: 'TRANSLINK_GTFS_STATIC_DIR'
            value: '/app/data/gtfs-static'
          }
          {
            name: 'TRANSLINK_POLL_INTERVAL_MS'
            value: '15000'
          }
          {
            name: 'TRANSLINK_API_KEY'
            secretRef: 'translink-api-key'
          }
          {
            name: 'FABRIC_EVENTSTREAM_BROKERS'
            value: eventstreamBrokers
          }
          {
            name: 'FABRIC_EVENTSTREAM_TOPIC'
            value: eventstreamTopic
          }
          {
            name: 'FABRIC_EVENTSTREAM_USERNAME'
            value: eventstreamUsername
          }
          {
            name: 'FABRIC_EVENTSTREAM_PASSWORD'
            secretRef: 'eventstream-password'
          }
          {
            name: 'FABRIC_KQL_QUERY_URI'
            value: kqlQueryUri
          }
          {
            name: 'FABRIC_KQL_DATABASE'
            value: kqlDatabase
          }
          {
            name: 'AZURE_CLIENT_ID'
            value: publisherIdentityClientId
          }
          {
            name: 'PUBLISHER_ALLOWED_ORIGIN'
            value: allowedOrigin
          }
          {
            name: 'PUBLISHER_RATE_LIMIT_PER_MINUTE'
            value: '60'
          }
          {
            name: 'PUBLISHER_EXPOSE_ERROR_DETAIL'
            value: 'false'
          }
        ]
        resources: {
          cpu: json('0.5')
          memory: '1Gi'
        }
        probes: [
          {
            type: 'Startup'
            tcpSocket: {
              port: 7071
            }
            initialDelaySeconds: 1
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 30
          }
          {
            type: 'Liveness'
            tcpSocket: {
              port: 7071
            }
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          }
          {
            type: 'Readiness'
            httpGet: {
              path: '/api/ready'
              port: 7071
              scheme: 'HTTP'
            }
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 4
          }
        ]
      }
    ]
    activeRevisionsMode: 'Single'
    maxInactiveRevisions: 3
    ingressAllowInsecure: false
    ingressExternal: true
    ingressTargetPort: 7071
    ingressTransport: 'http'
    corsPolicy: {
      allowedOrigins: [allowedOrigin]
      allowedMethods: ['GET', 'OPTIONS']
      allowedHeaders: ['Content-Type']
    }
    scaleSettings: {
      minReplicas: 1
      maxReplicas: 1
    }
    diagnosticSettings: [
      {
        workspaceResourceId: logAnalyticsResourceId
      }
    ]
    tags: tags
    enableTelemetry: false
  }
}

@description('HTTPS origin of the deployed publisher API.')
output publisherUrl string = 'https://${publisher.outputs.fqdn}'

@description('Container App resource ID.')
output publisherResourceId string = publisher.outputs.resourceId
