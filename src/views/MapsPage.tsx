"use client";

import { Select, SegmentedControl, TextInput } from "@mantine/core";
import { ArrowRight, ClockCounterClockwise, FunnelSimple, MapPin, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocationPicker } from "../components/LocationPicker";
import { SavedPlaceIcon } from "../components/SavedPlaceIcon";
import { TransactionRow } from "../components/TransactionRow";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { KATHMANDU_BOUNDS, KATHMANDU_CENTER, KATHMANDU_MAP_MAX_ZOOM, addKathmanduLabelMarkers, applyKathmanduMapTheme, kathmanduMapStyle } from "../lib/kathmandu-locations";
import { transactionPlaceKey } from "../lib/place-spending-trends";
import { savedPlaceIconOptions } from "../lib/saved-places";
import type { CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount, SavedPlace, SavedPlaceDraft, SavedPlaceIconName, TransactionKind, TransactionLocationDraft } from "../types";

interface MapsPageProps {
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  onSaveSavedPlace: (draft: SavedPlaceDraft, id?: string) => Promise<void>;
  onDeleteSavedPlace: (id: string) => Promise<void>;
  onEdit: (transaction: LedgerTransaction) => void;
  onAdd: () => void;
  onAddAtPlace: (place: SavedPlace) => void;
}

type MapMode = "pins" | "heatmap";
type DateFilter = "all" | "this_month" | "last_3_months" | "this_year" | "custom";

interface MapFilters {
  kind: TransactionKind | "all";
  category: string;
  paymentAccountId: string;
  dateFilter: DateFilter;
  fromDate: string;
  toDate: string;
  minAmount: string;
  maxAmount: string;
}

interface PlaceSummary {
  key: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  icon: SavedPlaceIconName;
  transactions: LedgerTransaction[];
  totalExpenseMinor: number;
  totalIncomeMinor: number;
  netMinor: number;
  topCategory: string;
  monthlyTotals: { month: string; amountMinor: number }[];
}

const coordinatesMatch = (first: { latitude: number; longitude: number }, second: { latitude: number; longitude: number }) => first.latitude.toFixed(5) === second.latitude.toFixed(5) && first.longitude.toFixed(5) === second.longitude.toFixed(5);

const initialFilters: MapFilters = { kind: "all", category: "all", paymentAccountId: "all", dateFilter: "all", fromDate: "", toDate: "", minAmount: "", maxAmount: "" };
const placeHistoryPageSize = 4;
const startOfThisMonth = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`; };
const startOfLast3Months = () => { const date = new Date(); date.setMonth(date.getMonth() - 2, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`; };
const startOfThisYear = () => `${new Date().getFullYear()}-01-01`;

function dateRangeFor(filters: MapFilters) {
  if (filters.dateFilter === "this_month") return { from: startOfThisMonth(), to: "" };
  if (filters.dateFilter === "last_3_months") return { from: startOfLast3Months(), to: "" };
  if (filters.dateFilter === "this_year") return { from: startOfThisYear(), to: "" };
  if (filters.dateFilter === "custom") return { from: filters.fromDate, to: filters.toDate };
  return { from: "", to: "" };
}

