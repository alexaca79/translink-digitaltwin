using './main.bicep'

param location = 'westus2'
param resourceGroupName = 'rg-translink-digital-twin'
param tags = {
  application: 'translink-digital-twin'
  dataClassification: 'public'
  workload: 'transit-operations'
}