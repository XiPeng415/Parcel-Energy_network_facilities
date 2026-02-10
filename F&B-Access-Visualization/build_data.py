#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd


@dataclass(frozen=True)
class FacilitySpec:
    type_name: str
    prefix: str
    color: str
    point_file: str
    point_name_col: str
    point_id_col: str
    path_file: str
    path_layer: str
    path_name_col: str
    path_id_col: str
    output_point_file: str
    output_path_file: str


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent

PARCEL_FILE = ROOT / "parcels_with_energy.gpkg"
PARCEL_LAYER = "parcels_with_energy"

FACILITY_SPECS = [
    FacilitySpec(
        type_name="Restaurant",
        prefix="Restaurant",
        color="#2f6de1",
        point_file="singapore_restaurants.geojson",
        point_name_col="name",
        point_id_col="osm_id",
        path_file="restaurant_network_paths.gpkg",
        path_layer="network_paths",
        path_name_col="restaurant_name",
        path_id_col="restaurant_osm_id",
        output_point_file="Restaurants_wgs84.geojson",
        output_path_file="Restaurant_network_paths_wgs84_simplified.geojson",
    ),
    FacilitySpec(
        type_name="Cafe",
        prefix="Cafe",
        color="#16a085",
        point_file="singapore_cafes.geojson",
        point_name_col="name",
        point_id_col="osm_id",
        path_file="cafe_network_paths.gpkg",
        path_layer="network_paths",
        path_name_col="cafe_name",
        path_id_col="cafe_osm_id",
        output_point_file="Cafes_wgs84.geojson",
        output_path_file="Cafe_network_paths_wgs84_simplified.geojson",
    ),
    FacilitySpec(
        type_name="Bar",
        prefix="Bar",
        color="#e67e22",
        point_file="singapore_bars_20260121_230346.geojson",
        point_name_col="name",
        point_id_col="osm_id",
        path_file="bar_network_paths.gpkg",
        path_layer="network_paths",
        path_name_col="bar_name",
        path_id_col="bar_osm_id",
        output_point_file="Bars_wgs84.geojson",
        output_path_file="Bar_network_paths_wgs84_simplified.geojson",
    ),
]


def safe_token(v: Any) -> str:
    text = "" if v is None else str(v).strip()
    if not text:
        return "Unknown"
    return re.sub(r"[^a-zA-Z0-9_]+", "_", text)


def clean_number(v: Any, decimals: int = 2) -> Any:
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    try:
        return round(float(v), decimals)
    except Exception:
        return None


def normalize_name(v: Any, fallback: str) -> str:
    if v is None:
        return fallback
    txt = str(v).strip()
    return txt if txt else fallback


def parcel_node_id(parcel_name: str) -> str:
    return f"http://www.regencities.org/instance#Parcel_{safe_token(parcel_name)}"


def facility_node_id(spec: FacilitySpec, name: str, osm_id: Any) -> str:
    return f"http://www.regencities.org/instance#{spec.prefix}_{safe_token(name)}_{safe_token(osm_id)}"


def load_parcels() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(PARCEL_FILE, layer=PARCEL_LAYER)
    gdf = gdf.to_crs(4326)
    keep_cols = [
        "Name",
        "building_count",
        "total_footprint_m2",
        "total_gfa_m2",
        "total_embodied_carbon_kgco2e",
        "total_energy_kwh_yr",
        "total_cooling_kwh_yr",
        "total_lighting_kwh_yr",
        "total_equipment_kwh_yr",
        "total_water_kwh_yr",
        "mean_levels",
        "energy_total_kwh_m2_yr",
        "geometry",
    ]
    keep = [c for c in keep_cols if c in gdf.columns]
    gdf = gdf[keep].copy()
    gdf["geometry"] = gdf.geometry.simplify(0.8, preserve_topology=True)
    gdf.to_file(SCRIPT_DIR / "parcels.geojson", driver="GeoJSON")
    return gdf


