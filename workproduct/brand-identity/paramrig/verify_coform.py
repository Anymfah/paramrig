"""Calibrated silhouette comparisons, independent of the vector fitting code."""
from pathlib import Path
import json
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree
from skimage.measure import find_contours

WORK = Path(__file__).resolve().parent
ROOT = WORK.parents[2]
QA = WORK / "vector-qa"


def iou(a, b):
    return float(np.count_nonzero(a & b) / np.count_nonzero(a | b))


def boundary(image, scale):
    contours = find_contours(1-np.array(image.convert("L"), dtype=float)/255, 0.5)
    dense = []
    for c in contours:
        c = (c + .5) / scale
        for p, q in zip(c[:-1], c[1:]):
            count = max(1, int(np.ceil(np.linalg.norm(q-p)/.05)))
            dense.extend(p + (q-p)*t for t in np.linspace(0, 1, count, endpoint=False))
    return np.array(dense)


def run():
    calibration = np.array(Image.open(QA / "calibration.png").convert("L")) < 128
    known = np.zeros((64, 64), dtype=bool)
    known[12:52, 12:52] = True
    assert np.array_equal(known, calibration), "Renderer calibration failed"
    assert iou(known, known) == 1
    assert abs(iou(known, np.roll(known, 1, axis=1)) - 39/41) < 1e-12
    results = {"calibration": {"rendered_square_matches_1600_known_pixels": True,
                              "identity_iou": 1, "one_pixel_shift_iou": 39/41}, "assets": {}}
    for name in ("symbol", "logo"):
        source = Image.open(QA / f"{name}-reference.png").convert("L")
        rendered = Image.open(QA / f"{name}-render-1x.png").convert("L")
        high = Image.open(QA / f"{name}-render-4x.png").convert("L")
        assert source.size == rendered.size
        a, b = np.array(source)<128, np.array(rendered)<128
        source_edge, rendered_edge = boundary(source, 1), boundary(high, 4)
        distances = np.r_[cKDTree(source_edge).query(rendered_edge)[0],
                           cKDTree(rendered_edge).query(source_edge)[0]]
        svg = WORK / f"reference/svg-v1/paramrig-coform-{name}.svg"
        element = ET.parse(svg).getroot()
        tags = {node.tag.rsplit("}", 1)[-1] for node in element.iter()}
        assert tags <= {"svg", "title", "path", "g"}, tags
        assert "data:" not in svg.read_text() and "<text" not in svg.read_text()
        assert (a & b).sum() > 0
        result = {
            "foreground_iou": iou(a, b), "foreground_iou_percent": round(iou(a,b)*100, 4),
            "native_pixel_disagreements": int(np.count_nonzero(a ^ b)),
            "boundary_mean_source_px": float(np.mean(distances)),
            "boundary_p95_source_px": float(np.percentile(distances,95)),
            "boundary_max_source_px": float(np.max(distances)),
            "pure_vector_no_font_or_raster": True,
        }
        assert result["foreground_iou"] > .99
        assert result["boundary_p95_source_px"] < .4
        results["assets"][name] = result
        # Diagnostic colors only: black agreement, red raster-only, cyan SVG-only.
        diagnostic = np.full((*a.shape,3),255,dtype=np.uint8)
        diagnostic[a & b] = [0,0,0]
        diagnostic[a & ~b] = [230,50,65]
        diagnostic[b & ~a] = [0,175,205]
        Image.fromarray(diagnostic).save(QA / f"{name}-overlay.png")
    (QA / "results.json").write_text(json.dumps(results, indent=2) + "\n")

    # One evidence plate: same framing and scale for source, SVG and difference.
    font = ImageFont.load_default(size=20)
    small = ImageFont.load_default(size=15)
    plate = Image.new("RGB", (1260, 720), "white")
    draw = ImageDraw.Draw(plate)
    draw.text((32,22), "Coform / raster-to-vector verification", fill="black", font=font)
    names = [("Reference", "symbol-reference.png"), ("SVG render", "symbol-render-1x.png"),
             ("Silhouette overlay", "symbol-overlay.png")]
    for x, (label, file) in zip((32,448,864), names):
        draw.text((x,72),label,fill="black",font=font)
        frame = Image.open(QA/file).convert("RGB")
        plate.paste(frame, (x,112))
    draw.text((32,420),"Overlay: black = shared; red = reference only; cyan = SVG only.",fill="black",font=small)
    m=results["assets"]["symbol"]
    draw.text((32,448),f"Foreground overlap: {m['foreground_iou_percent']:.2f}%  |  95% of edge distances < {m['boundary_p95_source_px']:.2f} source px",fill="black",font=small)
    draw.text((32,490),"Actual SVG at small sizes",fill="black",font=font)
    x=32
    for size in [16,24,32,64]:
        plate.paste(Image.open(QA/f"symbol-{size}px.png").convert("RGB"),(x,530))
        draw.text((x,602),f"{size}px",fill="black",font=small)
        x+=100
    draw.text((32,650),"Vector paths only. Transparent background. No font substitution. No design changes.",fill="black",font=small)
    plate.save(QA / "comparison.png")
    print(json.dumps(results,indent=2))


if __name__ == "__main__":
    run()
