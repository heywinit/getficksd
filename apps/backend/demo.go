package main

import "net/http"

type demoSiteSummary struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Location           string  `json:"location"`
	Timezone           string  `json:"timezone"`
	PeakDemandKW       float64 `json:"peak_demand_kw"`
	SolarCapacityKW    float64 `json:"solar_capacity_kw"`
	WindCapacityKW     float64 `json:"wind_capacity_kw"`
	BatteryCapacityKWH float64 `json:"battery_capacity_kwh"`
	DieselCapacityKW   float64 `json:"diesel_capacity_kw"`
}

type demoOperator struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Role string          `json:"role"`
	Site demoSiteSummary `json:"site"`
}

var demoOperators = []demoOperator{
	{
		ID:   "maya-patel",
		Name: "Maya Patel",
		Role: "Grid operator",
		Site: demoSiteSummary{
			ID:                 "spiti-valley",
			Name:               "Spiti Valley Community Grid",
			Location:           "Himachal Pradesh, India",
			Timezone:           "Asia/Kolkata",
			PeakDemandKW:       206,
			SolarCapacityKW:    220,
			WindCapacityKW:     60,
			BatteryCapacityKWH: 900,
			DieselCapacityKW:   160,
		},
	},
	{
		ID:   "kwame-mensah",
		Name: "Kwame Mensah",
		Role: "Grid operator",
		Site: demoSiteSummary{
			ID:                 "ada-foah",
			Name:               "Ada Foah Coastal Grid",
			Location:           "Greater Accra, Ghana",
			Timezone:           "Africa/Accra",
			PeakDemandKW:       130,
			SolarCapacityKW:    95,
			WindCapacityKW:     80,
			BatteryCapacityKWH: 420,
			DieselCapacityKW:   120,
		},
	},
	{
		ID:   "lucia-torres",
		Name: "Lucía Torres",
		Role: "Grid operator",
		Site: demoSiteSummary{
			ID:                 "sierra-verde",
			Name:               "Sierra Verde Health Grid",
			Location:           "Oaxaca, Mexico",
			Timezone:           "America/Mexico_City",
			PeakDemandKW:       58,
			SolarCapacityKW:    88,
			WindCapacityKW:     0,
			BatteryCapacityKWH: 280,
			DieselCapacityKW:   55,
		},
	},
	{
		ID:   "noor-rahman",
		Name: "Noor Rahman",
		Role: "Grid operator",
		Site: demoSiteSummary{
			ID:                 "char-kukri-mukri",
			Name:               "Char Kukri Mukri Grid",
			Location:           "Bhola, Bangladesh",
			Timezone:           "Asia/Dhaka",
			PeakDemandKW:       74,
			SolarCapacityKW:    110,
			WindCapacityKW:     25,
			BatteryCapacityKWH: 310,
			DieselCapacityKW:   70,
		},
	},
}

func (a *app) listDemoOperators(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, demoOperators)
}