def build_facility_catalog() -> dict[str, dict[str, dict[str, Any]]]:
    catalog: dict[str, dict[str, dict[str, Any]]] = {}

    for spec in FACILITY_SPECS:
        gdf = gpd.read_file(ROOT / spec.point_file).to_crs(4326)
        keep_cols = [
            spec.point_id_col,
            spec.point_name_col,
            "amenity",
            "cuisine",
            "addr_street",
            "addr_housenumber",
            "addr_postcode",
            "opening_hours",
            "phone",
            "website",
            "geometry",
        ]
        keep = [c for c in keep_cols if c in gdf.columns]
        gdf = gdf[keep].copy()
        gdf.to_file(SCRIPT_DIR / spec.output_point_file, driver="GeoJSON")

        type_map: dict[str, dict[str, Any]] = {}
        for _, row in gdf.iterrows():
            osm_id = row.get(spec.point_id_col)
            name = normalize_name(row.get(spec.point_name_col), f"{spec.type_name}_{safe_token(osm_id)}")
            node_id = facility_node_id(spec, name, osm_id)
            props = {}
            for col in gdf.columns:
                if col == "geometry":
                    continue
                value = row.get(col)
                if isinstance(value, float):
                    if math.isnan(value) or math.isinf(value):
                        continue
                if value is None:
                    continue
                value_txt = str(value).strip()
                if value_txt == "":
                    continue
                props[col] = [value_txt]
            type_map[str(osm_id)] = {
                "id": node_id,
                "name": name,
                "color": spec.color,
                "type": spec.type_name,
                "properties": props,
            }
        catalog[spec.type_name] = type_map

    return catalog


def load_paths(spec: FacilitySpec) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(ROOT / spec.path_file, layer=spec.path_layer)
    gdf["network_distance_m"] = pd.to_numeric(gdf["network_distance_m"], errors="coerce")
    gdf = gdf.dropna(subset=["centroid_id", spec.path_id_col, spec.path_name_col, "network_distance_m"]).copy()
    gdf["centroid_id"] = gdf["centroid_id"].astype(str)
    gdf[spec.path_id_col] = gdf[spec.path_id_col].astype(str)
    gdf[spec.path_name_col] = gdf[spec.path_name_col].astype(str)
    gdf = gdf.sort_values(["centroid_id", "network_distance_m"], ascending=[True, True]).reset_index(drop=True)
    return gdf


def write_simplified_path_geojson(spec: FacilitySpec, path_df: gpd.GeoDataFrame, top_n: int = 3) -> None:
    out = path_df.groupby("centroid_id", as_index=False, group_keys=False).head(top_n).copy()
    out["geometry"] = out.geometry.simplify(1.2, preserve_topology=False)
    out = out.to_crs(4326)
    out.to_file(SCRIPT_DIR / spec.output_path_file, driver="GeoJSON")