function buildSummaries(transactions: LedgerTransaction[], savedPlaces: SavedPlace[]): PlaceSummary[] {
  const savedById = new Map(savedPlaces.map((place) => [place.id, place]));
  const groups = new Map<string, PlaceSummary>();
  transactions.forEach((transaction) => {
    if (transaction.locationLatitude == null || transaction.locationLongitude == null) return;
    const key = transactionPlaceKey(transaction);
    if (!key) return;
    const saved = transaction.savedPlaceId ? savedById.get(transaction.savedPlaceId) : undefined;
    const current = groups.get(key) ?? {
      key,
      label: saved?.name ?? transaction.locationLabel ?? transaction.area ?? "Pinned location",
      address: saved?.address ?? transaction.locationAddress ?? "Kathmandu, Nepal",
      latitude: transaction.locationLatitude,
      longitude: transaction.locationLongitude,
      icon: saved?.icon ?? "pin",
      transactions: [],
      totalExpenseMinor: 0,
      totalIncomeMinor: 0,
      netMinor: 0,
      topCategory: transaction.category,
      monthlyTotals: [],
    };
    current.transactions.push(transaction);
    if (transaction.kind === "expense") current.totalExpenseMinor += transaction.amountMinor;
    else current.totalIncomeMinor += transaction.amountMinor;
    current.netMinor = current.totalIncomeMinor - current.totalExpenseMinor;
    groups.set(key, current);
  });
  savedPlaces.forEach((place) => {
    const matchingSummary = groups.get(place.id) ?? [...groups.values()].find((summary) => coordinatesMatch(summary, place));
    if (matchingSummary) {
      matchingSummary.label = place.name;
      matchingSummary.address = place.address;
      matchingSummary.icon = place.icon ?? "pin";
      return;
    }
    groups.set(place.id, {
      key: place.id,
      label: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      icon: place.icon ?? "pin",
      transactions: [],
      totalExpenseMinor: 0,
      totalIncomeMinor: 0,
      netMinor: 0,
      topCategory: "other",
      monthlyTotals: [],
    });
  });
  return [...groups.values()].map((summary) => {
    const categoryTotals = new Map<string, number>();
    const monthlyTotals = new Map<string, number>();
    summary.transactions.forEach((transaction) => categoryTotals.set(transaction.category, (categoryTotals.get(transaction.category) ?? 0) + transaction.amountMinor));
    summary.transactions.forEach((transaction) => { if (transaction.kind === "expense") monthlyTotals.set(transaction.occurredOn.slice(0, 7), (monthlyTotals.get(transaction.occurredOn.slice(0, 7)) ?? 0) + transaction.amountMinor); });
    summary.topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? summary.topCategory;
    summary.monthlyTotals = [...monthlyTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, amountMinor]) => ({ month, amountMinor }));
    return summary;
  }).sort((a, b) => b.totalExpenseMinor - a.totalExpenseMinor || b.transactions.length - a.transactions.length);
}

