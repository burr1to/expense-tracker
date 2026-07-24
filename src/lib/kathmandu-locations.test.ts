import { describe, expect, it } from "vitest";
import { KATHMANDU_BOUNDS, KATHMANDU_PLACES, isInsideKathmandu, kathmanduMapStyle, nearestKathmanduPlace, pinnedKathmanduLocation } from "./kathmandu-locations";

describe("Kathmandu transaction locations", () => {
  it("accepts coordinates inside the configured Kathmandu area", () => {
    expect(isInsideKathmandu(27.7172, 85.3240)).toBe(true);
    expect(isInsideKathmandu(KATHMANDU_BOUNDS.south, KATHMANDU_BOUNDS.west)).toBe(true);
  });

  it("rejects coordinates outside the Kathmandu-only boundary", () => {
    expect(isInsideKathmandu(27.6710, 85.4298)).toBe(false);
    expect(isInsideKathmandu(28.2096, 83.9856)).toBe(false);
  });

  it("uses the keyless OpenFreeMap vector style by default", () => {
    expect(kathmanduMapStyle()).toBe("https://tiles.openfreemap.org/styles/positron");
  });

  it("provides small locality labels across the wider Kathmandu map at its default zoom", () => {
    expect(KATHMANDU_PLACES.filter((place) => (place.minZoom ?? 11) <= 12.3).length).toBeGreaterThanOrEqual(20);
    expect(KATHMANDU_PLACES.every((place) => isInsideKathmandu(place.latitude, place.longitude))).toBe(true);
  });

  it("creates a precise pin snapshot with a nearby Kathmandu label", () => {
    const location = pinnedKathmanduLocation(27.7155, 85.3124);
    expect(nearestKathmanduPlace(location.latitude, location.longitude).name).toBe("Thamel");
    expect(location).toMatchObject({
      label: "Near Thamel",
      latitude: 27.7155,
      longitude: 85.3124,
      source: "pin",
      savedPlaceId: null,
    });
    expect(location.address).toContain("27.715500, 85.312400");
  });
});