def build_graph_dataset(
    parcels: gpd.GeoDataFrame,
    facility_catalog: dict[str, dict[str, dict[str, Any]]],
    top_n_per_type: int | None = 3,
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    node_ids: set[str] = set()

    parcel_lookup: set[str] = set()
    parcel_rows: dict[str, pd.Series] = {}
    for _, row in parcels.iterrows():
        name = str(row.get("Name"))
        parcel_lookup.add(name)
        parcel_rows[name] = row

    for parcel_name, row in parcel_rows.items():
        pid = parcel_node_id(parcel_name)
        props = {}
        for col, value in row.items():
            if col == "geometry" or col == "Name":
                continue
            num = clean_number(value)
            if num is not None:
                props[f"parcel_{col}"] = [num]
        props["basic_parcelId"] = [parcel_name]
        props["label"] = [f"Parcel_{parcel_name}"]
        nodes.append(
            {
                "id": pid,
                "label": f"Parcel_{parcel_name}",
                "type": "Parcel",
                "color": "#e74c3c",
                "size": 28,
                "properties": props,
            }
        )
        node_ids.add(pid)

    edge_set: set[tuple[str, str]] = set()

    for spec in FACILITY_SPECS:
        paths = load_paths(spec)
        if top_n_per_type is not None:
            paths = paths.groupby("centroid_id", as_index=False, group_keys=False).head(top_n_per_type)

        for _, row in paths.iterrows():
            centroid_id = str(row["centroid_id"])
            if centroid_id not in parcel_lookup:
                continue
            parcel_id = parcel_node_id(centroid_id)
            facility_osm_id = str(row[spec.path_id_col])
            facility_name = normalize_name(row[spec.path_name_col], f"{spec.type_name}_{facility_osm_id}")

            from_catalog = facility_catalog.get(spec.type_name, {}).get(facility_osm_id)
            if from_catalog:
                facility_id = from_catalog["id"]
                facility_props = dict(from_catalog["properties"])
            else:
                facility_id = facility_node_id(spec, facility_name, facility_osm_id)
                facility_props = {}

            if facility_id not in node_ids:
                facility_props["basic_name"] = [facility_name]
                facility_props["basic_osmId"] = [facility_osm_id]
                nodes.append(
                    {
                        "id": facility_id,
                        "label": f"{spec.type_name}: {facility_name}",
                        "type": spec.type_name,
                        "color": spec.color,
                        "size": 14,
                        "properties": facility_props,
                    }
                )
                node_ids.add(facility_id)

            edge_key = (parcel_id, facility_id)
            if edge_key in edge_set:
                continue
            edge_set.add(edge_key)
            edges.append(
                {
                    "from": parcel_id,
                    "to": facility_id,
                    "label": "hasAccessibilityTo",
                    "predicate": "http://www.regencities.org/ontology#hasAccessibilityTo",
                }
            )

        write_simplified_path_geojson(spec, paths, top_n=3)

    type_counts: dict[str, int] = {}
    for n in nodes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1

    stats = {
        "node_types": [{"type": t, "count": c} for t, c in sorted(type_counts.items(), key=lambda x: x[1], reverse=True)],
        "node_count": len(nodes),
        "edge_count": len(edges),
    }

    return {"nodes": nodes, "edges": edges, "stats": stats}


def build_sample_500(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    node_lookup = {n["id"]: n for n in nodes}
    parcel_ids = [n["id"] for n in nodes if n.get("type") == "Parcel"]
    seed_parcels = set(parcel_ids[:260])

    sample_ids = set(seed_parcels)
    sample_edges = []

    for e in edges:
        if e["from"] not in seed_parcels:
            continue
        sample_edges.append(e)
        sample_ids.add(e["to"])
        if len(sample_ids) >= 500:
            break

    if len(sample_ids) < 500:
        for n in nodes:
            sample_ids.add(n["id"])
            if len(sample_ids) >= 500:
                break

    sample_nodes = [n for n in nodes if n["id"] in sample_ids]
    sample_edges = [e for e in sample_edges if e["from"] in sample_ids and e["to"] in sample_ids]
    type_counts: dict[str, int] = {}
    for n in sample_nodes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1
    return {
        "nodes": sample_nodes,
        "edges": sample_edges,
        "stats": {
            "node_types": [{"type": t, "count": c} for t, c in sorted(type_counts.items(), key=lambda x: x[1], reverse=True)],
            "node_count": len(sample_nodes),
            "edge_count": len(sample_edges),
        },
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parcels = load_parcels()
    facility_catalog = build_facility_catalog()

    top3 = build_graph_dataset(parcels, facility_catalog, top_n_per_type=3)
    full = build_graph_dataset(parcels, facility_catalog, top_n_per_type=None)
    sample = build_sample_500(top3["nodes"], top3["edges"])

    write_json(SCRIPT_DIR / "network_data_parcel_facility_top3.json", top3)
    write_json(SCRIPT_DIR / "network_data_parcel_facility.json", full)
    write_json(SCRIPT_DIR / "network_data.json", full)
    write_json(SCRIPT_DIR / "network_data_500.json", sample)

    print("Data build complete")
    print(f"Top3 nodes={top3['stats']['node_count']} edges={top3['stats']['edge_count']}")
    print(f"Full nodes={full['stats']['node_count']} edges={full['stats']['edge_count']}")


if __name__ == "__main__":
    main()
