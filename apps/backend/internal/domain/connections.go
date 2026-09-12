package domain

import "fmt"

// NormalizeScenarioConnections gives legacy scenario documents their original
// star topology. A non-nil empty slice is an explicit fully disconnected grid.
func NormalizeScenarioConnections(scenario *Scenario) {
	if scenario.Site.Connections != nil {
		return
	}

	connections := make([]Connection, 0, len(scenario.Site.Assets)+len(scenario.Site.Services))
	for _, asset := range scenario.Site.Assets {
		connections = append(connections, Connection{
			ID:       defaultConnectionID(asset.ID, ControllerNodeID),
			SourceID: asset.ID,
			TargetID: ControllerNodeID,
		})
	}
	for _, service := range scenario.Site.Services {
		connections = append(connections, Connection{
			ID:       defaultConnectionID(ControllerNodeID, service.ID),
			SourceID: ControllerNodeID,
			TargetID: service.ID,
		})
	}
	scenario.Site.Connections = connections
}

func defaultConnectionID(sourceID, targetID string) string {
	return fmt.Sprintf("connection:%s:%s", sourceID, targetID)
}

// AssetCanReachController reports whether an asset has a directed path to the
// controller. Valid paths can pass through battery assets.
func AssetCanReachController(site Site, assetID string) bool {
	assets := make(map[string]Asset, len(site.Assets))
	for _, asset := range site.Assets {
		assets[asset.ID] = asset
	}
	if _, exists := assets[assetID]; !exists {
		return false
	}

	adjacent := make(map[string][]string)
	for _, connection := range site.Connections {
		adjacent[connection.SourceID] = append(adjacent[connection.SourceID], connection.TargetID)
	}
	visited := map[string]bool{assetID: true}
	queue := []string{assetID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, next := range adjacent[current] {
			if next == ControllerNodeID {
				return true
			}
			asset, isAsset := assets[next]
			if !isAsset || asset.Type != AssetBattery || visited[next] {
				continue
			}
			visited[next] = true
			queue = append(queue, next)
		}
	}
	return false
}

func ServiceIsConnected(site Site, serviceID string) bool {
	for _, connection := range site.Connections {
		if connection.SourceID == ControllerNodeID && connection.TargetID == serviceID {
			return true
		}
	}
	return false
}
