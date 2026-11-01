"""Build the About physics meshes from the Illustrator SVGs (fonttools, shapely >= 2.1)."""
import json
import re
from pathlib import Path
from unicodedata import normalize
from xml.etree import ElementTree as ET

from fontTools.pens.basePen import BasePen
from fontTools.svgLib.path import parse_path
from shapely import constrained_delaunay_triangles, make_valid, union_all
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
# Match the artwork to the established glossary, in Approach … Hesitation order.
EXPORT_NUMBERS = (8, 1, 2, 3, 4, 5, 6, 7)
CANVAS_WIDTH = 1634
FLATNESS = .32  # Illustrator viewBox units; < 0.2 CSS px on the design artboard.


def midpoint(a, b):
    return tuple((x + y) / 2 for x, y in zip(a, b))


def chord_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx+dy*dy or 1)))
    return ((p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2)**.5


class OutlinePen(BasePen):
    def __init__(self):
        super().__init__(None)
        self.rings = []

    def _moveTo(self, point):
        self.rings.append([point])

    def _lineTo(self, point):
        self.rings[-1].append(point)

    def _curveToOne(self, b, c, d):
        a = self.rings[-1][-1]
        if max(chord_distance(p, a, d) for p in (b, c)) <= FLATNESS:
            self._lineTo(d)
            return
        ab, bc, cd = midpoint(a,b), midpoint(b,c), midpoint(c,d)
        left, right = midpoint(ab,bc), midpoint(bc,cd)
        self._curveToOne(ab, left, midpoint(left,right))
        self._curveToOne(right, cd, d)

    def _closePath(self):
        pass  # Polygon closes each subpath.


def surfaces(geometry):
    if geometry.geom_type == "Polygon":
        if not geometry.is_empty:
            yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from surfaces(part)


def painted_region(svg):
    root = ET.parse(svg).getroot()
    vx, vy, width, height = map(float, root.attrib["viewBox"].split())
    css = root.findtext(".//{*}style", "")
    classes = {name: dict(re.findall(r"([\w-]+)\s*:\s*([^;}]+?)\s*;", rule))
               for name, rule in re.findall(r"\.([\w-]+)\s*\{([^}]*)\}", css)}
    ink = Polygon()
    for element in root:
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "defs":
            continue
        if "transform" in element.attrib:
            raise ValueError(f"{svg.name}: expand element transforms before baking")
        style = {**classes.get(element.get("class"), {}), **element.attrib}
        if tag == "path" and style.get("fill-rule") == "evenodd":
            pen = OutlinePen()
            parse_path(element.attrib["d"], pen)
            region = Polygon()
            for ring in pen.rings:
                region = region.symmetric_difference(make_valid(Polygon(ring)))
            ink = ink.union(region)
        elif tag == "circle":
            center = Point(float(element.attrib["cx"]), float(element.attrib["cy"]))
            radius = float(element.attrib["r"])
            if style.get("fill") == "#fff" and style.get("stroke") == "#000":
                half_stroke = float(style["stroke-width"].removesuffix("px")) / 2
                # Paint order matters: a white terminal masks any line underneath it.
                ink = ink.union(center.buffer(radius + half_stroke, quad_segs=12))
                ink = ink.difference(center.buffer(radius - half_stroke, quad_segs=12))
            elif style.get("fill", "#000") in ("#000", "black"):
                ink = ink.union(center.buffer(radius, quad_segs=12))
            else:
                raise ValueError(f"Unsupported circle paint in {svg.name}")
        else:
            raise ValueError(f"Unsupported {tag} or fill rule in {svg.name}")
    region = union_all(list(surfaces(ink))).simplify(FLATNESS, preserve_topology=True)
    return region, (vx, vy, width, height)


def convex_pieces(region):
    """Merge neighboring triangles only if the result is convex and fills exactly the same ink."""
    parts = list(constrained_delaunay_triangles(region).geoms)
    while True:
        edges = {}
        for i, poly in enumerate(parts):
            verts = list(poly.exterior.coords)
            for a, b in zip(verts, verts[1:]):
                edges.setdefault(tuple(sorted((a,b))), []).append(i)
        used, merged = set(), []
        for ids in edges.values():
            if len(ids) != 2 or any(i in used for i in ids):
                continue
            a, b = (parts[i] for i in ids)
            hull = a.union(b).convex_hull
            if len(hull.exterior.coords) <= 9 and abs(hull.area - a.area - b.area) < 1e-6:
                used.update(ids)
                merged.append(hull)
        if not merged:
            return parts
        parts = [p for i,p in enumerate(parts) if i not in used] + merged


def bake(svg):
    region, (vx, vy, w, h) = painted_region(svg)
    scale = CANVAS_WIDTH / w

    def coords(ring):
        return [[round((x-vx-w/2)*scale,3), round((y-vy-h/2)*scale,3)] for x,y in ring.coords]

    paths = [coords(ring) for p in surfaces(region) for ring in (p.exterior, *p.interiors)]
    pieces = convex_pieces(region)
    if region.symmetric_difference(union_all(pieces)).area > region.area * 1e-6:
        raise ValueError(f"Mesh does not cover the ink of {svg.name}")
    polygons = [coords(p.exterior)[:-1] for p in pieces]
    print(normalize("NFC",svg.name), len(paths), "boundaries,", len(polygons), "fixtures")
    return dict(source="assets/"+svg.name, w=CANVAS_WIDTH, h=round(h*scale,3), paths=paths, polygons=polygons)


def main():
    assets = {normalize("NFC",p.name):p for p in (ROOT/"assets").glob("*.svg")}
    symbols = [bake(assets[f"기호{i}.svg"]) for i in EXPORT_NUMBERS]
    (ROOT/"symbol-ink.js").write_text(
        "/* Generated from the SVG ink outlines by tools/trace-symbols.py. */\nwindow.KNOTATION_INK = "
        + json.dumps(symbols, separators=(",",":")) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    main()
