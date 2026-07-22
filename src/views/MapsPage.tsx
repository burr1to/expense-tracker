"use client";

import { Select, SegmentedControl, TextInput } from "@mantine/core";
import { ArrowRight, ClockCounterClockwise, MapPin, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TransactionRow } from "../components/TransactionRow";
import { allCategoriesFor, getCategory } from "../lib/categories";
import { formatMoney } from "../lib/currency";
import { KATHMANDU_BOUNDS, KATHMANDU_CENTER, KATHMANDU_MAP_MAX_ZOOM, addKathmanduLabelMarkers, applyKathmanduMapTheme, kathmanduMapStyle } from "../lib/kathmandu-locations";
import type { CurrencyCode, CustomCategory, LedgerTransaction, PaymentAccount, SavedPlace, TransactionKind } from "../types";

interface MapsPageProps {
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  paymentAccounts: PaymentAccount[];
  savedPlaces: SavedPlace[];
  onSaveSavedPlace: (draft: Pick<SavedPlace, "name" | "address" | "latitude" | "longitude">, id?: string) => Promise<void>;
  onDeleteSavedPlace: (id: string) => Promise<void>;
  onEdit: (transaction: LedgerTransaction) => void;
  onAdd: () => void;
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
  transactions: LedgerTransaction[];
  totalExpenseMinor: number;
  totalIncomeMinor: number;
  netMinor: number;
  topCategory: string;
  monthlyTotals: { month: string; amountMinor: number }[];
}