export function MapsPage({ currency, transactions, customCategories, paymentAccounts, savedPlaces, onSaveSavedPlace, onDeleteSavedPlace, onEdit, onAdd, onAddAtPlace }: MapsPageProps) {
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("pins");
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string | null>(null);
  const [placeHistoryPage, setPlaceHistoryPage] = useState(0);
  const [mapError, setMapError] = useState<string | null>(null);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [editingSavedPlaceId, setEditingSavedPlaceId] = useState<string | null>(null);
  const [editingSavedPlaceName, setEditingSavedPlaceName] = useState("");
  const [editingSavedPlaceIcon, setEditingSavedPlaceIcon] = useState<SavedPlaceIconName>("pin");
  const [saveSelectedPlaceOpen, setSaveSelectedPlaceOpen] = useState(false);
  const [selectedPlaceName, setSelectedPlaceName] = useState("");
  const [selectedPlaceIcon, setSelectedPlaceIcon] = useState<SavedPlaceIconName>("pin");
  const [savingSelectedPlace, setSavingSelectedPlace] = useState(false);
  const [saveSelectedPlaceError, setSaveSelectedPlaceError] = useState<string | null>(null);
  const [justSavedPlace, setJustSavedPlace] = useState<SavedPlaceDraft | null>(null);
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const located = useMemo(() => {
    const range = dateRangeFor(filters);
    const minMinor = filters.minAmount ? Math.max(0, Number(filters.minAmount.replace(/,/g, "")) * 100) : null;
    const maxMinor = filters.maxAmount ? Math.max(0, Number(filters.maxAmount.replace(/,/g, "")) * 100) : null;
    return transactions.filter((transaction) => {
      if (transaction.locationLatitude == null || transaction.locationLongitude == null) return false;
      if (filters.kind !== "all" && transaction.kind !== filters.kind) return false;
      if (filters.category !== "all" && transaction.category !== filters.category) return false;
      if (filters.paymentAccountId !== "all" && transaction.paymentAccountId !== filters.paymentAccountId) return false;
      if (range.from && transaction.occurredOn < range.from) return false;
      if (range.to && transaction.occurredOn > range.to) return false;
      if (minMinor != null && transaction.amountMinor < minMinor) return false;
      if (maxMinor != null && transaction.amountMinor > maxMinor) return false;
      return true;
    });
  }, [filters, transactions]);
  const summaries = useMemo(() => buildSummaries(located, savedPlaces), [located, savedPlaces]);
  const selectedSavedPlaceByKey = savedPlaces.find((place) => place.id === selectedPlaceKey);
  const selectedSummary = summaries.find((summary) => summary.key === selectedPlaceKey) ?? (selectedSavedPlaceByKey ? summaries.find((summary) => coordinatesMatch(summary, selectedSavedPlaceByKey)) : null) ?? null;
  const selectedSavedPlace = selectedSummary ? savedPlaces.find((place) => place.id === selectedPlaceKey || coordinatesMatch(place, selectedSummary)) ?? null : null;
  const justSavedSelectedPlace = selectedSummary && justSavedPlace && coordinatesMatch(justSavedPlace, selectedSummary) ? justSavedPlace : null;
  const selectedPlaceDisplay = selectedSavedPlace ?? justSavedSelectedPlace;
  const placeHistoryCount = selectedSummary?.transactions.length ?? 0;
  const placeHistoryPageCount = Math.max(1, Math.ceil(placeHistoryCount / placeHistoryPageSize));
  const visiblePlaceHistoryPage = Math.min(placeHistoryPage, placeHistoryPageCount - 1);
  const visiblePlaceHistory = selectedSummary?.transactions.slice(visiblePlaceHistoryPage * placeHistoryPageSize, (visiblePlaceHistoryPage + 1) * placeHistoryPageSize) ?? [];
  const categories = useMemo(() => {
    const unique = new Map<string, { value: string; label: string }>();
    [...allCategoriesFor("expense", customCategories), ...allCategoriesFor("income", customCategories)].forEach((category) => unique.set(category.id, { value: category.id, label: category.label }));
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [customCategories]);
  const recentLocations = useMemo(() => {
    const seen = new Set<string>();
    return transactions.flatMap((transaction): TransactionLocationDraft[] => {
      if (transaction.locationLatitude == null || transaction.locationLongitude == null) return [];
      const key = `${transaction.locationLatitude.toFixed(5)}-${transaction.locationLongitude.toFixed(5)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        label: transaction.locationLabel ?? transaction.area ?? "Pinned location",
        address: transaction.locationAddress ?? "Kathmandu, Nepal",
        latitude: transaction.locationLatitude,
        longitude: transaction.locationLongitude,
        accuracy: transaction.locationAccuracy,
        source: transaction.locationSource ?? "pin",
        savedPlaceId: transaction.savedPlaceId,
      }];
    }).slice(0, 8);
  }, [transactions]);
  const activeFilterCount = [
    filters.kind !== "all",
    filters.category !== "all",
    filters.paymentAccountId !== "all",
    filters.dateFilter !== "all",
    filters.dateFilter === "custom" && Boolean(filters.fromDate),
    filters.dateFilter === "custom" && Boolean(filters.toDate),
    Boolean(filters.minAmount),
    Boolean(filters.maxAmount),
  ].filter(Boolean).length;
  const updateFilter = <K extends keyof MapFilters>(key: K, value: MapFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const placeKey = new URLSearchParams(window.location.search).get("place");
    if (placeKey) setSelectedPlaceKey(placeKey);
  }, []);

  useEffect(() => {
    if (selectedPlaceKey && !selectedSummary) setSelectedPlaceKey(null);
  }, [selectedPlaceKey, selectedSummary]);

  useEffect(() => {
    setSaveSelectedPlaceOpen(false);
    setSelectedPlaceName("");
    setSelectedPlaceIcon("pin");
    setSaveSelectedPlaceError(null);
  }, [selectedPlaceKey]);

  useEffect(() => {
    setPlaceHistoryPage(0);
  }, [selectedPlaceKey]);

  useEffect(() => {
    setPlaceHistoryPage((page) => Math.min(page, placeHistoryPageCount - 1));
  }, [placeHistoryPageCount]);

  useEffect(() => {
    if (justSavedPlace && savedPlaces.some((place) => coordinatesMatch(place, justSavedPlace))) setJustSavedPlace(null);
  }, [justSavedPlace, savedPlaces]);

  useEffect(() => {
    if (!selectedSummary) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPlaceKey(null);
    };
    const lockPageScroll = window.matchMedia("(max-width: 640px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (lockPageScroll) document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (lockPageScroll) document.body.style.overflow = previousOverflow;
    };
  }, [selectedSummary]);

  useEffect(() => {
    if (!mapNode.current) return;
    let active = true;
    let removeLabels = () => {};
    const savedPlaceMarkers: { marker: import("maplibre-gl").Marker; root: Root }[] = [];
    setMapError(null);
    void import("maplibre-gl").then((module) => {
      if (!active || !mapNode.current) return;
      const features = located.map((transaction) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [transaction.locationLongitude!, transaction.locationLatitude!] },
        properties: { id: transaction.id, kind: transaction.kind, amount: transaction.amountMinor, placeKey: transactionPlaceKey(transaction) },
      }));
      const instance = new module.Map({
        container: mapNode.current,
        style: kathmanduMapStyle(),
        center: KATHMANDU_CENTER,
        zoom: 12.3,
        minZoom: 11,
        maxZoom: KATHMANDU_MAP_MAX_ZOOM,
        maxBounds: [[KATHMANDU_BOUNDS.west, KATHMANDU_BOUNDS.south], [KATHMANDU_BOUNDS.east, KATHMANDU_BOUNDS.north]],
      });
      map.current = instance;
      instance.addControl(new module.NavigationControl({ showCompass: false }), "top-right");
      instance.on("style.load", () => applyKathmanduMapTheme(instance));
      removeLabels = addKathmanduLabelMarkers(instance, module.Marker);
      instance.on("error", (event) => {
        const message = event.error?.message ?? "";
        if (/AJAXError|Failed to fetch|tile/i.test(message)) { setMapError("Some background tiles did not load. Transaction pins remain available."); return; }
        console.error("[transaction-map] Map error", event.error);
      });
      instance.on("idle", () => setMapError(null));
      instance.on("load", () => {
        instance.addSource("transactions", { type: "geojson", data: { type: "FeatureCollection", features } });
        if (mapMode === "heatmap") {
          instance.addLayer({ id: "transaction-heatmap", type: "heatmap", source: "transactions", maxzoom: 17, paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "amount"], 0, 0, 1000, 0.15, 10000, 0.5, 100000, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 15, 1.8],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 18, 15, 34, 17, 45],
            "heatmap-opacity": 0.84,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(19,93,234,0)", 0.2, "#8ad5d0", 0.45, "#f3d26a", 0.7, "#e06a5f", 1, "#9b1c31"],
          } });
        } else {
          instance.addLayer({ id: "transaction-expenses", type: "circle", source: "transactions", filter: ["==", ["get", "kind"], "expense"], paint: { "circle-color": "#e06a5f", "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
          instance.addLayer({ id: "transaction-income", type: "circle", source: "transactions", filter: ["==", ["get", "kind"], "income"], paint: { "circle-color": "#2a936f", "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
        }
        const pointLayers = mapMode === "pins" ? ["transaction-expenses", "transaction-income"] : [];
        const selectPoint = (event: import("maplibre-gl").MapMouseEvent & { features?: import("maplibre-gl").MapGeoJSONFeature[] }) => {
          const properties = event.features?.[0]?.properties;
          if (properties?.placeKey) setSelectedPlaceKey(String(properties.placeKey));
        };
        pointLayers.forEach((layer) => instance.on("click", layer, selectPoint));
        if (mapMode === "pins") savedPlaces.forEach((place) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "saved-place-map-marker";
          element.setAttribute("aria-label", place.name);
          element.title = place.name;
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            setSelectedPlaceKey(place.id);
          });
          const root = createRoot(element);
          root.render(<SavedPlaceIcon icon={place.icon ?? "pin"} size={18} weight="fill" />);
          const marker = new module.Marker({ element, anchor: "center" })
            .setLngLat([place.longitude, place.latitude])
            .addTo(instance);
          savedPlaceMarkers.push({ marker, root });
        });
        if (mapMode === "pins") {
          ["transaction-expenses", "transaction-income"].forEach((layer) => { instance.on("mouseenter", layer, () => { instance.getCanvas().style.cursor = "pointer"; }); instance.on("mouseleave", layer, () => { instance.getCanvas().style.cursor = ""; }); });
        }
        const savedPlaceFeatures = savedPlaces.map((place) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [place.longitude, place.latitude] },
        }));
        const allFeatures = [...features, ...savedPlaceFeatures];
        if (allFeatures.length > 1) { const bounds = new module.LngLatBounds(); allFeatures.forEach((feature) => bounds.extend(feature.geometry.coordinates as [number, number])); instance.fitBounds(bounds, { padding: 65, maxZoom: 15 }); }
        else if (allFeatures[0]) instance.flyTo({ center: allFeatures[0].geometry.coordinates as [number, number], zoom: 15 });
      });
    });
    return () => {
      active = false;
      removeLabels();
      savedPlaceMarkers.forEach(({ marker, root }) => {
        root.unmount();
        marker.remove();
      });
      map.current?.remove();
      map.current = null;
    };
  }, [located, mapMode, savedPlaces]);

  const focusSummary = (summary: PlaceSummary) => { setSelectedPlaceKey(summary.key); map.current?.flyTo({ center: [summary.longitude, summary.latitude], zoom: 16 }); };
  const savePlaceRename = async (place: SavedPlace) => {
    const name = editingSavedPlaceName.trim();
    if (!name) return;
    await onSaveSavedPlace({ name, icon: editingSavedPlaceIcon, address: place.address, latitude: place.latitude, longitude: place.longitude }, place.id);
    setEditingSavedPlaceId(null);
  };
  const saveSelectedPlace = async () => {
    if (!selectedSummary || selectedSavedPlace) return;
    const name = selectedPlaceName.trim();
    if (!name) return;
    const draft: SavedPlaceDraft = { name, icon: selectedPlaceIcon, address: selectedSummary.address || "Kathmandu, Nepal", latitude: selectedSummary.latitude, longitude: selectedSummary.longitude };
    setSavingSelectedPlace(true);
    setSaveSelectedPlaceError(null);
    try {
      await onSaveSavedPlace(draft);
      // The persistence callback returns no id; retain this local match until savedPlaces refreshes.
      setJustSavedPlace(draft);
      setSaveSelectedPlaceOpen(false);
    } catch (error) {
      setSaveSelectedPlaceError(error instanceof Error ? error.message : "Unable to save this place. Please try again.");
    } finally {
      setSavingSelectedPlace(false);
    }
  };

  return <div className="page maps-page">
    <header className="page-header maps-header"><div><span className="eyebrow">Kathmandu location history</span><h1>Transaction map</h1><p>Save the places that matter, then connect transactions to them to understand your location patterns.</p></div><div className="maps-header-actions"><button className="secondary-button" onClick={onAdd}><MapPin size={18} />Add transaction</button><button className="primary-button" onClick={() => setPlacePickerOpen(true)}><Plus size={18} />Save a place</button></div></header>
    <section className="map-filter-panel">
      <div className="map-filter-heading"><div><span className="section-label">Explore your places</span><strong>{located.length} mapped {located.length === 1 ? "entry" : "entries"}</strong></div><div className="map-filter-actions">{activeFilterCount > 0 && <button type="button" className="text-button" onClick={() => setFilters(initialFilters)}><X size={14} />Clear</button>}<button type="button" className={activeFilterCount ? "secondary-button small map-filter-toggle active" : "secondary-button small map-filter-toggle"} aria-expanded={filtersOpen} aria-controls="map-filters" onClick={() => setFiltersOpen((open) => !open)}><FunnelSimple size={16} weight={activeFilterCount ? "fill" : "regular"} />Filter{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button></div></div>
      {filtersOpen && <div className="map-filter-grid" id="map-filters">
        <Select label="Date" value={filters.dateFilter} data={[{ value: "all", label: "All time" }, { value: "this_month", label: "This month" }, { value: "last_3_months", label: "Last 3 months" }, { value: "this_year", label: "This year" }, { value: "custom", label: "Custom range" }]} onChange={(value) => updateFilter("dateFilter", (value ?? "all") as DateFilter)} />
        <Select label="Category" value={filters.category} data={[{ value: "all", label: "All categories" }, ...categories]} onChange={(value) => updateFilter("category", value ?? "all")} />
        <Select label="Payment account" value={filters.paymentAccountId} data={[{ value: "all", label: "All payment sources" }, ...paymentAccounts.map((account) => ({ value: account.id, label: account.label || account.provider }))]} onChange={(value) => updateFilter("paymentAccountId", value ?? "all")} />
        <SegmentedControl aria-label="Transaction type" value={filters.kind} data={[{ value: "all", label: "All" }, { value: "expense", label: "Expenses" }, { value: "income", label: "Income" }]} onChange={(value) => updateFilter("kind", value as TransactionKind | "all")} />
        {filters.dateFilter === "custom" && <><TextInput type="date" label="From" value={filters.fromDate} onChange={(event) => updateFilter("fromDate", event.currentTarget.value)} /><TextInput type="date" label="To" value={filters.toDate} onChange={(event) => updateFilter("toDate", event.currentTarget.value)} /></>}
        <TextInput label="Minimum amount" placeholder="0" value={filters.minAmount} onChange={(event) => updateFilter("minAmount", event.currentTarget.value)} />
        <TextInput label="Maximum amount" placeholder="No limit" value={filters.maxAmount} onChange={(event) => updateFilter("maxAmount", event.currentTarget.value)} />
        <button type="button" className="text-button map-filter-clear" onClick={() => setFilters(initialFilters)}><X size={14} />Clear filters</button>
      </div>}
    </section>
    <section className="map-summary-strip"><div><strong>{summaries.length}</strong><span>{summaries.length === 1 ? "place" : "places"}</span></div><div><span className="map-legend expense" />Expense</div><div><span className="map-legend income" />Income</div><SegmentedControl aria-label="Map display" value={mapMode} data={[{ value: "pins", label: "Pins" }, { value: "heatmap", label: "Heatmap" }]} onChange={(value) => setMapMode(value as MapMode)} /></section>
    <div className="maps-layout">
      <section className="transaction-map-card">
        <div ref={mapNode} className="transactions-map" />
        {mapMode === "heatmap" && <div className="heatmap-legend"><span>Lower spend</span><i /><span>Higher spend</span></div>}
        {mapError && <span className="map-load-warning" role="status">{mapError}</span>}
        {!located.length && !savedPlaces.length && <div className="map-empty-state"><MapPin size={32} weight="duotone" /><strong>Your map is ready</strong><p>Save a place first, or add a transaction with an exact Kathmandu location.</p><button className="primary-button small" onClick={() => setPlacePickerOpen(true)}>Save your first place</button></div>}
        {selectedSummary && <div className="map-selected-backdrop" onClick={() => setSelectedPlaceKey(null)}><article className="map-selected-card" role="dialog" aria-label={`${selectedPlaceDisplay?.name ?? selectedSummary.label} details`} onClick={(event) => event.stopPropagation()}><button className="icon-button" aria-label="Close selected place" onClick={() => setSelectedPlaceKey(null)}><X size={16} /></button><div className="place-summary-card"><span className="eyebrow">Selected place</span><h2><SavedPlaceIcon icon={selectedPlaceDisplay?.icon ?? selectedSummary.icon} size={20} />{selectedPlaceDisplay?.name ?? selectedSummary.label}</h2><p>{selectedPlaceDisplay?.address ?? selectedSummary.address}</p><div className="place-summary-stats"><div><strong className="map-amount">{formatMoney(selectedSummary.totalExpenseMinor, currency)}</strong><small>Spent</small></div><div><strong className="map-amount">{formatMoney(selectedSummary.totalIncomeMinor, currency)}</strong><small>Received</small></div><div><strong className="map-amount">{formatMoney(selectedSummary.netMinor, currency)}</strong><small>Net</small></div><div><strong>{selectedSummary.transactions.length}</strong><small>Entries</small></div></div>{selectedSummary.transactions.length > 0 && <small className="place-summary-category">Top category: {getCategory(selectedSummary.topCategory, customCategories).label}</small>}{!selectedPlaceDisplay && <div className="save-selected-place">{saveSelectedPlaceOpen ? <><TextInput aria-label="Place name" size="xs" value={selectedPlaceName} onChange={(event) => setSelectedPlaceName(event.currentTarget.value)} placeholder="Name this place" autoFocus /><fieldset className="saved-place-icon-picker compact"><legend>Icon</legend>{savedPlaceIconOptions.map((option) => <button type="button" className={selectedPlaceIcon === option.value ? "active" : undefined} aria-label={option.label} aria-pressed={selectedPlaceIcon === option.value} key={option.value} onClick={() => setSelectedPlaceIcon(option.value)}><SavedPlaceIcon icon={option.value} size={15} /></button>)}</fieldset>{saveSelectedPlaceError && <p className="save-selected-place-error" role="alert">{saveSelectedPlaceError}</p>}<div className="saved-place-editor-actions"><button type="button" className="text-button" disabled={savingSelectedPlace} onClick={() => { setSaveSelectedPlaceOpen(false); setSaveSelectedPlaceError(null); }}>Cancel</button><button type="button" className="primary-button small" disabled={!selectedPlaceName.trim() || savingSelectedPlace} onClick={() => void saveSelectedPlace()}>{savingSelectedPlace ? "Saving…" : "Save place"}</button></div></> : <button type="button" className="secondary-button small" onClick={() => { setSelectedPlaceName(selectedSummary.label); setSelectedPlaceIcon(selectedSummary.icon); setSaveSelectedPlaceError(null); setSaveSelectedPlaceOpen(true); }}><Plus size={15} />Save place</button>}</div>}{selectedSavedPlace && <button type="button" className="secondary-button small add-at-place-button" onClick={() => onAddAtPlace(selectedSavedPlace)}><Plus size={15} />Add transaction here</button>}{selectedSummary.monthlyTotals.length > 0 && <div className="place-trend"><span className="section-label">Monthly spending</span>{selectedSummary.monthlyTotals.map((item) => { const max = Math.max(...selectedSummary.monthlyTotals.map((entry) => entry.amountMinor)); return <div className="place-trend-row" key={item.month}><span>{item.month}</span><i><b style={{ width: `${max ? Math.max(6, item.amountMinor / max * 100) : 0}%` }} /></i><strong className="map-amount">{formatMoney(item.amountMinor, currency)}</strong></div>; })}</div>}</div><div className="place-history"><div className="section-heading"><div><span className="section-label">History</span><h3>Transactions at this place</h3></div></div>{visiblePlaceHistory.map((transaction) => <div className="place-history-row" key={transaction.id}><TransactionRow compact transaction={transaction} currency={currency} customCategories={customCategories} /><button type="button" className="text-button" onClick={() => onEdit(transaction)}><PencilSimple size={14} />Edit</button></div>)}{placeHistoryCount > placeHistoryPageSize && <nav className="place-history-pagination" aria-label="Place transaction history pages"><span aria-live="polite">Showing {visiblePlaceHistoryPage * placeHistoryPageSize + 1}–{Math.min((visiblePlaceHistoryPage + 1) * placeHistoryPageSize, placeHistoryCount)} of {placeHistoryCount}</span><div><button type="button" className="secondary-button small" disabled={visiblePlaceHistoryPage === 0} onClick={() => setPlaceHistoryPage((page) => Math.max(0, page - 1))}>Previous</button><button type="button" className="secondary-button small" disabled={visiblePlaceHistoryPage >= placeHistoryPageCount - 1} onClick={() => setPlaceHistoryPage((page) => Math.min(placeHistoryPageCount - 1, page + 1))}>Next</button></div></nav>}{!placeHistoryCount && <p className="mapped-list-empty">Add a transaction here, or edit an existing transaction and choose this saved place.</p>}</div></article></div>}
      </section>
      <aside className="mapped-transaction-list">
        <div className="section-heading"><div><span className="section-label">Location summaries</span><h2>Places in Kathmandu</h2></div></div>
        <div className="mapped-place-list">{summaries.map((summary) => <button type="button" className={selectedSummary?.key === summary.key ? "mapped-entry active" : "mapped-entry"} key={summary.key} onClick={() => focusSummary(summary)}><SavedPlaceIcon icon={summary.icon} size={18} weight="fill" /><span><strong>{summary.label}</strong><small>{summary.transactions.length} {summary.transactions.length === 1 ? "entry" : "entries"} · <span className="map-amount">{formatMoney(summary.totalExpenseMinor, currency)}</span> spent</small></span><ArrowRight size={15} /></button>)}{!summaries.length && <p className="mapped-list-empty">Saved and mapped places will appear here.</p>}</div>
        <div className="saved-places-panel">
          <div className="section-heading"><div><span className="section-label"><ClockCounterClockwise size={14} />Saved places</span><h3>Reusable locations</h3></div><button type="button" className="icon-button" onClick={() => setPlacePickerOpen(true)} aria-label="Save a new place"><Plus size={15} /></button></div>
          {savedPlaces.map((place) => <div className={editingSavedPlaceId === place.id ? "saved-place-row editing" : "saved-place-row"} key={place.id}>{editingSavedPlaceId === place.id ? <div className="saved-place-editor"><TextInput aria-label="Saved place name" size="xs" value={editingSavedPlaceName} onChange={(event) => setEditingSavedPlaceName(event.currentTarget.value)} /><fieldset className="saved-place-icon-picker compact"><legend>Icon</legend>{savedPlaceIconOptions.map((option) => <button type="button" className={editingSavedPlaceIcon === option.value ? "active" : undefined} aria-label={option.label} aria-pressed={editingSavedPlaceIcon === option.value} key={option.value} onClick={() => setEditingSavedPlaceIcon(option.value)}><SavedPlaceIcon icon={option.value} size={15} /></button>)}</fieldset><div className="saved-place-editor-actions"><button type="button" className="text-button" onClick={() => setEditingSavedPlaceId(null)}>Cancel</button><button type="button" className="primary-button small" disabled={!editingSavedPlaceName.trim()} onClick={() => void savePlaceRename(place)}>Save</button></div></div> : <><button type="button" className="saved-place-focus" onClick={() => { const summary = summaries.find((item) => item.key === place.id || coordinatesMatch(item, place)); if (summary) focusSummary(summary); }}><SavedPlaceIcon icon={place.icon ?? "pin"} size={17} /><span><strong>{place.name}</strong><small>{place.address}</small></span></button><button type="button" className="icon-button" onClick={() => { setEditingSavedPlaceId(place.id); setEditingSavedPlaceName(place.name); setEditingSavedPlaceIcon(place.icon ?? "pin"); }} aria-label={`Edit ${place.name}`}><PencilSimple size={14} /></button><button type="button" className="icon-button danger-text" onClick={() => { if (window.confirm(`Delete saved place ${place.name}?`)) void onDeleteSavedPlace(place.id); }} aria-label={`Delete ${place.name}`}><Trash size={14} /></button></>}</div>)}
          {!savedPlaces.length && <div className="saved-place-empty"><p>Name places like Home, Office, or your favorite shop.</p><button type="button" className="secondary-button small" onClick={() => setPlacePickerOpen(true)}><Plus size={15} />Save a place</button></div>}
        </div>
      </aside>
    </div>
    <LocationPicker open={placePickerOpen} mode="saved-place" value={null} recentLocations={recentLocations} savedPlaces={savedPlaces} onClose={() => setPlacePickerOpen(false)} onSavePlace={onSaveSavedPlace} />
  </div>;
}
