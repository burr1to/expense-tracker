"use client";

import { SegmentedControl } from "@mantine/core";
import { ArrowRight, MapPin, PencilSimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TransactionRow } from "../components/TransactionRow";
import { KATHMANDU_BOUNDS, KATHMANDU_CENTER, KATHMANDU_MAP_MAX_ZOOM, addKathmanduLabelMarkers, applyKathmanduMapTheme, kathmanduMapStyle } from "../lib/kathmandu-locations";
import type { CurrencyCode, CustomCategory, LedgerTransaction, TransactionKind } from "../types";

interface MapsPageProps {
  currency: CurrencyCode;
  transactions: LedgerTransaction[];
  customCategories: CustomCategory[];
  onEdit: (transaction: LedgerTransaction) => void;
  onAdd: () => void;
}

export function MapsPage({ currency, transactions, customCategories, onEdit, onAdd }: MapsPageProps) {
  const [kind, setKind] = useState<TransactionKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<import("maplibre-gl").Map | null>(null);
  const located = useMemo(() => transactions
    .filter((transaction) => transaction.locationLatitude != null && transaction.locationLongitude != null)
    .filter((transaction) => kind === "all" || transaction.kind === kind), [transactions, kind]);
  const selected = located.find((transaction) => transaction.id === selectedId) ?? null;

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
        properties: { id: transaction.id, kind: transaction.kind },
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
        if (/AJAXError|Failed to fetch|tile/i.test(message)) {
          setMapError("Some background tiles did not load. Transaction pins remain available.");
          return;
        }
        console.error("[transaction-map] Map error", event.error);
      });
      instance.on("idle", () => setMapError(null));
      instance.on("load", () => {
        instance.addSource("transactions", { type: "geojson", data: { type: "FeatureCollection", features }, cluster: true, clusterRadius: 46, clusterMaxZoom: 15 });
        instance.addLayer({
          id: "transaction-clusters",
          type: "circle",
          source: "transactions",
          filter: ["has", "point_count"],
          paint: { "circle-color": "#135dea", "circle-radius": ["step", ["get", "point_count"], 19, 10, 25, 30, 31], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
        });
        instance.addLayer({
          id: "transaction-cluster-count",
          type: "symbol",
          source: "transactions",
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
          paint: { "text-color": "#ffffff" },
        });
        instance.addLayer({
          id: "transaction-expenses",
          type: "circle",
          source: "transactions",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "expense"]],
          paint: { "circle-color": "#e06a5f", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
        });
        instance.addLayer({
          id: "transaction-income",
          type: "circle",
          source: "transactions",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "kind"], "income"]],
          paint: { "circle-color": "#2a936f", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
        });
        const selectPoint = (event: import("maplibre-gl").MapMouseEvent & { features?: import("maplibre-gl").MapGeoJSONFeature[] }) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") setSelectedId(id);
        };
        instance.on("click", "transaction-expenses", selectPoint);
        instance.on("click", "transaction-income", selectPoint);
        instance.on("click", "transaction-clusters", (event) => instance.easeTo({ center: event.lngLat, zoom: Math.min(instance.getZoom() + 2, 16) }));
        ["transaction-expenses", "transaction-income", "transaction-clusters"].forEach((layer) => {
          instance.on("mouseenter", layer, () => { instance.getCanvas().style.cursor = "pointer"; });
          instance.on("mouseleave", layer, () => { instance.getCanvas().style.cursor = ""; });
        });
        if (features.length > 1) {
          const bounds = new module.LngLatBounds();
          features.forEach((feature) => bounds.extend(feature.geometry.coordinates as [number, number]));
          instance.fitBounds(bounds, { padding: 65, maxZoom: 15 });
        } else if (features[0]) instance.flyTo({ center: features[0].geometry.coordinates as [number, number], zoom: 15 });
      });
    });
    return () => { active = false; removeLabels(); map.current?.remove(); map.current = null; };
  }, [located]);

  const focusTransaction = (transaction: LedgerTransaction) => {
    setSelectedId(transaction.id);
    map.current?.flyTo({ center: [transaction.locationLongitude!, transaction.locationLatitude!], zoom: 16 });
  };

  return <div className="page maps-page">
    <header className="page-header maps-header"><div><span className="eyebrow">Kathmandu location history</span><h1>Transaction map</h1><p>See exactly where your mapped income and expenses happened.</p></div><button className="primary-button" onClick={onAdd}><MapPin size={18} />Add mapped transaction</button></header>
    <section className="map-summary-strip">
      <div><strong>{located.length}</strong><span>mapped {located.length === 1 ? "entry" : "entries"}</span></div>
      <div><span className="map-legend expense" />Expense</div>
      <div><span className="map-legend income" />Income</div>
      <SegmentedControl value={kind} data={[{ value: "all", label: "All" }, { value: "expense", label: "Expenses" }, { value: "income", label: "Income" }]} onChange={(value) => { setKind(value as TransactionKind | "all"); setSelectedId(null); }} />
    </section>
    <div className="maps-layout">
      <section className="transaction-map-card">
        <div ref={mapNode} className="transactions-map" />
        {mapError && <span className="map-load-warning" role="status">{mapError}</span>}
        {!located.length && <div className="map-empty-state"><MapPin size={32} weight="duotone" /><strong>No mapped transactions yet</strong><p>Add or edit a transaction and choose its exact Kathmandu location.</p><button className="primary-button small" onClick={onAdd}>Add a location</button></div>}
        {selected && <article className="map-selected-card"><button className="icon-button" aria-label="Close selected transaction" onClick={() => setSelectedId(null)}>×</button><TransactionRow compact transaction={selected} currency={currency} customCategories={customCategories} /><button className="text-button" onClick={() => onEdit(selected)}><PencilSimple size={15} />Edit transaction</button></article>}
      </section>
      <aside className="mapped-transaction-list">
        <div className="section-heading"><div><span className="section-label">Mapped entries</span><h2>Places in Kathmandu</h2></div></div>
        <div>
          {located.slice(0, 30).map((transaction) => <button type="button" className={selectedId === transaction.id ? "mapped-entry active" : "mapped-entry"} key={transaction.id} onClick={() => focusTransaction(transaction)}><MapPin size={18} weight="fill" /><span><strong>{transaction.locationLabel ?? transaction.area ?? "Pinned location"}</strong><small>{transaction.note || transaction.locationAddress}</small></span><ArrowRight size={15} /></button>)}
          {!located.length && <p className="mapped-list-empty">Mapped transactions will appear here for quick reuse and review.</p>}
        </div>
      </aside>
    </div>
  </div>;
}
