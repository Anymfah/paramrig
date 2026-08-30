"""Reproduce the approved raster silhouettes as editable, font-free SVG paths.

This is a mechanical asset conversion, not a redesign. Rendered-raster QA is
performed separately. Requires Pillow, numpy, scipy and scikit-image.
"""
from pathlib import Path
import hashlib
import json
import re

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from skimage.measure import find_contours

ROOT = Path(__file__).resolve().parents[3]
WORK = Path(__file__).resolve().parent
SOURCE = WORK / "reference/coform-approved-board.png"
# Historical reconstruction only: never overwrite the optically cleaned master.
ASSETS = WORK / "reference/svg-v1"
QA = WORK / "vector-qa"
SCALE = 4
REGIONS = {
    "symbol": (930, 175, 1300, 485),
    "logo": (900, 175, 1310, 600),
}


def unit(v):
    return v / max(np.linalg.norm(v), 1e-12)


def bezier(ctrl, u):
    t = u[:, None]
    return ((1-t)**3 * ctrl[0] + 3*t*(1-t)**2 * ctrl[1]
            + 3*t*t*(1-t) * ctrl[2] + t**3 * ctrl[3])


def fit(points, left, right, tolerance=0.22):
    """Least-squares cubic fitting with bounded sample error and subdivision."""
    if len(points) == 2:
        distance = np.linalg.norm(points[1] - points[0]) / 3
        return [np.array([points[0], points[0] + left*distance,
                          points[1] + right*distance, points[1]])]
    u = np.r_[0, np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
    u /= u[-1]
    for _ in range(5):
        t = u[:, None]
        a = 3*t*(1-t)**2 * left
        b = 3*t*t*(1-t) * right
        base = ((1-t)**3 + 3*t*(1-t)**2) * points[0] + (3*t*t*(1-t)+t**3)*points[-1]
        residual = points - base
        mat = np.array([[np.sum(a*a), np.sum(a*b)], [np.sum(a*b), np.sum(b*b)]])
        rhs = np.array([np.sum(a*residual), np.sum(b*residual)])
        alpha = np.linalg.lstsq(mat, rhs, rcond=None)[0]
        chord = np.linalg.norm(points[-1] - points[0])
        if min(alpha) < chord * 1e-6 or max(alpha) > chord * 4:
            alpha[:] = chord / 3
        ctrl = np.array([points[0], points[0] + left*alpha[0],
                         points[-1] + right*alpha[1], points[-1]])
        curve = bezier(ctrl, u)
        errors = np.linalg.norm(curve - points, axis=1)
        split = int(np.argmax(errors))
        if errors[split] <= tolerance:
            return [ctrl]
        # Newton reparameterization improves the fit without adding segments.
        d = 3*np.diff(ctrl, axis=0)
        dd = 2*np.diff(d, axis=0)
        first = (1-t)**2*d[0] + 2*(1-t)*t*d[1] + t*t*d[2]
        second = (1-t)*dd[0] + t*dd[1]
        delta = curve - points
        denom = np.sum(first*first + delta*second, axis=1)
        step = np.divide(np.sum(delta*first, axis=1), denom,
                         out=np.zeros_like(u), where=np.abs(denom)>1e-10)
        new_u = np.clip(u-step, 0, 1)
        if np.any(np.diff(new_u) <= 0):
            break
        u = new_u
    split = max(1, min(len(points)-2, split))
    tangent = unit(points[split-1] - points[split+1])
    return (fit(points[:split+1], left, tangent, tolerance)
            + fit(points[split:], -tangent, right, tolerance))


def smooth_paths(gray):
    coverage = gaussian_filter(1 - np.array(gray, dtype=float)/255, sigma=0.45)
    contours = find_contours(coverage, 0.5)
    paths = []
    for contour in contours:
        if len(contour) < 8:
            continue
        points = contour[:, ::-1] + 0.5  # Pixel centers -> SVG coordinates.
        points = points[:-1]
        # Start at the top, split the closed curve into four fitting spans.
        points = np.roll(points, -int(np.argmin(points[:, 1])), axis=0)
        closed = np.vstack([points, points[0]])
        spans = np.linspace(0, len(points), 5).astype(int)
        segments = []
        for start, stop in zip(spans[:-1], spans[1:]):
            left = unit(closed[(start+1) % len(points)] - closed[(start-1) % len(points)])
            right = unit(closed[(stop-1) % len(points)] - closed[(stop+1) % len(points)])
            segments.extend(fit(closed[start:stop+1], left, right))
        f = lambda p: f"{p[0]:.3f} {p[1]:.3f}"
        d = "M" + f(segments[0][0])
        d += " ".join("C" + " ".join(f(p) for p in seg[1:]) for seg in segments)
        paths.append(d + "Z")
    return paths


def trace(region, name):
    source = Image.open(SOURCE).convert("RGB")
    gray = source.crop(region).convert("L")
    mask = np.array(gray) < 128
    yy, xx = np.where(mask)
    # Two source pixels of breathing room retain edge antialiasing in QA.
    box = (int(xx.min()) - 2, int(yy.min()) - 2,
           int(xx.max()) + 3, int(yy.max()) + 3)
    gray = gray.crop(box)
    width, height = gray.size
    enlarged = gray.resize((width * SCALE, height * SCALE), Image.Resampling.LANCZOS)
    binary = enlarged.point(lambda value: 0 if value < 128 else 255).convert("RGB")
    paths = smooth_paths(gray)
    content = [f'    <path d="{d}"/>' for d in paths] if name == "symbol" else [
        '    <path fill-rule="evenodd" d="' + " ".join(paths) + '"/>'
    ]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" fill="currentColor" role="img" aria-label="ParamRig">\n'
        f'  <title>ParamRig — Coform {name}</title>\n'
        + "\n".join(content) + "\n</svg>\n"
    )
    target = ASSETS / f"paramrig-coform-{name}.svg"
    target.write_text(svg)
    gray.save(QA / f"{name}-reference.png")
    binary.save(QA / f"{name}-reference-4x.png")
    return {
        "file": str(target.relative_to(ROOT)), "width": width, "height": height,
        "source_box": [region[0] + box[0], region[1] + box[1],
                       region[0] + box[2], region[1] + box[3]],
        "paths": len(content), "bytes": len(svg.encode()),
        "curve_commands": len(re.findall(r"[CQ]", svg)),
    }


if __name__ == "__main__":
    ASSETS.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    results = {name: trace(region, name) for name, region in REGIONS.items()}
    manifest = {"source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "reference": str(SOURCE.relative_to(ROOT)), "scale": SCALE,
                "method": "Grayscale subpixel contours at 50%; sigma 0.45px; cubic fitting tolerance 0.22px",
                "assets": results}
    (QA / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
