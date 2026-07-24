"use client";

import { Loader, TextInput } from "@mantine/core";
import { ClockCounterClockwise, Crosshair, MagnifyingGlass, MapPin, NavigationArrow, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KATHMANDU_BOUNDS, KATHMANDU_CENTER, KATHMANDU_MAP_MAX_ZOOM, addKathmanduLabelMarkers, applyKathmanduMapTheme, isInsideKathmandu, kathmanduMapStyle, nearestKathmanduPlace, pinnedKathmanduLocation } from "../lib/kathmandu-locations";
import { savedPlaceIconOptions } from "../lib/saved-places";
import type { SavedPlace, SavedPlaceDraft, SavedPlaceIconName, TransactionLocationDraft } from "../types";
import { SavedPlaceIcon } from "./SavedPlaceIcon";

interface LocationPickerProps {
  open: boolean;
  value: TransactionLocationDraft | null;
  recentLocations: TransactionLocationDraft[];
  savedPlaces: SavedPlace[];
  onClose: () => void;
  onSelect?: (location: TransactionLocationDraft) => void;
  mode?: "transaction" | "saved-place";
  onSavePlace?: (place: SavedPlaceDraft) => Promise<void>;
}

interface LocationSearchResult {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
}

export function LocationPicker({ open, value, recentLocations, savedPlaces, onClose, onSelect, mode = "transaction", onSavePlace }: LocationPickerProps) {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const marker = useRef<import("maplibre-gl").Marker | null>(null);
  const mapModule = useRef<typeof import("maplibre-gl") | null>(null);
  const [candidate, setCandidate] = useState<TransactionLocationDraft | null>(value);
  const [query, setQuery] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [savedPlaceName, setSavedPlaceName] = useState("");
  const [savedPlaceIcon, setSavedPlaceIcon] = useState<SavedPlaceIconName>("pin");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedLocationDrafts = useMemo(() => savedPlaces.map((place): TransactionLocationDraft => ({ label: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude, accuracy: null, source: "saved", savedPlaceId: place.id })), [savedPlaces]);
  const visibleLocations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const previousLocations = mode === "transaction" ? [...savedLocationDrafts, ...recentLocations] : recentLocations;
    if (!normalized) return previousLocations.slice(0, 8);
    const previousMatches = previousLocations.filter((place) => `${place.label} ${place.address}`.toLowerCase().includes(normalized));
    const seen = new Set(previousMatches.map((place) => `${place.latitude.toFixed(5)}-${place.longitude.toFixed(5)}`));
    return [...previousMatches, ...searchResults.filter((place) => {
      const key = `${place.latitude.toFixed(5)}-${place.longitude.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })].slice(0, 8);
  }, [mode, query, recentLocations, savedLocationDrafts, searchResults]);

  const moveMarker = (next: TransactionLocationDraft, zoom = 16) => {
    setCandidate(next);
    if (!map.current || !mapModule.current) return;
    if (!marker.current) {
      marker.current = new mapModule.current.Marker({ color: "#135dea", draggable: true })
        .setLngLat([next.longitude, next.latitude])
        .addTo(map.current);
      marker.current.on("dragend", () => {
        const point = marker.current?.getLngLat();
        if (point) setCandidate(pinnedKathmanduLocation(point.lat, point.lng));
      });
    } else marker.current.setLngLat([next.longitude, next.latitude]);
    map.current.flyTo({ center: [next.longitude, next.latitude], zoom });
  };

  useEffect(() => {
    if (!open) return;
    setCandidate(value);
    setQuery("");
    setLocationError(null);
    setMapError(null);
    setSearching(false);
    setSearchResults([]);
    setSavedPlaceName("");
    setSavedPlaceIcon("pin");
    setSaving(false);
    setSaveError(null);
    let active = true;
    let removeLabels = () => {};
    void import("maplibre-gl").then((module) => {
      if (!active || !mapNode.current) return;
      mapModule.current = module;
      const center: [number, number] = value ? [value.longitude, value.latitude] : KATHMANDU_CENTER;
      const instance = new module.Map({
        container: mapNode.current,
        style: kathmanduMapStyle(),
        center,
        zoom: value ? 16 : 12.5,
        maxBounds: [[KATHMANDU_BOUNDS.west, KATHMANDU_BOUNDS.south], [KATHMANDU_BOUNDS.east, KATHMANDU_BOUNDS.north]],
        minZoom: 11,
        maxZoom: KATHMANDU_MAP_MAX_ZOOM,
      });
      map.current = instance;
      instance.addControl(new module.NavigationControl({ showCompass: false }), "top-right");
      instance.on("style.load", () => applyKathmanduMapTheme(instance));
      removeLabels = addKathmanduLabelMarkers(instance, module.Marker);
      instance.on("error", (event) => {
        const message = event.error?.message ?? "";
        if (/AJAXError|Failed to fetch|tile/i.test(message)) {
          setMapError("A few background tiles could not load. Your selected location is still safe.");
          return;
        }
        console.error("[location-picker] Map error", event.error);
      });
      instance.on("idle", () => setMapError(null));
      instance.on("click", (event) => moveMarker(pinnedKathmanduLocation(event.lngLat.lat, event.lngLat.lng)));
      if (value) moveMarker(value, 16);
    });
    return () => {
      active = false;
      removeLabels();
      marker.current?.remove();
      marker.current = null;
      map.current?.remove();
      map.current = null;
      mapModule.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const searchQuery = query.trim();
    setLocationError(null);
    if (searchQuery.length < 2) {
      setSearching(false);
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchResults([]);
    const timer = window.setTimeout(() => {
      void fetch(`/api/maps/search?q=${encodeURIComponent(searchQuery)}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json() as { results?: LocationSearchResult[]; error?: string };
          if (!response.ok) throw new Error(data.error || "Search failed.");
          setSearchResults(data.results ?? []);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLocationError(error instanceof Error ? error.message : "Place search is temporarily unavailable.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  if (!open) return null;

  const choosePlace = (place: LocationSearchResult | TransactionLocationDraft) => moveMarker({
    label: place.label,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    accuracy: null,
    source: "savedPlaceId" in place && "source" in place && place.source === "saved" ? "saved" : "search",
    savedPlaceId: "savedPlaceId" in place ? place.savedPlaceId : null,
  });
  const useCurrentLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) { setLocationError("Location is not supported by this browser."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setLocating(false);
      const { latitude, longitude, accuracy } = position.coords;
      if (!isInsideKathmandu(latitude, longitude)) {
        setLocationError("Your current location is outside the Kathmandu-only map area.");
        return;
      }
      const nearest = nearestKathmanduPlace(latitude, longitude);
      moveMarker({
        label: `Near ${nearest.name}`,
        address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)} · Kathmandu`,
        latitude,
        longitude,
        accuracy: Math.round(accuracy),
        source: "current_location",
        savedPlaceId: null,
      });
    }, () => {
      setLocating(false);
      setLocationError("We could not access your location. You can still drop a pin.");
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  };
  const confirm = async () => {
    if (!candidate) return;
    if (mode === "saved-place") {
      if (!savedPlaceName.trim() || !onSavePlace) return;
      setSaving(true);
      setSaveError(null);
      try {
        await onSavePlace({
          name: savedPlaceName.trim(),
          icon: savedPlaceIcon,
          address: candidate.address || "Kathmandu, Nepal",
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        });
        onClose();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Could not save this place.");
      } finally {
        setSaving(false);
      }
      return;
    }
    onSelect?.({ ...candidate, label: candidate.label.trim() || "Pinned location" });
    onClose();
  };

  return <div className="modal-backdrop location-picker-backdrop" role="presentation">
    <section className="location-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="location-picker-title">
      <header>
        <div><span className="eyebrow">Kathmandu only</span><h2 id="location-picker-title">{mode === "saved-place" ? "Save a place" : "Choose transaction location"}</h2><p>{mode === "saved-place" ? "Choose the exact spot, then give it a name and icon." : "Search an area, use your device, or click the exact spot on the map."}</p></div>
        <button className="icon-button" onClick={onClose} aria-label="Close location picker"><X size={21} /></button>
      </header>
      <div className="location-picker-body">
        <aside className="location-picker-panel">
          <button type="button" className="secondary-button full-width" disabled={locating} onClick={useCurrentLocation}><Crosshair size={18} />{locating ? "Finding your location…" : "Use current location"}</button>
          {locationError && <div className="form-error" role="alert">{locationError}</div>}
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} leftSection={<MagnifyingGlass size={17} />} rightSection={searching ? <Loader size={15} /> : undefined} label="Search Kathmandu" placeholder="Place, landmark, or address…" />
          {!query.trim() && visibleLocations.length > 0 && <span className="field-label"><ClockCounterClockwise size={15} />{mode === "saved-place" ? "Previously selected" : "Saved and previously selected"}</span>}
          <div className="location-results">
            {visibleLocations.map((place) => {
              const label = place.label;
              const active = candidate?.latitude === place.latitude && candidate.longitude === place.longitude;
              const savedPlace = "savedPlaceId" in place && place.savedPlaceId ? savedPlaces.find((item) => item.id === place.savedPlaceId) : undefined;
              return <button type="button" className={active ? "active" : undefined} key={`${label}-${place.latitude}-${place.longitude}`} onClick={() => choosePlace(place)}>{savedPlace ? <SavedPlaceIcon icon={savedPlace.icon ?? "pin"} size={17} weight={active ? "fill" : "regular"} /> : <MapPin size={17} weight={active ? "fill" : "regular"} />}<span><strong>{label}</strong><small>{place.address}</small></span></button>;
            })}
            {query.trim().length >= 2 && !searching && !visibleLocations.length && !locationError && <p>No Kathmandu places matched that search.</p>}
          </div>
        </aside>
        <div className="location-map-wrap">
          <div ref={mapNode} className="location-map" />
          <span className="map-area-badge"><NavigationArrow size={14} weight="fill" />Kathmandu map area</span>
          {mapError && <span className="map-load-warning" role="status">{mapError}</span>}
        </div>
      </div>
      <footer className={mode === "saved-place" ? "location-picker-footer save-place-mode" : "location-picker-footer"}>
        <div className="selected-location">
          {candidate ? <><MapPin size={20} weight="fill" /><div><TextInput aria-label="Location label" value={candidate.label} onChange={(event) => setCandidate({ ...candidate, label: event.target.value })} /><small>{candidate.address}</small></div></> : <><MapPin size={20} /><div><strong>No location selected</strong><small>Click anywhere inside the Kathmandu map.</small></div></>}
        </div>
        {mode === "saved-place" && <div className="location-picker-actions"><TextInput label="Place name" aria-label="Saved place name" value={savedPlaceName} onChange={(event) => setSavedPlaceName(event.currentTarget.value)} placeholder="e.g. Home or Office" /><fieldset className="saved-place-icon-picker"><legend>Icon</legend>{savedPlaceIconOptions.map((option) => <button type="button" className={savedPlaceIcon === option.value ? "active" : undefined} aria-label={option.label} aria-pressed={savedPlaceIcon === option.value} title={option.label} key={option.value} onClick={() => setSavedPlaceIcon(option.value)}><SavedPlaceIcon icon={option.value} size={18} /></button>)}</fieldset>{saveError && <div className="form-error" role="alert">{saveError}</div>}</div>}
        <div className="dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={saving || !candidate || !candidate.label.trim() || (mode === "saved-place" && !savedPlaceName.trim())} onClick={() => void confirm()}><MapPin size={17} />{saving ? "Saving…" : mode === "saved-place" ? "Save place" : "Use this location"}</button></div>
      </footer>
    </section>
  </div>;
}
