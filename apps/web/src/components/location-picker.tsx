import { Input } from "@getficksd/ui/components/input";
import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
} from "@getficksd/ui/components/map";
import { MapPinIcon } from "lucide-react";

export type LocationValue = {
  longitude: number;
  latitude: number;
};

type LocationPickerProps = {
  value: LocationValue;
  onChange: (value: LocationValue) => void;
};

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  function updateCoordinate(coordinate: keyof LocationValue, input: string) {
    const number = Number(input);
    if (Number.isFinite(number)) {
      onChange({ ...value, [coordinate]: number });
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium" htmlFor="map-latitude">
          Latitude
          <Input
            id="map-latitude"
            type="number"
            step="any"
            value={value.latitude}
            onChange={(event) => updateCoordinate("latitude", event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium" htmlFor="map-longitude">
          Longitude
          <Input
            id="map-longitude"
            type="number"
            step="any"
            value={value.longitude}
            onChange={(event) => updateCoordinate("longitude", event.target.value)}
          />
        </label>
      </div>

      <div className="h-[min(62vh,640px)] min-h-96 overflow-hidden border">
        <Map center={[value.longitude, value.latitude]} zoom={13}>
          <MapControls showCompass showFullscreen showLocate onLocate={onChange} />
          <MapMarker
            draggable
            longitude={value.longitude}
            latitude={value.latitude}
            onDragEnd={({ lng, lat }) => onChange({ longitude: lng, latitude: lat })}
          >
            <MarkerContent className="-translate-y-1/2">
              <span className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-md">
                <MapPinIcon className="size-4" />
              </span>
            </MarkerContent>
            <MarkerPopup>
              <p className="font-medium">Selected location</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
              </p>
            </MarkerPopup>
          </MapMarker>
        </Map>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag the marker, edit the coordinates, or use the location control.
      </p>
    </div>
  );
}