const initialFilters: MapFilters = { kind: "all", category: "all", paymentAccountId: "all", dateFilter: "all", fromDate: "", toDate: "", minAmount: "", maxAmount: "" };
const placeKeyFor = (transaction: LedgerTransaction) => transaction.savedPlaceId ?? `${transaction.locationLatitude!.toFixed(5)}-${transaction.locationLongitude!.toFixed(5)}`;
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
    const key = placeKeyFor(transaction);
    const saved = transaction.savedPlaceId ? savedById.get(transaction.savedPlaceId) : undefined;
    const current = groups.get(key) ?? {
      key,
      label: saved?.name ?? transaction.locationLabel ?? transaction.area ?? "Pinned location",
      address: saved?.address ?? transaction.locationAddress ?? "Kathmandu, Nepal",
      latitude: transaction.locationLatitude,
      longitude: transaction.locationLongitude,
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

export function MapsPage({ currency, transactions, customCategories, paymentAccounts, savedPlaces, onSaveSavedPlace, onDeleteSavedPlace, onEdit, onAdd }: MapsPageProps) {
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const [mapMode, setMapMode] = useState<MapMode>("pins");
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [editingSavedPlaceId, setEditingSavedPlaceId] = useState<string | null>(null);
  const [editingSavedPlaceName, setEditingSavedPlaceName] = useState("");
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
  const selectedSummary = summaries.find((summary) => summary.key === selectedPlaceKey) ?? null;
  const categories = useMemo(() => {
    const unique = new Map<string, { value: string; label: string }>();
    [...allCategoriesFor("expense", customCategories), ...allCategoriesFor("income", customCategories)].forEach((category) => unique.set(category.id, { value: category.id, label: category.label }));
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [customCategories]);
  const updateFilter = <K extends keyof MapFilters>(key: K, value: MapFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (selectedPlaceKey && !selectedSummary) setSelectedPlaceKey(null);
  }, [selectedPlaceKey, selectedSummary]);

  useEffect(() => {
    if (!mapNode.current) return;
    let active = true;
    let removeLabels = () => {};
    setMapError(null);
    void import("maplibre-gl").then((module) => {
      if (!active || !mapNode.current) return;
      const features = located.map((transaction) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [transaction.locationLongitude!, transaction.locationLatitude!] },
        properties: { id: transaction.id, kind: transaction.kind, amount: transaction.amountMinor, placeKey: placeKeyFor(transaction) },
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
        instance.addSource("transactions", { type: "geojson", data: { type: "FeatureCollection", features }, cluster: mapMode === "pins", clusterRadius: 46, clusterMaxZoom: 15 });
        if (mapMode === "heatmap") {
          instance.addLayer({ id: "transaction-heatmap", type: "heatmap", source: "transactions", maxzoom: 17, paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "amount"], 0, 0, 1000, 0.15, 10000, 0.5, 100000, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 15, 1.8],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 18, 15, 34, 17, 45],
            "heatmap-opacity": 0.84,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(19,93,234,0)", 0.2, "#8ad5d0", 0.45, "#f3d26a", 0.7, "#e06a5f", 1, "#9b1c31"],
          } });
          instance.addLayer({ id: "transaction-heatmap-points", type: "circle", source: "transactions", minzoom: 15, paint: { "circle-color": ["match", ["get", "kind"], "income", "#2a936f", "#e06a5f"], "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2, "circle-opacity": 0.88 } });
        } else {
          instance.addLayer({ id: "transaction-clusters", type: "circle", source: "transactions", filter: ["has", "point_count"], paint: { "circle-color": "#135dea", "circle-radius": ["step", ["get", "point_count"], 19, 10, 25, 30, 31], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
          instance.addLayer({ id: "transaction-cluster-count", type: "symbol", source: "transactions", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#ffffff" } });
          instance.addLayer({ id: "transaction-expenses", type: "circle", source: "transactions", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "expense"]], paint: { "circle-color": "#e06a5f", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
          instance.addLayer({ id: "transaction-income", type: "circle", source: "transactions", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "income"]], paint: { "circle-color": "#2a936f", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
        }
        const pointLayers = mapMode === "heatmap" ? ["transaction-heatmap-points"] : ["transaction-expenses", "transaction-income"];
        const selectPoint = (event: import("maplibre-gl").MapMouseEvent & { features?: import("maplibre-gl").MapGeoJSONFeature[] }) => {
          const properties = event.features?.[0]?.properties;
          if (properties?.placeKey) setSelectedPlaceKey(String(properties.placeKey));
        };
        pointLayers.forEach((layer) => instance.on("click", layer, selectPoint));
        if (mapMode === "pins") {
          instance.on("click", "transaction-clusters", (event) => instance.easeTo({ center: event.lngLat, zoom: Math.min(instance.getZoom() + 2, 16) }));
          ["transaction-expenses", "transaction-income", "transaction-clusters"].forEach((layer) => { instance.on("mouseenter", layer, () => { instance.getCanvas().style.cursor = "pointer"; }); instance.on("mouseleave", layer, () => { instance.getCanvas().style.cursor = ""; }); });
        }
        if (features.length > 1) { const bounds = new module.LngLatBounds(); features.forEach((feature) => bounds.extend(feature.geometry.coordinates as [number, number])); instance.fitBounds(bounds, { padding: 65, maxZoom: 15 }); }
        else if (features[0]) instance.flyTo({ center: features[0].geometry.coordinates as [number, number], zoom: 15 });
      });
    });
    return () => { active = false; removeLabels(); map.current?.remove(); map.current = null; };
  }, [located, mapMode]);

  const focusSummary = (summary: PlaceSummary) => { setSelectedPlaceKey(summary.key); map.current?.flyTo({ center: [summary.longitude, summary.latitude], zoom: 16 }); };
  const savePlaceRename = async (place: SavedPlace) => {
    const name = editingSavedPlaceName.trim();
    if (!name) return;
    await onSaveSavedPlace({ name, address: place.address, latitude: place.latitude, longitude: place.longitude }, place.id);
    setEditingSavedPlaceId(null);
  };

  return <div className="page maps-page">
    <header className="page-header maps-header"><div><span className="eyebrow">Kathmandu location history</span><h1>Transaction map</h1><p>See where your mapped income and expenses happened, what each place costs, and how your patterns change.</p></div><button className="primary-button" onClick={onAdd}><MapPin size={18} />Add mapped transaction</button></header>
    <section className="map-filter-panel">
      <div className="map-filter-heading"><div><span className="section-label">Explore your places</span><strong>{located.length} mapped {located.length === 1 ? "entry" : "entries"}</strong></div><button type="button" className="text-button" onClick={() => setFilters(initialFilters)}><X size={14} />Clear filters</button></div>
      <div className="map-filter-grid">
        <Select label="Date" value={filters.dateFilter} data={[{ value: "all", label: "All time" }, { value: "this_month", label: "This month" }, { value: "last_3_months", label: "Last 3 months" }, { value: "this_year", label: "This year" }, { value: "custom", label: "Custom range" }]} onChange={(value) => updateFilter("dateFilter", (value ?? "all") as DateFilter)} />
        <Select label="Category" value={filters.category} data={[{ value: "all", label: "All categories" }, ...categories]} onChange={(value) => updateFilter("category", value ?? "all")} />
        <Select label="Payment account" value={filters.paymentAccountId} data={[{ value: "all", label: "All payment sources" }, ...paymentAccounts.map((account) => ({ value: account.id, label: account.label || account.provider }))]} onChange={(value) => updateFilter("paymentAccountId", value ?? "all")} />
        <SegmentedControl aria-label="Transaction type" value={filters.kind} data={[{ value: "all", label: "All" }, { value: "expense", label: "Expenses" }, { value: "income", label: "Income" }]} onChange={(value) => updateFilter("kind", value as TransactionKind | "all")} />
        {filters.dateFilter === "custom" && <><TextInput type="date" label="From" value={filters.fromDate} onChange={(event) => updateFilter("fromDate", event.currentTarget.value)} /><TextInput type="date" label="To" value={filters.toDate} onChange={(event) => updateFilter("toDate", event.currentTarget.value)} /></>}
        <TextInput label="Minimum amount" placeholder="0" value={filters.minAmount} onChange={(event) => updateFilter("minAmount", event.currentTarget.value)} />
        <TextInput label="Maximum amount" placeholder="No limit" value={filters.maxAmount} onChange={(event) => updateFilter("maxAmount", event.currentTarget.value)} />
      </div>
    </section>
    <section className="map-summary-strip"><div><strong>{summaries.length}</strong><span>{summaries.length === 1 ? "place" : "places"}</span></div><div><span className="map-legend expense" />Expense</div><div><span className="map-legend income" />Income</div><SegmentedControl aria-label="Map display" value={mapMode} data={[{ value: "pins", label: "Pins" }, { value: "heatmap", label: "Heatmap" }]} onChange={(value) => setMapMode(value as MapMode)} /></section>
    <div className="maps-layout">
      <section className="transaction-map-card">
        <div ref={mapNode} className="transactions-map" />
        {mapMode === "heatmap" && <div className="heatmap-legend"><span>Lower spend</span><i /><span>Higher spend</span></div>}
        {mapError && <span className="map-load-warning" role="status">{mapError}</span>}
        {!located.length && <div className="map-empty-state"><MapPin size={32} weight="duotone" /><strong>No mapped transactions match</strong><p>Adjust the filters or add a transaction with an exact Kathmandu location.</p><button className="primary-button small" onClick={onAdd}>Add a location</button></div>}
        {selectedSummary && <article className="map-selected-card"><button className="icon-button" aria-label="Close selected place" onClick={() => setSelectedPlaceKey(null)}>×</button><div className="place-summary-card"><span className="eyebrow">Selected place</span><h2>{selectedSummary.label}</h2><p>{selectedSummary.address}</p><div className="place-summary-stats"><div><strong className="map-amount">{formatMoney(selectedSummary.totalExpenseMinor, currency)}</strong><small>Spent</small></div><div><strong className="map-amount">{formatMoney(selectedSummary.totalIncomeMinor, currency)}</strong><small>Received</small></div><div><strong className="map-amount">{formatMoney(selectedSummary.netMinor, currency)}</strong><small>Net</small></div><div><strong>{selectedSummary.transactions.length}</strong><small>Entries</small></div></div><small className="place-summary-category">Top category: {getCategory(selectedSummary.topCategory, customCategories).label}</small>{selectedSummary.monthlyTotals.length > 0 && <div className="place-trend"><span className="section-label">Monthly spending</span>{selectedSummary.monthlyTotals.map((item) => { const max = Math.max(...selectedSummary.monthlyTotals.map((entry) => entry.amountMinor)); return <div className="place-trend-row" key={item.month}><span>{item.month}</span><i><b style={{ width: `${max ? Math.max(6, item.amountMinor / max * 100) : 0}%` }} /></i><strong className="map-amount">{formatMoney(item.amountMinor, currency)}</strong></div>; })}</div>}</div><div className="place-history"><div className="section-heading"><div><span className="section-label">History</span><h3>Transactions at this place</h3></div></div>{selectedSummary.transactions.map((transaction) => <div className="place-history-row" key={transaction.id}><TransactionRow compact transaction={transaction} currency={currency} customCategories={customCategories} /><button type="button" className="text-button" onClick={() => onEdit(transaction)}><PencilSimple size={14} />Edit</button></div>)}</div></article>}
      </section>
      <aside className="mapped-transaction-list">
        <div className="section-heading"><div><span className="section-label">Location summaries</span><h2>Places in Kathmandu</h2></div></div>
        <div className="mapped-place-list">{summaries.map((summary) => <button type="button" className={selectedPlaceKey === summary.key ? "mapped-entry active" : "mapped-entry"} key={summary.key} onClick={() => focusSummary(summary)}><MapPin size={18} weight="fill" /><span><strong>{summary.label}</strong><small>{summary.transactions.length} {summary.transactions.length === 1 ? "entry" : "entries"} · <span className="map-amount">{formatMoney(summary.totalExpenseMinor, currency)}</span> spent</small></span><ArrowRight size={15} /></button>)}{!summaries.length && <p className="mapped-list-empty">Mapped places will appear here for quick review.</p>}</div>
        <div className="saved-places-panel"><div className="section-heading"><div><span className="section-label"><ClockCounterClockwise size={14} />Saved places</span><h3>Quick reuse</h3></div></div>{savedPlaces.map((place) => <div className="saved-place-row" key={place.id}>{editingSavedPlaceId === place.id ? <><TextInput aria-label="Saved place name" size="xs" value={editingSavedPlaceName} onChange={(event) => setEditingSavedPlaceName(event.currentTarget.value)} /><button type="button" className="icon-button" onClick={() => void savePlaceRename(place)} aria-label="Save place name">✓</button></> : <><button type="button" className="saved-place-focus" onClick={() => focusSummary(summaries.find((summary) => summary.key === place.id) ?? { key: place.id, label: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude, transactions: [], totalExpenseMinor: 0, totalIncomeMinor: 0, netMinor: 0, topCategory: "other", monthlyTotals: [] })}><MapPin size={16} /><span><strong>{place.name}</strong><small>{place.address}</small></span></button><button type="button" className="icon-button" onClick={() => { setEditingSavedPlaceId(place.id); setEditingSavedPlaceName(place.name); }} aria-label={`Rename ${place.name}`}><PencilSimple size={14} /></button><button type="button" className="icon-button danger-text" onClick={() => { if (window.confirm(`Delete saved place ${place.name}?`)) void onDeleteSavedPlace(place.id); }} aria-label={`Delete ${place.name}`}><Trash size={14} /></button></>}</div>)}{!savedPlaces.length && <p className="mapped-list-empty">Save a place while adding a transaction to reuse it here.</p>}</div>
      </aside>
    </div>
  </div>;
}
